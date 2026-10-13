"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDocumentCommentReaction,
  createDocumentComment,
  deleteDocumentComment,
  listDocumentComments,
  removeDocumentCommentReaction,
  reopenDocumentComment,
  resolveDocumentComment,
  updateDocumentComment,
  type CommentReactionBody,
  type CreateDocumentCommentBody,
} from "../api/endpoints/document-comments";
import { DocumentNotVerifiableError, type DocumentComment } from "../types/document";
import { documentKeys } from "./keys";
import { requireVerifiableComment, requireVerifiableReaction, requireVerifiableStatus } from "./verify";

// Document comment hooks (G1-07, UNI-681; lane 07b). One key per document
// thread (documentKeys.comments) is what every mutation invalidates - the
// realtime document.comment_* frames push exactly the same key, so a comment
// written in another session lands without refetching the document itself.
// Mutations return the verified row; a malformed answer throws
// DocumentNotVerifiableError and the composer keeps its draft and its key.
// The void routes (delete, reaction removal) require the {status:"ok"} proof
// before invalidating, and the reaction add requires its row identity, so a
// half-written answer never reads as saved.

export function useDocumentComments(
  wsId: string,
  documentId: string,
  opts?: { enabled?: boolean },
) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: documentKeys.comments(wsId, documentId),
    // The read answers a full list or "unchanged" (G8-03): an unchanged
    // answer keeps the cached list - its empty `comments` is never written -
    // and an unprovable answer throws, which leaves React Query's last
    // successful data in place. The web query sends no sinceToken yet.
    queryFn: async ({ signal }) => {
      const page = await listDocumentComments(documentId, { signal });
      if (!page) throw new DocumentNotVerifiableError("comment list not verifiable");
      if (page.unchanged) {
        return qc.getQueryData<DocumentComment[]>(documentKeys.comments(wsId, documentId)) ?? [];
      }
      return page.comments;
    },
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId,
  });
}

export function useCreateDocumentComment(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateDocumentCommentBody & { idempotencyKey?: string }) => {
      const { idempotencyKey, ...body } = input;
      return requireVerifiableComment(
        await createDocumentComment(documentId, body, { idempotencyKey }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.comments(wsId, documentId) }),
  });
}

export function useUpdateDocumentComment(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { commentId: string; body: string }) =>
      requireVerifiableComment(
        await updateDocumentComment(documentId, input.commentId, { body: input.body }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.comments(wsId, documentId) }),
  });
}

export function useDeleteDocumentComment(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) =>
      requireVerifiableStatus(await deleteDocumentComment(documentId, commentId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.comments(wsId, documentId) }),
  });
}

export function useResolveDocumentComment(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) =>
      requireVerifiableComment(await resolveDocumentComment(documentId, commentId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.comments(wsId, documentId) }),
  });
}

export function useReopenDocumentComment(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) =>
      requireVerifiableComment(await reopenDocumentComment(documentId, commentId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.comments(wsId, documentId) }),
  });
}

export function useAddDocumentCommentReaction(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { commentId: string } & CommentReactionBody) =>
      requireVerifiableReaction(
        await addDocumentCommentReaction(documentId, input.commentId, { emoji: input.emoji }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.comments(wsId, documentId) }),
  });
}

export function useRemoveDocumentCommentReaction(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { commentId: string } & CommentReactionBody) =>
      requireVerifiableStatus(
        await removeDocumentCommentReaction(documentId, input.commentId, { emoji: input.emoji }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.comments(wsId, documentId) }),
  });
}
