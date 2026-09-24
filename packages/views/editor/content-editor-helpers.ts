import type { Editor } from "@tiptap/react";

/** Canonical comparison form for a markdown string: drop the blank lines a
 *  block leaves behind at either end, so both sides of a dirty check compare
 *  like-for-like.
 *
 *  This used to also strip `blob:` image lines with a regex, because an
 *  in-flight image serialised its process-local blob URL into the body. That
 *  is now impossible at the source: the image and fileCard `renderMarkdown`
 *  implementations emit nothing while `attrs.uploading` is set, so a
 *  placeholder never becomes text that has to be scrubbed back out.
 *
 *  Leading blank lines are trimmed too, not just trailing: a placeholder in
 *  the FIRST block leaves its blank line at the head of the document, and a
 *  draft that opens with an empty line is the same content as one that does
 *  not. (The old regex left one such newline behind for the same reason.) */
export function normalizeMarkdown(md: string): string {
  return md.trim();
}

/** `normalizeMarkdown` applied to the live editor's serialized content. */
export function normalizeEditorMarkdown(editor: Editor): string {
  return normalizeMarkdown(editor.getMarkdown());
}

/** True when any node in the document is mid-upload (`attrs.uploading`). The
 *  `return !found` early-out matches the original inline scans verbatim: in
 *  ProseMirror it only stops descending into the matched node's subtree (not
 *  the whole walk), but once `found` flips true the boolean result is fixed. */
export function hasUploadingNode(editor: Editor): boolean {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.attrs.uploading) found = true;
    return !found;
  });
  return found;
}

