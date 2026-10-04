"use client";

/**
 * Paste/drop of image files into a Markdown document.
 *
 * REUSE, not a second uploader: the placeholder lifecycle (the `uploading` /
 * `uploadId` attributes and `renderMarkdown` dropping an in-flight node) is the
 * shared ImageExtension contract, and the placeholder is removed with the
 * shared `removeUploadNode`. The bytes go to the injected host port
 * (`MarkdownImageUploader`); the view never calls a transport, and only the
 * RELATIVE path the host returns is authored into the text - never a bucket
 * name, an object key or an OS path.
 *
 * A FAILED upload removes the placeholder and records the failure, which feeds
 * the same manifest/asset-failure path `hasFailedAsset` reads, so the save
 * control stays blocked (the failed-asset-keeps-unsaved invariant).
 */
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { createSafeId } from "@uniwork/core/utils";
import { removeUploadNode } from "../../../editor/extensions/file-upload";
import type { AssetStatus } from "../../asset-manifest";

/** NUL separator for the dedup key, built without an escape in this source. */
const KEY_SEP = String.fromCharCode(0);

export interface MarkdownImageUploadResult {
  /** The RELATIVE path authored into the Markdown (e.g. "assets/logo.png"). */
  path: string;
  /** The opaque id the host issued; resolution goes through the manifest. */
  assetId: string;
  width?: number;
  height?: number;
}

export type MarkdownImageUploader = (
  file: File,
  uploadId: string,
) => Promise<MarkdownImageUploadResult | null>;

export interface MarkdownImageUploadOptions {
  /** Read live: the editor is created once, the port closure is not. */
  getUploader: () => MarkdownImageUploader | undefined;
  /** A failed upload keeps the document unsavable. */
  onAssetFailure?: (name: string, status: AssetStatus) => void;
  onPendingChange?: (pending: number) => void;
}

function findImageByUploadId(editor: Editor, uploadId: string): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === "image" && node.attrs.uploadId === uploadId) {
      found = pos;
      return false;
    }
    return undefined;
  });
  return found;
}

/** Replace the placeholder for this upload with the resolved relative path. */
function settleImage(editor: Editor, uploadId: string, result: MarkdownImageUploadResult): boolean {
  const pos = findImageByUploadId(editor, uploadId);
  if (pos === null) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    src: result.path,
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
    const key = [file.name, String(file.size), file.type].join(KEY_SEP);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createMarkdownImageUploadExtension(options: MarkdownImageUploadOptions) {
  return Extension.create({
    name: "markdownImageUpload",
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
        if (!file.type.startsWith("image/")) return false;
        const uploadId = createSafeId();
        const preview = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
        const attrs = { src: preview, alt: file.name, uploading: true, uploadId };
        if (pos !== undefined) editor.chain().focus().insertContentAt(pos, { type: "image", attrs }).run();
        else editor.chain().focus().insertContent({ type: "image", attrs }).run();

        notify(1);
        // Fire-and-forget: the upload outlives the mount. If this editor is
        // destroyed before it settles the result is dropped - the placeholder
        // went with the destroyed document, and the write-back path owns
        // delivery for a dead editor (the same rule as the shared uploader).
        // `onPendingChange` still fires with -1 in the `finally` below, so a
        // host counting in-flight uploads cannot be left stuck.
        void (async () => {
          try {
            const result = await uploader(file, uploadId);
            if (editor.isDestroyed) return;
            if (result) settleImage(editor, uploadId, result);
            else {
              removeUploadNode(editor, uploadId);
              options.onAssetFailure?.(file.name, "failed");
            }
          } catch {
            if (!editor.isDestroyed) removeUploadNode(editor, uploadId);
            options.onAssetFailure?.(file.name, "failed");
          } finally {
            if (preview && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(preview);
            notify(-1);
          }
        })();
        return true;
      };

      const handleFiles = (files: File[], pos?: number): boolean => {
        if (!options.getUploader() || files.length === 0) return false;
        const images = dedupFiles(files).filter((file) => file.type.startsWith("image/"));
        if (images.length === 0) return false;
        images.forEach((file, index) => insertPlaceholder(file, index === 0 ? pos : undefined));
        return true;
      };

      return [
        new Plugin({
          key: new PluginKey("markdownImageUpload"),
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
              const dropped = view.posAtCoords({ left: dragEvent.clientX, top: dragEvent.clientY });
              return handleFiles(files, dropped?.pos);
            },
          },
        }),
      ];
    },
  });
}
