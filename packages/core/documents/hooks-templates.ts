"use client";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listTemplateDocuments,
  markDocumentTemplate,
  unmarkDocumentTemplate,
} from "../api/endpoints/document-templates";
import type { ListDocumentsBaseOpts } from "../api/endpoints/documents-collections";
import { documentFilterKey } from "./hooks-collections";
import { documentKeys } from "./keys";
import { requireVerifiableDocument } from "./verify";

// Templates section hooks. Every key hangs off the workspace root, so one
// `document.template_*` frame or one mutation refresh reaches the list, the
// details and the library. Mutations await the server: no optimistic update.

const TEMPLATE_PAGE_SIZE = 50;

/** The workspace's templates as an infinite, keyset-paged query. */
export function useTemplateDocuments(wsId: string, opts?: ListDocumentsBaseOpts & { enabled?: boolean }) {
  const { enabled, ...rest } = opts ?? {};
  // The page position is the query's own; only the filters key the entry.
  const filter = { ...rest, cursor: undefined, limit: undefined };
  const filterKey = documentFilterKey(filter);
  return useInfiniteQuery({
    queryKey: documentKeys.templates(wsId, filterKey === "[]" ? "" : filterKey),
    queryFn: ({ pageParam, signal }) =>
      listTemplateDocuments(wsId, { ...filter, cursor: pageParam || undefined, limit: TEMPLATE_PAGE_SIZE }, signal),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: (enabled ?? true) && !!wsId,
  });
}

/** Mark a document as a template. A restricted document needs
 *  `widenToWorkspace` after the caller confirmed (the server answers 409
 *  `template_widens_visibility` otherwise). */
export function useMarkDocumentTemplate(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { documentId: string; widenToWorkspace?: boolean }) =>
      requireVerifiableDocument(
        (await markDocumentTemplate(input.documentId, { widenToWorkspace: input.widenToWorkspace }))?.document,
      ),
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(wsId, doc.id), doc);
      return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}

/** Remove the template mark; the document stays where it is. */
export function useUnmarkDocumentTemplate(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) =>
      requireVerifiableDocument((await unmarkDocumentTemplate(documentId))?.document),
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(wsId, doc.id), doc);
      return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}
