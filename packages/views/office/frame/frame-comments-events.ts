import { DOCUMENT_ACCESS_LEVELS, type DocumentAccessLevel } from "@uniwork/core/types/document";

// Pure rules of the frame comments hook (G8-08): which realtime frame tells the
// editor its comments changed, and what level of comment access the host
// advertises. No React here so both are pinned without a frame.

/** The realtime topics that change a document's comment list (contract-collab §7). */
const COMMENT_TOPICS: ReadonlySet<string> = new Set([
  "document.comment_added",
  "document.comment_updated",
  "document.comment_deleted",
  "document.comment_resolved",
  "document.comment_unresolved",
  "document.comment_reaction_added",
  "document.comment_reaction_removed",
  // G8-04: one frame per anchors write that changed a row; it names a version, not a comment.
  "document.comment_anchors_updated",
]);

/**
 * The document id a realtime frame says changed comments, when that is the document the
 * frame edits in this workspace; null for anything else. Frames are ids-only, so this is
 * all the editor is told (`comments.changed {document_id}`) and it re-lists by itself. A
 * frame without a workspace id passes like it does in the realtime sync; one that names
 * another workspace never does.
 */
export function commentsChangedDocument(
  message: { type: string; payload: unknown },
  wsId: string,
  documentId: string,
): string | null {
  if (!COMMENT_TOPICS.has(message.type)) return null;
  const payload = message.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const { document_id: changed, workspace_id: workspace } = payload as { document_id?: unknown; workspace_id?: unknown };
  if (typeof workspace === "string" && workspace !== wsId) return null;
  return typeof changed === "string" && changed === documentId ? changed : null;
}

/**
 * The comment access level the host advertises in `init.commentsLevel` (OQ-C12): the
 * document's effective level (`my_level`), `comment` included (DOC-05). A read-only page never
 * advertises more than `view`. Only a page with no level at all (absent / null) lets the minted
 * token decide between `edit` and `view`; a level the client does not know, or an empty one (an
 * admin-only caller), never maps upward: it reads `view`. The host never guesses `manage`.
 * The frame treats it as a display hint: the server stays the only gate.
 */
export function frameCommentsLevel({
  myLevel,
  readonly,
  canEdit,
}: {
  myLevel: string | null | undefined;
  readonly: boolean;
  canEdit: boolean | undefined;
}): DocumentAccessLevel {
  if (readonly) return "view";
  if (myLevel === undefined || myLevel === null) return canEdit === true ? "edit" : "view";
  return DOCUMENT_ACCESS_LEVELS.find((level) => level === myLevel) ?? "view";
}

/**
 * Whether the host advertises `capabilities.commentsShareView` (G8-18): only a caller who can
 * administer the document through its content, which is `manage` (the server's `canAdminister()`
 * without the admin-only scope, which never opens the frame). The server stays the gate: a
 * Work Product document answers 409 and a caller without the right 403, both mapped for the frame.
 */
export function frameCanShareView(level: DocumentAccessLevel, readonly: boolean): boolean {
  return !readonly && level === "manage";
}
