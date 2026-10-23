/**
 * Editor attachment transport — wired to `/api/v1/attachments` (Task 5/9).
 */

import {
  attachmentContentPath,
  getAttachment,
  uploadTaskAttachment,
  uploadWorkspaceAttachment,
} from "@uniwork/core/api/endpoints/task-attachments";
import { ApiError, requestBlob, requestText } from "@uniwork/core/api/http";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import type { Attachment } from "@uniwork/core/types/attachment";

export class AttachmentTextTooLargeError extends Error {
  constructor(message = "Attachment text too large") {
    super(message);
    this.name = "AttachmentTextTooLargeError";
  }
}

export class AttachmentTextUnsupportedError extends Error {
  constructor(message = "Attachment text unsupported") {
    super(message);
    this.name = "AttachmentTextUnsupportedError";
  }
}

export class PreviewTooLargeError extends Error {
  constructor(message = "Preview too large") {
    super(message);
    this.name = "PreviewTooLargeError";
  }
}

export class PreviewUnsupportedError extends Error {
  constructor(message = "Preview unsupported") {
    super(message);
    this.name = "PreviewUnsupportedError";
  }
}

// Both vocabularies are live until every module's cutover (UNI-747): legacy
// rows answer too_large / unsupported_media_type, FileService rows answer the
// FS-C1 codes. The status is the same in both, so it decides first and a
// body whose code did not parse still maps.
const TOO_LARGE_CODES = new Set(["too_large", "file_too_large"]);
const UNSUPPORTED_CODES = new Set(["unsupported_media_type", "file_type_rejected"]);

export function mapPreviewError(err: unknown): never {
  if (err instanceof ApiError) {
    if (err.status === 413 || TOO_LARGE_CODES.has(err.code)) {
      throw new PreviewTooLargeError(err.message);
    }
    if (err.status === 415 || UNSUPPORTED_CODES.has(err.code)) {
      throw new PreviewUnsupportedError(err.message);
    }
  }
  throw err;
}

export const api = {
  getBaseUrl(): string {
    return runtimeConfig().apiUrl;
  },
  async getAttachment(id: string): Promise<Attachment> {
    const att = await getAttachment(id);
    if (!att) throw new Error(`attachment not found: ${id}`);
    return att;
  },
  async getAttachmentTextContent(id: string): Promise<string> {
    try {
      return await requestText(attachmentContentPath(id));
    } catch (err) {
      mapPreviewError(err);
    }
  },
  async getAttachmentBlob(id: string): Promise<Blob> {
    try {
      return await requestBlob(attachmentContentPath(id));
    } catch (err) {
      mapPreviewError(err);
    }
  },
  async uploadFile(
    file: File,
    ctx?: {
      taskId?: string;
      workspaceId?: string;
      commentId?: string;
      chatSessionId?: string;
      purpose?: string;
    },
    _signal?: AbortSignal,
  ): Promise<Attachment> {
    const att = ctx?.taskId
      ? await uploadTaskAttachment(ctx.taskId, file, ctx.purpose)
      : ctx?.workspaceId
        ? await uploadWorkspaceAttachment(ctx.workspaceId, file, ctx.purpose)
        : null;
    if (!att) throw new Error("upload failed");
    return att;
  },
  searchTasks(_opts: unknown): Promise<{ tasks: unknown[] }> {
    return Promise.resolve({ tasks: [] });
  },
  searchProjects(_opts: unknown): Promise<{ projects: unknown[] }> {
    return Promise.resolve({ projects: [] });
  },
};
