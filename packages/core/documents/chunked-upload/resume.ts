import { z } from "zod";
import type { StorageAdapter } from "../../types/storage";
import { uploadTargetKey, type UploadSessionTarget } from "./target";

export interface ResumableUpload {
  session_id: string;
  expires_at: string;
  idempotency_key: string;
  /** Parts the server confirmed before the page left (R2-F2); absent on records written before the field existed. */
  completed_parts?: number;
}

const ResumableUploadSchema = z.object({
  session_id: z.string().min(1),
  expires_at: z.string().min(1),
  idempotency_key: z.string().min(1),
  completed_parts: z.number().int().nonnegative().optional(),
});

/** Key of a local file for resume matching: `${name}:${size}:${lastModified}`. */
export function uploadFileKey(
  file: Pick<File, "name" | "size" | "lastModified"> | (Blob & { name?: string; lastModified?: number }),
  fallbackName = "blob",
): string {
  const name = "name" in file && typeof file.name === "string" && file.name.length > 0 ? file.name : fallbackName;
  const lastModified =
    "lastModified" in file && typeof file.lastModified === "number" && Number.isFinite(file.lastModified)
      ? file.lastModified
      : 0;
  return `${name}:${file.size}:${lastModified}`;
}

export function uploadSessionStorageKey(fileKey: string, target: UploadSessionTarget): string {
  return `uniwork:upload-session:${fileKey}:${uploadTargetKey(target)}`;
}

export function saveResumableUpload(
  storage: StorageAdapter,
  fileKey: string,
  target: UploadSessionTarget,
  record: ResumableUpload,
): void {
  const key = uploadSessionStorageKey(fileKey, target);
  storage.setItem(key, JSON.stringify(record));
}

/** The open session for this file key and target, if a previous page left one (and it has not expired). */
export function findResumableUpload(
  storage: StorageAdapter,
  fileKey: string,
  target: UploadSessionTarget,
  nowMs = Date.now(),
): ResumableUpload | null {
  const key = uploadSessionStorageKey(fileKey, target);
  const raw = storage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = ResumableUploadSchema.safeParse(parsed);
    if (!result.success) {
      storage.removeItem(key);
      return null;
    }
    const expiresMs = Date.parse(result.data.expires_at);
    if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
      storage.removeItem(key);
      return null;
    }
    return result.data;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function clearResumableUpload(
  storage: StorageAdapter,
  fileKey: string,
  target: UploadSessionTarget,
): void {
  const key = uploadSessionStorageKey(fileKey, target);
  storage.removeItem(key);
}
