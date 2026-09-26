import { $, component$, useSignal, type QRL, type Signal } from "@builder.io/qwik";
import { uid } from "../../data";
import type { BulkImportEntry, SignItem, SignProject } from "../../types";
import { diffText, parseBulkTsv, type BulkParsedRow } from "../../utils";

type Commit = QRL<(label: string, update: (draft: SignProject) => void) => void>;

interface PreviewEntry extends BulkImportEntry {
  /** ready：可直接采用；invalid：原因见 reason；awaiting：已确认待比对 */
  previewKind: "ready" | "invalid" | "awaiting";
}

function evaluateRows(rows: BulkParsedRow[], signs: SignItem[]): PreviewEntry[] {
  const now = new Date().toISOString();
  return rows.map((row) => {
    const base: PreviewEntry = {
      id: uid("bulk"),
      row: row.row,
      code: row.code,
      language: row.language,
      targetText: row.targetText,
      reviewer: row.reviewer,
      state: "ready",
      createdAt: now,
      previewKind: "ready",
    };
    if (row.cells.length !== 4) {
      return { ...base, state: "invalid", previewKind: "invalid", reason: `列数为 ${row.cells.length}，应为 4 列（编号、语言、译文、审校人）` };
    }
    if (!row.code) {
      return { ...base, state: "invalid", previewKind: "invalid", reason: "缺少标识编号" };
    }
    if (!row.language) {
      return { ...base, state: "invalid", previewKind: "invalid", reason: "缺少目标语言" };
    }
    if (!row.targetText) {
      return { ...base, state: "invalid", previewKind: "invalid", reason: "缺少译文内容" };
    }
    if (!row.reviewer) {
      return { ...base, state: "invalid", previewKind: "invalid", reason: "缺少审校人" };
    }
    const sign = signs.find((item) => item.code.trim().toLowerCase() === row.code.trim().toLowerCase());
    if (!sign) {
      return { ...base, state: "invalid", previewKind: "invalid", reason: `找不到编号「${row.code}」对应的标识` };
    }
    if (sign.targetLanguage.trim() !== row.language.trim()) {
      return {
        ...base,
        state: "invalid",
        previewKind: "invalid",
        reason: `目标语言对不上：标识 ${sign.code} 当前为「${sign.targetLanguage}」，回传为「${row.language}」`,
      };
    }
    if (sign.status === "confirmed") {
      return { ...base, state: "awaiting", previewKind: "awaiting", signId: sign.id, oldText: sign.targetText };
    }
    return { ...base, signId: sign.id };
  });
}

const STATE_BADGE: Record<BulkImportEntry["state"], { label: string; cls: string }> = {
  ready: { label: "待采用", cls: "badge-info" },
  invalid: { label: "编号/语言对不上", cls: "badge-error" },
  awaiting: { label: "待比对", cls: "badge-warning" },
  applied: { label: "已直接采用", cls: "badge-success" },
  accepted: { label: "比对后采用", cls: "badge-success" },
  rejected: { label: "已放弃", cls: "badge-neutral" },
};

interface BulkImportModalProps {
  open: Signal<boolean>;
  project: Signal<SignProject>;
  commit: Commit;
  onLocate: QRL<(signId: string) => void>;
  onToast: QRL<(message: string) => void>;
}

