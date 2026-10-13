"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDocumentCommentReaction,
  createDocumentComment,
  deleteDocumentComment,
  listDocumentCommentRevisions,
  listDocumentComments,
  listDocumentMentionCandidates,
  removeDocumentCommentReaction,
  reopenDocumentComment,
  resolveDocumentComment,
  updateDocumentComment,
  type CommentReactionBody,
  type CreateDocumentCommentBody,
} from "../api/endpoints/document-comments";
import {
  DocumentNotVerifiableError,
  type DocumentComment,
  type DocumentCommentMention,
} from "../types/document";
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

/** What the comments key caches: the rows and the mention-chip name table
 *  that came with them (contract-collab 2.1). The two are written together,
 *  so a chip never reads a name table from another list. */
interface DocumentCommentThreadData {
  comments: DocumentComment[];
  mentions: DocumentCommentMention[];
}

function useDocumentCommentQuery<T>(
  wsId: string,
  documentId: string,
  select: (data: DocumentCommentThreadData) => T,
  opts?: { enabled?: boolean },
) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: documentKeys.comments(wsId, documentId),
    // The read answers a full list or "unchanged" (G8-03): an unchanged
    // answer keeps the cached list - its empty `comments` is never written -
    // and an unprovable answer throws, which leaves React Query's last
    // successful data in place. The web query sends no sinceToken yet.
    queryFn: async ({ signal }): Promise<DocumentCommentThreadData> => {
      const page = await listDocumentComments(documentId, { signal });
      if (!page) throw new DocumentNotVerifiableError("comment list not verifiable");
      if (page.unchanged) {
        return (
          qc.getQueryData<DocumentCommentThreadData>(documentKeys.comments(wsId, documentId)) ?? {
            comments: [],
            mentions: [],
          }
        );
      }
      return { comments: page.comments, mentions: page.mentions };
    },
    select,
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId,
  });
}

const selectComments = (data: DocumentCommentThreadData) => data.comments;
const selectThread = (data: DocumentCommentThreadData) => data;

/** The document's comment rows, oldest first (both kinds, tombstones included). */
export function useDocumentComments(
  wsId: string,
  documentId: string,
  opts?: { enabled?: boolean },
) {
  return useDocumentCommentQuery(wsId, documentId, selectComments, opts);
}

/** The rows plus the name table the mention chips read their current names from. */
export function useDocumentCommentThread(
  wsId: string,
  documentId: string,
  opts?: { enabled?: boolean },
) {
  return useDocumentCommentQuery(wsId, documentId, selectThread, opts);
}

/**
 * One comment's edit history, newest first (contract-collab 2.7). The key
 * hangs off the comments key, so every comment frame that refreshes the
 * thread refreshes an open history too. A malformed answer throws: the
 * history then reads as an error with Retry, never as "not edited".
 */
export function useDocumentCommentRevisions(
  wsId: string,
  documentId: string,
  commentId: string,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: [...documentKeys.comments(wsId, documentId), "revisions", commentId] as const,
    queryFn: async ({ signal }) => {
      const revisions = await listDocumentCommentRevisions(documentId, commentId, { signal });
      if (!revisions) throw new DocumentNotVerifiableError("comment revisions not verifiable");
      return revisions;
    },
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId && !!commentId,
  });
}

/**
 * The mention picker's people for one document (G8-06): whoever holds at
 * least view on it today, searched by display name and email (accents
 * folded). The caller's own access decides whether rows carry emails, so the
 * list is never merged across queries of different terms; `enabled` lets a
 * picker stay closed until the composer opens.
 */
export function useDocumentMentionCandidates(
  wsId: string,
  documentId: string,
  query: string,
  opts?: { enabled?: boolean; limit?: number },
) {
  const q = query.trim();
  const limit = opts?.limit;
  return useQuery({
    queryKey: documentKeys.mentionCandidates(wsId, documentId, q, limit),
    queryFn: ({ signal }) => listDocumentMentionCandidates(documentId, { q, limit }, signal),
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
