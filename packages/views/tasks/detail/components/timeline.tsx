"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
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
import { TaskCommentCard } from "./comment-card";
import { TaskCommentComposer } from "./comment-composer";
import { TaskDetailRuntimeStubs } from "./timeline-runtime-stubs";

function commentHashId(): string | null {
  if (typeof document === "undefined") return null;
  const hashIdx = document.URL.indexOf("#");
  if (hashIdx < 0) return null;
  const hash = document.URL.slice(hashIdx);
  const m = /^#comment-(.+)$/.exec(hash);
  return m?.[1] ?? null;
}

/**
 * Task detail timeline: comments from the comments endpoint, activity stub
 * (GetTaskTimeline is still capability_unavailable), AgentRun/PR stubs.
 */
export function TaskDetailTimeline({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const errFallback = t("common.error");
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { data: comments, isLoading } = useComments(taskId);
  const createComment = useCreateCommentSuite(taskId);
  const updateComment = useUpdateComment(taskId);
  const deleteComment = useDeleteComment(taskId);
  const resolveComment = useResolveComment(taskId);
  const unresolveComment = useUnresolveComment(taskId);
  const addReaction = useAddCommentReaction(taskId);
  const removeReaction = useRemoveCommentReaction(taskId);
  const subscribers = useTaskSubscribers(taskId);
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

      <TaskDetailRuntimeStubs />

      <p className="mt-3 text-caption text-muted-foreground">
        {t("tasks.detail.activity_stub_reason")}
      </p>

      <div className="mt-4 space-y-3">
        {isLoading ? (
          <p className="text-caption text-muted-foreground">
            {t("common.loading")}
          </p>
        ) : roots.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            {t("tasks.detail.comments_empty")}
          </p>
        ) : (
          roots.map((c) => (
            <TaskCommentCard
              key={c.id}
              comment={c}
              highlighted={highlightedId === c.id}
              onToggleReaction={(emoji) => {
                addReaction.mutate(
                  { commentId: c.id, emoji },
                  {
                    onError: () => {
                      removeReaction.mutate(
                        { commentId: c.id, emoji },
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
                  { commentId: c.id, body: { body } },
                  { onError: (err) => toastApiError(err, errFallback) },
                );
              }}
              onResolveToggle={(resolved) => {
                if (resolved) {
                  resolveComment.mutate(c.id, {
                    onError: (err) => toastApiError(err, errFallback),
                  });
                } else {
                  unresolveComment.mutate(c.id, {
                    onError: (err) => toastApiError(err, errFallback),
                  });
                }
              }}
              onDelete={() => {
                deleteComment.mutate(c.id, {
                  onError: (err) => toastApiError(err, errFallback),
                });
              }}
            />
          ))
        )}
      </div>

      <div className="mt-4">
        <TaskCommentComposer taskId={taskId} onSubmit={onCompose} />
      </div>
    </section>
  );
}
