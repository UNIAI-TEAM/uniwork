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

function mapPreviewError(err: unknown): never {
  if (err instanceof ApiError) {
    if (err.status === 413 || err.code === "too_large") {
      throw new PreviewTooLargeError(err.message);
    }
    if (err.status === 415 || err.code === "unsupported_media_type") {
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
    ctx?: { taskId?: string; workspaceId?: string; commentId?: string; chatSessionId?: string },
    _signal?: AbortSignal,
  ): Promise<Attachment> {
    const att = ctx?.taskId
      ? await uploadTaskAttachment(ctx.taskId, file)
      : ctx?.workspaceId
        ? await uploadWorkspaceAttachment(ctx.workspaceId, file)
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
