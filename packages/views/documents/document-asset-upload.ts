"use client";

import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { createSafeId } from "@uniwork/core/utils";
import { removeUploadNode } from "../editor/extensions/file-upload";
import { assetSrc } from "./document-asset";

/**
 * Paste/drop of image files into a page.
 *
 * Every file becomes an `asset://{id}` node: the bytes go to
 * POST /documents/{id}/assets through the caller's uploader, and only the id
 * is written back into the document. Until the upload answers, the node is a
 * local placeholder with `uploading: true` and a blob preview — neither of
 * which survives sanitisation, so an in-flight upload is never reported (or
 * stored) as content.
 */

export interface DocumentAssetUploadResult {
  assetId: string;
  width?: number;
  height?: number;
}

export type DocumentAssetUploader = (
  file: File,
  uploadId: string,
) => Promise<DocumentAssetUploadResult | null>;

export interface DocumentAssetUploadOptions {
  /** Read live: the editor is created once, the uploader closure is not. */
  getUploader: () => DocumentAssetUploader | undefined;
  /** How many assets are in flight; the save indicator gates on this. */
  onPendingChange?: (pending: number) => void;
  onError?: (error: unknown) => void;
}

function findUploadImage(
  editor: Editor,
  uploadId: string,
): { pos: number; node: ProseMirrorNode } | null {
  let found: { pos: number; node: ProseMirrorNode } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "image" && node.attrs.uploadId === uploadId) {
      found = { pos, node };
      return false;
    }
    return undefined;
  });
  return found;
}

/** Turn this upload's placeholder into the finished asset node, in place. */
function settleImage(editor: Editor, uploadId: string, result: DocumentAssetUploadResult): boolean {
  const hit = findUploadImage(editor, uploadId);
  if (!hit) return false;
  const tr = editor.state.tr.setNodeMarkup(hit.pos, undefined, {
    ...hit.node.attrs,
    src: assetSrc(result.assetId),
    uploading: false,
    uploadId: null,
    width: result.width ?? null,
    height: result.height ?? null,
  });
  editor.view.dispatch(tr);
  return true;
}

/** macOS/Chrome can list the same file twice in one paste. */
function dedupFiles(files: File[]): File[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.name}\0${file.size}\0${file.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createDocumentAssetUploadExtension(options: DocumentAssetUploadOptions) {
  return Extension.create({
    name: "documentAssetUpload",
    addProseMirrorPlugins() {
      const { editor } = this;
      let pending = 0;

      const notify = (delta: number) => {
        pending += delta;
        options.onPendingChange?.(pending);
      };

      const insertPlaceholder = (file: File, pos?: number): boolean => {
        const uploader = options.getUploader();
        if (!uploader || editor.isDestroyed) return false;
        const uploadId = createSafeId();
        const preview =
          typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
        const attrs = { src: preview, alt: file.name, uploading: true, uploadId };
        if (pos !== undefined) {
          editor.chain().focus().insertContentAt(pos, { type: "image", attrs }).run();
        } else {
          editor.chain().focus().insertContent({ type: "image", attrs }).run();
        }

        notify(1);
        void (async () => {
          try {
            const result = await uploader(file, uploadId);
            if (editor.isDestroyed) return;
            if (result) settleImage(editor, uploadId, result);
            else removeUploadNode(editor, uploadId);
          } catch (error) {
            if (!editor.isDestroyed) removeUploadNode(editor, uploadId);
            options.onError?.(error);
          } finally {
            if (preview && typeof URL.revokeObjectURL === "function") {
              URL.revokeObjectURL(preview);
            }
            notify(-1);
          }
        })();
        return true;
      };

      const handleFiles = (files: File[], pos?: number): boolean => {
        if (!options.getUploader() || files.length === 0) return false;
        const unique = dedupFiles(files);
        unique.forEach((file, index) => {
          insertPlaceholder(file, index === 0 ? pos : undefined);
        });
        return true;
      };

      return [
        new Plugin({
          key: new PluginKey("documentAssetUpload"),
          props: {
            handlePaste(_view, event) {
              const files = Array.from(event.clipboardData?.files ?? []);
              if (files.length === 0) return false;
              return handleFiles(files);
            },
            handleDrop(view, event) {
              const dragEvent = event as DragEvent;
              const files = Array.from(dragEvent.dataTransfer?.files ?? []);
              if (files.length === 0) return false;
              const dropped = view.posAtCoords({
                left: dragEvent.clientX,
                top: dragEvent.clientY,
              });
              return handleFiles(files, dropped?.pos);
            },
          },
        }),
      ];
    },
  });
}
