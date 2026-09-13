"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { useMembers } from "@uniwork/core/workspaces";
import { useResourceHistory } from "@uniwork/core/audit";
import type { AuditEvent, TaskComment } from "@uniwork/core/types";
import {
  useAddCommentReaction,
  useComments,
  useCreateCommentSuite,
  useDeleteComment,
  useRemoveCommentReaction,
  useResolveComment,
  useSubscribeTask,
  useTaskSubscribers,
  useUnresolveComment,
  useUnsubscribeTask,
  useUpdateComment,
} from "@uniwork/core/tasks";
import {
  useResolvedExpandedThreads,
  useTaskDetailUiStore,
} from "@uniwork/core/tasks/stores/task-detail-ui-store";
import { Button } from "@uniwork/ui/components/ui/button";
import { toastApiError } from "../../../toast-api-error";
import { useFindExpandedThreads } from "../find/find-expanded-threads";
import { TaskActivityRow, isTimelineActivity } from "./activity-row";
import { TaskCommentCard } from "./comment-card";
import { TaskCommentComposer } from "./comment-composer";
import { buildCommentThreads, type CommentThread } from "./comment-thread";
import { commentPreviewOrFallback } from "./comment-preview-text";
import { TaskReplyComposer } from "./reply-composer";
import { ResolvedThreadBar } from "./resolved-thread-bar";
import { ThreadNavPanel, type ThreadNavItem } from "./thread-nav-panel";

function isThreadResolved(thread: CommentThread): boolean {
  return !!thread.root.resolved_at;
}

function commentHashId(): string | null {
  if (typeof document === "undefined") return null;
  const hashIdx = document.URL.indexOf("#");
  if (hashIdx < 0) return null;
  const hash = document.URL.slice(hashIdx);
  const m = /^#comment-(.+)$/.exec(hash);
  return m?.[1] ?? null;
}

/**
 * Task detail timeline: comments from the comments endpoint merged with
 * activity read from the audit log, sorted by time. AgentRun/PR chrome was
 * removed at web cutover.
 */
