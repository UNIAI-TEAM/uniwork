import { z } from "zod";
import {
  DocumentArchiveImpactSchema,
  DocumentArchiveSchema,
  DocumentEnvelopeSchema,
  DocumentListSchema,
  DocumentTreeSchema,
  type Document,
  type DocumentAccessFilter,
  type DocumentArchive,
  type DocumentArchiveImpact,
  type DocumentFileFormat,
  type DocumentKind,
  type DocumentList,
  type DocumentTree,
} from "../../types/document";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import { ensureMyFolder, type DocumentRequestOpts } from "./documents";

export { ensureMyFolder };

const DocumentPurgeResponseSchema = z.undefined();

// Document collection endpoints (C-01 §5.1; UNI-679, G1-05b): the flat list
// with filters/search/cursor, recent, shared-with-me and the sidebar tree,
// plus move/archive/restore and the archive impact. Lists throw when the
// answer cannot be trusted (an empty array would render "no documents" over a
// workspace that has them); mutations, and the archive impact whose counts a
// confirmation rests on, resolve null when they cannot prove the answer and
// the hooks turn that into "result not verifiable".

const enc = encodeURIComponent;

/** Filters of GET /workspaces/{ws}/documents. `parentId: ""` lists the
 *  workspace roots; leaving it undefined is the flat list. `sharedByMe: true`
 *  lists documents the caller owns and has shared (`parent_id` + `shared_by_me`
 *  is rejected with 400 `invalid_filter`, so the union forbids passing both). */
export interface ListDocumentsBaseOpts {
  q?: string;
  /** "document" is every kind but folder (folders contract v1.0). */
  kind?: DocumentKind | "document";
  /** The library's type chip: the file format of the row's current version
   *  (the MIME the server verified, else the title's extension). Folders stay
   *  in the answer; pages never match; `kind: "page"` together with it is
   *  refused with 400 `invalid_filter`. */
  format?: DocumentFileFormat;
  /** The library's access filter: `manage` the rows the caller manages,
   *  `edit` those they manage or edit, `restricted` those with restricted
   *  visibility. On the trash only `restricted` is accepted. */
  access?: DocumentAccessFilter;
  /** "title" searches the accent-folded title instead of the full text;
   *  left out, the search keeps its old behaviour. */
  match?: "title";
  archived?: boolean;
  updatedBy?: string;
  /** RFC3339 lower/upper bound on updated_at. */
  updatedFrom?: string;
  updatedTo?: string;
  cursor?: string;
  limit?: number;
}

export type ListDocumentsOpts = ListDocumentsBaseOpts &
  (
    | { parentId?: string; sharedByMe?: false | undefined }
    | { sharedByMe: true; parentId?: never }
  );

