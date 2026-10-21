import {
  putUploadSessionPart,
  type UploadSessionPartURL,
} from "../../api/endpoints/documents-upload-sessions";
import type { UploadProbe } from "../chunked-upload/probe";

// The client side of the folder-upload API (CONTRACT section 4). The server
// contract is not signed yet: the runner codes against this interface, tests
// run on the in-memory fake, and the HTTP implementation will live in
// api/endpoints/documents-folder-uploads.ts. Wire names stay snake_case.

/** Where one file's bytes go: a single presigned PUT, or a multipart session. */
export type FileTarget =
  | { kind: "put"; url: string; headers: Record<string, string>; expires_at: string }
  | { kind: "session"; session_id: string; part_size: number; parts: UploadSessionPartURL[]; expires_at: string };

export interface FolderUploadPlanFile {
  /** Client-generated, stable for the run, so complete and retry are idempotent per key. */
  file_key: string;
  path: string;
  filename: string;
  size_bytes: number;
  probe?: UploadProbe;
}

export interface FolderUploadPlanBody {
  parent_id: string;
  root_name: string;
  share_with_workspace: boolean;
  /** Relative folder paths, root included, top-down. */
  folders: string[];
  files: FolderUploadPlanFile[];
}

export interface FolderUploadPlanResponse {
  batch_id: string;
  /** The title after the server's "(n)" decision. */
  root: { id: string; title: string };
  folders: { path: string; id: string }[];
  files: { file_key: string; target: FileTarget }[];
}

export type FolderUploadCompleteItem =
  | { file_key: string; etag: string }
  | { file_key: string; parts: { part_number: number; etag: string }[] };

export interface FolderUploadCompleteResult {
  file_key: string;
  status: "ok" | "error";
  document_id?: string;
  code?: string;
}

export interface FolderUploadStatusFile {
  file_key: string;
  state: "done" | "failed" | "pending";
  code?: string;
  target?: FileTarget;
}

export interface FolderUploadTransport {
  plan(
    body: FolderUploadPlanBody,
    opts: { idempotencyKey: string; signal?: AbortSignal },
  ): Promise<FolderUploadPlanResponse>;
  complete(
    batchId: string,
    items: FolderUploadCompleteItem[],
    opts?: { signal?: AbortSignal },
  ): Promise<FolderUploadCompleteResult[]>;
  status(batchId: string): Promise<{ files: FolderUploadStatusFile[] }>;
  cancel(batchId: string): Promise<void>;
}

export type FolderUploadErrorCode = "missing_etag" | "missing_part_url" | "target_expired";

export class FolderUploadError extends Error {
  constructor(
    public code: FolderUploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FolderUploadError";
  }
}

/** What a finished storage upload hands to complete, without the file key. */
export type StoredObject = { etag: string } | { parts: { part_number: number; etag: string }[] };

export interface PutToStorageOpts {
  /** Injected so tests never reach the network. */
  fetch?: typeof fetch;
}

/**
 * Send one file's bytes to storage. A "put" target is one presigned PUT; a
 * "session" target sends each part through the chunked-upload part PUT, one
 * after another (the runner parallelises across files, not within one).
 * Storage refusals reject as ApiError with the HTTP status; a missing ETag
 * rejects as FolderUploadError("missing_etag"), as the chunked engine does.
 */
export async function putToStorage(
  target: FileTarget,
  blob: Blob,
  signal?: AbortSignal,
  opts: PutToStorageOpts = {},
): Promise<StoredObject> {
  if (target.kind === "put") {
    const etag = await putUploadSessionPart(target.url, blob, { headers: target.headers, signal, fetch: opts.fetch });
    if (!etag) throw new FolderUploadError("missing_etag", "Storage answered without an ETag");
    return { etag };
  }
  const urls = new Map(target.parts.map((p) => [p.part_number, p]));
  const partCount = Math.max(1, Math.ceil(blob.size / target.part_size));
  const parts: { part_number: number; etag: string }[] = [];
  for (let partNumber = 1; partNumber <= partCount; partNumber++) {
    const part = urls.get(partNumber);
    if (!part) throw new FolderUploadError("missing_part_url", `No URL for part ${partNumber}`);
    const start = (partNumber - 1) * target.part_size;
    const etag = await putUploadSessionPart(part.url, blob.slice(start, start + target.part_size), {
      headers: part.headers,
      signal,
      fetch: opts.fetch,
    });
    if (!etag) throw new FolderUploadError("missing_etag", `Storage answered part ${partNumber} without an ETag`);
    parts.push({ part_number: partNumber, etag });
  }
  return { parts };
}
