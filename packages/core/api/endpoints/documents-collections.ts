import {
  DocumentArchiveSchema,
  DocumentEnvelopeSchema,
  DocumentListSchema,
  DocumentTreeSchema,
  type Document,
  type DocumentArchive,
  type DocumentKind,
  type DocumentList,
  type DocumentTree,
} from "../../types/document";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import type { DocumentRequestOpts } from "./documents";

// Document collection endpoints (C-01 §5.1; UNI-679, G1-05b): the flat list
// with filters/search/cursor, recent, shared-with-me and the sidebar tree,
// plus move/archive/restore. Lists throw when the answer cannot be trusted
// (an empty array would render "no documents" over a workspace that has
// them); mutations resolve null when they cannot prove the write and the
// hooks turn that into "result not verifiable".

const enc = encodeURIComponent;

/** Filters of GET /workspaces/{ws}/documents. `parentId: ""` lists the
 *  workspace roots; leaving it undefined is the flat list. */
export interface ListDocumentsOpts {
  parentId?: string;
  q?: string;
  kind?: DocumentKind;
  archived?: boolean;
  updatedBy?: string;
  /** RFC3339 lower/upper bound on updated_at. */
  updatedFrom?: string;
  updatedTo?: string;
  cursor?: string;
  limit?: number;
}

function listQuery(opts?: ListDocumentsOpts): string {
  if (!opts) return "";
  const p = new URLSearchParams();
  if (opts.parentId !== undefined) p.set("parent_id", opts.parentId);
  if (opts.q) p.set("q", opts.q);
  if (opts.kind) p.set("kind", opts.kind);
  if (opts.archived !== undefined) p.set("archived", opts.archived ? "1" : "0");
  if (opts.updatedBy) p.set("updated_by", opts.updatedBy);
  if (opts.updatedFrom) p.set("updated_from", opts.updatedFrom);
  if (opts.updatedTo) p.set("updated_to", opts.updatedTo);
  if (opts.cursor) p.set("cursor", opts.cursor);
  if (opts.limit !== undefined) p.set("limit", String(opts.limit));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * GET /api/v1/workspaces/{workspaceID}/documents — the flat list, one tree
 * level (parentId) or a workspace search (q). Permission filtering runs
 * server-side before the limit; pages are stable on the opaque cursor.
 */
export async function listDocuments(
  wsId: string,
  opts?: ListDocumentsOpts,
  signal?: AbortSignal,
): Promise<DocumentList> {
  const raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents${listQuery(opts)}`, { signal });
  const parsed = parseWithFallback<DocumentList | null>(raw, DocumentListSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/documents",
  });
  if (!parsed) throw new Error("document_list_invalid");
  return parsed;
}

/** GET /api/v1/workspaces/{workspaceID}/documents/recent — what the person
 *  opened or last edited. Humans only; an agent token answers 403. */
export async function listRecentDocuments(
  wsId: string,
  opts?: Pick<ListDocumentsOpts, "cursor" | "limit">,
  signal?: AbortSignal,
): Promise<DocumentList> {
  const raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents/recent${listQuery(opts)}`, { signal });
  const parsed = parseWithFallback<DocumentList | null>(raw, DocumentListSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/documents/recent",
  });
  if (!parsed) throw new Error("document_list_invalid");
  return parsed;
}

/** GET /api/v1/workspaces/{workspaceID}/documents/shared-with-me — every
 *  workspace in the organization the caller receives a live share from.
 *  Server-side keyset paging: `cursor` follows `next_cursor`, `limit` caps
 *  the page (default 50, max 100), and a denied candidate never takes a slot. */
export async function listSharedWithMe(
  wsId: string,
  opts?: Pick<ListDocumentsOpts, "cursor" | "limit">,
  signal?: AbortSignal,
): Promise<DocumentList> {
  const raw = await request(
    `/api/v1/workspaces/${enc(wsId)}/documents/shared-with-me${listQuery(opts)}`,
    { signal },
  );
  const parsed = parseWithFallback<DocumentList | null>(raw, DocumentListSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/documents/shared-with-me",
  });
  if (!parsed) throw new Error("document_list_invalid");
  return parsed;
}

/** GET /api/v1/workspaces/{workspaceID}/documents/tree — the sidebar forest
 *  to five levels; root narrows to one branch. Metadata only. */
export async function getDocumentTree(
  wsId: string,
  root?: string,
  signal?: AbortSignal,
): Promise<DocumentTree> {
  const q = root ? `?root=${enc(root)}` : "";
  const raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents/tree${q}`, { signal });
  const parsed = parseWithFallback<DocumentTree | null>(raw, DocumentTreeSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/documents/tree",
  });
  if (!parsed) throw new Error("document_tree_invalid");
  return parsed;
}

export interface MoveDocumentBody {
  /** New parent; undefined or null moves to the workspace root. */
  parent_id?: string | null;
  /** Fractional sibling order; undefined appends last. */
  position?: number;
  /** Revision the caller last saw (decimal string); a stale base is 422. */
  revision: string;
}

/** POST /api/v1/documents/{documentID}/move — reparent/reorder inside one
 *  workspace. Null means the move cannot be proven (keep the caller's state
 *  and key, retry with the same Idempotency-Key). */
export async function moveDocument(
  documentId: string,
  body: MoveDocumentBody,
  opts?: DocumentRequestOpts,
): Promise<Document | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/move`, {
    method: "POST",
    body,
    headers: opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    signal: opts?.signal,
  });
  return parseWithFallback<{ document: Document } | null>(raw, DocumentEnvelopeSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/move",
  })?.document ?? null;
}

/** POST /api/v1/documents/{documentID}/archive — the subtree moves to the
 *  trash in one batch. Null means the archive cannot be proven. */
export async function archiveDocument(
  documentId: string,
  opts?: DocumentRequestOpts,
): Promise<DocumentArchive | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/archive`, {
    method: "POST",
    headers: opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    signal: opts?.signal,
  });
  return parseWithFallback<DocumentArchive | null>(raw, DocumentArchiveSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/archive",
  });
}

/** POST /api/v1/documents/{documentID}/restore — recovers exactly the nodes
 *  one archive batch moved. Null means the restore cannot be proven. */
export async function restoreDocument(
  documentId: string,
  opts?: DocumentRequestOpts,
): Promise<DocumentArchive | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/restore`, {
    method: "POST",
    headers: opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    signal: opts?.signal,
  });
  return parseWithFallback<DocumentArchive | null>(raw, DocumentArchiveSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/restore",
  });
}
