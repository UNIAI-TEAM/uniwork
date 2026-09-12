"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { useMembers } from "@uniwork/core/workspaces";
import { useResourceHistory } from "@uniwork/core/audit";
import type { AuditEvent } from "@uniwork/core/types";
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
import { Button } from "@uniwork/ui/components/ui/button";
import { toastApiError } from "../../../toast-api-error";
import { TaskActivityRow, isTimelineActivity } from "./activity-row";
import { TaskCommentCard } from "./comment-card";
import { TaskCommentComposer } from "./comment-composer";

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
}: {
  workspaceId: string;
  taskId: string;
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

  const roots = useMemo(() => {
    const list = comments ?? [];
    return list
      .filter((c) => !c.parent_id)
      .slice()
      .sort((a, b) => {
        const ta = a.created_at ?? "";
        const tb = b.created_at ?? "";
        return ta.localeCompare(tb);
      });
  }, [comments]);

  const entries = useMemo(() => {
    const commentRows = roots.map((c) => ({
      kind: "comment" as const,
      at: c.created_at ?? "",
      comment: c,
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
  }, [roots, history.data]);

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
    const target = commentHashId();
    if (!target || roots.length === 0) return;
    const el = document.getElementById(`comment-${target}`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    setHighlightedId(target);
    const fade = window.setTimeout(() => setHighlightedId(null), 2500);
    return () => window.clearTimeout(fade);
  }, [roots, taskId]);

  const onCompose = async (body: string): Promise<boolean> => {
    try {
      const created = await createComment.mutateAsync({ body: { body } });
      return !!created;
    } catch (err) {
      toastApiError(err, errFallback);
      return false;
    }
  };

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
                key={entry.comment.id}
                data-testid={`task-timeline-comment-${entry.comment.id}`}
              >
                <TaskCommentCard
                  comment={entry.comment}
                  highlighted={highlightedId === entry.comment.id}
                  onToggleReaction={(emoji) => {
                    addReaction.mutate(
                      { commentId: entry.comment.id, emoji },
                      {
                        onError: () => {
                          removeReaction.mutate(
                            { commentId: entry.comment.id, emoji },
                            {
                              onError: (err) =>
                                toastApiError(err, errFallback),
                            },
                          );
                        },
                      },
                    );
                  }}
                  onEdit={(body) => {
                    updateComment.mutate(
                      { commentId: entry.comment.id, body: { body } },
                      { onError: (err) => toastApiError(err, errFallback) },
                    );
                  }}
                  onResolveToggle={(resolved) => {
                    if (resolved) {
                      resolveComment.mutate(entry.comment.id, {
                        onError: (err) => toastApiError(err, errFallback),
                      });
                    } else {
                      unresolveComment.mutate(entry.comment.id, {
                        onError: (err) => toastApiError(err, errFallback),
                      });
                    }
                  }}
                  onDelete={() => {
                    deleteComment.mutate(entry.comment.id, {
                      onError: (err) => toastApiError(err, errFallback),
                    });
                  }}
                />
              </div>
            ),
          )
        )}
      </div>

      <div className="mt-4">
        <TaskCommentComposer taskId={taskId} onSubmit={onCompose} />
      </div>
    </section>
  );
}