export function TaskDetailTimeline({
  workspaceId,
  taskId,
  findQuery = "",
}: {
  workspaceId: string;
  taskId: string;
  /** The open find bar's query; "" while the bar is closed. */
  findQuery?: string;
}) {
  const { t } = useTranslation();
  const errFallback = t("common.error");
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { data: comments, isLoading } = useComments(taskId);
  const history = useResourceHistory(workspaceId, "task", taskId);
  const createComment = useCreateCommentSuite(taskId);
  const updateComment = useUpdateComment(taskId);
  const deleteComment = useDeleteComment(taskId);
  const resolveComment = useResolveComment(taskId);
  const unresolveComment = useUnresolveComment(taskId);
  const addReaction = useAddCommentReaction(taskId);
  const removeReaction = useRemoveCommentReaction(taskId);
  const subscribers = useTaskSubscribers(taskId);
  // Best effort: an actor outside this workspace still shows as a short id.
  const members = useMembers(workspaceId);
  const subscribe = useSubscribeTask(taskId);
  const unsubscribe = useUnsubscribeTask(taskId);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  // Remembered per task, so an opened resolved thread is still open when the
  // person comes back. The store hands back a stable array (a shared empty
  // one when nothing is open); the Set is derived below, never in the
  // selector, or every render would produce a new identity and re-run the
  // scroll effect below.
  const expandedResolvedIds = useResolvedExpandedThreads(taskId);
  // The single source of truth for "which comment should the page scroll to
  // and highlight". Seeded from the URL hash on mount, and re-pointed by the
  // thread-nav chips (via jumpToComment) — one mechanism, two triggers. The
  // nonce forces the effect below to rerun even when a chip is clicked twice
  // in a row for the same thread.
  const [scrollRequest, setScrollRequest] = useState<{
    target: string;
    nonce: number;
  } | null>(() => {
    const id = commentHashId();
    return id ? { target: id, nonce: 0 } : null;
  });

  const threads = useMemo(() => buildCommentThreads(comments ?? []), [comments]);

  // In-page find opens the resolved threads its query matches through a
  // temporary set that is never written to the store: a search is not the
  // person asking to keep a thread open (find/find-expanded-threads.ts).
  const findExpanded = useFindExpandedThreads(threads, findQuery);
  const expandedResolved = useMemo(
    () => new Set([...expandedResolvedIds, ...findExpanded.ids]),
    [expandedResolvedIds, findExpanded.ids],
  );

  const navThreads = useMemo<ThreadNavItem[]>(
    () =>
      threads.map((thread) => ({
        id: thread.root.id,
        preview: commentPreviewOrFallback(
          thread.root.body,
          t("tasks.detail.comment_preview_empty"),
        ),
        replyCount: thread.replies.length,
        resolved: isThreadResolved(thread),
      })),
    [threads, t],
  );

  // The highlight fade lives in a ref, not in the scroll effect's cleanup.
  // The effect clears `scrollRequest` as its last act, which re-runs it
  // immediately; a cleanup-owned timer would be cancelled by that very
  // re-run and the highlight would never fade.
  const fadeTimerRef = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      if (fadeTimerRef.current !== undefined) {
        window.clearTimeout(fadeTimerRef.current);
      }
    },
    [],
  );

  const jumpToComment = (id: string) =>
    setScrollRequest((prev) => ({ target: id, nonce: (prev?.nonce ?? 0) + 1 }));

  const entries = useMemo(() => {
    const commentRows = threads.map((thread) => ({
      kind: "comment" as const,
      at: thread.root.created_at ?? "",
      thread,
    }));
    const activityRows = (history.data ?? [])
      .filter((e: AuditEvent) => isTimelineActivity(e))
      .map((e: AuditEvent) => ({
        kind: "activity" as const,
        at: e.occurred_at,
        event: e,
      }));
    return [...commentRows, ...activityRows].sort((a, b) =>
      a.at.localeCompare(b.at),
    );
  }, [threads, history.data]);

  const actorNames = useMemo(
    () =>
      new Map(
        (members.data ?? []).map((m) => [m.user_id, m.display_name] as const),
      ),
    [members.data],
  );

  const watching = useMemo(() => {
    if (!currentUserId) return false;
    return (subscribers.data ?? []).some(
      (s) => s.actor_id === currentUserId && s.actor_type === "member",
    );
  }, [subscribers.data, currentUserId]);

  useEffect(() => {
    const target = scrollRequest?.target ?? null;
    if (!target || threads.length === 0) return;
    // A link into a resolved thread must not hit a dead end: expand it first
    // so the target renders, then a later run of this effect (triggered by
    // the expandedResolved change) finds the element and scrolls to it. A
    // link wins over memory: a thread the person collapsed last visit still
    // opens for it, and stays remembered as open afterwards. The
    // thread-nav chips point at this same target/effect pair instead of
    // scrolling on their own, so the two triggers never fight each other.
    const thread = threads.find(
      (th) => th.root.id === target || th.replies.some((r) => r.id === target),
    );
    if (
      thread &&
      isThreadResolved(thread) &&
      !expandedResolved.has(thread.root.id)
    ) {
      useTaskDetailUiStore
        .getState()
        .setResolvedExpanded(taskId, thread.root.id, true);
      return;
    }
    const el = document.getElementById(`comment-${target}`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    setHighlightedId(target);
    if (fadeTimerRef.current !== undefined) {
      window.clearTimeout(fadeTimerRef.current);
    }
    fadeTimerRef.current = window.setTimeout(() => {
      fadeTimerRef.current = undefined;
      setHighlightedId(null);
    }, 2500);
    // Honoured — retire the request. An un-cleared request stays "active"
    // against `expandedResolved` and `threads`, both of which this effect
    // depends on: collapsing the resolved thread you just jumped to would
    // re-run it and re-expand the thread (the bar springs back open), and
    // every comments refetch (posting, reacting) gives `threads` a new
    // identity and re-scrolls to the stale hash target with a fresh
    // highlight.
    setScrollRequest(null);
  }, [scrollRequest, threads, taskId, expandedResolved]);

  const onCompose = async (body: string): Promise<boolean> => {
    try {
      const created = await createComment.mutateAsync({ body: { body } });
      return !!created;
    } catch (err) {
      toastApiError(err, errFallback);
      return false;
    }
  };

  const onReplySubmit = async (parentId: string, body: string): Promise<boolean> => {
    try {
      const created = await createComment.mutateAsync({ body: { body, parent_id: parentId } });
      setReplyingTo(null);
      return !!created;
    } catch (err) {
      toastApiError(err, errFallback);
      return false;
    }
  };

  const renderCommentCard = (comment: TaskComment, onReply?: () => void) => (
    <TaskCommentCard
      key={comment.id}
      comment={comment}
      highlighted={highlightedId === comment.id}
      onReply={onReply}
      onToggleReaction={(emoji) => {
        addReaction.mutate(
          { commentId: comment.id, emoji },
          {
            onError: () => {
              removeReaction.mutate(
                { commentId: comment.id, emoji },
                {
                  onError: (err) => toastApiError(err, errFallback),
                },
              );
            },
          },
        );
      }}
      onEdit={(body) => {
        updateComment.mutate(
          { commentId: comment.id, body: { body } },
          { onError: (err) => toastApiError(err, errFallback) },
        );
      }}
      onResolveToggle={(resolved) => {
        if (resolved) {
          resolveComment.mutate(comment.id, {
            onError: (err) => toastApiError(err, errFallback),
          });
        } else {
          unresolveComment.mutate(comment.id, {
            onError: (err) => toastApiError(err, errFallback),
          });
        }
      }}
      onDelete={() => {
        deleteComment.mutate(comment.id, {
          onError: (err) => toastApiError(err, errFallback),
        });
      }}
    />
  );

  return (
    <section
      aria-label={t("tasks.detail.timeline_section")}
      className="mt-8 border-t border-border pt-6"
      data-testid="task-detail-timeline"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-body font-semibold text-foreground">
          {t("tasks.detail.timeline_section")}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-disabled={subscribe.isPending || unsubscribe.isPending || undefined}
          onClick={() => {
            if (subscribe.isPending || unsubscribe.isPending) return;
            if (watching) {
              unsubscribe.mutate(undefined, {
                onError: (err) => toastApiError(err, errFallback),
              });
            } else {
              subscribe.mutate(undefined, {
                onError: (err) => toastApiError(err, errFallback),
              });
            }
          }}
        >
          {watching
            ? t("tasks.detail.unsubscribe")
            : t("tasks.detail.subscribe")}
        </Button>
      </div>

      <ThreadNavPanel threads={navThreads} onJump={jumpToComment} />

      <div className="mt-4 space-y-3">
        {history.isError ? (
          <p
            data-testid="task-timeline-activity-error"
            className="text-caption text-destructive"
          >
            {t("tasks.detail.activity_error")}
          </p>
        ) : null}
        {isLoading ? (
          <p className="text-caption text-muted-foreground">
            {t("common.loading")}
          </p>
        ) : entries.length === 0 ? (
          history.isError ? null : (
            <p className="text-caption text-muted-foreground">
              {t("tasks.detail.comments_empty")}
            </p>
          )
        ) : (
          entries.map((entry) =>
            entry.kind === "activity" ? (
              <TaskActivityRow
                key={entry.event.id}
                event={entry.event}
                actorName={actorNames.get(entry.event.actor_id)}
              />
            ) : (
              <div
                key={entry.thread.root.id}
                data-testid={`task-timeline-comment-${entry.thread.root.id}`}
              >
                {isThreadResolved(entry.thread) ? (
                  <ResolvedThreadBar
                    replyCount={entry.thread.replies.length}
                    expanded={expandedResolved.has(entry.thread.root.id)}
                    onToggle={() => {
                      const rootId = entry.thread.root.id;
                      const open = expandedResolved.has(rootId);
                      // Collapsing also closes a thread only find opened;
                      // only a person's own open is remembered.
                      if (open) findExpanded.dismiss(rootId);
                      useTaskDetailUiStore
                        .getState()
                        .setResolvedExpanded(taskId, rootId, !open);
                    }}
                  />
                ) : null}
                {!isThreadResolved(entry.thread) ||
                expandedResolved.has(entry.thread.root.id) ? (
                  <>
                    {renderCommentCard(entry.thread.root, () =>
                      setReplyingTo(entry.thread.root.id),
                    )}
                    {entry.thread.replies.length > 0 ? (
                      <div className="ml-6 border-l border-border pl-3">
                        {entry.thread.replies.map((reply) =>
                          renderCommentCard(reply),
                        )}
                      </div>
                    ) : null}
                    {replyingTo === entry.thread.root.id ? (
                      <div className="ml-6 border-l border-border pl-3">
                        <TaskReplyComposer
                          taskId={taskId}
                          parent={entry.thread.root}
                          onSubmit={(body) =>
                            onReplySubmit(entry.thread.root.id, body)
                          }
                          onCancel={() => setReplyingTo(null)}
                        />
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ),
          )
        )}
      </div>

      <div
        data-testid="task-comment-composer-dock"
        className="sticky bottom-0 z-10 mt-4 border-t border-border bg-background pt-3"
      >
        <TaskCommentComposer taskId={taskId} onSubmit={onCompose} />
      </div>
    </section>
  );
}
