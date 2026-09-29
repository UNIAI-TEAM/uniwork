import { z } from "zod";
import { DocumentEnvelopeSchema, type Document } from "../../types/document";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// Office endpoints (plan G2-07 / UNI-690): capability, jobs, blank create and
// the explicit copy. Every response goes through parseWithFallback and a
// malformed answer degrades to null, the same rule as the rest of the
// Documents surface. The job payload never carries an engine address, a
// storage key or a grant — only ids, states and the pinned engine identity.

const enc = encodeURIComponent;

/** The engine operations the job route accepts. export and convert answer a
 *  typed unsupported_operation until an engine lane binds a converter (Q7). */
export type OfficeOperation = "open" | "serialize" | "export" | "convert";
export type OfficeFormat = "docx" | "xlsx" | "pptx" | "pdf" | "md" | "html" | "xls" | "odt";

export interface OfficeCapabilityRow {
  operation: string;
  runtime: string;
  evidenceLevel: string;
  /** The engine build binds the operation (it would run). */
  engineBound: boolean;
  /** The product rule: bound and proven. false means the UI hides the action. */
  supported: boolean;
  reason: string | null;
  targetFormat: string | null;
}

export interface OfficeCapabilities {
  documentId: string;
  format: string;
  engineVersion: string;
  operations: OfficeCapabilityRow[];
}

export interface OfficeJobError {
  code: string;
  reason: string | null;
  kind: string | null;
  retryable: boolean;
}

export interface OfficeJobResult {
  sourceFormat: string;
  targetFormat: string;
  fidelity: { level: string; lost: string[] };
  content: { sheets: string[]; cells: Record<string, string>; paragraphs: string[] };
}

