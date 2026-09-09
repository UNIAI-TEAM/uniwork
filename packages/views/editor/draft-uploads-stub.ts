import type { Attachment } from "@uniwork/core/types/attachment";

export type DraftUpload = {
  clientUploadId: string;
  attachmentId?: string;
  status: "pending" | "uploading" | "uploaded" | "failed" | "done";
  filename?: string;
  size?: number;
  attachment?: Attachment;
};

export function startUpload(_args: unknown): string {
  return "";
}
export function abortUpload(_id: string): void {}
export function hasUploadingDraft(_id?: string): boolean {
  return false;
}
export function attachmentToDraftUpload(att: Attachment): DraftUpload {
  return {
    clientUploadId: att.id,
    attachmentId: att.id,
    status: "uploaded",
    filename: att.filename,
    size: att.size_bytes,
    attachment: att,
  };
}
