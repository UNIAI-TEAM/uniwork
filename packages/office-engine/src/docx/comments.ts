// Comments family of the DOCX session model, split out of ./model to keep that
// file inside the 500-line budget (same pattern as ./protection and ./fields).
//
// The model owns an authoritative comment list that reaches saveDocx as
// SaveOptions.comments: the save regenerates word/comments.xml from it and
// removes body markers for ids no longer present. An untouched list never
// reaches SaveOptions, so a save keeps word/comments.xml byte-identical (the
// byte-preservation rule).
import { DocxEngineError, type DocxCommentInfo, type DocxParsed, type DocxSaveOptions } from "./engine";
import { requireCommentEntry } from "./payloads";

/** Every id in a comment's thread below it (the id plus its whole reply
 * subtree, transitively â€” files can carry replies to replies). */
function threadSubtree(comments: readonly DocxCommentInfo[], id: string): Set<string> {
  const ids = new Set([id]);
  let size = 0;
  while (size !== ids.size) {
    size = ids.size;
    for (const comment of comments) {
      if (comment.parentId !== undefined && ids.has(comment.parentId)) ids.add(comment.id);
    }
  }
  return ids;
}

/** Pending comment edits of one session: the list the editor replaced, or
 * undefined while the parse's own list stays authoritative. */
export class DocxCommentEdits {
  private comments: DocxCommentInfo[] | undefined;

  constructor(private readonly onDirty: () => void) {}

  /** The authoritative list: the edit's own list until one replaces it, else
   * the parse's. Every call returns fresh copies, never aliasing into the
   * model. */
  list(parsed: DocxParsed): DocxCommentInfo[] {
    const own = this.comments;
    if (own) return own.map((comment) => ({ ...comment }));
    const source = parsed.comments;
    return Array.isArray(source) ? source.map((comment) => ({ ...comment })) : [];
  }

  /** Replace the authoritative list â€” upstream SaveOptions.comments: the save
   * regenerates word/comments.xml from it and removes body markers for ids no
   * longer present. Ids must be unique and every reply must point at a listed
   * parent; the caller's array is copied, never aliased into the plan. Entries
   * are only structurally checked (see requireCommentEntry): a list seeded from
   * the parse carries its own author-less/empty-text entries and must reach the
   * save unchanged. */
  set(comments: DocxCommentInfo[]): void {
    if (!Array.isArray(comments)) {
      throw new DocxEngineError("bad_comment", "set_comments needs a comment list");
    }
    const ids = new Set<string>();
    for (const comment of comments) {
      requireCommentEntry(comment, "set_comments", false);
      if (ids.has(comment.id)) throw new DocxEngineError("duplicate_comment_id", "comment id " + comment.id + " appears twice");
      ids.add(comment.id);
    }
    for (const comment of comments) {
      if (comment.parentId !== undefined && !ids.has(comment.parentId)) {
        throw new DocxEngineError("unknown_comment", "reply " + comment.id + " points at missing parent " + comment.parentId);
      }
    }
    this.comments = comments.map((comment) => ({ ...comment }));
    this.onDirty();
  }

  /** Append one comment (the caller allocates the id; the save assigns the
   * commentsExtended paraId for new entries). */
  add(parsed: DocxParsed, comment: DocxCommentInfo): void {
    requireCommentEntry(comment, "add_comment", true);
    const list = this.list(parsed);
    if (list.some((c) => c.id === comment.id)) throw new DocxEngineError("duplicate_comment_id", "comment id " + comment.id + " already exists");
    this.set([...list, { ...comment }]);
  }

  /** Append a reply anchored to `parentId` (Word: a reply shares the parent
   * comment's document range, so the anchor is the parent's). */
  reply(parsed: DocxParsed, parentId: string, reply: DocxCommentInfo): void {
    requireCommentEntry(reply, "reply_to_comment", true);
    const list = this.list(parsed);
    if (!list.some((c) => c.id === parentId)) throw new DocxEngineError("unknown_comment", "no comment " + parentId + " to reply to");
    if (reply.parentId !== undefined && reply.parentId !== parentId) {
      throw new DocxEngineError("bad_comment", "reply " + reply.id + " carries parentId " + reply.parentId + ", not " + parentId);
    }
    if (list.some((c) => c.id === reply.id)) throw new DocxEngineError("duplicate_comment_id", "comment id " + reply.id + " already exists");
    this.set([...list, { ...reply, parentId }]);
  }

  /** Resolve/reopen a thread: the comment and every reply below it share the
   * flag (Word resolves a thread as a unit). */
  resolve(parsed: DocxParsed, id: string, done: boolean): void {
    const list = this.list(parsed);
    if (!list.some((c) => c.id === id)) throw new DocxEngineError("unknown_comment", "no comment " + id + " to resolve");
    const ids = threadSubtree(list, id);
    this.set(list.map((c) => (ids.has(c.id) ? { ...c, done } : c)));
  }

  /** Delete a comment; its whole reply subtree goes with it (Word deletes the
   * thread). The body markers disappear because the save strips markers for ids
   * no longer in the list (upstream removeDeletedCommentMarkers). */
  remove(parsed: DocxParsed, id: string): void {
    const list = this.list(parsed);
    if (!list.some((c) => c.id === id)) throw new DocxEngineError("unknown_comment", "no comment " + id + " to delete");
    const gone = threadSubtree(list, id);
    this.set(list.filter((c) => !gone.has(c.id)));
  }

  /** Only the edit the user made; the key stays absent otherwise so an
   * untouched list never reaches SaveOptions. */
  saveOptions(): DocxSaveOptions {
    return this.comments === undefined ? {} : { comments: this.comments.map((comment) => ({ ...comment })) };
  }

  clear(): void {
    this.comments = undefined;
  }
}