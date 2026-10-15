import { documentLevelRank } from "@uniwork/core/permissions";
import type {
  Document,
  DocumentComment,
  DocumentCommentKind,
  DocumentCommentMentionWithoutAccess,
} from "@uniwork/core/types/document";
import type { MentionCandidate } from "@uniwork/core/types/document-access";
import { buildCommentThreads, type CommentThread } from "../comments/comment-thread";
import { K } from "./document-comments-keys";

// Pure rules of the web comments panel (G8-10, EXPERIENCE-G8 S12/S13). The
// panel component only renders what these return, so the state table rows
// that are decisions (which tab exists, the order of threads, which label an
// anchor reads, who may reply) are tested here without a DOM.

type AnchorFormat = "docx" | "xlsx" | "pptx" | "pdf";
export type DocumentThread = CommentThread<DocumentComment>;

/**
 * The formats whose comments carry an anchor (contract-collab 4.1). Only these
 * get the Comments tab; every other document (pages, Markdown, HTML, files no
 * module opens) has the Discussion alone (Foundation G8, invariant 8).
 */
export function anchorableFormat(doc: Pick<Document, "kind" | "file">): AnchorFormat | null {
  if (doc.kind !== "file" || !doc.file) return null;
  const name = doc.file.filename.toLowerCase();
  const mime = doc.file.mime_type.toLowerCase();
  if (mime.includes("wordprocessingml.document") || name.endsWith(".docx")) return "docx";
  if (mime.includes("spreadsheetml.sheet") || name.endsWith(".xlsx")) return "xlsx";
  if (mime.includes("presentationml.presentation") || name.endsWith(".pptx")) return "pptx";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  return null;
}

const QUOTE_MAX = 60;

/** One anchor label: the catalogue key, its placeholder values, and the full quote for the tooltip. */
interface AnchorLabel {
  key: string;
  values: Record<string, string>;
  title?: string;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const int = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

/** Excel's sheet-name limit; a longer string is an opaque id, not a name. */
const SHEET_NAME_MAX = 31;

/**
 * The anchor's `sheet` is the workbook's stable id when it has one, else the
 * name (contract-collab 4). A value that reads as an id (a ULID, a UUID, bare
 * digits) or cannot be a sheet name is not shown; null then falls back to the
 * range alone.
 */
function readableSheetName(value: unknown): string | null {
  const name = str(value).trim();
  if (!name || name.length > SHEET_NAME_MAX || /[[\]:*?/\\]/.test(name)) return null;
  if (Array.from(name).some((ch) => ch.charCodeAt(0) < 32)) return null;
  if (/^\d+$/.test(name) || /^[0-9A-Z]{26}$/.test(name) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) return null;
  return name;
}

/**
 * The location a comment points at, one key with a placeholder per format
 * (String catalogue › Neo). An anchor the client cannot read yields null: the
 * comment still renders, it just names no place. Numbers are formatted in the
 * reader's locale; the A1 range is Excel syntax and never translated. The web
 * has no open sheet to compare with, so the cell label always carries the sheet
 * qualifier when the anchor holds a readable sheet name (ruling F-04).
 */
export function anchorLabel(anchor: Record<string, unknown> | null, locale: string): AnchorLabel | null {
  if (!anchor) return null;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  switch (anchor.format) {
    case "docx": {
      const quote = str(anchor.quote).replace(/\s+/g, " ").trim();
      if (!quote) return null;
      const chars = Array.from(quote);
      const short = chars.length > QUOTE_MAX ? `${chars.slice(0, QUOTE_MAX).join("")}…` : quote;
      return { key: K.collabAnchorDocx, values: { quote: short }, title: quote };
    }
    case "xlsx": {
      const range = str(anchor.range);
      if (!range) return null;
      const sheet = readableSheetName(anchor.sheet);
      return { key: K.collabAnchorCell, values: { cell: sheet ? `'${sheet.replaceAll("'", "''")}'!${range}` : range } };
    }
    case "pptx": {
      const index = int(anchor.slide_index);
      return index === null ? null : { key: K.collabAnchorSlide, values: { slide: number(index + 1) } };
    }
    case "pdf": {
      const page = int(anchor.page);
      return page === null || page < 1 ? null : { key: K.collabAnchorPage, values: { page: number(page) } };
    }
    default:
      return null;
  }
}

/** The text that says an anchor may have moved or is gone; `exact` and unknown states say nothing. */
export function anchorStateKey(state: string | null | undefined): string | null {
  if (state === "stale") return K.collabAnchorStale;
  if (state === "lost") return K.collabAnchorLost;
  return null;
}

/** "B7" or "B7:D9" -> [row, column] of the top-left cell; unreadable -> null. */
function cellPosition(range: string): [number, number] | null {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d+)/.exec(range.split("!").pop() ?? "");
  if (!match?.[1] || !match[2]) return null;
  let column = 0;
  for (const ch of match[1].toUpperCase()) column = column * 26 + (ch.charCodeAt(0) - 64);
  return [Number(match[2]), column];
}

