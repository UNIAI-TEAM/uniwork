"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelOfficeJob,
  copyDocument,
  createBlankDocumentFile,
  getOfficeCapabilities,
  getOfficeJob,
  startOfficeJob,
  type CopyDocumentBody,
  type CreateBlankDocumentFileBody,
  type OfficeJob,
  type OfficeJobResult,
  type StartOfficeJobBody,
} from "../api/endpoints/office";
import { DocumentNotVerifiableError } from "../types/document";
import { documentKeys } from "./keys";

// Office hooks (plan G2-07 / UNI-690). Capability answers drive which actions
// the UI shows; a job is a server-side object, so a start/cancel answer that
// cannot prove the write throws "result not verifiable" instead of pretending
// success. Every key carries the workspace id beside the document id.

/** Job states that still change on their own; polling stops when a job
 *  settles (completed / failed / timed_out / cancelled / crashed). */
const LIVE_OFFICE_STATES = new Set(["accepted", "running"]);

/** One second while live: jobs are short and the answer is small. */
const OFFICE_JOB_POLL_MS = 1000;

export const officeKeys = {
  all: ["office"] as const,
  document: (wsId: string, documentId: string) =>
    [...officeKeys.all, wsId, documentId] as const,
  capabilities: (wsId: string, documentId: string) =>
    [...officeKeys.document(wsId, documentId), "capabilities"] as const,
  job: (wsId: string, documentId: string, jobId: string) =>
    [...officeKeys.document(wsId, documentId), "job", jobId] as const,
};

export function isLiveOfficeJob(job: OfficeJob | null | undefined): boolean {
  return !!job && LIVE_OFFICE_STATES.has(job.state);
}

export function isCompletedOfficeConversion(
  job: OfficeJob | null | undefined,
): job is OfficeJob & { result: OfficeJobResult; targetFormat: string } {
  return job?.operation === "convert"
    && job.state === "completed"
    && job.targetFormat !== null
    && job.result !== null
    && job.result.targetFormat === job.targetFormat;
}

/** The document's office capabilities (engine rows + create_blank). A null
 *  answer means the contract drifted, or no engine is configured: the UI
 *  hides the office actions rather than guessing. */
export function useOfficeCapabilities(wsId: string, documentId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: officeKeys.capabilities(wsId, documentId),
    queryFn: ({ signal }) => getOfficeCapabilities(documentId, signal),
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId,
  });
}

/** One job; it polls itself while it is live and stops on a terminal state. */
export function useOfficeJob(
  wsId: string,
  documentId: string,
  jobId: string | null | undefined,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: officeKeys.job(wsId, documentId, jobId ?? ""),
    queryFn: ({ signal }) => getOfficeJob(documentId, jobId as string, signal),
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId && !!jobId,
    refetchInterval: (query) => (isLiveOfficeJob(query.state.data) ? OFFICE_JOB_POLL_MS : false),
  });
}

/** Start a job; the answer is stored so the job hook can follow it. */
export function useStartOfficeJob(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StartOfficeJobBody & { idempotencyKey: string }) => {
      const { idempotencyKey, ...body } = input;
      const job = await startOfficeJob(documentId, body, { idempotencyKey });
      if (!job?.jobId) throw new DocumentNotVerifiableError();
      return job;
    },
    onSuccess: (job) => {
      qc.setQueryData(officeKeys.job(wsId, documentId, job.jobId), job);
    },
  });
}

/** Cancel a job; the settled state is written back under the job key. */
export function useCancelOfficeJob(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { jobId: string; idempotencyKey?: string }) => {
      const job = await cancelOfficeJob(documentId, input.jobId, {
        idempotencyKey: input.idempotencyKey,
      });
      if (!job?.jobId) throw new DocumentNotVerifiableError();
      return job;
    },
    onSuccess: (job) => {
      qc.setQueryData(officeKeys.job(wsId, documentId, job.jobId), job);
    },
  });
}

/** Create a blank document; the new document joins the workspace tree keys. */
export function useCreateBlankDocumentFile(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBlankDocumentFileBody & { idempotencyKey?: string }) => {
      const { idempotencyKey, ...body } = input;
      const doc = await createBlankDocumentFile(wsId, body, { idempotencyKey });
      if (!doc?.id) throw new DocumentNotVerifiableError();
      return doc;
    },
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(wsId, doc.id), doc);
      return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}

/** Copy a document (consent: "copy"); the copy joins the workspace tree. */
export function useCopyDocument(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<CopyDocumentBody, "consent"> & { idempotencyKey?: string }) => {
      const { idempotencyKey, ...rest } = input;
      const doc = await copyDocument(
        documentId,
        { consent: "copy", ...rest },
        { idempotencyKey },
      );
      if (!doc?.id) throw new DocumentNotVerifiableError();
      return doc;
    },
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(wsId, doc.id), doc);
      return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}
