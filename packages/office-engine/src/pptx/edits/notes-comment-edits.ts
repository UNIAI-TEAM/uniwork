// A5e (UNI-927) - speaker-notes + comment edits (logic half).
//
// Binds the three vendored pptx-ops kinds this area owns to one typed,
// validated op builder. The wire round registers `NotesCommentEdit` as
// `PptxEdit` kinds in model.ts and calls the builder mechanically:
//
//   this.txn(buildNotesCommentOps(this.opened, this.fitWidthPx, edit))
//
// Vendored contract (READ ONLY - never imported; cited for every field):
//   setNotes      packages/pptx-ops/src/ops/slide-ops.ts:664 (validate
//                 :665-668 -> resolveSlide + text must be a string; apply
//                 :669-675 -> setSlideNotes(opened, index, text),
//                 packages/pptx-engine/src/notes.ts:107, which overwrites the
//                 notesSlide body and creates the part (plus a notesMaster)
//                 when absent). A string of any length is accepted - an empty
//                 string clears the body.
//   addComment    packages/pptx-ops/src/ops/slide-ops.ts:679 (validate
//                 :680-686 -> resolveSlide + non-empty text + non-empty
//                 author; apply :687-696 -> addSlideComment,
//                 packages/pptx-engine/src/comments.ts:168, which assigns the
//                 authorId/idx pair).
//   deleteComment packages/pptx-ops/src/ops/slide-ops.ts:700 (validate
//                 :701-706 -> resolveSlide + authorId number + idx number;
//                 apply :707-719 -> deleteSlideComment,
//                 packages/pptx-engine/src/comments.ts:219, keyed by the
//                 (authorId, idx) pair).
//
// All three kinds are geometry-free - notes and comments live on their own
// package parts, never in an element rect - so no px->EMU conversion happens
// here; `fitWidthPx` stays in the signature only because every engine-half
// builder shares the same mechanical wire call.
import { PptxEngineError, type OpenedPptxLike, type PptxOp, type PptxSlideLike } from "../engine";

/** The edit kinds this module builds (registered as PptxEdit kinds by the
 * wire round):
 *  - set_notes      -> vendored `setNotes` (slide target + text; an empty
 *                      string clears the notes body);
 *  - add_comment    -> vendored `addComment` (slide target + non-empty text +
 *                      non-empty author);
 *  - delete_comment -> vendored `deleteComment` (slide target + the
 *                      (authorId, idx) pair identifying one comment). */
export type NotesCommentEdit =
  | { op: "set_notes"; slideIndex: number; text: string }
  | { op: "add_comment"; slideIndex: number; text: string; author: string }
  | { op: "delete_comment"; slideIndex: number; authorId: number; idx: number };

const requireSlide = (opened: OpenedPptxLike, slideIndex: number, op: string): PptxSlideLike => {
  const slide = Number.isInteger(slideIndex) && slideIndex >= 0 ? opened.deck.slides[slideIndex] : undefined;
  if (!slide) {
    throw new PptxEngineError("no_slide", op + ": slide index " + String(slideIndex) + " does not exist");
  }
  return slide;
};

/** One validated edit -> the vendored op the executor runs. Refusals are
 * typed PptxEngineError codes: no_slide (slide index absent from the deck),
 * bad_notes_text (notes text is not a string), bad_comment_text (comment text
 * missing, empty or non-string), bad_comment_author (author missing, empty or
 * non-string), bad_comment_ref (authorId or idx is not a number). */
export function buildNotesCommentOps(
  opened: OpenedPptxLike,
  fitWidthPx: number,
  edit: NotesCommentEdit,
): PptxOp[] {
  // Package-part state: nothing to convert (see the module header). `void`
  // keeps the uniform wire signature honest about the deliberate non-use.
  void fitWidthPx;
  switch (edit.op) {
    case "set_notes": {
      requireSlide(opened, edit.slideIndex, "set_notes");
      // Mirrors slide-ops.ts:667 - a string of any length (empty clears).
      if (typeof edit.text !== "string") {
        throw new PptxEngineError("bad_notes_text", 'set_notes "text" must be a string');
      }
      return [{ op: "setNotes", target: { slide: edit.slideIndex }, text: edit.text }];
    }
    case "add_comment": {
      requireSlide(opened, edit.slideIndex, "add_comment");
      // Mirrors slide-ops.ts:682-683 - non-empty text.
      if (typeof edit.text !== "string" || edit.text.length === 0) {
        throw new PptxEngineError("bad_comment_text", 'add_comment "text" must be a non-empty string');
      }
      // Mirrors slide-ops.ts:684-685 - non-empty author.
      if (typeof edit.author !== "string" || edit.author.length === 0) {
        throw new PptxEngineError("bad_comment_author", 'add_comment "author" must be a non-empty string');
      }
      return [{ op: "addComment", target: { slide: edit.slideIndex }, text: edit.text, author: edit.author }];
    }
    case "delete_comment": {
      requireSlide(opened, edit.slideIndex, "delete_comment");
      // Mirrors slide-ops.ts:703 - number type only; the pair is the ref.
      if (typeof edit.authorId !== "number" || typeof edit.idx !== "number") {
        throw new PptxEngineError("bad_comment_ref", 'delete_comment "authorId" and "idx" must be numbers');
      }
      return [{ op: "deleteComment", target: { slide: edit.slideIndex }, authorId: edit.authorId, idx: edit.idx }];
    }
  }
}