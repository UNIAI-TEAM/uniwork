import type { Notification } from "@uniwork/core/types";

/** The verbs the server folds into one `document_changed` row (contract-uni2056-doc-change-notify §4). */
const VERBS = [
  "renamed",
  "moved",
  "trashed",
  "restored",
  "deleted",
  "shelved",
  "unshelved",
  "access_changed",
  "version_created",
  "relocated",
] as const;
type DocumentChangedVerb = (typeof VERBS)[number];

const VERB_SET: ReadonlySet<string> = new Set(VERBS);

export function isDocumentChanged(n: Notification): boolean {
  return n.kind === "document_changed";
}

/**
 * The titles of the sample documents the reader can read now, in order, from the
 * row's top-level `sample_documents` (the server drops the rest); a blank title is skipped.
 */
function sampleTitles(n: Notification): string[] {
  return (n.sample_documents ?? []).map((d) => d.title.trim()).filter((title) => title !== "");
}

/**
 * How many distinct documents the row covers: `params.document_count`, then the
 * row's own `count` (the server sets both to the distinct count), then the
 * titles in hand, and one at the least: the row exists because a document changed.
 */
function documentCount(n: Notification, titles: readonly string[]): number {
  const fromParam = Number.parseInt(n.params.document_count ?? "", 10);
  if (Number.isFinite(fromParam) && fromParam > 0) return fromParam;
  if (Number.isFinite(n.count) && n.count > 0) return n.count;
  return Math.max(1, titles.length);
}

interface DocumentChangedFacts {
  /** null for a verb this client does not word (a newer server). */
  verb: DocumentChangedVerb | null;
  count: number;
  titles: string[];
  /** Documents beyond the titles shown; 0 when every one is named or the count is smaller. */
  more: number;
}

export function documentChangedFacts(n: Notification): DocumentChangedFacts {
  const titles = sampleTitles(n);
  const count = documentCount(n, titles);
  const verb = n.params.verb ?? "";
  return {
    verb: VERB_SET.has(verb) ? (verb as DocumentChangedVerb) : null,
    count,
    titles,
    more: Math.max(0, count - titles.length),
  };
}

/**
 * Whether the row lists any document the reader could read at send time. The server puts only those in
 * `sample_documents`, so none listed means none readable: the list dialog would open to an empty state.
 */
function hasReadableDocuments(n: Notification): boolean {
  return (n.sample_documents ?? []).length > 0;
}

/** More than one document the reader can read: a click opens the list instead of a page. */
export function opensDocumentList(n: Notification): boolean {
  return isDocumentChanged(n) && documentChangedFacts(n).count > 1 && hasReadableDocuments(n);
}

/**
 * One document that was permanently deleted, moved to the trash or purged since has no page to open: the
 * trash view and an archived document's page are manage-only, and most recipients are not managers. Several
 * documents have the list to open, unless the reader can read none of them (then the row is inert).
 */
export function documentChangedHasPage(n: Notification): boolean {
  const { verb, count } = documentChangedFacts(n);
  if (count > 1) return hasReadableDocuments(n);
  return !(verb === "deleted" || verb === "trashed" || n.resource_deleted);
}

/**
 * The locale key of the row's sentence: one per verb and per shape (one named
 * document, one unnamed, several). A verb this client does not word reads the
 * generic "changed N documents"; ids never reach the sentence.
 */
export function documentChangedTitleKey(n: Notification): string {
  const { verb, count, titles } = documentChangedFacts(n);
  const shape = count > 1 ? "many" : titles.length > 0 ? "one" : "untitled";
  // The base key is the generic "changed N documents" sentence notify_local registered.
  if (verb === null && shape === "many") return "notifications.kind.document_changed";
  return `notifications.kind.document_changed_${verb ?? "generic"}_${shape}`;
}

/** The params the sentence places: who, the one document's name, how many (the server's own param name). */
export function documentChangedTitleParams(n: Notification): Record<string, string> {
  const { count, titles } = documentChangedFacts(n);
  return { actor: n.params.actor ?? "", document: titles[0] ?? "", document_count: String(count) };
}
