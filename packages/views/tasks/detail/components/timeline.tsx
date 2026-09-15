"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { useCurrentMember } from "@uniwork/core/permissions";
import { useMembers } from "@uniwork/core/workspaces";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import { useResourceHistory } from "@uniwork/core/audit";
import type { AuditEvent } from "@uniwork/core/types";
import {
  useAddCommentReaction,
  useComments,
  useCreateCommentSuite,
  useDeleteComment,
  useRemoveCommentReaction,
  useProjects,
  useResolveComment,
  useSubscribeTask,
  useTaskAttachments,
  useTaskSubscribers,
  useUnresolveComment,
  useUnsubscribeTask,
  useUploadTaskAttachment,
  useUpdateComment,
} from "@uniwork/core/tasks";
import {
  useResolvedExpandedThreads,
  useTaskDetailUiStore,
} from "@uniwork/core/tasks/stores/task-detail-ui-store";
import { Button } from "@uniwork/ui/components/ui/button";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import {
  AvatarGroup,
  AvatarGroupCount,
} from "@uniwork/ui/components/ui/avatar";
import { toastApiError } from "../../../toast-api-error";
import { useFindExpandedThreads } from "../find/find-expanded-threads";
import { useTaskFindQuery } from "../find/find-query-context";
import { useTaskThreadNavOptional } from "../thread-nav-context";
import { isTimelineActivity } from "./activity-row";
import { TaskActivityGroup } from "./activity-group";
import { TaskCommentCard } from "./comment-card";
import { TaskCommentComposer } from "./comment-composer";
import { buildCommentThreads, type CommentThread } from "./comment-thread";
import { TaskReplyComposer } from "./reply-composer";
import { ResolvedThreadBar } from "./resolved-thread-bar";
import { scrollCommentIntoContainer } from "./thread-nav-helpers";
import { groupTimelineEntries } from "./timeline-entries";

const MAX_VISIBLE_FOLLOWERS = 4;

function avatarInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

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
}: {
  workspaceId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  // The open find bar's query ("" while it is closed), from the page's find
  // scope. Read here, not passed through the editors, so typing in the bar
  // re-renders the timeline and not the title and description editors.
  const findQuery = useTaskFindQuery();
  const errFallback = t("common.error");
  const currentUserId = useAuthStore((s) => s.user?.id);
  const threadNav = useTaskThreadNavOptional();
  const { data: comments, isLoading } = useComments(taskId);
  const attachments = useTaskAttachments(workspaceId, taskId);
  const { mutateAsync: uploadTaskAttachment } = useUploadTaskAttachment(workspaceId, taskId);
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
  const agents = useWorkspaceAgents(workspaceId);
  const projects = useProjects(workspaceId);
  const subscribe = useSubscribeTask(taskId);
  const unsubscribe = useUnsubscribeTask(taskId);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const currentMember = useCurrentMember(workspaceId);
  // Remembered per task, so an opened resolved thread is still open when the
  // person comes back. The store hands back a stable array (a shared empty
  // one when nothing is open); the Set is derived below, never in the
  // selector, or every render would produce a new identity and re-run the
  // scroll effect below.
  const expandedResolvedIds = useResolvedExpandedThreads(taskId);
  const uploadCommentFile = useCallback(async (file: File) => {
    const attachment = await uploadTaskAttachment(file);
    if (!attachment) throw new Error("upload failed");
    return attachment;
  }, [uploadTaskAttachment]);
  // The single source of truth for "which comment should the page scroll to
  // and highlight". Seeded from the URL hash on mount, and re-pointed by the
  // header thread-nav (via registerJump) — one mechanism, two triggers. The
  // nonce forces the effect below to rerun even when the same thread is
  // requested twice in a row.
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

  const jumpToComment = useCallback((id: string) => {
    setScrollRequest((prev) => ({ target: id, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  // Header panel jumps through the page-owned context; absent when the
  // timeline is mounted alone in a test without the suite provider.
  const registerJump = threadNav?.registerJump;
  useEffect(() => {
    if (!registerJump) return;
    registerJump(jumpToComment);
    return () => registerJump(null);
  }, [registerJump, jumpToComment]);

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
      new Map([
        ...(members.data ?? []).map((m) => [m.user_id, m.display_name] as const),
        ...(agents.data ?? []).map((a) => [a.id, a.name] as const),
      ]),
    [members.data, agents.data],
  );
  const actorAvatarUrls = useMemo(
    () =>
      new Map([
        ...(members.data ?? []).flatMap((member) =>
          typeof member.avatar_url === "string"
            ? [[member.user_id, member.avatar_url] as const]
            : [],
        ),
        ...(agents.data ?? []).flatMap((agent) =>
          agent.avatar_url ? [[agent.id, agent.avatar_url] as const] : [],
        ),
      ]),
    [members.data, agents.data],
  );
  const valueNames = useMemo(
    () =>
      new Map([
        ...(members.data ?? []).map((m) => [m.user_id, m.display_name] as const),
        ...(agents.data ?? []).map((a) => [a.id, a.name] as const),
        ...(projects.data?.projects ?? []).map((p) => [p.id, p.title] as const),
      ]),
    [members.data, agents.data, projects.data?.projects],
  );
  const displayEntries = useMemo(() => groupTimelineEntries(entries), [entries]);

  const watching = useMemo(() => {
    if (!currentUserId) return false;
    return (subscribers.data ?? []).some(
      (s) => s.actor_id === currentUserId && s.actor_type === "member",
    );
  }, [subscribers.data, currentUserId]);
  const followerActors = useMemo(
    () =>
      (subscribers.data ?? []).map((subscriber) => {
        const name = actorNames.get(subscriber.actor_id) ?? subscriber.actor_id;
        return {
          id: `${subscriber.actor_type}:${subscriber.actor_id}`,
          name,
          initials: avatarInitials(name),
          avatarUrl: actorAvatarUrls.get(subscriber.actor_id),
          isAgent: subscriber.actor_type === "agent",
        };
      }),
    [subscribers.data, actorNames, actorAvatarUrls],
  );

  useEffect(() => {
    const target = scrollRequest?.target ?? null;
    if (!target || threads.length === 0) return;
    // A link into a resolved thread must not hit a dead end: expand it first
    // so the target renders, then a later run of this effect (triggered by
    // the expandedResolved change) finds the element and scrolls to it. A
    // link wins over memory: a thread the person collapsed last visit still
    // opens for it, and stays remembered as open afterwards. The header
    // thread-nav points at this same target/effect pair instead of scrolling
    // on its own, so the two triggers never fight each other.
    const thread = threads.find(
      (th) => th.root.id === target || th.replies.some((r) => r.id === target),
    );
    // Whether to remember the thread reads the store's own ids, not the merged
    // set: a thread open only because find matches it still gets written, so
    // it stays open after the bar closes. Whether it is on screen yet (and can
    // be scrolled to now) reads the merged set.
    if (
      thread &&
      isThreadResolved(thread) &&
      !expandedResolvedIds.includes(thread.root.id)
    ) {
      useTaskDetailUiStore
        .getState()
        .setResolvedExpanded(taskId, thread.root.id, true);
      if (!expandedResolved.has(thread.root.id)) return;
    }
    const el = document.getElementById(`comment-${target}`);
    const container = threadNav?.scrollContainerEl;
    if (!el || !container) return;
    // Drive scrollTop on the page scroller only — never native scrollIntoView,
    // which also scrolls every scrollable ancestor (desktop shell included).
    scrollCommentIntoContainer(el, container);
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
  }, [
    scrollRequest,
    threads,
    taskId,
    expandedResolved,
    expandedResolvedIds,
    threadNav?.scrollContainerEl,
  ]);

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
      return !!created;
    } catch (err) {
      toastApiError(err, errFallback);
      return false;
    }
  };

  const renderCommentThread = (thread: CommentThread) => (
    <TaskCommentCard
      key={thread.root.id}
      taskId={taskId}
      comment={thread.root}
      replies={thread.replies}
      attachments={attachments.data}
      uploadFile={uploadCommentFile}
      highlighted={threadNav?.hoverThreadId === thread.root.id}
      highlightedId={highlightedId}
      canModerate={currentMember.role === "owner" || currentMember.role === "admin"}
      getActorName={(_type, id) => actorNames.get(id) ?? id}
      replyComposer={
        <TaskReplyComposer
          taskId={taskId}
          parent={thread.root}
          inline
          attachments={attachments.data}
          uploadFile={uploadCommentFile}
          onSubmit={(body) => onReplySubmit(thread.root.id, body)}
          onCancel={() => undefined}
        />
      }
      onToggleReaction={(commentId, emoji) => {
        const target = commentId === thread.root.id
          ? thread.root
          : thread.replies.find((reply) => reply.id === commentId);
        const reacted = target?.reactions?.some(
          (reaction) => reaction.actor_type === "member" && reaction.actor_id === currentUserId && reaction.emoji === emoji,
        );
        const mutation = reacted ? removeReaction : addReaction;
        mutation.mutate(
          { commentId, emoji },
          { onError: (err) => toastApiError(err, errFallback) },
        );
      }}
      onEdit={async (commentId, body) => {
        try {
          const updated = await updateComment.mutateAsync({ commentId, body: { body } });
          return !!updated;
        } catch (err) {
          toastApiError(err, errFallback);
          return false;
        }
      }}
      onResolveToggle={(commentId, resolved) => {
        if (resolved) {
          resolveComment.mutate(commentId, {
            onError: (err) => toastApiError(err, errFallback),
          });
        } else {
          unresolveComment.mutate(commentId, {
            onError: (err) => toastApiError(err, errFallback),
          });
        }
      }}
      onDelete={(commentId) => {
        deleteComment.mutate(commentId, {
          onError: (err) => toastApiError(err, errFallback),
        });
      }}
    />
  );

  return (
    <>
    {/* Activity section only — the composer sits outside so sticky can pin
        across the content column (baseline issue-detail). */}
    <section
      aria-label={t("tasks.detail.timeline_section")}
      className="mt-8 border-t border-border pt-6"
      data-testid="task-detail-timeline"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-body font-semibold text-foreground">
          {t("tasks.detail.timeline_section")}
        </h2>
        <div className="flex items-center gap-2">
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
          {followerActors.length > 0 ? (
            <AvatarGroup
              aria-label={t("tasks.detail.followers", {
                names: followerActors.map((actor) => actor.name).join(", "),
              })}
            >
              {followerActors.slice(0, MAX_VISIBLE_FOLLOWERS).map((actor) => (
                <ActorAvatar
                  key={actor.id}
                  name={actor.name}
                  initials={actor.initials}
                  avatarUrl={actor.avatarUrl}
                  isAgent={actor.isAgent}
                  size="md"
                />
              ))}
              {followerActors.length > MAX_VISIBLE_FOLLOWERS ? (
                <AvatarGroupCount aria-hidden="true">
                  {t("tasks.detail.more_followers_short", {
                    count: followerActors.length - MAX_VISIBLE_FOLLOWERS,
                  })}
                </AvatarGroupCount>
              ) : null}
            </AvatarGroup>
          ) : null}
        </div>
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
          displayEntries.map((entry) =>
            entry.kind === "activity-group" ? (
              <TaskActivityGroup
                key={`activity-${entry.events[0]?.id ?? "empty"}`}
                events={entry.events}
                actorNames={actorNames}
                actorAvatarUrls={actorAvatarUrls}
                valueNames={valueNames}
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
                    {renderCommentThread(entry.thread)}
                  </>
                ) : null}
              </div>
            ),
          )
        )}
      </div>
    </section>

    {/* Bottom comment input — direct child of the content column (not the
        Activity section): a sticky box can't leave its containing block, and
        the Activity section only spans the timeline — at column level
        `sticky bottom-0` pins across the whole scroll range (baseline).

        Opaque bg-background under the card, a 16px gradient fade above
        (covers the mt-4 gap at rest), and pb-4 so the card floats off the
        viewport edge — with -mb-4 giving the padding back to the column's
        py-8 so the at-rest layout doesn't shift. */}
    <div
      data-testid="task-comment-composer-dock"
      className="relative sticky bottom-0 z-10 mt-4 -mb-4 bg-background pb-4 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-4 before:bg-gradient-to-t before:from-background before:to-transparent"
    >
      <div className="rounded-lg border border-border bg-card px-3 py-2">
        <TaskCommentComposer
          taskId={taskId}
          attachments={attachments.data}
          uploadFile={uploadCommentFile}
          compact
          onSubmit={onCompose}
        />
      </div>
    </div>
    </>
  );
}
