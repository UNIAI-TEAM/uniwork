import { z } from "zod";
import { ApiError, request, requestDownload } from "../http";
import { parseWithFallback } from "../schema";

// The several-file download (UNI-2045 W9, SV-9, Advisor Q1): the server zips
// the files on its slow lane, checks each document, skips what it may not
// send (a UniNote page is `not_a_file`) and answers a signed link that lives
// one hour. Written contract-first against the agreed shape; the server half
// is a separate branch.

const enc = encodeURIComponent;

export type DocumentDownloadJobStatus = "queued" | "running" | "ready" | "failed" | "expired";
export type DocumentDownloadSkipReason = "not_found" | "not_a_file" | "too_large";

export interface DocumentDownloadJobSkip {
  document_id: string;
  reason: DocumentDownloadSkipReason;
}

export interface DocumentDownloadJob {
  id: string;
  status: DocumentDownloadJobStatus;
  created_at: string;
  expires_at: string | null;
  download_url: string | null;
  file_count: number | null;
  skipped: DocumentDownloadJobSkip[];
  error: string | null;
}

const SkipSchema = z.object({ document_id: z.string().min(1), reason: z.string() });

// Lenient: status and reason stay strings (the type narrows them), every
// optional field degrades to null on drift and a skipped entry that does not
// parse is dropped. Only the id is load-bearing: without it the job cannot be
// polled, so the whole answer is refused.
const DocumentDownloadJobSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  created_at: z.string().catch(""),
  expires_at: z.string().nullable().catch(null),
  download_url: z.string().nullable().catch(null),
  file_count: z.number().int().nonnegative().nullable().catch(null),
  skipped: z
    .array(z.unknown())
    .catch([])
    .transform((items) => items.flatMap((item) => {
      const parsed = SkipSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })),
  error: z.string().nullable().catch(null),
});

/** POST /api/v1/workspaces/{ws}/documents/download-jobs `{document_ids[1..100]}` → 202 job; null when the answer cannot be polled. */
export async function createDownloadJob(wsId: string, documentIds: readonly string[]): Promise<DocumentDownloadJob | null> {
  const raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents/download-jobs`, {
    method: "POST",
    body: { document_ids: documentIds },
  });
  return parseWithFallback<DocumentDownloadJob | null>(raw, DocumentDownloadJobSchema, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/documents/download-jobs",
  });
}

/** GET /api/v1/workspaces/{ws}/documents/download-jobs/{jobID} (its creator only); null when the answer cannot be read. */
export async function getDownloadJob(wsId: string, jobId: string, signal?: AbortSignal): Promise<DocumentDownloadJob | null> {
  const raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents/download-jobs/${enc(jobId)}`, { signal });
  return parseWithFallback<DocumentDownloadJob | null>(raw, DocumentDownloadJobSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/documents/download-jobs/{jobID}",
  });
}

/** The 422 the create answers when the files add up to more than 1 GiB. */
export function isDownloadTooLargeError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "download_too_large";
}

/**
 * GET /api/v1/workspaces/{ws}/documents/download-jobs/{jobID}/download: the zip of a ready job.
 * A bearer route, so a plain link or navigation answers 401; this goes through the transport
 * (bearer plus one refresh). The path is built from the ids, never from the job's `download_url`.
 * `filename` is the server's, or null when the browser cannot read it. An empty body is not a zip
 * and rejects as an ApiError rather than saving a 0-byte file.
 */
export async function downloadJobZip(wsId: string, jobId: string, signal?: AbortSignal): Promise<{ blob: Blob; filename: string | null }> {
  const out = await requestDownload(`/api/v1/workspaces/${enc(wsId)}/documents/download-jobs/${enc(jobId)}/download`, { signal });
  if (out.blob.size === 0) throw new ApiError("The zip answered no bytes", "internal", 200);
  return out;
}
