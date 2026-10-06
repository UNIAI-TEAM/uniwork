// Save-payload oracles for the model's authoritative list mutators. The save
// regenerates the comments/notes parts — or embeds picture bytes — from these
// payloads, so a malformed entry must be refused before it can reach the
// package. Extracted verbatim from model.ts when the B5 numbering additions
// pushed that file past the 500-line budget.
import { DocxEngineError, type DocxCommentInfo, type DocxNoteInfo } from "./engine";

/** Formats the vendored writer can embed (patch.ts embedImage). */
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif"]);

/** Shared bytes oracle for image payloads: a mime the writer cannot embed would
 * otherwise produce a dangling relationship (or a silently dropped picture). */
export function requireImageBytes(image: { base64: string; mime: string } | undefined, what: string): void {
  if (!image || typeof image.base64 !== "string" || image.base64.length === 0) {
    throw new DocxEngineError("bad_image", what + " needs image bytes");
  }
  if (!IMAGE_MIMES.has(image.mime)) {
    throw new DocxEngineError("bad_image_mime", what + " mime " + String(image.mime) + " is not png/jpeg/gif");
  }
}

/** Comment payload oracle. `set_comments` only checks the structure (id,
 * string author/text, unique ids, resolvable parents): real files carry
 * author-less and empty-text entries — `parse-package.ts` maps
 * `attrs['w:author'] ?? ''` and joins possibly-empty paragraphs — and a seeded
 * entry has to round-trip untouched. `authored` (add/reply) additionally
 * refuses blank user text. */
export function requireCommentEntry(comment: DocxCommentInfo, what: string, authored: boolean): void {
  if (!comment || typeof comment !== "object" || typeof comment.id !== "string" || comment.id.length === 0) {
    throw new DocxEngineError("bad_comment", what + " needs a comment object with a non-empty id");
  }
  if (typeof comment.author !== "string" || typeof comment.text !== "string") {
    throw new DocxEngineError("bad_comment", what + " comment " + comment.id + " needs a string author and text");
  }
  if (authored && comment.author.length === 0) throw new DocxEngineError("bad_comment", what + " comment " + comment.id + " needs an author");
  if (authored && comment.text.length === 0) throw new DocxEngineError("empty_comment_text", what + " comment " + comment.id + " needs non-empty text");
}

/** Note payload oracle: the save regenerates the notes part from id/text
 * alone, so an id-less entry or a non-string body is refused before it can
 * reach the part. An empty body is legal (a note with no text is a real Word
 * state); the mutators that author user text refuse blank input instead. */
export function requireNote(note: DocxNoteInfo, what: string): void {
  if (!note || typeof note !== "object") {
    throw new DocxEngineError("bad_note", what + " needs a note object");
  }
  if (typeof note.id !== "string" || note.id.length === 0) {
    throw new DocxEngineError("bad_note", what + " note needs a non-empty id");
  }
  if (typeof note.text !== "string") {
    throw new DocxEngineError("bad_note", what + " note " + note.id + " needs text");
  }
}

/** Copy a note (and its nested rich rows) so the caller's objects never alias
 * into the save options. */
export function cloneNote(note: DocxNoteInfo): DocxNoteInfo {
  const copy = { ...note };
  if (note.richParas) copy.richParas = note.richParas.map((runs) => runs.map((run) => ({ ...run })));
  if (note.spacing) copy.spacing = { ...note.spacing };
  return copy;
}
