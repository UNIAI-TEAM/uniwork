"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { MessageSquare, RotateCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { documentCommentDraftKey, useDocumentCommentDraftStore } from "@uniwork/core/documents/comment-drafts";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import {
  useAddDocumentCommentReaction,
  useCreateDocumentComment,
  useDeleteDocumentComment,
  useDocumentComments,
  useRemoveDocumentCommentReaction,
  useReopenDocumentComment,
  useResolveDocumentComment,
  useUpdateDocumentComment,
} from "@uniwork/core/documents/hooks-comments";
import { useFlag } from "@uniwork/core/feature-flags";
import type { Document, DocumentComment } from "@uniwork/core/types/document";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Sheet, SheetContent } from "@uniwork/ui/components/ui/sheet";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { useMediaQuery } from "@uniwork/ui/hooks/use-media-query";
import type { ContentEditorProps } from "../editor";
import { CommentCard } from "../comments/comment-card";
import { CommentComposer } from "../comments/comment-composer";
import { CommentReplyQuote } from "../comments/comment-reply-quote";
import { ResolvedThreadBar } from "../comments/resolved-thread-bar";
import {
  buildCommentThreads,
  deriveThreadResolution,
  type CommentThread,
} from "../comments/comment-thread";
import { toastApiError } from "../toast-api-error";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useDocumentCommentsChrome } from "./document-comments-context";

/** Tailwind `xl` — the breakpoint where the detail row can afford a rail. */
const DESKTOP_QUERY = "(min-width: 1280px)";

/** One unguessable key per logical create; reused while the body is unchanged
 *  so a retry after a lost answer replays instead of double-posting. */
