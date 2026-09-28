import { z } from "zod";

/**
 * FileService read path (T4, spec 2026-09-22 §8). A file is referenced by its
 * durable `file_id`; the URL a resolve returns is a short-lived view of it and
 * is never persisted into rich text, drafts or business records.
 *
 * Schemas are lenient (server enums as strings); the exported types narrow
 * them, so a switch over `access` or `status` needs a `default`.
 */
export const FileViewSchema = z.object({
  id: z.string(),
  filename: z.string(),
  content_type: z.string(),
  size_bytes: z.number(),
  status: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  ready_at: z.string().nullable().optional(),
});

const FileAccessErrorSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
});

export const FileAccessItemSchema = z.object({
  file_id: z.string(),
  file: FileViewSchema.nullable().optional(),
  access: z.string().optional(),
  url: z.string().optional(),
  url_expires_at: z.string().nullable().optional(),
  error: FileAccessErrorSchema.nullable().optional(),
});

export type FileView = z.infer<typeof FileViewSchema>;

/**
 * `presign`: the URL is signed by storage and names its host and object path.
 * `proxy`: the URL goes through the API, which hides the storage location and
 * re-checks permission on every request.
 */
export type FileAccessMode = "presign" | "proxy";

export interface FileAccessError {
  /** FS-C1 §7 code (`file_not_found`, `file_deleting`, …) or a client-side
   *  `file_unavailable` when the response could not be read. */
  code: string;
  message: string;
}

/**
 * One resolved file, in the order it was requested. Exactly one of
 * `error` and (`file`, `url`) is set: a refused file never carries a URL, so a
 * revoked or deleting file cannot keep showing a stale one.
 */
export interface ResolvedFile {
  fileId: string;
  file: FileView | null;
  access: FileAccessMode | null;
  url: string | null;
  /** When the URL stops working. The UI does not refresh it on a timer or on
   *  a media error (T1-Q7); the next data load resolves again. */
  urlExpiresAt: string | null;
  error: FileAccessError | null;
}

export type FileDisposition = "inline" | "attachment";