export interface OfficeJob {
  jobId: string;
  documentId: string;
  operation: string;
  format: string;
  state: string;
  baseRevision: string;
  baseVersionId: string;
  outputFileId: string | null;
  outputChecksum: string | null;
  outputLength: number | null;
  targetFormat: string | null;
  result: OfficeJobResult | null;
  error: OfficeJobError | null;
  engineName: string;
  engineVersion: string;
  contractVersion: string;
  protocolVersion: string;
  committedVersionId: string | null;
  deadlineAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeRequestOpts {
  /** Mint one key per user intent; retries of that intent reuse it. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface StartOfficeJobBody {
  operation: OfficeOperation;
  /** Optional: server-side it must match the document's format. */
  format?: OfficeFormat;
  /** Decimal string of the base revision the writer saw; omitted = current. */
  base_revision?: string;
  /** The editor's document model reference (serialize). */
  document_model_ref?: string;
  target_format?: OfficeFormat;
}

export interface CreateBlankDocumentFileBody {
  format: OfficeFormat;
  title: string;
  parent_id?: string;
}

export interface CopyDocumentBody {
  /** Must be "copy": the server answers copy_consent_required otherwise. */
  consent: "copy";
  title?: string;
  parent_id?: string;
  job_id?: string;
}

const CapabilityRowSchema = z.object({
  operation: z.string(),
  runtime: z.string(),
  evidence_level: z.string(),
  engine_bound: z.boolean(),
  supported: z.boolean(),
  reason: z.string().optional(),
  target_format: z.string().optional().nullable(),
});

const CapabilitiesSchema = z.object({
  document_id: z.string().optional(),
  format: z.string(),
  engine_version: z.string(),
  operations: z.array(CapabilityRowSchema),
});

const JobErrorSchema = z.object({
  code: z.string(),
  reason: z.string().optional(),
  kind: z.string().optional(),
  retryable: z.boolean().optional(),
});

const JobResultSchema = z.object({
  source_format: z.string(),
  target_format: z.string(),
  fidelity: z.object({
    level: z.string(),
    lost: z.array(z.string()).optional().default([]),
  }),
  content: z.object({
    sheets: z.array(z.string()).optional().default([]),
    cells: z.record(z.string(), z.string()).optional().default({}),
    paragraphs: z.array(z.string()).optional().default([]),
  }),
});

const JobSchema = z.object({
  job_id: z.string(),
  document_id: z.string(),
  operation: z.string(),
  format: z.string(),
  state: z.string(),
  base_revision: z.string(),
  base_version_id: z.string(),
  output_file_id: z.string().optional().nullable(),
  output_checksum_sha256: z.string().optional().nullable(),
  output_length: z.number().optional().nullable(),
  target_format: z.string().optional().nullable(),
  result: JobResultSchema.optional().nullable(),
  error: JobErrorSchema.optional().nullable(),
  engine_name: z.string().optional(),
  engine_version: z.string().optional(),
  contract_version: z.string().optional(),
  protocol_version: z.string().optional(),
  committed_version_id: z.string().optional().nullable(),
  deadline_at: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

function idempotencyHeaders(opts?: OfficeRequestOpts): Record<string, string> | undefined {
  return opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined;
}

function narrowJob(raw: unknown): OfficeJob | null {
  const job = parseWithFallback<z.infer<typeof JobSchema> | null>(raw, JobSchema, null, {
    endpoint: "office job",
  });
  if (!job) return null;
  const error = job.error
    ? {
        code: job.error.code,
        reason: job.error.reason ?? null,
        kind: job.error.kind ?? null,
        retryable: job.error.retryable ?? false,
      }
    : null;
  return {
    jobId: job.job_id,
    documentId: job.document_id,
    operation: job.operation,
    format: job.format,
    state: job.state,
    baseRevision: job.base_revision,
    baseVersionId: job.base_version_id,
    outputFileId: job.output_file_id ?? null,
    outputChecksum: job.output_checksum_sha256 ?? null,
    outputLength: job.output_length ?? null,
    targetFormat: job.target_format ?? null,
    result: job.result
      ? {
          sourceFormat: job.result.source_format,
          targetFormat: job.result.target_format,
          fidelity: job.result.fidelity,
          content: job.result.content,
        }
      : null,
    error,
    engineName: job.engine_name ?? "",
    engineVersion: job.engine_version ?? "",
    contractVersion: job.contract_version ?? "",
    protocolVersion: job.protocol_version ?? "",
    committedVersionId: job.committed_version_id ?? null,
    deadlineAt: job.deadline_at ?? "",
    createdAt: job.created_at ?? "",
    updatedAt: job.updated_at ?? "",
  };
}

/** GET /api/v1/documents/{id}/office/capabilities — what this document's
 *  format can do here, with the create_blank action spelled out. */
export async function getOfficeCapabilities(
  documentId: string,
  signal?: AbortSignal,
): Promise<OfficeCapabilities | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/office/capabilities`, { signal });
  const parsed = parseWithFallback<z.infer<typeof CapabilitiesSchema> | null>(
    raw,
    CapabilitiesSchema,
    null,
    { endpoint: "GET /api/v1/documents/{id}/office/capabilities" },
  );
  if (!parsed) return null;
  return {
    documentId: parsed.document_id ?? documentId,
    format: parsed.format,
    engineVersion: parsed.engine_version,
    operations: parsed.operations.map((row) => ({
      operation: row.operation,
      runtime: row.runtime,
      evidenceLevel: row.evidence_level,
      engineBound: row.engine_bound,
      supported: row.supported,
      reason: row.reason ?? null,
      targetFormat: row.target_format ?? null,
    })),
  };
}

/** POST /api/v1/documents/{id}/office/jobs — start one engine job. */
export async function startOfficeJob(
  documentId: string,
  body: StartOfficeJobBody,
  opts?: OfficeRequestOpts,
): Promise<OfficeJob | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/office/jobs`, {
    method: "POST",
    body,
    headers: idempotencyHeaders(opts),
    signal: opts?.signal,
  });
  return narrowJob(raw);
}

/** GET /api/v1/documents/{id}/office/jobs/{jobID} — one job's state. */
export async function getOfficeJob(
  documentId: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<OfficeJob | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/office/jobs/${enc(jobId)}`, {
    signal,
  });
  return narrowJob(raw);
}

/** POST /api/v1/documents/{id}/office/jobs/{jobID}/cancel. */
export async function cancelOfficeJob(
  documentId: string,
  jobId: string,
  opts?: OfficeRequestOpts,
): Promise<OfficeJob | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/office/jobs/${enc(jobId)}/cancel`, {
    method: "POST",
    headers: idempotencyHeaders(opts),
    signal: opts?.signal,
  });
  return narrowJob(raw);
}

/** POST /api/v1/workspaces/{ws}/documents/files/blank — create a document
 *  whose first version holds engine-produced bytes (md/html today). */
export async function createBlankDocumentFile(
  workspaceId: string,
  body: CreateBlankDocumentFileBody,
  opts?: OfficeRequestOpts,
): Promise<Document | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/documents/files/blank`, {
    method: "POST",
    body,
    headers: idempotencyHeaders(opts),
    signal: opts?.signal,
  });
  return (
    parseWithFallback<{ document: Document } | null>(raw, DocumentEnvelopeSchema, null, {
      endpoint: "POST /api/v1/workspaces/{ws}/documents/files/blank",
    })?.document ?? null
  );
}

/** POST /api/v1/documents/{id}/copies — an explicit copy that keeps the
 *  source's ACL snapshot and records provenance. */
export async function copyDocument(
  documentId: string,
  body: CopyDocumentBody,
  opts?: OfficeRequestOpts,
): Promise<Document | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/copies`, {
    method: "POST",
    body,
    headers: idempotencyHeaders(opts),
    signal: opts?.signal,
  });
  return (
    parseWithFallback<{ document: Document } | null>(raw, DocumentEnvelopeSchema, null, {
      endpoint: "POST /api/v1/documents/{id}/copies",
    })?.document ?? null
  );
}