export default component$((props: BulkImportModalProps) => {
  const pasteText = useSignal("");
  const preview = useSignal<PreviewEntry[]>([]);
  const rejectId = useSignal("");
  const rejectReason = useSignal("");
  const showHistory = useSignal(false);

  const parse = $(() => {
    const rows = parseBulkTsv(pasteText.value);
    if (!rows.length) {
      preview.value = [];
      props.onToast("没有识别到可导入的行");
      return;
    }
    preview.value = evaluateRows(rows, props.project.value.signs);
  });

  const processImport = $(async () => {
    const entries = preview.value;
    if (!entries.length) return;
    const direct = entries.filter((entry) => entry.previewKind === "ready");
    const held = entries.filter((entry) => entry.previewKind !== "ready").map((entry) => {
      const { previewKind: _previewKind, ...persisted } = entry;
      return persisted;
    });
    await props.commit("处理表格回传译文", (draft) => {
      for (const entry of direct) {
        const sign = draft.signs.find((item) => item.id === entry.signId);
        if (!sign) continue;
        sign.targetText = entry.targetText;
        sign.bulkReviewer = entry.reviewer;
        sign.status = "pending";
        sign.updatedAt = new Date().toISOString();
      }
      draft.bulkImports.unshift(...held);
    });
    props.onToast(`已直接采用 ${direct.length} 条，${held.length} 条留待处理`);
    pasteText.value = "";
    preview.value = [];
  });

  const acceptEntry = $(async (entry: BulkImportEntry) => {
    await props.commit("采用回传译文", (draft) => {
      const sign = draft.signs.find((item) => item.id === entry.signId);
      const held = draft.bulkImports.find((item) => item.id === entry.id);
      if (!sign || !held) return;
      sign.versions.unshift({
        id: uid("version"),
        label: `版本 ${sign.versions.length + 1}`,
        createdAt: new Date().toISOString(),
        sourceText: sign.sourceText,
        targetText: sign.targetText,
        status: sign.status,
        terms: structuredClone(sign.terms),
        reviewer: entry.reviewer,
        note: "表格回传采用前快照",
      });
      sign.versions = sign.versions.slice(0, 12);
      sign.targetText = entry.targetText;
      sign.bulkReviewer = entry.reviewer;
      sign.status = "pending";
      sign.updatedAt = new Date().toISOString();
      held.state = "accepted";
      held.decidedAt = new Date().toISOString();
    });
    rejectId.value = "";
    rejectReason.value = "";
    props.onToast("已生成版本快照，译文退回待确认");
  });

  const rejectEntry = $(async (entry: BulkImportEntry) => {
    const reason = rejectReason.value.trim();
    if (!reason) {
      props.onToast("请先填写放弃原因");
      return;
    }
    await props.commit("放弃回传译文", (draft) => {
      const held = draft.bulkImports.find((item) => item.id === entry.id);
      if (!held) return;
      held.state = "rejected";
      held.reason = reason;
      held.decidedAt = new Date().toISOString();
    });
    rejectId.value = "";
    rejectReason.value = "";
    props.onToast("已放弃该回传并留存原因");
  });

  const removeInvalid = $(async (entry: BulkImportEntry) => {
    await props.commit("移除无效回传行", (draft) => {
      draft.bulkImports = draft.bulkImports.filter((item) => item.id !== entry.id);
    });
  });

  const clearHistory = $(async () => {
    await props.commit("清除已处理回传", (draft) => {
      draft.bulkImports = draft.bulkImports.filter((item) => item.state === "invalid" || item.state === "awaiting");
    });
    showHistory.value = false;
  });

  const previewGroups = () => {
    const list = preview.value;
    return {
      ready: list.filter((entry) => entry.previewKind === "ready"),
      awaiting: list.filter((entry) => entry.previewKind === "awaiting"),
      invalid: list.filter((entry) => entry.previewKind === "invalid"),
    };
  };

  const held = () => props.project.value.bulkImports.filter((entry) => entry.state === "awaiting" || entry.state === "invalid");
  const history = () => props.project.value.bulkImports.filter((entry) => entry.state !== "awaiting" && entry.state !== "invalid");
  const groups = previewGroups();
  const pendingCount = held().length;

  const renderDiff = (oldText: string, newText: string) => {
    const tokens = diffText(oldText, newText);
    return (
      <div class="mt-2 rounded-lg bg-slate-900 p-3 text-sm leading-7 text-slate-100">
        {tokens.map((token, index) => (
          <span
            key={index}
            class={token.type === "add" ? "rounded bg-green-400/25 text-green-200" : token.type === "remove" ? "bg-red-400/25 text-red-200 line-through" : ""}
          >
            {token.value}
          </span>
        ))}
      </div>
    );
  };

  return (
    <dialog open={props.open.value} class="modal modal-bottom sm:modal-middle">
      <div class="modal-box max-w-3xl">
        <div class="flex items-start justify-between">
          <div>
            <h3 class="text-lg font-bold">表格批量回传译文</h3>
            <p class="mt-1 text-xs text-slate-500">
              从 Excel/表格直接粘贴，每行 4 列：标识编号、目标语言、译文、审校人（可用制表符分隔，首行表头自动跳过）。
            </p>
          </div>
          <span class="badge badge-lg badge-warning">{pendingCount} 条未处理</span>
        </div>

        <div class="mt-4">
          <textarea
            class="textarea textarea-bordered min-h-28 w-full font-mono text-xs leading-5"
            placeholder={"TR-01\tEnglish\tWaiting Area ...\t王敏\nEM-02\tEnglish\tEMERGENCY EXIT ...\t李审"}
            value={pasteText.value}
            onInput$={(_, element) => (pasteText.value = element.value)}
          />
          <div class="mt-2 flex gap-2">
            <button class="btn btn-sm btn-primary" onClick$={parse}>解析表格</button>
            {preview.value.length > 0 && (
              <button class="btn btn-sm btn-success" onClick$={processImport}>
                开始处理（直接采用 {groups.ready.length} 条）
              </button>
            )}
          </div>
        </div>

        {preview.value.length > 0 && (
          <div class="mt-4 space-y-3">
            <div class="text-xs font-bold text-slate-500">
              解析结果：{groups.ready.length} 条可直接采用 · {groups.awaiting.length} 条已确认待比对 · {groups.invalid.length} 条对不上（行保留）
            </div>
            {[...groups.awaiting, ...groups.invalid, ...groups.ready].map((entry) => (
              <div key={entry.id} class="rounded-xl border border-slate-200 p-3 text-xs">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono font-bold">{entry.code}</span>
                  <span class="badge badge-sm badge-ghost">{entry.language}</span>
                  <span class={`badge badge-sm ${STATE_BADGE[entry.state].cls}`}>{STATE_BADGE[entry.state].label}</span>
                  <span class="text-slate-400">第 {entry.row} 行 · 审校人 {entry.reviewer || "—"}</span>
                </div>
                {entry.previewKind === "invalid" ? (
                  <p class="mt-1 font-semibold text-error">原因：{entry.reason}</p>
                ) : entry.previewKind === "awaiting" ? (
                  <p class="mt-1 text-slate-500">该标识已确认，处理后需比对新旧内容再决定采用或放弃。</p>
                ) : (
                  <p class="mt-1 line-clamp-2 whitespace-pre-line text-slate-600">{entry.targetText}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <div class="divider"></div>

        <div class="max-h-[42vh] space-y-3 overflow-y-auto pr-1">
          <h4 class="text-sm font-bold">待处理记录（{pendingCount}）</h4>
          {pendingCount === 0 && (
            <div class="rounded-xl border border-dashed p-5 text-center text-xs text-slate-400">没有待处理记录。</div>
          )}

          {held().map((entry) => {
            const sign = props.project.value.signs.find((item) => item.id === entry.signId);
            const drifted = entry.state === "awaiting" && sign && sign.targetText !== entry.oldText;
            return (
              <div key={entry.id} class="rounded-xl border border-slate-200 p-3">
                <div class="flex flex-wrap items-center gap-2 text-xs">
                  <span class="font-mono text-sm font-bold">{entry.code}</span>
                  <span class="badge badge-sm badge-ghost">{entry.language}</span>
                  <span class={`badge badge-sm ${STATE_BADGE[entry.state].cls}`}>{STATE_BADGE[entry.state].label}</span>
                  <span class="text-slate-400">审校人 {entry.reviewer || "—"}</span>
                  {sign && (
                    <button class="btn btn-xs btn-ghost" onClick$={() => props.onLocate(sign.id)}>定位标识</button>
                  )}
                </div>

                {entry.state === "invalid" ? (
                  <div class="mt-2 flex items-start justify-between gap-3">
                    <p class="text-xs font-semibold text-error">原因：{entry.reason}</p>
                    <button class="btn btn-xs btn-ghost text-error" onClick$={() => removeInvalid(entry)}>移除该行</button>
                  </div>
                ) : (
                  <>
                    <div class="mt-2 grid gap-2 text-xs">
                      <div>
                        <div class="font-bold text-slate-500">旧译文（已确认）</div>
                        <p class="mt-1 whitespace-pre-line rounded-lg bg-red-50 p-2 text-slate-700">{entry.oldText}</p>
                      </div>
                      <div>
                        <div class="font-bold text-slate-500">新译文（回传）</div>
                        <p class="mt-1 whitespace-pre-line rounded-lg bg-green-50 p-2 text-slate-700">{entry.targetText}</p>
                      </div>
                    </div>
                    {renderDiff(entry.oldText ?? "", entry.targetText)}
                    {drifted && <p class="mt-2 text-[11px] font-semibold text-warning">注意：回传后该译文又被手动修改过，旧译文为回传解析时的内容。</p>}
                    <div class="mt-2 flex flex-wrap items-center gap-2">
                      <button class="btn btn-xs btn-success" onClick$={() => acceptEntry(entry)}>采用（生成快照并退回待确认）</button>
                      {rejectId.value === entry.id ? (
                        <div class="flex w-full flex-wrap items-center gap-2">
                          <input
                            class="input input-xs input-bordered flex-1"
                            placeholder="填写放弃原因，例如：术语译法不符合规范"
                            value={rejectReason.value}
                            onInput$={(_, element) => (rejectReason.value = element.value)}
                          />
                          <button class="btn btn-xs btn-error" onClick$={() => rejectEntry(entry)}>确认放弃</button>
                          <button class="btn btn-xs btn-ghost" onClick$={() => { rejectId.value = ""; rejectReason.value = ""; }}>取消</button>
                        </div>
                      ) : (
                        <button class="btn btn-xs btn-outline" onClick$={() => { rejectId.value = entry.id; rejectReason.value = ""; }}>放弃</button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {history().length > 0 && (
            <div class="mt-4">
              <button class="btn btn-xs btn-ghost" onClick$={() => (showHistory.value = !showHistory.value)}>
                {showHistory.value ? "收起" : "查看"}已处理记录（{history().length}）
              </button>
              {showHistory.value && (
                <div class="mt-2 space-y-2">
                  {history().map((entry) => (
                    <div key={entry.id} class="rounded-lg bg-slate-50 p-2 text-xs">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="font-mono font-bold">{entry.code}</span>
                        <span class="badge badge-sm badge-ghost">{entry.language}</span>
                        <span class={`badge badge-sm ${STATE_BADGE[entry.state].cls}`}>{STATE_BADGE[entry.state].label}</span>
                        <span class="text-slate-400">审校人 {entry.reviewer || "—"}{entry.decidedAt ? ` · ${new Date(entry.decidedAt).toLocaleString()}` : ""}</span>
                      </div>
                      {entry.state === "rejected" && <p class="mt-1 text-slate-600">放弃原因：{entry.reason}</p>}
                    </div>
                  ))}
                  <button class="btn btn-xs btn-ghost text-error" onClick$={clearHistory}>清除已处理记录</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <form method="dialog" class="modal-backdrop">
        <button type="button" aria-label="关闭" onClick$={() => (props.open.value = false)}>close</button>
      </form>
    </dialog>
  );
});
