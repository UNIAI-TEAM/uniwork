import {
  DocumentEnvelopeSchema,
  type Document,
  type DocumentAccessLevel,
  type DocumentVisibility,
} from "../../types/document";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import {
  DOCUMENT_DESTINATIONS,
  type DocumentCreateDestination,
  type DocumentRequestOpts,
} from "./documents";

export { DOCUMENT_DESTINATIONS, type DocumentCreateDestination };

// Blank file documents: the server seeds an empty docx/xlsx/pptx/md/html/pdf
// so the person can open it in the matching editor straight away.

export const BLANK_DOCUMENT_FORMATS = ["docx", "xlsx", "pptx", "md", "html", "pdf"] as const;
export type BlankDocumentFormat = (typeof BLANK_DOCUMENT_FORMATS)[number];

export type CreateBlankDocumentBody = {
  format: BlankDocumentFormat;
  title: string;
  visibility?: DocumentVisibility;
  workspace_level?: DocumentAccessLevel;
} & (
  | { parent_id?: string; destination?: never }
  | { destination?: DocumentCreateDestination; parent_id?: never }
);

/** POST /api/v1/workspaces/{workspaceID}/documents/files/blank. */
export async function createBlankDocumentFile(
  wsId: string,
  body: CreateBlankDocumentBody,
  opts?: DocumentRequestOpts,
): Promise<Document | null> {
  const raw = await request(`/api/v1/workspaces/${encodeURIComponent(wsId)}/documents/files/blank`, {
    method: "POST",
    body,
    headers: opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    signal: opts?.signal,
  });
  return parseWithFallback<{ document: Document } | null>(raw, DocumentEnvelopeSchema, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/documents/files/blank",
  })?.document ?? null;
}
