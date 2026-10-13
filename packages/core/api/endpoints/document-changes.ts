import { z } from "zod";
import { ApiError, request } from "../http";
import { parseWithFallback } from "../schema";

// Office change feed, web client (G5-02, UNI-1347). GET
// /api/v1/workspaces/{workspaceID}/documents/changes is how a client catches
// up on document changes it missed (G5-03w uses it after a realtime
// reconnect). No cursor opens a snapshot (cold start); every page hands out
// the next opaque cursor. The cursor is never parsed or built here.
//
// Three outcomes the caller must tell apart, none of which is a throw:
//  - page: a verified page of rows;
//  - resync: the cursor cannot be continued, start again without one;
//  - unavailable: the answer broke the contract, so it is neither "caught up"
//    nor a page to continue from (a degraded empty page would claim the
//    former, and a partial page would silently skip documents).
// Everything else (403 office_capability_off, 404, 501, network) rejects as an
// ApiError exactly like the neighbouring endpoints.

const enc = encodeURIComponent;

// Server enums stay plain strings so a value a newer server adds still parses.
// `revision` is a decimal string on the wire (a BIGINT would lose precision as
// a JSON number) and stays one here: it is the sync base, never arithmetic.
const documentChangeSchema = z.object({
  document_id: z.string().min(1),
  kind: z.string(),
  revision: z.string().regex(/^\d+$/),
  current_version: z.number().int(),
  version_id: z.string().nullish(),
});

const documentChangePageSchema = z.object({
  phase: z.string(),
  changes: z.array(documentChangeSchema),
  has_more: z.boolean(),
  next_cursor: z.string().min(1),
  expires_at: z.string(),
});

export interface DocumentChange {
  documentId: string;
  /** Server enum (page | file | folder today); switch with a default. */
  kind: string;
  /** Decimal string; compare by BigInt, never Number. */
  revision: string;
  currentVersion: number;
  /** Head version record (file documents); null for page/folder. */
  versionId: string | null;
}

export interface DocumentChangePage {
  /** Server enum (snapshot today; the incremental feed adds its own value). */
  phase: string;
  changes: DocumentChange[];
  hasMore: boolean;
  /** Opaque; pass it back unchanged as `cursor` for the next page. */
  nextCursor: string;
  /** Deadline of `nextCursor`; past it the server answers change_cursor_expired. */
  expiresAt: string;
}

/**
 * Why the cursor cannot be continued. `cursor_expired` is 410
 * change_cursor_expired (retention passed or the snapshot was swept);
 * `cursor_invalid` is 400 change_cursor_invalid (forged, or signed for another
 * account, organization, workspace or deployment). Either way the recovery is
 * the same: drop the cursor and cold start.
 */
export type DocumentChangesResyncReason = "cursor_expired" | "cursor_invalid";

export type DocumentChangesResult =
  | { kind: "page"; page: DocumentChangePage }
  | { kind: "resync"; reason: DocumentChangesResyncReason }
  | { kind: "unavailable"; reason: "malformed_response" };

export interface ListDocumentChangesOpts {
  /** `nextCursor` of the previous page; omit to open a snapshot (cold start). */
  cursor?: string;
  /** Rows per page; the server defaults to 200 and clamps to 500. */
  limit?: number;
}

function changesQuery(opts?: ListDocumentChangesOpts): string {
  if (!opts) return "";
  const p = new URLSearchParams();
  if (opts.cursor) p.set("cursor", opts.cursor);
  if (opts.limit !== undefined) p.set("limit", String(opts.limit));
  const s = p.toString();
  return s ? `?${s}` : "";
}

const RESYNC_BY_CODE: Record<string, DocumentChangesResyncReason> = {
  change_cursor_expired: "cursor_expired",
  change_cursor_invalid: "cursor_invalid",
};

const MALFORMED: DocumentChangesResult = { kind: "unavailable", reason: "malformed_response" };

/** GET /api/v1/workspaces/{workspaceID}/documents/changes — one feed page. */
export async function listDocumentChanges(
  wsId: string,
  opts?: ListDocumentChangesOpts,
  signal?: AbortSignal,
): Promise<DocumentChangesResult> {
  let raw: unknown;
  try {
    raw = await request(`/api/v1/workspaces/${enc(wsId)}/documents/changes${changesQuery(opts)}`, { signal });
  } catch (err) {
    // Matched on the stable code, not the status alone: another 400/410 (a bad
    // limit, an unknown commit intent) is not a cursor problem.
    // Own keys only: the code is server-supplied, and `constructor` or
    // `__proto__` must not resolve through Object.prototype.
    if (err instanceof ApiError && Object.hasOwn(RESYNC_BY_CODE, err.code)) {
      return { kind: "resync", reason: RESYNC_BY_CODE[err.code]! };
    }
    throw err;
  }
  const parsed = parseWithFallback<z.infer<typeof documentChangePageSchema> | null>(
    raw,
    documentChangePageSchema,
    null,
    { endpoint: "GET /api/v1/workspaces/{workspaceID}/documents/changes" },
  );
  if (!parsed) return MALFORMED;
  return {
    kind: "page",
    page: {
      phase: parsed.phase,
      changes: parsed.changes.map((c) => ({
        documentId: c.document_id,
        kind: c.kind,
        revision: c.revision,
        currentVersion: c.current_version,
        versionId: c.version_id ?? null,
      })),
      hasMore: parsed.has_more,
      nextCursor: parsed.next_cursor,
      expiresAt: parsed.expires_at,
    },
  };
}
