import type { UploadProbe } from "../chunked-upload/probe";
import type { FolderUploadTransport } from "./transport";
import type { FolderUploadPlan } from "./types";

// Public shapes of `runFolderUpload` (CONTRACT section 5), kept apart from the
// runner so views can code against them while the runner changes.

export type FolderUploadPhase =
  /** Waiting for the plan answer. */
  | "planning"
  /** The server said folder_uploads_busy; waiting Retry-After once. */
  | "waiting"
  | "uploading"
  /** `retryFailed()` is running (never "uploading", so a settled first run stays settled). */
  | "retrying"
  | "finished"
  | "canceled"
  /** 410: the batch is gone, the folder has to be uploaded again. */
  | "expired"
  /** The plan was refused; `done` rejected with a FolderUploadRefusedError. */
  | "refused";

export interface FolderUploadProgress {
  done: number;
  failed: number;
  /** Files whose bytes are in storage, waiting for their complete. */
  stored: number;
  total: number;
  sentBytes: number;
  totalBytes: number;
  phase: FolderUploadPhase;
}

export interface FolderUploadFailedFile {
  /** Path as planned, root segment first. */
  path: string;
  filename: string;
  /** Server code from complete, or the client's PUT failure code. */
  code: string;
  reason?: string;
  /**
   * True for a client-side failure the server never decided on (network,
   * target_expired, http_5xx, missing_etag, missing_part_url, aborted, or a
   * complete that got no answer); false when the server failed the file
   * (unsupported_media, size_mismatch, storage_quota_exceeded, not_found, …)
   * or the browser cannot read it (file_unreadable): the file has to be fixed
   * or moved and the folder uploaded again.
   */
  retryable: boolean;
}

export interface FolderUploadReport {
  /** Null when the run was canceled before the server answered the plan. */
  batchId: string | null;
  /**
   * The server's root folder and its final title ("Name (1)"); id null before
   * the plan. Null in files mode: the files went to the caller's destination.
   */
  root: { id: string | null; title: string } | null;
  done: number;
  failed: FolderUploadFailedFile[];
  total: number;
  canceled: boolean;
  /** 410 folder_upload_expired: nothing more can happen in this batch. */
  expired: boolean;
  /** Whether `retryFailed()` can run: a batch, a retryable failure, not canceled or expired. */
  canRetry: boolean;
}

export interface FolderUploadRunLimitsInput {
  /** Concurrent storage PUTs (already clamped by `folderUploadLimits`). */
  parallel: number;
  /** Files per complete call. */
  completeBatch: number;
  /** Files above this get a probe in the plan; absent = never (local storage). */
  chunkedThresholdBytes?: number;
}

export interface RunFolderUploadOptions {
  transport: FolderUploadTransport;
  /** A plan without refusal, from `planFolderUpload`. */
  plan: FolderUploadPlan;
  /** The bytes of a planned file, by `PlannedFile.index`. */
  file: (index: number) => Blob;
  /** Target folder id; null is the workspace root. */
  parentId: string | null;
  shareWithWorkspace: boolean;
  limits: FolderUploadRunLimitsInput;
  onProgress?: (progress: FolderUploadProgress) => void;
  /** Refresh document lists: at most once per 2 s during the run, once at the end. */
  onInvalidate?: () => void;
  /** Stable per run; keep it when the user retries a plan that failed on the network. */
  idempotencyKey?: string;
  /** Injected for tests; defaults to `buildUploadProbe`. */
  buildProbe?: (blob: Blob) => Promise<UploadProbe>;
}

export interface FolderUploadHandle {
  /** Resolves with the report; rejects with a FolderUploadRefusedError when the plan is refused. */
  done: Promise<FolderUploadReport>;
  /**
   * Abort PUTs, complete the files already in storage (errors ignored), then
   * cancel the batch on the server. Landed files stay.
   */
  cancel(): void;
  /**
   * Same batch, phase "retrying": re-run the failed files the server still has
   * as pending (a file whose bytes are stored only gets its complete again).
   */
  retryFailed(): Promise<FolderUploadReport>;
}
