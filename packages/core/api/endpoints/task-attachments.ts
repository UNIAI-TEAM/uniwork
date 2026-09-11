import { z } from "zod";
import { AttachmentSchema, type Attachment } from "../../types/attachment";
import { attachmentDownloadPath as stableDownloadPath } from "../../types/attachment-url";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const ListResponse = z.object({ attachments: z.array(AttachmentSchema) });

const enc = encodeURIComponent;

export function attachmentContentPath(id: string): string {
  return `/api/v1/attachments/${enc(id)}/content`;
}

export function attachmentDownloadPath(id: string): string {
  return stableDownloadPath(id);
}

export async function listTaskAttachments(taskId: string): Promise<Attachment[]> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/attachments`);
  return parseWithFallback<{ attachments: Attachment[] }>(raw, ListResponse, { attachments: [] }, {
    endpoint: "GET /api/v1/tasks/{id}/attachments",
  }).attachments;
}

export async function uploadTaskAttachment(
  taskId: string,
  file: File,
): Promise<Attachment | null> {
  const form = new FormData();
  form.append("file", file);
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/attachments`, {
    method: "POST",
    body: form,
  });
  return parseWithFallback<Attachment | null>(raw, AttachmentSchema, null, {
    endpoint: "POST /api/v1/tasks/{id}/attachments",
  });
}

export async function getAttachment(id: string): Promise<Attachment | null> {
  const raw = await request(`/api/v1/attachments/${enc(id)}`);
  return parseWithFallback<Attachment | null>(raw, AttachmentSchema, null, {
    endpoint: "GET /api/v1/attachments/{id}",
  });
}

export async function deleteAttachment(id: string): Promise<void> {
  await request(`/api/v1/attachments/${enc(id)}`, { method: "DELETE" });
}
