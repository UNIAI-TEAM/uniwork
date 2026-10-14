"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@uniwork/core/api/http";
import { useAuthStore } from "@uniwork/core/auth";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import {
  useCreateDocumentComment,
  useDeleteDocumentComment,
  useDocumentCommentThread,
  useReopenDocumentComment,
  useResolveDocumentComment,
  useUpdateDocumentComment,
} from "@uniwork/core/documents/hooks-comments";
import type { Document, DocumentComment } from "@uniwork/core/types/document";
import { mentionNames } from "./document-comment-body";
import type { SendOutcome } from "./document-comment-composer";
import type { ThreadActions } from "./document-comment-thread";

// The panel's data and writes (S12/S13 state table): one list for both tabs,
// the mention name table, who may write, and the panel status a failed read
// or write leaves behind. Writes never apply optimistically: they await the
// server and the list reloads through the comments key.

/** The one-line panel status (S12 structure, item 2); null when there is nothing to say. */
export type PanelStatus = "offline" | "server" | "signedOut" | "viewOnly" | null;

/** One unguessable key per logical create; reused while parent and body are unchanged. */
function newIdempotencyKey(): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  return random ?? `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** What a failed read or write says about the connection, if anything. */
function connectionStatus(err: unknown): Exclude<PanelStatus, "viewOnly" | null> | "permission" | null {
  const { cls } = classifyDocumentError(err);
  if (cls === "session") return "signedOut";
  if (cls === "permission") return "permission";
  if (err instanceof ApiError) return err.status >= 500 ? "server" : null;
  // A rejection that is not an HTTP answer never reached the server.
  return err instanceof TypeError || (err instanceof Error && err.name === "NetworkError") ? "offline" : null;
}

export function useDocumentCommentsPanel(wsId: string, doc: Document) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const query = useDocumentCommentThread(wsId, doc.id);
  const create = useCreateDocumentComment(wsId, doc.id);
  const update = useUpdateDocumentComment(wsId, doc.id);
  const remove = useDeleteDocumentComment(wsId, doc.id);
  const resolve = useResolveDocumentComment(wsId, doc.id);
  const reopen = useReopenDocumentComment(wsId, doc.id);
  const idempotency = useRef<{ key: string; body: string; parent: string } | null>(null);
  // A write refused with 403 means the level dropped under us: read-only at that level. The refusal
  // is remembered with the level it answered, so a level the server restores (a refetched document
  // with another `my_level`) writes again; it is never a sticky flag.
  const level = doc.my_level;
  const [refusedAt, setRefusedAt] = useState<string | null>(null);
  const writeRefused = refusedAt !== null && refusedAt === level;
  useEffect(() => {
    if (refusedAt !== null && refusedAt !== level) setRefusedAt(null);
  }, [refusedAt, level]);
  const [writeProblem, setWriteProblem] = useState<Exclude<PanelStatus, "viewOnly" | null> | null>(null);
  const problemAt = useRef(0);
  const setProblem = useCallback((problem: Exclude<PanelStatus, "viewOnly" | null> | null) => {
    problemAt.current = Date.now();
    setWriteProblem(problem);
  }, []);

  const comments = useMemo(() => query.data?.comments ?? [], [query.data]);
  const names = useMemo(() => mentionNames(query.data?.mentions ?? []), [query.data]);
  const canWrite = !writeRefused && (level === "edit" || level === "manage");
  const canModerate = canWrite && level === "manage";

  const readError = query.error ? classifyDocumentError(query.error) : null;
  const noAccess = !!readError && (readError.cls === "permission" || readError.cls === "missing");
  const firstLoadFailed = query.isError && query.data === undefined && !noAccess;
  // A list read that lands after a failed write says the server is back: the write sentence ends.
  useEffect(() => {
    if (writeProblem && query.dataUpdatedAt > problemAt.current) setWriteProblem(null);
  }, [writeProblem, query.dataUpdatedAt]);
  const readProblem = query.isError && query.data !== undefined ? connectionStatus(query.error) : null;

  const status: PanelStatus = (() => {
    const problem = writeProblem ?? (readProblem === "permission" ? null : readProblem);
    if (problem) return problem;
    if (!canWrite) return "viewOnly";
    return null;
  })();
  // A failed write only says so (the status sentence); it never locks Send, or a retry after the server
  // recovers would be impossible. Only a failed read or an ended session blocks sending.
  const readBlocked = readProblem !== null && readProblem !== "permission";
  const blocked = readBlocked || writeProblem === "signedOut";

  const authorNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of comments) {
      const name = c.author?.display_name || c.display_name;
      if (c.author_id && name) map.set(c.author_id, name);
    }
    return map;
  }, [comments]);

  const reload = useCallback(() => void query.refetch(), [query]);

  const noteFailure = useCallback(
    (err: unknown) => {
      const problem = connectionStatus(err);
      if (problem === "permission") {
        setRefusedAt(level ?? "");
        reload();
      } else if (problem) {
        setProblem(problem);
      }
      if (classifyDocumentError(err).code === "comment_deleted") reload();
    },
    [reload, level, setProblem],
  );

  const run = useCallback(
    async (write: () => Promise<unknown>): Promise<boolean> => {
      // A new attempt clears the last write's status line; a failure puts it back.
      setProblem(null);
      try {
        await write();
        return true;
      } catch (err) {
        noteFailure(err);
        return false;
      }
    },
    [noteFailure, setProblem],
  );

  const send = useCallback(
    async (body: string, parentId?: string): Promise<SendOutcome> => {
      const parent = parentId ?? "";
      const previous = idempotency.current;
      const key = previous && previous.body === body && previous.parent === parent ? previous.key : newIdempotencyKey();
      idempotency.current = { key, body, parent };
      setProblem(null);
      try {
        // A new root from the web is always a Discussion post: a comment root needs an anchor
        // only the editor can give (signed decision, OQ-C2), so the server's default applies.
        await create.mutateAsync({ body, parent_id: parentId, idempotencyKey: key });
        idempotency.current = null;
        return "sent";
      } catch (err) {
        noteFailure(err);
        return classifyDocumentError(err).code === "comment_deleted" ? "target_deleted" : "failed";
      }
    },
    [create, noteFailure, setProblem],
  );

  const actions = useMemo<ThreadActions>(
    () => ({
      reply: (parentId, body) => send(body, parentId),
      edit: (commentId, body) => run(() => update.mutateAsync({ commentId, body })),
      remove: (commentId) => run(() => remove.mutateAsync(commentId)),
      setResolved: (commentId, resolved) =>
        run(() => (resolved ? resolve.mutateAsync(commentId) : reopen.mutateAsync(commentId))),
      reload,
    }),
    [send, run, update, remove, resolve, reopen, reload],
  );

  return {
    query,
    comments,
    names,
    currentUserId,
    canWrite,
    canModerate,
    noAccess,
    firstLoadFailed,
    status,
    blocked,
    actions,
    send,
    /** The display name of a post's author, or "" when the server no longer names them. */
    authorName: (comment: Pick<DocumentComment, "author_id" | "author" | "display_name">) =>
      comment.author?.display_name || comment.display_name || "",
    /** The name of whoever wrote a history entry: an author in the list, else the mention table. */
    nameOfId: (userId: string) => {
      const mention = names.get(userId.toUpperCase());
      return authorNames.get(userId) || (mention?.state === "ok" ? mention.display_name : "");
    },
  };
}
