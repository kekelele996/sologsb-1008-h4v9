export type ReviewStatus = "draft" | "pending" | "confirmed" | "changes";

export interface Reply {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface ReviewComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  resolved: boolean;
  replies: Reply[];
}

export interface TermBinding {
  id: string;
  source: string;
  target: string;
  required: boolean;
  confirmed: boolean;
}

export interface VersionSnapshot {
  id: string;
  label: string;
  createdAt: string;
  sourceText: string;
  targetText: string;
  status: ReviewStatus;
  terms: TermBinding[];
  reviewer?: string;
  note?: string;
}

/** 表格批量回传单条记录的处理状态 */
export type BulkImportState =
  | "ready" // 解析预览：未确认标识，可直接采用
  | "invalid" // 编号或语言对不上，留存并显示原因
  | "awaiting" // 已确认标识，等待新旧比对后采用/放弃
  | "applied" // 未确认标识，新译文已直接采用
  | "accepted" // 已确认标识，比对后采用
  | "rejected"; // 已确认标识，放弃并留存原因

export interface BulkImportEntry {
  id: string;
  row: number;
  code: string;
  language: string;
  targetText: string;
  reviewer: string;
  state: BulkImportState;
  reason?: string;
  signId?: string;
  /** 解析回传时已确认标识的旧译文，用于新旧比对 */
  oldText?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface SignItem {
  id: string;
  code: string;
  sourceText: string;
  targetLanguage: string;
  targetText: string;
  scenario: string;
  regulation: string;
  status: ReviewStatus;
  terms: TermBinding[];
  comments: ReviewComment[];
  versions: VersionSnapshot[];
  emergencyRevision: boolean;
  /** 最近一次表格回传的审校人 */
  bulkReviewer?: string;
  updatedAt: string;
}

export interface SignProject {
  id: string;
  title: string;
  location: string;
  activeSignId: string;
  signs: SignItem[];
  bulkImports: BulkImportEntry[];
  updatedAt: string;
}

export interface PersistedProject {
  schema: 1;
  project: SignProject;
}

export interface DiffToken {
  type: "same" | "add" | "remove";
  value: string;
}
