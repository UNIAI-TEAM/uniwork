"use client";

import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { DocumentImageView } from "./document-image-view";

/**
 * The page image node (C-01 §3.7).
 *
 * The contract makes an image an INLINE node whose `src` is `asset://{id}`,
 * with `alt` and `width`. `uploading` and `uploadId` are local to a mount —
 * they describe an upload in flight, are never rendered, and `sanitizePageContent`
 * drops both (and a `blob:` src) before anything is sent, so a pending upload
 * can never be stored as content. `height` is a local hint too: it lets the
 * browser reserve the image box before the bytes decode.
 */
export const DocumentImageExtension = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      uploading: { default: false, rendered: false },
      uploadId: { default: null, rendered: false },
      width: {
        default: null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.width ? { width: attrs.width as number } : {},
        parseHTML: (el: HTMLElement) => {
          const w = parseInt(el.getAttribute("width") || "", 10);
          return Number.isFinite(w) ? w : null;
        },
      },
      height: {
        default: null,
        rendered: false,
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(DocumentImageView);
  },
}).configure({
  inline: true,
  allowBase64: false,
});