function listQuery(opts?: ListDocumentsOpts): string {
  if (!opts) return "";
  const p = new URLSearchParams();
  if (opts.parentId !== undefined) p.set("parent_id", opts.parentId);
  if (opts.sharedByMe) p.set("shared_by_me", "true");
  if (opts.q) p.set("q", opts.q);
  if (opts.kind) p.set("kind", opts.kind);
  if (opts.format) p.set("format", opts.format);
  if (opts.access) p.set("access", opts.access);
  if (opts.match) p.set("match", opts.match);
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
 *  opened or last edited. Humans only; an agent token answers 403. Takes the
 *  same `format`/`access` filters as the flat list. */
export async function listRecentDocuments(
  wsId: string,
  opts?: Pick<ListDocumentsBaseOpts, "cursor" | "limit" | "format" | "access">,
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
  opts?: Pick<ListDocumentsBaseOpts, "cursor" | "limit" | "format" | "access">,
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

/**
 * GET /api/v1/workspaces/{workspaceID}/documents?shared_by_me=true —
 * non-archived documents in the workspace that the caller owns (`acl_owner_id`)
 * and has shared (at least one active person/group share or `visibility = 'workspace'`;
 * public links and My Folder rows are excluded). Uses the same list schema and
 * keyset cursor pagination as the flat list; never sends `parent_id`.
 */
export async function listSharedByMe(
  wsId: string,
  cursorOrOpts?: string | Pick<ListDocumentsBaseOpts, "cursor" | "limit" | "format" | "access">,
  signal?: AbortSignal,
): Promise<DocumentList> {
  const opts = typeof cursorOrOpts === "string" ? { cursor: cursorOrOpts } : cursorOrOpts;
  const raw = await request(
    `/api/v1/workspaces/${enc(wsId)}/documents${listQuery({
      sharedByMe: true,
      cursor: opts?.cursor,
      limit: opts?.limit,
      format: opts?.format,
      access: opts?.access,
    })}`,
    { signal },
  );
  const parsed = parseWithFallback<DocumentList | null>(raw, DocumentListSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/documents?shared_by_me=true",
  });
  if (!parsed) throw new Error("document_list_invalid");
  return parsed;
}

/** GET /api/v1/workspaces/{workspaceID}/documents/tree — the sidebar forest
 *  to TREE_MAX_LEVEL levels; root narrows to one branch, foldersOnly drops
 *  pages and files. Metadata only. */
export async function getDocumentTree(
  wsId: string,
  root?: string,
  signal?: AbortSignal,
  opts?: { foldersOnly?: boolean },
): Promise<DocumentTree> {
  const p = new URLSearchParams();
  if (root) p.set("root", root);
  if (opts?.foldersOnly) p.set("folders_only", "true");
  const q = p.toString();
  const raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents/tree${q ? `?${q}` : ""}`, { signal });
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

/** POST /api/v1/documents/{documentID}/restore — recovers the target trashed
 *  item and the trashed descendants in its batch that the caller manages. Null
 *  means the restore cannot be proven. */
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

/** POST /api/v1/documents/{documentID}/shelve — archives the subtree into the
 *  read-only "Lưu trữ" state in one batch (ARCHIVE-01, addendum §2 S-1).
 *  Same envelope and Idempotency-Key semantics as archive; null means the
 *  shelve cannot be proven. */
export async function shelveDocument(
  documentId: string,
  opts?: DocumentRequestOpts,
): Promise<DocumentArchive | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/shelve`, {
    method: "POST",
    headers: opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    signal: opts?.signal,
  });
  return parseWithFallback<DocumentArchive | null>(raw, DocumentArchiveSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/shelve",
  });
}

/** POST /api/v1/documents/{documentID}/unshelve — brings back the target
 *  shelved item and the shelved descendants of the same batch the caller
 *  manages (ARCHIVE-01 §2 S-2). Null means the unshelve cannot be proven. */
export async function unshelveDocument(
  documentId: string,
  opts?: DocumentRequestOpts,
): Promise<DocumentArchive | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/unshelve`, {
    method: "POST",
    headers: opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    signal: opts?.signal,
  });
  return parseWithFallback<DocumentArchive | null>(raw, DocumentArchiveSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/unshelve",
  });
}


/** POST /api/v1/documents/{documentID}/purge — permanently delete a trashed
 *  item and the trashed descendants in its batch that the caller manages
 *  (RESTORE-01). The server answers 204 and keeps no purge ledger, so no
 *  Idempotency-Key is sent; a drifted 2xx JSON body degrades to undefined via
 *  parseWithFallback. */
export async function purgeDocument(
  documentId: string,
  opts?: Pick<DocumentRequestOpts, "signal">,
): Promise<void> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/purge`, {
    method: "POST",
    signal: opts?.signal,
  });
  return parseWithFallback<undefined>(raw, DocumentPurgeResponseSchema, undefined, {
    endpoint: "POST /api/v1/documents/{id}/purge",
  });
}

/** GET /api/v1/documents/{documentID}/archive-impact — what archiving this
 *  subtree would move, behind the same manage gate as the archive. Null means
 *  the answer cannot be read; it never degrades into counts. */
export async function getDocumentArchiveImpact(
  documentId: string,
  signal?: AbortSignal,
): Promise<DocumentArchiveImpact | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/archive-impact`, { signal });
  return parseWithFallback<DocumentArchiveImpact | null>(raw, DocumentArchiveImpactSchema, null, {
    endpoint: "GET /api/v1/documents/{id}/archive-impact",
  });
}
