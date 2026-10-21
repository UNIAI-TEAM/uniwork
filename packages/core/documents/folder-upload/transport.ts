import { ApiError } from "../../api/http";
import type { UploadProbe } from "../chunked-upload/probe";

// The client side of the folder-upload API, wire shapes of the e6-server
// contract v0.2 (CONTRACT section 9). The runner codes against this
// interface; `createFolderUploadTransport(wsId)` in
// api/endpoints/documents-folder-uploads.ts is the HTTP implementation and
// fake-transport.ts the in-memory one. Wire names stay snake_case.

/**
 * Where one file's bytes go. A "put" target is one request; `auth: "session"`
 * marks the server's own content route (storage that cannot presign, a URL
 * relative to the API origin), which carries the session bearer. Without it
 * the URL is presigned and gets no credentials at all.
 */
export type FileTarget =
  | {
      kind: "put";
      method: string;
      url: string;
      headers: Record<string, string>;
      expires_at: string;
      auth?: "session";
    }
  | {
      kind: "multipart";
      session_id: string;
      part_size: number;
      /** On a refreshed target, only the parts still missing. */
      parts: { part_number: number; method: string; url: string; headers: Record<string, string>; expires_at: string }[];
      expires_at: string;
    };

export type FolderUploadBatchStatus = "open" | "completed" | "canceled" | "expired";
export type FolderUploadFileStatus = "pending" | "done" | "failed";

export interface FolderUploadFileError {
  code: string;
  message: string;
  /** Why validation refused the content (`unsupported_media`). */
  reason?: string;
}

export interface FolderUploadCounts {
  total: number;
  done: number;
  failed: number;
  pending: number;
}

export interface FolderUploadBatchFile {
  file_key: string;
  /** Parent folder under the root, "" for the root itself. */
  path: string;
  filename: string;
  size_bytes: number;
  status: FolderUploadFileStatus;
  document_id: string | null;
  error: FolderUploadFileError | null;
  /** Only while pending; a GET signs a fresh one. */
  target: FileTarget | null;
}

/** FolderUploadBatchSDO: what plan, status and cancel all answer. */
export interface FolderUploadBatch {
  id: string;
  status: FolderUploadBatchStatus;
  parent_id: string | null;
  root_folder_id: string;
  /** The root title after the server's "(n)" decision. */
  root_title: string;
  share_with_workspace: boolean;
  /** Folder paths under the root; the root itself is "". */
  folders: { path: string; id: string }[];
  files: FolderUploadBatchFile[];
  counts: FolderUploadCounts;
  total_bytes: number;
  expires_at: string;
  created_at: string;
}

export interface FolderUploadPlanFile {
  /** Client-generated, 1-64 of [A-Za-z0-9_-], stable for the run. */
  file_key: string;
  /** Parent folder under the root, "" for the root itself. */
  path: string;
  filename: string;
  size_bytes: number;
  /** Only for files above chunked_upload_threshold_bytes. */
  probe?: UploadProbe;
}

export interface FolderUploadPlanBody {
  /** Null is the workspace root. */
  parent_id: string | null;
  root_name: string;
  share_with_workspace: boolean;
  /** Folder paths under the root, parents first; the root is not listed. */
  folders: string[];
  files: FolderUploadPlanFile[];
}

export type FolderUploadCompleteItem =
  | { file_key: string; etag: string }
  | { file_key: string; parts: { part_number: number; etag: string }[] };

export interface FolderUploadCompleteResult {
  file_key: string;
  status: "done" | "failed";
  document_id: string | null;
  error: FolderUploadFileError | null;
}

export interface FolderUploadCompleteResponse {
  results: FolderUploadCompleteResult[];
  batch: { status: FolderUploadBatchStatus; counts: FolderUploadCounts };
}

/** What a finished storage upload hands to complete, without the file key. */
export type StoredObject = { etag: string } | { parts: { part_number: number; etag: string }[] };

export interface FolderUploadPutOpts {
  signal?: AbortSignal;
  /**
   * Part ETags already stored for this file, filled in as parts land, so a
   * refreshed multipart target (missing parts only) resumes instead of
   * starting over.
   */
  storedParts?: Map<number, string>;
}

export interface FolderUploadTransport {
  plan(
    body: FolderUploadPlanBody,
    opts: { idempotencyKey: string; signal?: AbortSignal },
  ): Promise<FolderUploadBatch>;
  /** Sends one file's bytes to its target. */
  put(target: FileTarget, blob: Blob, opts?: FolderUploadPutOpts): Promise<StoredObject>;
  complete(
    batchId: string,
    items: FolderUploadCompleteItem[],
    opts?: { signal?: AbortSignal },
  ): Promise<FolderUploadCompleteResponse>;
  status(batchId: string, opts?: { signal?: AbortSignal }): Promise<FolderUploadBatch>;
  cancel(batchId: string): Promise<FolderUploadBatch>;
}

export type FolderUploadErrorCode = "missing_etag" | "missing_part_url" | "untrusted_target";

export class FolderUploadError extends Error {
  constructor(
    public code: FolderUploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FolderUploadError";
  }
}

/** The plan refusals the server names (contract v0.2 §3); the UI has copy for each. */
export const FOLDER_UPLOAD_REFUSAL_CODES = [
  "folder_upload_too_many_files",
  "folder_upload_too_large",
  "folder_upload_file_too_large",
  "folder_upload_unsupported_type",
  "folder_upload_too_many_folders",
  "document_too_deep",
  "document_parent_kind",
  "invalid_request",
  "folder_uploads_busy",
  "idempotency_payload_mismatch",
] as const;

export type FolderUploadRefusalWireCode = (typeof FOLDER_UPLOAD_REFUSAL_CODES)[number];

/**
 * The server refused the whole plan: nothing was written. `code` is the wire
 * code (a known one, or whatever an older/newer server sent, so the UI falls
 * back to a generic sentence); `fields` carries the numbers to show.
 */
export class FolderUploadRefusedError extends Error {
  constructor(
    public code: string,
    public status: number,
    public fields: Record<string, unknown>,
    message: string,
  ) {
    super(message);
    this.name = "FolderUploadRefusedError";
  }

  /** True when `code` is one the UI has a sentence for. */
  get known(): boolean {
    return (FOLDER_UPLOAD_REFUSAL_CODES as readonly string[]).includes(this.code);
  }
}

/**
 * A plan failure as a refusal, or null when it is not one (network, 5xx,
 * abort). Every 4xx that answers the plan is a refusal of the whole upload;
 * a 403/404 without a code reads as the parent being out of reach.
 */
export function asFolderUploadRefusal(err: unknown): FolderUploadRefusedError | null {
  if (err instanceof FolderUploadRefusedError) return err;
  if (!(err instanceof ApiError) || err.status < 400 || err.status >= 500) return null;
  const fields = { ...err.fields };
  if (err.retryAfterSeconds !== undefined && fields.retry_after === undefined) {
    fields.retry_after = err.retryAfterSeconds;
  }
  const code = err.code && err.code !== "internal" ? err.code : `http_${err.status}`;
  return new FolderUploadRefusedError(code, err.status, fields, err.message);
}