/** The document-order key of an anchor; null sorts it with the lost ones. */
function anchorOrder(anchor: Record<string, unknown> | null): (number | string)[] | null {
  if (!anchor) return null;
  switch (anchor.format) {
    case "docx": {
      const path = Array.isArray(anchor.path) ? anchor.path.filter((n): n is number => typeof n === "number") : null;
      return path ? [...path, int(anchor.start) ?? 0] : null;
    }
    case "xlsx": {
      const cell = cellPosition(str(anchor.range));
      return cell ? [str(anchor.sheet), ...cell] : null;
    }
    case "pptx": {
      const index = int(anchor.slide_index);
      return index === null ? null : [index];
    }
    case "pdf": {
      const page = int(anchor.page);
      const rect = Array.isArray(anchor.rect) ? anchor.rect.filter((n): n is number => typeof n === "number") : [];
      // PDF space grows upwards: the higher top edge reads first.
      const top = rect.length === 4 ? Math.max(rect[1] ?? 0, rect[3] ?? 0) : 0;
      return page === null ? null : [page, -top];
    }
    default:
      return null;
  }
}

function compareKeys(a: (number | string)[], b: (number | string)[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

const byCreated = (a: DocumentThread, b: DocumentThread) =>
  (a.root.created_at ?? "").localeCompare(b.root.created_at ?? "");

/**
 * S12 order: threads that still point at a place follow the document (docx
 * text order, xlsx sheet then row and column, pptx slide, pdf page then top
 * to bottom); `lost` (or unreadable) anchors come after, by creation time.
 */
function sortByAnchor(threads: DocumentThread[]): DocumentThread[] {
  const placed: { thread: DocumentThread; key: (number | string)[] }[] = [];
  const rest: DocumentThread[] = [];
  for (const thread of threads) {
    const key = thread.root.anchor_state === "lost" ? null : anchorOrder(thread.root.anchor);
    if (key) placed.push({ thread, key });
    else rest.push(thread);
  }
  placed.sort((a, b) => compareKeys(a.key, b.key) || byCreated(a.thread, b.thread));
  return [...placed.map((p) => p.thread), ...rest.sort(byCreated)];
}

interface ThreadGroups {
  open: DocumentThread[];
  resolved: DocumentThread[];
}

/**
 * One tab's threads: the rows of that kind, grouped one level deep, split into
 * open and resolved (a thread is resolved when its root is). Comments follow
 * the anchor order, the Discussion is chronological, oldest first.
 */
export function threadsOf(comments: DocumentComment[], kind: DocumentCommentKind): ThreadGroups {
  const threads = buildCommentThreads(comments.filter((c) => c.kind === kind));
  const ordered = kind === "comment" ? sortByAnchor(threads) : threads;
  return {
    open: ordered.filter((t) => !t.root.resolved_at),
    resolved: ordered.filter((t) => !!t.root.resolved_at),
  };
}

/** The comment a reply answers, or null: a thread whose root was deleted takes no reply (S12 tombstone row). */
export function replyTargetOf(thread: DocumentThread): DocumentComment | null {
  return thread.root.deleted_at ? null : thread.root;
}

/** Where a `?comment=` link lands: the thread holding it, its kind, and whether it is a tombstone. */
interface DeepLinkTarget {
  rootId: string;
  kind: DocumentCommentKind;
  deleted: boolean;
  resolved: boolean;
}

export function findDeepLinkTarget(comments: DocumentComment[], commentId: string): DeepLinkTarget | null {
  const target = comments.find((c) => c.id === commentId);
  if (!target) return null;
  const thread = buildCommentThreads(comments.filter((c) => c.kind === target.kind))
    .find((t) => t.root.id === commentId || t.replies.some((r) => r.id === commentId));
  if (!thread) return null;
  return {
    rootId: thread.root.id,
    kind: target.kind,
    deleted: !!target.deleted_at,
    resolved: !!thread.root.resolved_at,
  };
}

/**
 * A fingerprint of what the list shows, to tell a reload that changed
 * something (announced once, politely) from one that did not.
 */
export function listSignature(comments: DocumentComment[]): string {
  return comments
    .map((c) => `${c.id}:${c.revision}:${c.resolved_at ?? ""}:${c.deleted_at ?? ""}:${c.anchor_state ?? ""}`)
    .join("|");
}

/**
 * `{time}` of `collabEdited` / `collabHistoryEntry` (String catalogue): local
 * time without seconds - the clock alone today, day and month this year, the
 * year as well before that. Vietnamese writes the date `dd/MM` and puts it
 * first (`12/10 15:30`); English names the month (`Oct 12, 3:30 PM`).
 */
export function formatCollabTime(at: string | null | undefined, locale: string, now: Date = new Date()): string {
  if (!at) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const clock = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
  const sameYear = date.getFullYear() === now.getFullYear();
  if (sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) return clock;
  const vietnamese = locale.toLowerCase().startsWith("vi");
  const parts = new Intl.DateTimeFormat(locale, {
    day: vietnamese ? "2-digit" : "numeric",
    month: vietnamese ? "2-digit" : "short",
    year: "numeric",
  }).formatToParts(date);
  // This year drops the year and the separator that led to it.
  const kept = sameYear
    ? parts.filter((part, i) => part.type !== "year" && !(part.type === "literal" && parts[i + 1]?.type === "year"))
    : parts;
  const day = kept.map((part) => part.value).join("");
  return `${day}${vietnamese ? " " : ", "}${clock}`;
}

const MENTION_TOKEN_RE = /\[@((?:[^[\]\\]|\\.)*)\]\(mention:\/\/member\/([0-9A-Za-z]{26})\)/g;
const unescapeMentionLabel = (label: string) => label.replace(/\\(.)/g, "$1");

/** The name a mentioned person is listed under: the server's `display_name`, else the id. */
export const mentionDisplayName = (m: Pick<DocumentCommentMentionWithoutAccess, "user_id" | "display_name">) =>
  m.display_name || m.user_id;

/** Formats a full list of display names via Intl.ListFormat without truncation (G8-18, N4). */
export function formatMentionList(names: readonly string[], locale: string): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  try {
    return new Intl.ListFormat(locale || "vi", { style: "long", type: "conjunction" }).format(clean);
  } catch {
    return clean.join(", ");
  }
}

/** Whether the caller can write/reply/edit own comments in the panel (DOC5-W01: comment, edit, manage). */
export function canCommentInPanel(
  doc: Pick<Document, "my_level"> | null | undefined,
  writeRefused = false,
): boolean {
  if (writeRefused) return false;
  return documentLevelRank(doc?.my_level) >= documentLevelRank("comment");
}

/**
 * Whether the caller can resolve or reopen a thread (DOC5-W02):
 * `edit` and `manage` can resolve/reopen any active thread; `comment` can
 * resolve/reopen only when they authored the thread root.
 */
export function canResolveCommentThread(opts: {
  canWrite: boolean;
  level: string | null | undefined;
  currentUserId: string | undefined;
  root: Pick<DocumentComment, "author_id" | "author_kind" | "deleted_at">;
}): boolean {
  if (!opts.canWrite || Boolean(opts.root.deleted_at)) return false;
  const rank = documentLevelRank(opts.level);
  if (rank >= documentLevelRank("edit")) return true;
  if (rank >= documentLevelRank("comment")) {
    return (
      Boolean(opts.currentUserId) &&
      opts.root.author_id === opts.currentUserId &&
      opts.root.author_kind !== "agent"
    );
  }
  return false;
}

/** Whether the caller can grant `view` share to a specific mentioned candidate (G8-18). */
export function canCallerShareMentionCandidate(opts: {
  doc?: Pick<Document, "my_level" | "owner_kind" | "admin_scope"> | null;
  currentUserId?: string;
  candidateUserId: string;
  canShare?: boolean | ((userId: string) => boolean);
}): boolean {
  if (typeof opts.canShare === "function") return opts.canShare(opts.candidateUserId);
  if (typeof opts.canShare === "boolean") return opts.canShare;
  if (opts.doc) {
    if (opts.doc.owner_kind) return false;
    if (opts.doc.my_level === "manage") return true;
    if (opts.doc.admin_scope === true) return opts.candidateUserId !== opts.currentUserId;
    return false;
  }
  return true;
}

/** Extracts `[@Label](mention://member/<ULID>)` tokens from a comment body in order, deduplicated by userId. */
export function extractMentionTokens(body: string): Array<{ userId: string; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ userId: string; label: string }> = [];
  for (const match of body.matchAll(MENTION_TOKEN_RE)) {
    const label = unescapeMentionLabel(match[1] ?? "");
    const userId = match[2] ?? "";
    const key = userId.toUpperCase();
    if (!userId || seen.has(key)) continue;
    seen.add(key);
    out.push({ userId, label });
  }
  return out;
}

