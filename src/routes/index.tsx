import { $, component$, useSignal, useVisibleTask$, type QRL } from "@builder.io/qwik";
import { type DocumentHead } from "@builder.io/qwik-city";
import { createSeedProject, STATUS_LABELS, uid } from "../data";
import type { ImportBatch, ImportRow, ReviewStatus, SignItem, SignProject } from "../types";
import { analyzeSign, cloneTerms, diffText } from "../utils";

const STORAGE_KEY = "sologsb-1008-project-v1";
const IMPORT_KEY = "sologsb-1008-imports-v1";
const WIDTHS = [320, 480, 720, 960] as const;

const IMPORT_ROW_STATUS_LABELS: Record<ImportRow["status"], string> = {
  applied: "已采用",
  awaiting: "待处理",
  discarded: "已放弃",
  error: "未匹配",
};

export const head: DocumentHead = {
  title: "公共标识多语言校对台",
  meta: [
    { name: "description", content: "公共标识译文、术语、版本和版面风险校对工作台" },
  ],
};

function statusClass(status: ReviewStatus) {
  if (status === "confirmed") return "badge-success";
  if (status === "changes") return "badge-error";
  if (status === "pending") return "badge-warning";
  return "badge-neutral";
}

export default component$(() => {
  const project = useSignal<SignProject>(createSeedProject());
  const past = useSignal<SignProject[]>([]);
  const future = useSignal<SignProject[]>([]);
  const hydrated = useSignal(false);
  const online = useSignal(true);
  const previewWidth = useSignal(480);
  const previewFont = useSignal(42);
  const selectedVersionId = useSignal("");
  const termSource = useSignal("");
  const termTarget = useSignal("");
  const commentDraft = useSignal("");
  const replyDraft = useSignal("");
  const replyingTo = useSignal("");
  const toast = useSignal("");
  const previewId = useSignal("");
  const readOnly = useSignal(false);
  const batches = useSignal<ImportBatch[]>([]);
  const importOpen = useSignal(false);
  const importDraft = useSignal("");
  const discardDrafts = useSignal<Record<string, string>>({});
  const active = () => project.value.signs.find((sign) => sign.id === (previewId.value || project.value.activeSignId)) ?? project.value.signs[0];

  const commit = $((label: string, update: (draft: SignProject) => void) => {
    past.value = [...past.value.slice(-49), structuredClone(project.value)];
    future.value = [];
    const draft = structuredClone(project.value);
    update(draft);
    draft.updatedAt = new Date().toISOString();
    project.value = draft;
  });

  const updateActive = $((label: string, update: (sign: SignItem, draft: SignProject) => void) => {
    commit(label, (draft) => {
      const sign = draft.signs.find((item) => item.id === draft.activeSignId);
      if (sign) update(sign, draft);
    });
  });

  const undo = $(() => {
    if (!past.value.length) return;
    const previous = past.value.at(-1)!;
    future.value = [structuredClone(project.value), ...future.value].slice(0, 50);
    past.value = past.value.slice(0, -1);
    project.value = previous;
    toast.value = "已撤销";
  });

  const redo = $(() => {
    if (!future.value.length) return;
    const next = future.value[0];
    past.value = [...past.value.slice(-49), structuredClone(project.value)];
    future.value = future.value.slice(1);
    project.value = next;
    toast.value = "已重做";
  });

  const navigateSign = $((direction: 1 | -1) => {
    if (readOnly.value) return;
    const signs = project.value.signs;
    const index = Math.max(0, signs.findIndex((sign) => sign.id === project.value.activeSignId));
    const next = signs[(index + direction + signs.length) % signs.length];
    commit("切换标识", (draft) => { draft.activeSignId = next.id; });
    selectedVersionId.value = "";
  });

  const setStatus = $((status: ReviewStatus) => {
    commit("更新审校状态", (draft) => {
      const sign = draft.signs.find((item) => item.id === draft.activeSignId);
      if (!sign) return;
      if (sign.emergencyRevision && status === "confirmed") {
        sign.status = "pending";
      } else {
        sign.status = status;
      }
    });
  });

  const toggleEmergency = $(() => {
    commit("切换紧急修订", (draft) => {
      const sign = draft.signs.find((item) => item.id === draft.activeSignId);
      if (!sign) return;
      sign.emergencyRevision = !sign.emergencyRevision;
      if (sign.emergencyRevision) sign.status = "changes";
    });
  });

  const saveVersion = $(() => {
    const sign = project.value.signs.find((item) => item.id === project.value.activeSignId);
    if (!sign) return;
    const versionId = uid("version");
    commit("保存版本快照", (draft) => {
      const current = draft.signs.find((item) => item.id === draft.activeSignId);
      if (!current) return;
      current.versions.unshift({
        id: versionId,
        label: `版本 ${current.versions.length + 1}`,
        createdAt: new Date().toISOString(),
        sourceText: current.sourceText,
        targetText: current.targetText,
        status: current.status,
        terms: cloneTerms(current.terms),
      });
      current.versions = current.versions.slice(0, 12);
    });
    selectedVersionId.value = versionId;
    toast.value = "版本快照已保存";
  });

  const addTerm = $(() => {
    const source = termSource.value.trim();
    const target = termTarget.value.trim();
    if (!source || !target) return;
    updateActive("绑定术语", (sign) => {
      sign.terms.push({ id: uid("term"), source, target, required: true, confirmed: false });
      sign.status = "pending";
    });
    termSource.value = "";
    termTarget.value = "";
  });

  const addComment = $(() => {
    const body = commentDraft.value.trim();
    if (!body) return;
    updateActive("添加审校意见", (sign) => {
      sign.comments.unshift({
        id: uid("comment"),
        author: "当前审校员",
        body,
        createdAt: new Date().toISOString(),
        resolved: false,
        replies: [],
      });
      sign.status = sign.status === "confirmed" ? "changes" : sign.status;
    });
    commentDraft.value = "";
  });

  const addReply = $((commentId: string) => {
    const body = replyDraft.value.trim();
    if (!body) return;
    updateActive("回复审校意见", (sign) => {
      const comment = sign.comments.find((item) => item.id === commentId);
      comment?.replies.push({ id: uid("reply"), author: "当前审校员", body, createdAt: new Date().toISOString() });
    });
    replyDraft.value = "";
    replyingTo.value = "";
  });

  const sharePreview: QRL<() => void> = $(() => {
    const current = project.value.signs.find((item) => item.id === project.value.activeSignId);
    if (!current) return;
    const url = `${window.location.origin}${window.location.pathname}?preview=${encodeURIComponent(current.id)}`;
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    toast.value = "只读预览链接已复制";
  });

  const pendingImportCount = () =>
    batches.value.reduce(
      (count, batch) => count + batch.rows.filter((row) => row.status === "awaiting" || row.status === "error").length,
      0,
    );

  const parseImport = $(() => {
    const source = importDraft.value.trim();
    if (!source) return;
    const rows: ImportRow[] = [];
    const directApplies: { signId: string; targetText: string }[] = [];
    const seenSignIds = new Set<string>();
    const alreadyAwaiting = new Set(
      batches.value.flatMap((batch) => batch.rows).filter((row) => row.status === "awaiting").map((row) => row.signId),
    );
    for (const line of source.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let fields = line.split("\t").map((field) => field.trim());
      if (fields.length < 4) {
        const byComma = line.split(/[,，]/).map((field) => field.trim());
        if (byComma.length > fields.length) fields = byComma;
      }
      const row: ImportRow = {
        id: uid("row"),
        code: fields[0] ?? "",
        language: fields[1] ?? "",
        targetText: fields.length >= 4 ? fields.slice(2, -1).join(" ").trim() : "",
        reviewer: fields.length >= 4 ? fields[fields.length - 1] : "",
        status: "error",
        createdAt: new Date().toISOString(),
      };
      if (fields.length < 4) {
        row.reason = "字段不足：每行需要 编号、目标语言、译文、审校人 四列（Tab 分隔）";
        rows.push(row);
        continue;
      }
      const missing: string[] = [];
      if (!row.code) missing.push("标识编号");
      if (!row.language) missing.push("目标语言");
      if (!row.targetText) missing.push("译文");
      if (!row.reviewer) missing.push("审校人");
      if (missing.length) {
        row.reason = `缺少${missing.join("、")}`;
        rows.push(row);
        continue;
      }
      const sign = project.value.signs.find((item) => item.code.trim().toLowerCase() === row.code.toLowerCase());
      if (!sign) {
        row.reason = `编号 ${row.code} 不存在`;
        rows.push(row);
        continue;
      }
      if (sign.targetLanguage.trim().toLowerCase() !== row.language.toLowerCase()) {
        row.reason = `语言不匹配：${sign.code} 的目标语言为 ${sign.targetLanguage}`;
        rows.push(row);
        continue;
      }
      if (seenSignIds.has(sign.id)) {
        row.reason = "本批次中该编号重复";
        rows.push(row);
        continue;
      }
      seenSignIds.add(sign.id);
      row.signId = sign.id;
      row.previousText = sign.targetText;
      if (sign.status === "confirmed") {
        if (alreadyAwaiting.has(sign.id)) {
          row.reason = "该标识已有待处理的导入记录";
          rows.push(row);
          continue;
        }
        row.status = "awaiting";
      } else {
        row.status = "applied";
        row.resolvedAt = new Date().toISOString();
        directApplies.push({ signId: sign.id, targetText: row.targetText });
      }
      rows.push(row);
    }
    if (!rows.length) return;
    if (directApplies.length) {
      commit("批量导入译文", (draft) => {
        for (const applied of directApplies) {
          const sign = draft.signs.find((item) => item.id === applied.signId);
          if (!sign) continue;
          sign.targetText = applied.targetText;
          sign.status = sign.emergencyRevision ? "changes" : "pending";
          sign.updatedAt = new Date().toISOString();
        }
      });
    }
    batches.value = [{ id: uid("batch"), createdAt: new Date().toISOString(), rows }, ...batches.value];
    importDraft.value = "";
    const applied = rows.filter((row) => row.status === "applied").length;
    const awaiting = rows.filter((row) => row.status === "awaiting").length;
    const errors = rows.filter((row) => row.status === "error").length;
    toast.value = `已采用 ${applied} 条，${awaiting} 条待处理，${errors} 条未匹配`;
  });

  const adoptRow = $((batchId: string, rowId: string) => {
    const row = batches.value.find((batch) => batch.id === batchId)?.rows.find((item) => item.id === rowId);
    if (!row?.signId || row.status !== "awaiting") return;
    const reviewer = row.reviewer;
    const targetText = row.targetText;
    const signId = row.signId;
    commit("采用批量导入译文", (draft) => {
      const sign = draft.signs.find((item) => item.id === signId);
      if (!sign) return;
      sign.versions.unshift({
        id: uid("version"),
        label: `导入前快照 · ${reviewer}`,
        createdAt: new Date().toISOString(),
        sourceText: sign.sourceText,
        targetText: sign.targetText,
        status: sign.status,
        terms: cloneTerms(sign.terms),
      });
      sign.versions = sign.versions.slice(0, 12);
      sign.targetText = targetText;
      sign.status = "pending";
      sign.updatedAt = new Date().toISOString();
      sign.comments.unshift({
        id: uid("comment"),
        author: reviewer,
        body: "批量导入新译文，原文已存档为版本快照，标识退回待确认。",
        createdAt: new Date().toISOString(),
        resolved: false,
        replies: [],
      });
    });
    batches.value = batches.value.map((batch) =>
      batch.id === batchId
        ? { ...batch, rows: batch.rows.map((item) => (item.id === rowId ? { ...item, status: "applied" as const, resolvedAt: new Date().toISOString() } : item)) }
        : batch,
    );
    toast.value = "已采用新译文并生成版本快照";
  });

  const discardRow = $((batchId: string, rowId: string) => {
    const reason = (discardDrafts.value[rowId] ?? "").trim();
    if (!reason) {
      toast.value = "放弃前请填写原因";
      return;
    }
    batches.value = batches.value.map((batch) =>
      batch.id === batchId
        ? { ...batch, rows: batch.rows.map((item) => (item.id === rowId ? { ...item, status: "discarded" as const, reason, resolvedAt: new Date().toISOString() } : item)) }
        : batch,
    );
    const drafts = { ...discardDrafts.value };
    delete drafts[rowId];
    discardDrafts.value = drafts;
    toast.value = "已放弃该行并记录原因";
  });

  const removeRow = $((batchId: string, rowId: string) => {
    batches.value = batches.value
      .map((batch) => (batch.id === batchId ? { ...batch, rows: batch.rows.filter((item) => item.id !== rowId) } : batch))
      .filter((batch) => batch.rows.length > 0);
  });

  const clearResolvedImports = $(() => {
    batches.value = batches.value
      .map((batch) => ({ ...batch, rows: batch.rows.filter((row) => row.status === "awaiting" || row.status === "error") }))
      .filter((batch) => batch.rows.length > 0);
  });

  const fillImportSample = $(() => {
    importDraft.value = [
      "TR-01\tEnglish\tWaiting Area. Please queue behind the yellow line and keep your belongings with you.\t王敏",
      "EM-02\tEnglish\tEMERGENCY EXIT. In an emergency, leave quickly in the direction shown. Do not use the elevator.\t李工",
      "SV-03\t日本語\t飲料水。茶殻や果物の皮などを流さないでください。\t佐藤",
      "PR-07\tEnglish\tNo Smoking. Including e-cigarettes.\t王敏",
      "XX-99\tEnglish\tStaff Only\t王敏",
    ].join("\n");
  });

  const preview = () => analyzeSign(active(), previewWidth.value, previewFont.value);
  const selectedVersion = () => active().versions.find((version) => version.id === selectedVersionId.value) ?? active().versions[0];
  const comparison = () => {
    const version = selectedVersion();
    return version ? diffText(version.targetText, active().targetText) : [];
  };

  useVisibleTask$(({ track }) => {
    track(() => hydrated.value);
    if (!hydrated.value) {
      try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "") as { schema: number; project: SignProject };
        if (stored.schema === 1 && stored.project?.signs?.length) project.value = stored.project;
        const storedImports = JSON.parse(localStorage.getItem(IMPORT_KEY) ?? "null") as { schema: number; batches: ImportBatch[] } | null;
        if (storedImports?.schema === 1 && Array.isArray(storedImports.batches)) batches.value = storedImports.batches;
        const requestedPreview = new URLSearchParams(window.location.search).get("preview") ?? "";
        previewId.value = requestedPreview;
        readOnly.value = Boolean(requestedPreview);
      } catch {
        // Keep bundled sample data when storage is unavailable or malformed.
      }
      hydrated.value = true;
    }
  });

  useVisibleTask$(({ track, cleanup }) => {
    track(() => hydrated.value);
    if (!hydrated.value) return;
    track(() => project.value);
    const timer = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ schema: 1, project: project.value }));
    }, 450);
    cleanup(() => window.clearTimeout(timer));
  });

  useVisibleTask$(({ track, cleanup }) => {
    track(() => hydrated.value);
    if (!hydrated.value) return;
    track(() => batches.value);
    const timer = window.setTimeout(() => {
      localStorage.setItem(IMPORT_KEY, JSON.stringify({ schema: 1, batches: batches.value }));
    }, 450);
    cleanup(() => window.clearTimeout(timer));
  });

  useVisibleTask$(({ cleanup }) => {
    const updateOnline = () => { online.value = navigator.onLine; };
    updateOnline();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && importOpen.value) {
        importOpen.value = false;
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? undo() : undo();
      } else if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        navigateSign(1);
      } else if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        navigateSign(-1);
      } else if (event.key === "[") {
        const index = WIDTHS.indexOf(previewWidth.value as (typeof WIDTHS)[number]);
        previewWidth.value = WIDTHS[Math.max(0, index - 1)];
      } else if (event.key === "]") {
        const index = WIDTHS.indexOf(previewWidth.value as (typeof WIDTHS)[number]);
        previewWidth.value = WIDTHS[Math.min(WIDTHS.length - 1, index + 1)];
      } else if (event.key === "-") {
        previewFont.value = Math.max(28, previewFont.value - 4);
      } else if (event.key === "=") {
        previewFont.value = Math.min(88, previewFont.value + 4);
      }
    };
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    window.addEventListener("keydown", keydown);
    cleanup(() => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("keydown", keydown);
    });
  });

  if (readOnly.value) {
    const sign = active();
    const analysis = analyzeSign(sign, previewWidth.value, previewFont.value);
    return (
      <main data-theme="corporate" class="min-h-screen bg-slate-100 p-6">
        <div class="mx-auto max-w-5xl">
          <div class="mb-4 flex items-center justify-between">
            <div>
              <div class="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Read-only preview</div>
              <h1 class="text-2xl font-bold text-slate-800">{sign.code} · {sign.scenario}</h1>
            </div>
            <span class={`badge ${statusClass(sign.status)}`}>{STATUS_LABELS[sign.status]}</span>
          </div>
          <section class="rounded-3xl bg-white p-14 shadow-xl">
            <div class="mb-3 text-center text-xs text-slate-400">中文原文</div>
            <p class="mx-auto mb-10 max-w-2xl text-center text-lg text-slate-600">{sign.sourceText}</p>
            <div class="mx-auto border-y-4 border-slate-800 py-10 text-center">
              <p class="whitespace-pre-line font-black leading-tight tracking-wide text-slate-900" style={{ fontSize: `${previewFont.value}px` }}>{analysis.visible.join("\n")}</p>
            </div>
            <div class="mt-5 text-center text-sm text-slate-500">{sign.targetLanguage} · {sign.regulation}</div>
          </section>
          <p class="mt-4 text-center text-xs text-slate-400">此链接读取当前浏览器中的本地版本，仅用于演示只读预览。</p>
        </div>
      </main>
    );
  }

  return (
    <div data-theme="corporate" class="min-h-screen bg-slate-100 pb-9 text-slate-800">
      <header class="navbar sticky top-0 z-40 min-h-16 border-b border-slate-700 bg-[#17324d] px-5 text-white shadow-lg">
        <div class="navbar-start gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-white/10 font-black">译</div>
          <div>
            <div class="text-xs uppercase tracking-[0.2em] text-sky-200">Public Sign Review</div>
            <div class="font-bold">公共标识多语言校对台</div>
          </div>
        </div>
        <div class="navbar-center hidden xl:flex">
          <input
            class="input input-sm w-80 border-white/15 bg-white/10 text-white placeholder:text-slate-300"
            value={project.value.title}
            onInput$={(_, element) => commit("修改项目名称", (draft) => { draft.title = element.value; })}
            aria-label="项目名称"
          />
        </div>
        <div class="navbar-end gap-2">
          <span class={`badge ${online.value ? "badge-success" : "badge-warning"} badge-outline`}>{online.value ? "在线" : "离线草稿"}</span>
          <button class="btn btn-sm border-white/20 bg-white/10 text-white hover:bg-white/20" onClick$={() => importOpen.value = true}>
            批量导入
            {pendingImportCount() > 0 && <span class="badge badge-error badge-sm">{pendingImportCount()}</span>}
          </button>
          <button class="btn btn-ghost btn-sm" disabled={!past.value.length} onClick$={undo}>撤销</button>
          <button class="btn btn-ghost btn-sm" disabled={!future.value.length} onClick$={redo}>重做</button>
          <button class="btn btn-sm border-white/20 bg-white/10 text-white hover:bg-white/20" onClick$={sharePreview}>复制只读链接</button>
          <button class={`btn btn-sm ${active().emergencyRevision ? "btn-error" : "btn-warning"}`} onClick$={toggleEmergency}>
            {active().emergencyRevision ? "退出紧急修订" : "紧急修订"}
          </button>
        </div>
      </header>

      {active().emergencyRevision && (
        <div class="alert alert-error sticky top-16 z-30 rounded-none border-x-0 py-2 text-white">
          <span class="text-lg">!</span>
          <span><strong>紧急修订模式</strong>：确认操作已锁定，修改后必须重新审校并保存版本。</span>
        </div>
      )}

      <div class="grid min-h-[calc(100vh-64px)] grid-cols-[270px_minmax(560px,1fr)_430px] gap-px bg-slate-300">
        <aside class="overflow-y-auto bg-slate-50 p-3">
          <div class="mb-3 rounded-xl bg-white p-4 shadow-sm">
            <div class="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">标识清单</div>
            <div class="mt-1 text-lg font-bold text-slate-800">{project.value.signs.length} 处标识</div>
            <p class="mt-1 text-xs leading-5 text-slate-500">{project.value.location}</p>
            {pendingImportCount() > 0 && (
              <button class="btn btn-error btn-xs mt-2 w-full" onClick$={() => importOpen.value = true}>
                未处理导入 {pendingImportCount()} 条
              </button>
            )}
          </div>
          <div class="space-y-2">
            {project.value.signs.map((sign, index) => {
              const risk = analyzeSign(sign, previewWidth.value, previewFont.value);
              return (
                <button
                  key={sign.id}
                  class={`w-full rounded-xl border p-3 text-left transition ${sign.id === project.value.activeSignId ? "border-blue-400 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  onClick$={() => {
                    commit("切换标识", (draft) => { draft.activeSignId = sign.id; });
                    selectedVersionId.value = "";
                  }}
                >
                  <div class="flex items-center justify-between">
                    <span class="font-mono text-xs font-bold text-slate-500">{sign.code}</span>
                    <span class={`badge badge-sm ${statusClass(sign.status)}`}>{STATUS_LABELS[sign.status]}</span>
                  </div>
                  <div class="mt-2 line-clamp-2 text-sm font-semibold text-slate-700">{sign.sourceText}</div>
                  <div class="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                    <span>{sign.targetLanguage}</span>
                    <span class={risk.risk === "high" ? "font-bold text-error" : risk.risk === "medium" ? "font-bold text-warning" : "text-success"}>
                      {risk.risk === "high" ? "高风险" : risk.risk === "medium" ? "需留意" : "版面正常"}
                    </span>
                  </div>
                  <span class="sr-only">第 {index + 1} 条</span>
                </button>
              );
            })}
          </div>
        </aside>

        <main class="min-w-0 bg-white">
          <div class="border-b border-slate-200 bg-slate-50 px-6 py-4">
            <div class="flex items-start justify-between gap-5">
              <div>
                <div class="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">{active().code} · {active().scenario}</div>
                <h1 class="mt-1 text-xl font-bold">中文原文与译文校对</h1>
              </div>
              <div class="join">
                {(["draft", "pending", "changes", "confirmed"] as ReviewStatus[]).map((status) => (
                  <button key={status} class={`btn join-item btn-sm ${active().status === status ? "btn-primary" : "btn-outline"}`} onClick$={() => setStatus(status)}>{STATUS_LABELS[status]}</button>
                ))}
              </div>
            </div>
          </div>

          <div class="space-y-5 p-6">
            <section class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body gap-4 p-5">
                <div class="flex items-center justify-between">
                  <div><div class="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Source</div><h2 class="font-bold">中文原文</h2></div>
                  <span class="badge badge-ghost">简体中文</span>
                </div>
                <textarea
                  class="textarea textarea-bordered min-h-24 w-full text-base leading-7"
                  value={active().sourceText}
                  onInput$={(_, element) => updateActive("修改中文原文", (sign) => { sign.sourceText = element.value; sign.status = "draft"; })}
                />
              </div>
            </section>

            <section class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body gap-4 p-5">
                <div class="grid grid-cols-2 gap-4">
                  <label class="form-control">
                    <span class="label-text mb-1 text-xs font-bold text-slate-500">目标语言</span>
                    <select class="select select-bordered" value={active().targetLanguage} onChange$={(_, element) => updateActive("修改目标语言", (sign) => { sign.targetLanguage = element.value; sign.status = "pending"; })}>
                      {["English", "日本語", "Français", "Deutsch", "한국어", "Español"].map((language) => <option key={language}>{language}</option>)}
                    </select>
                  </label>
                  <label class="form-control">
                    <span class="label-text mb-1 text-xs font-bold text-slate-500">适用场景</span>
                    <input class="input input-bordered" value={active().scenario} onInput$={(_, element) => updateActive("修改适用场景", (sign) => { sign.scenario = element.value; })} />
                  </label>
                </div>
                <label class="form-control">
                  <span class="label-text mb-1 text-xs font-bold text-slate-500">法规或规范提示</span>
                  <input class="input input-bordered" value={active().regulation} onInput$={(_, element) => updateActive("修改法规提示", (sign) => { sign.regulation = element.value; })} />
                </label>
                <div class="divider my-0"></div>
                <div class="flex items-center justify-between">
                  <div><div class="text-xs font-bold uppercase tracking-[0.16em] text-blue-500">Target</div><h2 class="font-bold">目标语言译文</h2></div>
                  <button class="btn btn-sm btn-outline" onClick$={saveVersion}>保存版本快照</button>
                </div>
                <textarea
                  class="textarea textarea-bordered min-h-36 w-full text-lg leading-8"
                  value={active().targetText}
                  onInput$={(_, element) => updateActive("修改译文", (sign) => { sign.targetText = element.value; sign.status = sign.emergencyRevision ? "changes" : "pending"; })}
                />
                <div class="flex flex-wrap gap-2">
                  {active().terms.map((term) => {
                    const matched = active().targetText.toLocaleLowerCase().includes(term.target.toLocaleLowerCase());
                    return (
                      <button
                        key={term.id}
                        title="点击切换术语确认状态"
                        class={`badge badge-lg gap-1 ${matched && term.confirmed ? "badge-success" : matched ? "badge-warning" : "badge-error"}`}
                        onClick$={() => updateActive("确认术语", (sign) => {
                          const current = sign.terms.find((item) => item.id === term.id);
                          if (current) current.confirmed = !current.confirmed;
                        })}
                      >
                        {term.source} → {term.target} {matched ? (term.confirmed ? "✓" : "!") : "×"}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body p-5">
                <div class="flex items-center justify-between">
                  <div><h2 class="font-bold">术语绑定</h2><p class="text-xs text-slate-500">必选术语未出现在译文中时会实时告警。</p></div>
                  <span class="badge badge-outline">{active().terms.length} 条</span>
                </div>
                <div class="mt-4 grid grid-cols-[1fr_1fr_auto] gap-2">
                  <input class="input input-sm input-bordered" placeholder="中文术语" value={termSource.value} onInput$={(_, element) => termSource.value = element.value} />
                  <input class="input input-sm input-bordered" placeholder="目标语言固定译法" value={termTarget.value} onInput$={(_, element) => termTarget.value = element.value} />
                  <button class="btn btn-sm btn-primary" onClick$={addTerm}>绑定</button>
                </div>
                <div class="mt-3 grid gap-2 md:grid-cols-2">
                  {active().terms.map((term) => (
                    <div key={term.id} class="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <div class="min-w-0">
                        <div class="truncate text-xs font-bold">{term.source}</div>
                        <div class="truncate text-xs text-slate-500">{term.target}</div>
                      </div>
                      <div class="flex gap-1">
                        <button class={`btn btn-xs ${term.confirmed ? "btn-success" : "btn-ghost"}`} onClick$={() => updateActive("确认术语", (sign) => { const target = sign.terms.find((item) => item.id === term.id); if (target) target.confirmed = !target.confirmed; })}>确认</button>
                        <button class="btn btn-xs btn-ghost text-error" onClick$={() => updateActive("删除术语", (sign) => { sign.terms = sign.terms.filter((item) => item.id !== term.id); })}>删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body p-5">
                <h2 class="font-bold">审校意见与回复</h2>
                <div class="mt-3 flex gap-2">
                  <textarea class="textarea textarea-bordered min-h-20 flex-1" placeholder="记录措辞、文化适配或法规依据…" value={commentDraft.value} onInput$={(_, element) => commentDraft.value = element.value} />
                  <button class="btn btn-primary self-end" onClick$={addComment}>添加意见</button>
                </div>
                <div class="mt-4 space-y-3">
                  {active().comments.length === 0 && <div class="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">还没有审校意见。</div>}
                  {active().comments.map((comment) => (
                    <article key={comment.id} class={`rounded-xl border-l-4 bg-slate-50 p-3 ${comment.resolved ? "border-success opacity-60" : "border-warning"}`}>
                      <div class="flex items-center justify-between text-xs"><strong>{comment.author}</strong><span class="text-slate-400">{new Date(comment.createdAt).toLocaleString()}</span></div>
                      <p class="my-2 text-sm">{comment.body}</p>
                      {comment.replies.map((reply) => (
                        <div key={reply.id} class="ml-4 my-1 border-l-2 border-slate-200 pl-3 text-xs"><strong>{reply.author}</strong>：{reply.body}</div>
                      ))}
                      {replyingTo.value === comment.id ? (
                        <div class="mt-2 flex gap-2">
                          <input class="input input-xs input-bordered flex-1" value={replyDraft.value} onInput$={(_, element) => replyDraft.value = element.value} />
                          <button class="btn btn-xs btn-primary" onClick$={() => addReply(comment.id)}>发送</button>
                        </div>
                      ) : (
                        <div class="mt-2 flex gap-2">
                          <button class="btn btn-xs btn-ghost" onClick$={() => { replyingTo.value = comment.id; }}>回复</button>
                          <button class="btn btn-xs btn-ghost" onClick$={() => updateActive("更新意见状态", (sign) => { const item = sign.comments.find((entry) => entry.id === comment.id); if (item) item.resolved = !item.resolved; })}>{comment.resolved ? "重新打开" : "标记已解决"}</button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </main>

        <aside class="overflow-y-auto bg-slate-50 p-4">
          <section class="sticky top-4 space-y-4">
            <div class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body p-4">
                <div class="flex items-center justify-between">
                  <div><div class="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Live Preview</div><h2 class="font-bold">版面实时预览</h2></div>
                  <span class={`badge ${preview().risk === "high" ? "badge-error" : preview().risk === "medium" ? "badge-warning" : "badge-success"}`}>
                    {preview().risk === "high" ? "溢出风险" : preview().risk === "medium" ? "接近边界" : "版面安全"}
                  </span>
                </div>
                <div class="mt-3 flex gap-1">
                  {WIDTHS.map((width) => <button key={width} class={`btn btn-xs flex-1 ${previewWidth.value === width ? "btn-primary" : "btn-outline"}`} onClick$={() => previewWidth.value = width}>{width}px</button>)}
                </div>
                <div class="mt-2 flex items-center gap-3 text-xs">
                  <span class="w-20">字号 {previewFont.value}px</span>
                  <input type="range" min="28" max="88" step="2" class="range range-primary range-xs flex-1" value={previewFont.value} onInput$={(_, element) => previewFont.value = Number(element.value)} />
                </div>
                <div class="mt-4 overflow-hidden rounded-xl bg-slate-800 p-3">
                  <div class="mx-auto grid min-h-48 place-items-center overflow-hidden border-4 border-white bg-[#174f3d] p-3 text-center text-white" style={{ width: `${previewWidth.value}px`, maxWidth: "100%" }}>
                    <div>
                      <div style={{ fontSize: `${previewFont.value}px` }} class="font-black leading-[1.18] tracking-wide">{preview().visible.map((line, index) => <div key={index}>{line || "\u00a0"}</div>)}</div>
                    </div>
                  </div>
                </div>
                <div class="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div class="rounded-lg bg-slate-100 p-2"><strong class="block text-lg">{preview().lines.length}</strong><span>预计行数</span></div>
                  <div class="rounded-lg bg-slate-100 p-2"><strong class="block text-lg">{active().targetText.length}</strong><span>字符数</span></div>
                  <div class="rounded-lg bg-slate-100 p-2"><strong class={`block text-lg ${preview().missingTerms.length ? "text-error" : "text-success"}`}>{preview().missingTerms.length}</strong><span>缺失术语</span></div>
                </div>
                {(preview().overflow || preview().tooLong) && <div class="alert alert-error mt-3 py-2 text-xs">{preview().overflow ? "当前字号下内容超过三行，可能截断。" : "译文接近标识建议字符上限。"}</div>}
              </div>
            </div>

            <div class="card border border-slate-200 bg-white shadow-sm">
              <div class="card-body p-4">
                <div class="flex items-center justify-between">
                  <div><h2 class="font-bold">版本比较</h2><p class="text-xs text-slate-500">旧版快照与当前译文逐词对比。</p></div>
                  <span class="badge badge-outline">{active().versions.length} 版</span>
                </div>
                {active().versions.length ? (
                  <>
                    <select class="select select-sm select-bordered mt-3 w-full" value={selectedVersionId.value || active().versions[0].id} onChange$={(_, element) => selectedVersionId.value = element.value}>
                      {active().versions.map((version) => <option key={version.id} value={version.id}>{`${version.label} · ${new Date(version.createdAt).toLocaleTimeString()}`}</option>)}
                    </select>
                    <div class="mt-3 rounded-lg bg-slate-900 p-3 text-sm leading-7 text-slate-100">
                      {comparison().map((token, index) => (
                        <span key={index} class={token.type === "add" ? "rounded bg-green-400/25 text-green-200" : token.type === "remove" ? "bg-red-400/25 text-red-200 line-through" : ""}>{token.value}</span>
                      ))}
                    </div>
                    <div class="mt-2 flex gap-3 text-[11px]"><span class="text-green-700">绿：新增</span><span class="text-red-700">红：删除</span></div>
                  </>
                ) : (
                  <div class="mt-3 rounded-xl border border-dashed p-5 text-center text-xs text-slate-400">保存当前译文后会在这里生成可比较版本。</div>
                )}
              </div>
            </div>

            <div class="rounded-xl bg-[#17324d] p-4 text-xs text-slate-200">
              <div class="mb-2 font-bold text-white">键盘操作</div>
              <div class="grid grid-cols-2 gap-y-1"><span><kbd class="kbd kbd-xs">J/K</kbd> 切换标识</span><span><kbd class="kbd kbd-xs">[ ]</kbd> 预览宽度</span><span><kbd class="kbd kbd-xs">- =</kbd> 字号</span><span><kbd class="kbd kbd-xs">Ctrl/⌘ Z</kbd> 撤销</span></div>
            </div>
          </section>
        </aside>
      </div>

      {importOpen.value && (
        <div class="modal modal-open">
          <div class="modal-box max-w-4xl">
            <div class="flex items-start justify-between">
              <div>
                <h2 class="text-lg font-bold">批量导入译文</h2>
                <p class="mt-1 text-xs text-slate-500">
                  每行一条：标识编号、目标语言、译文、审校人，以 Tab 分隔（可直接从表格软件粘贴）。编号或语言对不上的行会保留并标注原因，其余行照常处理。
                </p>
              </div>
              <button class="btn btn-ghost btn-sm" onClick$={() => importOpen.value = false}>关闭</button>
            </div>
            <textarea
              class="textarea textarea-bordered mt-3 min-h-28 w-full font-mono text-xs leading-6"
              placeholder={"TR-01\tEnglish\tWaiting Area. Please queue behind the yellow line.\t王敏"}
              value={importDraft.value}
              onInput$={(_, element) => importDraft.value = element.value}
            />
            <div class="mt-2 flex items-center justify-between">
              <button class="btn btn-ghost btn-xs" onClick$={fillImportSample}>填入示例</button>
              <div class="flex gap-2">
                {batches.value.some((batch) => batch.rows.some((row) => row.status === "applied" || row.status === "discarded")) && (
                  <button class="btn btn-ghost btn-sm" onClick$={clearResolvedImports}>清除已处理记录</button>
                )}
                <button class="btn btn-primary btn-sm" disabled={!importDraft.value.trim()} onClick$={parseImport}>解析并导入</button>
              </div>
            </div>

            <div class="mt-4 max-h-[52vh] space-y-4 overflow-y-auto pr-1">
              {batches.value.length === 0 && (
                <div class="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">还没有导入记录。待处理记录会保存在本浏览器，重新打开后仍在。</div>
              )}
              {batches.value.map((batch) => (
                <section key={batch.id} class="rounded-xl border border-slate-200">
                  <header class="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    <span class="font-bold">批次 {new Date(batch.createdAt).toLocaleString()}</span>
                    <span>{batch.rows.length} 行 · 待处理 {batch.rows.filter((row) => row.status === "awaiting" || row.status === "error").length}</span>
                  </header>
                  <ul class="divide-y divide-slate-100">
                    {batch.rows.map((row) => {
                      const sign = row.signId ? project.value.signs.find((item) => item.id === row.signId) : undefined;
                      return (
                        <li key={row.id} class="px-3 py-2">
                          <div class="flex items-center justify-between gap-3">
                            <div class="flex min-w-0 items-center gap-2 text-xs">
                              <span class="font-mono font-bold">{row.code || "（空编号）"}</span>
                              <span class="badge badge-ghost badge-sm">{row.language || "未填语言"}</span>
                              <span class="text-slate-500">审校人：{row.reviewer || "未填"}</span>
                            </div>
                            <div class="flex items-center gap-2">
                              <span class={`badge badge-sm ${row.status === "applied" ? "badge-success" : row.status === "awaiting" ? "badge-warning" : row.status === "discarded" ? "badge-neutral" : "badge-error"}`}>
                                {IMPORT_ROW_STATUS_LABELS[row.status]}
                              </span>
                              {row.status === "error" && (
                                <button class="btn btn-ghost btn-xs" onClick$={() => removeRow(batch.id, row.id)}>移除</button>
                              )}
                            </div>
                          </div>
                          {row.status === "error" && <p class="mt-1 text-xs font-semibold text-error">{row.reason}</p>}
                          {row.status === "discarded" && <p class="mt-1 text-xs text-slate-500">放弃原因：{row.reason}</p>}
                          {row.status === "applied" && <p class="mt-1 line-clamp-2 whitespace-pre-line text-xs text-slate-600">{row.targetText}</p>}
                          {row.status === "awaiting" && sign && (
                            <div class="mt-2 rounded-lg bg-slate-50 p-3">
                              <div class="grid grid-cols-2 gap-3 text-xs">
                                <div>
                                  <div class="mb-1 font-bold text-slate-500">当前译文（已确认）</div>
                                  <p class="whitespace-pre-line rounded bg-white p-2 leading-6">{sign.targetText}</p>
                                </div>
                                <div>
                                  <div class="mb-1 font-bold text-blue-600">新译文（{row.reviewer}）</div>
                                  <p class="whitespace-pre-line rounded bg-white p-2 leading-6">{row.targetText}</p>
                                </div>
                              </div>
                              <div class="mt-2 rounded-lg bg-slate-900 p-2 text-xs leading-6 text-slate-100">
                                {diffText(sign.targetText, row.targetText).map((token, index) => (
                                  <span key={index} class={token.type === "add" ? "rounded bg-green-400/25 text-green-200" : token.type === "remove" ? "bg-red-400/25 text-red-200 line-through" : ""}>{token.value}</span>
                                ))}
                              </div>
                              <div class="mt-2 flex flex-wrap items-center gap-2">
                                <button class="btn btn-primary btn-xs" onClick$={() => adoptRow(batch.id, row.id)}>采用（存档快照并退回待确认）</button>
                                <input
                                  class="input input-xs input-bordered flex-1"
                                  placeholder="放弃原因（必填）"
                                  value={discardDrafts.value[row.id] ?? ""}
                                  onInput$={(_, element) => discardDrafts.value = { ...discardDrafts.value, [row.id]: element.value }}
                                />
                                <button class="btn btn-outline btn-error btn-xs" disabled={!(discardDrafts.value[row.id] ?? "").trim()} onClick$={() => discardRow(batch.id, row.id)}>放弃</button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </div>
          <div class="modal-backdrop" onClick$={() => importOpen.value = false}></div>
        </div>
      )}

      {toast.value && <div class="toast toast-end z-50"><div class="alert alert-success"><span>{toast.value}</span></div></div>}
    </div>
  );
});