function newIdempotencyKey(): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  return random ?? `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function CommentComposerBox({
  wsId,
  doc,
  orgId,
  parentId,
  mentionItems,
  onSubmit,
  compact = false,
  refocusAfterSend = false,
  testId = "document-comment-composer",
}: {
  wsId: string;
  doc: Document;
  orgId: string;
  parentId?: string;
  mentionItems?: ContentEditorProps["mentionContextItems"];
  onSubmit: (body: string) => Promise<boolean>;
  compact?: boolean;
  refocusAfterSend?: boolean;
  testId?: string;
}) {
  const accountId = useAuthStore((s) => s.user?.id ?? "");
  const key = documentCommentDraftKey({
    accountId,
    orgId,
    wsId,
    documentId: doc.id,
    parentId,
  });
  const draft = useDocumentCommentDraftStore((s) => s.draftFor(key));
  const setStoredDraft = useDocumentCommentDraftStore((s) => s.setDraft);
  const clearStoredDraft = useDocumentCommentDraftStore((s) => s.clearDraft);
  const setDraft = useCallback((body: string) => setStoredDraft(key, body), [key, setStoredDraft]);
  const clearDraft = useCallback(() => clearStoredDraft(key), [key, clearStoredDraft]);

  return (
    <CommentComposer
      tPrefix="documents.comments"
      resetKey={key}
      draft={draft}
      setDraft={setDraft}
      clearDraft={clearDraft}
      onSubmit={onSubmit}
      compact={compact}
      refocusAfterSend={refocusAfterSend}
      testId={testId}
      shellTestId={`${testId}-shell`}
      mentionMode="context"
      mentionContextItems={mentionItems}
    />
  );
}

function CommentsPane({
  wsId,
  doc,
  onClose,
}: {
  wsId: string;
  doc: Document;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const workspace = useOptionalWorkspace();
  const orgId = doc.organization_id || workspace?.workspace.organization_id || "";
  const currentUserId = useAuthStore((s) => s.user?.id);
  const query = useDocumentComments(wsId, doc.id);
  // The mention picker reads server data only: this preloads the workspace
  // member list the panel's context-mode picker shows (never an invented list).
  const membersQuery = useMembers(wsId);

  const create = useCreateDocumentComment(wsId, doc.id);
  const update = useUpdateDocumentComment(wsId, doc.id);
  const remove = useDeleteDocumentComment(wsId, doc.id);
  const resolve = useResolveDocumentComment(wsId, doc.id);
  const reopen = useReopenDocumentComment(wsId, doc.id);
  const addReaction = useAddDocumentCommentReaction(wsId, doc.id);
  const removeReaction = useRemoveDocumentCommentReaction(wsId, doc.id);

  const [resolvedOpen, setResolvedOpen] = useState(false);
  const idempotencyRef = useRef<{ key: string; body: string; parentId: string } | null>(null);

  const level = doc.my_level;
  const canComment = level === "edit" || level === "manage";
  const canModerate = level === "manage";

  const comments = useMemo(() => query.data ?? [], [query.data]);
  const members = membersQuery.data;

  const actorNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) map.set(m.user_id, m.display_name);
    return map;
  }, [members]);

  const mentionItems = useMemo<ContentEditorProps["mentionContextItems"]>(
    () => (members ?? []).map((m) => ({ id: m.user_id, label: m.display_name, type: "member" as const })),
    [members],
  );

  const fail = useCallback(
    (err: unknown) => {
      toastApiError(err, t("documents.comments.action_failed"));
      // A write refused for permissions means the read may be gone too: re-ask
      // so the pane flips to the revoked state instead of showing stale rows.
      if (classifyDocumentError(err).cls === "permission") void query.refetch();
    },
    [t, query],
  );

  const submitComment = async (body: string, parentId?: string): Promise<boolean> => {
    try {
      const parent = parentId ?? "";
      const previous = idempotencyRef.current;
      const key =
        previous && previous.body === body && previous.parentId === parent
          ? previous.key
          : newIdempotencyKey();
      idempotencyRef.current = { key, body, parentId: parent };
      const created = await create.mutateAsync({
        body,
        parent_id: parentId,
        idempotencyKey: key,
      });
      idempotencyRef.current = null;
      return !!created;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const onEdit = async (commentId: string, body: string): Promise<boolean> => {
    try {
      const updated = await update.mutateAsync({ commentId, body });
      return !!updated;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const onToggleReaction = (commentId: string, emoji: string) => {
    const target = comments.find((c) => c.id === commentId);
    const reacted = target?.reactions?.some(
      (reaction) =>
        reaction.actor_type === "member" &&
        reaction.actor_id === currentUserId &&
        reaction.emoji === emoji,
    );
    const mutation = reacted ? removeReaction : addReaction;
    mutation.mutate({ commentId, emoji }, { onError: fail });
  };

  const onResolveToggle = (commentId: string, resolved: boolean) => {
    const mutation = resolved ? resolve : reopen;
    mutation.mutate(commentId, { onError: fail });
  };

  const onDelete = (commentId: string) => {
    remove.mutate(commentId, { onError: fail });
  };

  const threads = useMemo(() => buildCommentThreads(comments), [comments]);
  const openThreads = useMemo(
    () => threads.filter((thread) => deriveThreadResolution(thread.root, thread.replies).kind === "none"),
    [threads],
  );
  const resolvedThreads = useMemo(
    () => threads.filter((thread) => deriveThreadResolution(thread.root, thread.replies).kind !== "none"),
    [threads],
  );

  const renderThread = (thread: CommentThread<DocumentComment>) => (
    <CommentCard
      key={thread.root.id}
      comment={thread.root}
      replies={thread.replies}
      tPrefix="documents.comments"
      testIdPrefix="document-comment"
      canModerate={canModerate}
      reactionsReadOnly={!canComment}
      getActorName={(_type, id) => actorNames.get(id) ?? id}
      replyComposer={
        canComment ? (
          <div data-testid={`document-reply-composer-${thread.root.id}`}>
            <CommentReplyQuote
              comment={thread.root}
              tPrefix="documents.comments"
              className="mb-2"
            />
            <CommentComposerBox
              wsId={wsId}
              doc={doc}
              orgId={orgId}
              parentId={thread.root.id}
              mentionItems={mentionItems}
              compact
              refocusAfterSend
              testId="document-comment-reply-composer"
              onSubmit={(body) => submitComment(body, thread.root.id)}
            />
          </div>
        ) : undefined
      }
      onToggleReaction={canComment ? onToggleReaction : undefined}
      onEdit={canComment ? onEdit : undefined}
      onResolveToggle={canComment ? onResolveToggle : undefined}
      onDelete={canComment ? onDelete : undefined}
    />
  );

  const errorClass = query.error ? classifyDocumentError(query.error).cls : "unknown";
  const revoked = query.isError && errorClass === "permission";

  const body = (() => {
    if (query.isPending) {
      return (
        <div className="space-y-3 p-3" aria-busy="true" data-testid="document-comments-loading">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      );
    }
    if (query.isError) {
      return (
        <div className="p-4" role="alert" data-testid="document-comments-error">
          <p className="text-body font-medium text-foreground">
            {revoked
              ? t("documents.comments.revoked_title")
              : t("documents.comments.error_title")}
          </p>
          <p className="mt-1 text-caption text-muted-foreground">
            {revoked
              ? t("documents.comments.revoked_description")
              : t("documents.comments.error_description")}
          </p>
          {!revoked ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void query.refetch()}
            >
              <RotateCw aria-hidden className="size-3.5" />
              {t("documents.comments.retry")}
            </Button>
          ) : null}
        </div>
      );
    }
    return (
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {comments.length === 0 ? (
          <p className="text-caption text-muted-foreground" data-testid="document-comments-empty">
            {t("documents.comments.empty")}
          </p>
        ) : null}
        {openThreads.map(renderThread)}
        {resolvedThreads.length > 0 ? (
          <>
            <ResolvedThreadBar
              replyCount={resolvedThreads.length}
              expanded={resolvedOpen}
              onToggle={() => setResolvedOpen((value) => !value)}
              tPrefix="documents.comments"
            />
            {resolvedOpen ? resolvedThreads.map(renderThread) : null}
          </>
        ) : null}
      </div>
    );
  })();

  return (
    <div
      id="document-comments-panel"
      className="flex h-full min-h-0 flex-col bg-card"
      data-testid="document-comments-pane"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <MessageSquare aria-hidden className="size-4 text-muted-foreground" />
        <h2 className="min-w-0 truncate text-body font-semibold text-foreground">
          {t("documents.comments.title")}
        </h2>
        {query.isSuccess ? (
          <span className="shrink-0 text-caption text-muted-foreground">
            {t("documents.comments.count", { count: comments.length })}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0"
          aria-label={t("documents.comments.close")}
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </header>
      {body}
      {canComment && !query.isError ? (
        <div className="border-t border-border p-3">
          <CommentComposerBox
            wsId={wsId}
            doc={doc}
            orgId={orgId}
            mentionItems={mentionItems}
            onSubmit={(body) => submitComment(body)}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The document comments panel (G1-07c): a right-hand rail on `xl` and a sheet
 * below it, mounted from `DocumentDetailView` next to the workspace. Open
 * state lives in `DocumentCommentsProvider` (the header owns the trigger).
 * Renders nothing when the documents flag is off or when no provider exists.
 */
export function DocumentCommentsPanel() {
  const chrome = useDocumentCommentsChrome();
  const enabled = useFlag("documents", false);
  const { t } = useTranslation();
  const desktop = useMediaQuery(DESKTOP_QUERY);

  if (!chrome || !enabled || !chrome.open) return null;
  const { wsId, doc, setOpen } = chrome;
  const close = () => setOpen(false);

  if (desktop) {
    return (
      <aside
        aria-label={t("documents.comments.title")}
        className="flex w-96 min-w-0 shrink-0 flex-col border-l border-border"
      >
        <CommentsPane wsId={wsId} doc={doc} onClose={close} />
      </aside>
    );
  }

  return (
    <Sheet open onOpenChange={(next) => setOpen(next)}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-md"
      >
        <CommentsPane wsId={wsId} doc={doc} onClose={close} />
      </SheetContent>
    </Sheet>
  );
}
