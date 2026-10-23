"use client";
import { useQuery } from "@tanstack/react-query";
import { listDocumentChanges } from "../api/endpoints/document-changes";
import { documentChangesKeys } from "./changes-keys";

// Office change feed hook (G5-02). One page per call: the caller owns the
// cursor, because what to do between pages (apply rows, store the cursor,
// start again after a resync) is the consumer's sync logic, not a cache
// concern. `data` is the typed result of listDocumentChanges: a 410/400 cursor
// answer arrives as `{ kind: "resync" }` and a broken body as
// `{ kind: "unavailable" }`, both successes of the query; only a transport or
// permission failure lands in `error`.

export interface UseDocumentChangesOpts {
  /** `nextCursor` of the previous page; omit to open a snapshot (cold start). */
  cursor?: string;
  limit?: number;
  enabled?: boolean;
}

export function useDocumentChanges(wsId: string, opts?: UseDocumentChangesOpts) {
  const cursor = opts?.cursor;
  const limit = opts?.limit;
  return useQuery({
    queryKey: documentChangesKeys.page(wsId, cursor, limit),
    queryFn: ({ signal }) => listDocumentChanges(wsId, { cursor, limit }, signal),
    enabled: (opts?.enabled ?? true) && !!wsId,
  });
}
