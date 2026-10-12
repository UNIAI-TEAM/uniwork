"use client";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { createBlankDocumentFile, type BlankDocumentFormat } from "../api/endpoints/documents-blank";
import { createDocument } from "../api/endpoints/documents";
import {
  downloadDocumentSource,
  listDocumentSources,
  saveDocumentSource,
  type ListDocumentSourcesOpts,
} from "../api/endpoints/documents-sources";
import type { Document } from "../types/document";
import { documentKeys } from "./keys";
import { requireVerifiableDocument } from "./verify";

// Documents home hooks: the "other sources" list and the create-blank /
// create-folder / save-from-source mutations. Mutations await the server and
// only count as success on a verifiable answer, like the rest of documents.

const SOURCES_PAGE_SIZE = 50;

/** True when the backend lacks the route (404) or the feature (501): the UI
 *  hides the section instead of showing an error. */
export function isEndpointMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 501);
}

function sourcesFilterKey(filter?: Pick<ListDocumentSourcesOpts, "source" | "type" | "q">): string {
  if (!filter) return "";
  const entries = Object.entries(filter)
    .filter(([, value]) => value !== undefined && value !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

/** Files from chat, tasks, meetings and email as an infinite query. A missing
 *  endpoint is not retried so the caller can hide the section at once. */
export function useDocumentSources(
  wsId: string,
  filter?: Pick<ListDocumentSourcesOpts, "source" | "type" | "q">,
  opts?: { enabled?: boolean },
) {
  return useInfiniteQuery({
    queryKey: documentKeys.sources(wsId, sourcesFilterKey(filter)),
    queryFn: ({ pageParam, signal }) =>
      listDocumentSources(
        wsId,
        { ...filter, cursor: pageParam || undefined, limit: SOURCES_PAGE_SIZE },
        signal,
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    retry: (failureCount, error) => !isEndpointMissing(error) && failureCount < 3,
    enabled: (opts?.enabled ?? true) && !!wsId,
    // Source files appear without a `document.*` frame, and the meeting
    // recording frame only reaches a socket inside that meeting: coming back
    // to the tab (stale after the 15 s default) is the catch-all refresh. The
    // other frames refresh it in packages/core/realtime/source-events.ts.
    refetchOnWindowFocus: true,
  });
}

/** Shared onSuccess of the three create-style mutations. */
function useAfterCreate(wsId: string) {
  const qc = useQueryClient();
  return (doc: Document) => {
    qc.setQueryData(documentKeys.detail(wsId, doc.id), doc);
    return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
  };
}

export function useCreateBlankFile(wsId: string) {
  const onSuccess = useAfterCreate(wsId);
  return useMutation({
    mutationFn: async (input: {
      format: BlankDocumentFormat;
      title: string;
      parentId?: string;
      idempotencyKey?: string;
    }) =>
      requireVerifiableDocument(
        await createBlankDocumentFile(
          wsId,
          { format: input.format, title: input.title, parent_id: input.parentId },
          { idempotencyKey: input.idempotencyKey },
        ),
      ),
    onSuccess,
  });
}

export function useCreateFolder(wsId: string) {
  const onSuccess = useAfterCreate(wsId);
  return useMutation({
    mutationFn: async (input: { title: string; parentId?: string; idempotencyKey?: string }) =>
      requireVerifiableDocument(
        await createDocument(
          wsId,
          { kind: "folder", title: input.title, parent_id: input.parentId },
          { idempotencyKey: input.idempotencyKey },
        ),
      ),
    onSuccess,
  });
}

/** Copy a source file into the documents tree (parentId null/omitted = root). */
export function useSaveSourceToFolder(wsId: string) {
  const onSuccess = useAfterCreate(wsId);
  return useMutation({
    mutationFn: async (input: {
      sourceId: string;
      parentId?: string | null;
      title?: string;
      idempotencyKey?: string;
    }) =>
      requireVerifiableDocument(
        await saveDocumentSource(
          wsId,
          input.sourceId,
          { parent_id: input.parentId, title: input.title },
          { idempotencyKey: input.idempotencyKey },
        ),
      ),
    onSuccess,
  });
}

export function useDownloadDocumentSource(wsId: string) {
  return useMutation({
    mutationFn: (input: { sourceId: string }): Promise<Blob> =>
      downloadDocumentSource(wsId, input.sourceId),
  });
}
