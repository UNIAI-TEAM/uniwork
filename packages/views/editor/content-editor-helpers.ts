import type { Editor } from "@tiptap/react";
import type { Attachment } from "@uniwork/core/types";

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

/**
 * Merged attachment list fed to `AttachmentDownloadProvider`.
 *
 * Caller-supplied `attachments` (issue / comment editors that pre-load the full
 * `attachments[]` from the server) take precedence — we only append session
 * uploads the caller doesn't already have, so a parent re-render that includes
 * the same record doesn't end up with two copies.
 *
 * One exception on id collision: when the caller's copy has an EMPTY
 * `download_url` (the create-issue draft strips the short-lived signed URL
 * before persisting), backfill it from the session upload. The session copy
 * holds the this-response signed URL, so the just-pasted image first-paints
 * from it instead of taking an extra redirect hop through `markdown_url`.
 */
export function mergeProviderAttachments(
  attachments: Attachment[] | undefined,
  sessionUploads: Attachment[],
): Attachment[] | undefined {
  if (sessionUploads.length === 0) return attachments;
  const sessionById = new Map(sessionUploads.map((a) => [a.id, a]));
  const merged: Attachment[] = [];
  for (const a of attachments ?? []) {
    const session = a.id ? sessionById.get(a.id) : undefined;
    if (session) sessionById.delete(a.id);
    merged.push(
      session && !a.download_url
        ? { ...a, download_url: session.download_url }
        : a,
    );
  }
  merged.push(...sessionById.values());
  return merged;
}

