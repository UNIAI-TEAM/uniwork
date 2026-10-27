import { z } from "zod";
import type { DocumentAccessLevel } from "../../types/document";
import { ApiError, request } from "../http";
import { parseWithFallback } from "../schema";
import type { DocumentPrincipalType } from "./documents-sharing";

// Folder contents access (UNI-2244, spec 2026-10-27 §3): one command writes
// the same access list onto every document the caller manages in a folder's
// subtree. A dry run answers counts only; a small subtree is written in the
// request (200), a large one becomes a background batch (202) that the client
// polls. A folder still has no ACL of its own (ADR 0037).

const enc = encodeURIComponent;

export type FolderContentsAccessMode = "merge" | "replace";
export type FolderContentsAccessWarning = "wide_scope" | "downgrade" | "to_private";

export interface FolderContentsAccessItem {
  principal_type: DocumentPrincipalType;
  principal_id: string;
  level: DocumentAccessLevel;
}

export interface FolderContentsAccessInput {
  mode: FolderContentsAccessMode;
  /** 0-100 entries; empty is valid only with `replace` (removes every share). */
  items: FolderContentsAccessItem[];
}

export interface FolderContentsAccessCounts {
  changed: number;
  unchanged: number;
  skipped_not_manageable: number;
  skipped_locked: number;
}

export interface FolderContentsAccessPreview extends FolderContentsAccessCounts {
  losing_users: number;
  downgraded_users: number;
  warnings: FolderContentsAccessWarning[];
}

export type FolderContentsAccessResult =
  | { kind: "dry_run"; total: number; preview: FolderContentsAccessPreview }
  | ({ kind: "sync"; batch_id: string; total: number } & FolderContentsAccessCounts)
  | { kind: "background"; batch_id: string; total: number };

export type FolderContentsAccessBatchStatus = "queued" | "running" | "completed" | "failed";

export interface FolderContentsAccessBatch extends FolderContentsAccessCounts {
  batch_id: string;
  status: FolderContentsAccessBatchStatus;
  total: number;
  processed: number;
  finished_at: string | null;
}

// Server enums stay z.string() (CLAUDE.md API Compatibility) and are narrowed
// below. An unknown batch status reads as running, so the client asks again;
// an unknown warning is dropped.
const BATCH_STATUSES: readonly FolderContentsAccessBatchStatus[] = ["queued", "running", "completed", "failed"];
const WARNINGS: readonly FolderContentsAccessWarning[] = ["wide_scope", "downgrade", "to_private"];

const count = z.number().int().nonnegative().catch(0);
const optionalId = z.string().min(1).optional().catch(undefined);

const warningsField = z
  .array(z.unknown())
  .catch([])
  .transform((list) => WARNINGS.filter((w) => list.includes(w)));

const EMPTY_PREVIEW: FolderContentsAccessPreview = {
  changed: 0,
  unchanged: 0,
  skipped_not_manageable: 0,
  skipped_locked: 0,
  losing_users: 0,
  downgraded_users: 0,
  warnings: [],
};

const PreviewSchema = z
  .object({
    changed: count,
    unchanged: count,
    skipped_not_manageable: count,
    skipped_locked: count,
    losing_users: count,
    downgraded_users: count,
    warnings: warningsField,
  })
  .catch(EMPTY_PREVIEW);

// One schema for all three answers: they differ by which fields are present.
// A malformed body never reaches the transform (parseWithFallback returns the
// fallback), and a field that does not parse reads as absent / zero.
const ResultSchema = z
  .object({
    batch_id: optionalId,
    mode: z.string().optional().catch(undefined),
    total: count,
    changed: count,
    unchanged: count,
    skipped_not_manageable: count,
    skipped_locked: count,
    preview: z.unknown().optional(),
  })
  .transform((r): FolderContentsAccessResult => {
    if (r.preview !== undefined) return { kind: "dry_run", total: r.total, preview: PreviewSchema.parse(r.preview) };
    if (r.batch_id !== undefined) {
      if (r.mode === "background") return { kind: "background", batch_id: r.batch_id, total: r.total };
      return {
        kind: "sync",
        batch_id: r.batch_id,
        total: r.total,
        changed: r.changed,
        unchanged: r.unchanged,
        skipped_not_manageable: r.skipped_not_manageable,
        skipped_locked: r.skipped_locked,
      };
    }
    return { kind: "dry_run", total: r.total, preview: EMPTY_PREVIEW };
  });

