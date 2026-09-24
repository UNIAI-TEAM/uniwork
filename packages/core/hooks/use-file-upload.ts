"use client";

import { useCallback, useState } from "react";
import type { Attachment } from "@uniwork/core/types/attachment";
import { attachmentDownloadPath } from "@uniwork/core/types/attachment-url";
import { MAX_FILE_SIZE } from "@uniwork/core/constants/upload";

export type UploadResult = Attachment & {
  link: string;
  markdownLink: string;
};

export interface UploadContext {
  taskId?: string;
  commentId?: string;
  chatSessionId?: string;
}

function pickMarkdownLink(att: Attachment): string {
  if (att.markdown_url) return att.markdown_url;
  if (att.id) return attachmentDownloadPath(att.id);
  return att.url;
}

export function toUploadResult(att: Attachment): UploadResult {
  return { ...att, link: att.url, markdownLink: pickMarkdownLink(att) };
}

export type UploadFileFn = (
  file: File,
  context?: UploadContext,
  signal?: AbortSignal,
) => Promise<Attachment>;

/**
 * TipTap upload helper. Until Task 5, pass `uploadFile` from the host
 * (or leave unset — callers then rely on ContentEditor `onUploadFile`).
 */
export function useFileUpload(
  uploadFile?: UploadFileFn,
  onError?: (error: Error, file: File) => void,
) {
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (
      file: File,
      context?: UploadContext,
      signal?: AbortSignal,
    ): Promise<UploadResult | null> => {
      if (!uploadFile) {
        const err = new Error("upload not configured");
        onError?.(err, file);
        return null;
      }
      if (file.size > MAX_FILE_SIZE) {
        const err = new Error("file too large");
        onError?.(err, file);
        return null;
      }
      setUploading(true);
      try {
        const att = await uploadFile(file, context, signal);
        return toUploadResult(att);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        onError?.(err, file);
        return null;
      } finally {
        setUploading(false);
      }
    },
    [uploadFile, onError],
  );

  return { upload, uploading, uploadWithToast: upload };
}
