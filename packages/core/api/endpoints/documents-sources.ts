import { DocumentEnvelopeSchema, type Document } from "../../types/document";
import {
  DocumentSourceListSchema,
  type DocumentSourceKind,
  type DocumentSourceList,
  type DocumentSourceType,
} from "../../documents/sources-schema";
import { request, requestBlob } from "../http";
import { parseWithFallback } from "../schema";
import type { DocumentRequestOpts } from "./documents";

// "Other sources" endpoints of the Documents home: files attached in chat,
// tasks, meetings and email. The list throws on an untrustworthy answer (an
// empty list would read as "no files"); save resolves null when it cannot
// prove the write.

const enc = encodeURIComponent;

export interface ListDocumentSourcesOpts {
  source?: DocumentSourceKind;
  type?: DocumentSourceType;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface SaveDocumentSourceBody {
  /** Target folder; null or omitted saves to the workspace root. */
  parent_id?: string | null;
  /** Display title; defaults to the source file name server-side. */
  title?: string;
}

function sourcesQuery(opts?: ListDocumentSourcesOpts): string {
  if (!opts) return "";
  const p = new URLSearchParams();
  if (opts.source) p.set("source", opts.source);
  if (opts.type) p.set("type", opts.type);
  if (opts.q) p.set("q", opts.q);
  if (opts.cursor) p.set("cursor", opts.cursor);
  if (opts.limit !== undefined) p.set("limit", String(opts.limit));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** GET /api/v1/workspaces/{workspaceID}/documents/sources — files from chat,
 *  tasks, meetings and email the caller may read. */
export async function listDocumentSources(
  wsId: string,
  opts?: ListDocumentSourcesOpts,
  signal?: AbortSignal,
): Promise<DocumentSourceList> {
  const raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents/sources${sourcesQuery(opts)}`, {
    signal,
  });
  const parsed = parseWithFallback<DocumentSourceList | null>(raw, DocumentSourceListSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/documents/sources",
  });
  if (!parsed) throw new Error("document_sources_invalid");
  return parsed;
}

/** The download proxy path of one source file. */
export function documentSourceDownloadPath(wsId: string, sourceId: string): string {
  return `/api/v1/workspaces/${enc(wsId)}/documents/sources/${enc(sourceId)}/download`;
}

/** GET the bytes of one source file (auth via the transport's bearer). */
export async function downloadDocumentSource(
  wsId: string,
  sourceId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return requestBlob(documentSourceDownloadPath(wsId, sourceId), { signal });
}

/** POST .../documents/sources/{sourceFileID}/save — copy a source file into
 *  the documents tree as a file document. */
export async function saveDocumentSource(
  wsId: string,
  sourceId: string,
  body: SaveDocumentSourceBody,
  opts?: DocumentRequestOpts,
): Promise<Document | null> {
  const raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents/sources/${enc(sourceId)}/save`, {
    method: "POST",
    body,
    headers: opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    signal: opts?.signal,
  });
  return parseWithFallback<{ document: Document } | null>(raw, DocumentEnvelopeSchema, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/documents/sources/{id}/save",
  })?.document ?? null;
}