/**
 * Resolves the `can_view: false` mentions that were picked from the picker and
 * are still present in `body` (and not yet granted `view` in this composer session).
 * Typed/pasted tokens not picked with `can_view: false` do not trigger pre-send warning.
 */
export function resolveNoAccessMentionsForSend(opts: {
  body: string;
  pickedCandidates: ReadonlyMap<string, MentionCandidate & { can_share?: boolean }>;
  sharedUserIds: ReadonlySet<string>;
  doc?: Pick<Document, "my_level" | "owner_kind" | "admin_scope"> | null;
  currentUserId?: string;
  canShare?: boolean | ((userId: string) => boolean);
}): DocumentCommentMentionWithoutAccess[] {
  const tokens = extractMentionTokens(opts.body);
  const out: DocumentCommentMentionWithoutAccess[] = [];
  for (const token of tokens) {
    const key = token.userId.toUpperCase();
    if (opts.sharedUserIds.has(key)) continue;
    const picked = opts.pickedCandidates.get(key);
    if (!picked || picked.can_view !== false) continue;
    const explicitCanShare = (picked as { can_share?: boolean }).can_share;
    const canShare =
      typeof explicitCanShare === "boolean"
        ? explicitCanShare
        : canCallerShareMentionCandidate({
            doc: opts.doc,
            currentUserId: opts.currentUserId,
            candidateUserId: picked.user_id,
            canShare: opts.canShare,
          });
    out.push({
      user_id: picked.user_id,
      display_name: picked.display_name || token.label || picked.user_id,
      can_share: canShare,
    });
  }
  return out;
}