const BatchSchema = z.object({
  batch_id: optionalId,
  status: z.string().catch("running"),
  total: count,
  processed: count,
  changed: count,
  unchanged: count,
  skipped_not_manageable: count,
  skipped_locked: count,
  finished_at: z.string().nullable().optional().catch(null),
});

/**
 * PUT /api/v1/documents/{folderID}/contents-access — write the access list
 * onto every managed document under the folder. `dryRun` answers counts only
 * and writes nothing. The kind comes from the body: a `preview` is a dry run,
 * `mode: "background"` is a queued batch, any other body with a `batch_id` is
 * the sync result. A body that cannot be read is a dry run with zero counts
 * ("nothing to change"); it never throws. Refusals reject as ApiError:
 * 422 not_a_folder / document_access_rejected, 409 folder_access_batch_running.
 */
export async function updateFolderContentsAccess(
  folderId: string,
  input: FolderContentsAccessInput,
  opts: { dryRun: boolean },
): Promise<FolderContentsAccessResult> {
  const raw = await request(`/api/v1/documents/${enc(folderId)}/contents-access`, {
    method: "PUT",
    body: { mode: input.mode, items: input.items, dry_run: opts.dryRun },
  });
  return parseWithFallback<FolderContentsAccessResult>(
    raw,
    ResultSchema,
    { kind: "dry_run", total: 0, preview: EMPTY_PREVIEW },
    { endpoint: "PUT /api/v1/documents/{id}/contents-access" },
  );
}

/**
 * GET /api/v1/documents/{folderID}/contents-access/{batchID} — progress of a
 * background batch (only its creator may read it; anyone else gets 404). A
 * body that cannot be read, or an unknown status, reads as `running` with the
 * counts that did parse, so the poll continues.
 */
export async function getFolderContentsAccessBatch(folderId: string, batchId: string): Promise<FolderContentsAccessBatch> {
  const raw = await request(`/api/v1/documents/${enc(folderId)}/contents-access/${enc(batchId)}`);
  const fallback: FolderContentsAccessBatch = {
    batch_id: batchId,
    status: "running",
    total: 0,
    processed: 0,
    changed: 0,
    unchanged: 0,
    skipped_not_manageable: 0,
    skipped_locked: 0,
    finished_at: null,
  };
  const parsed = parseWithFallback<z.infer<typeof BatchSchema> | null>(raw, BatchSchema, null, {
    endpoint: "GET /api/v1/documents/{id}/contents-access/{batchId}",
  });
  if (!parsed) return fallback;
  return {
    batch_id: parsed.batch_id ?? batchId,
    status: BATCH_STATUSES.find((v) => v === parsed.status) ?? "running",
    total: parsed.total,
    processed: parsed.processed,
    changed: parsed.changed,
    unchanged: parsed.unchanged,
    skipped_not_manageable: parsed.skipped_not_manageable,
    skipped_locked: parsed.skipped_locked,
    finished_at: parsed.finished_at ?? null,
  };
}

/** 409 folder_access_batch_running → the running batch's id; any other error, or a 409 without an id, → null. */
export function parseFolderAccessBatchRunning(err: unknown): { batch_id: string } | null {
  if (!(err instanceof ApiError) || err.code !== "folder_access_batch_running") return null;
  const id = err.fields?.batch_id;
  return typeof id === "string" && id !== "" ? { batch_id: id } : null;
}

/** 422 not_a_folder: the id names a document that is not a folder. */
export function isNotAFolderError(err: unknown): boolean {
  return err instanceof ApiError && err.code === "not_a_folder";
}
