/**
 * Editor attachment transport stub until Task 5 wires `/api/v1/attachments`.
 * Product components import this instead of a uniwork-style `api` singleton.
 */

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

async function notWired<T>(op: string): Promise<T> {
  throw new Error(`attachment API not wired yet: ${op}`);
}

export const api = {
  getBaseUrl(): string {
    return "";
  },
  getAttachment(id: string): Promise<Attachment> {
    return notWired(`getAttachment(${id})`);
  },
  getAttachmentTextContent(id: string): Promise<string> {
    return notWired(`getAttachmentTextContent(${id})`);
  },
  getAttachmentBlob(id: string): Promise<Blob> {
    return notWired(`getAttachmentBlob(${id})`);
  },
  uploadFile(
    _file: File,
    _ctx?: { taskId?: string; commentId?: string; chatSessionId?: string },
    _signal?: AbortSignal,
  ): Promise<Attachment> {
    return notWired("uploadFile");
  },
  searchTasks(_opts: unknown): Promise<{ tasks: unknown[] }> {
    return Promise.resolve({ tasks: [] });
  },
  searchProjects(_opts: unknown): Promise<{ projects: unknown[] }> {
    return Promise.resolve({ projects: [] });
  },
};
