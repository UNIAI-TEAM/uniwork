"use client";

import { useMemo } from "react";
import { useAuthStore } from "@uniwork/core/auth";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import { useComments } from "@uniwork/core/tasks";
import { useMembers } from "@uniwork/core/workspaces";
import { useTaskThreadNav } from "../thread-nav-context";
import { ThreadNavPanel } from "./thread-nav-panel";
import { buildThreadNavThreads } from "./thread-nav-helpers";

/**
 * Header thread navigator. Builds thread rows from the same comments query the
 * timeline uses, and jumps through the page-owned thread-nav context.
 */
export function TaskDetailThreadNav({
  workspaceId,
  taskId,
}: {
  workspaceId: string;
  taskId: string;
}) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const comments = useComments(taskId);
  const members = useMembers(workspaceId);
  const agents = useWorkspaceAgents(workspaceId);
  const {
    open,
    pinned,
    onOpenChange,
    onHoverThread,
    jumpToThread,
  } = useTaskThreadNav();

  const getActorName = useMemo(() => {
    const names = new Map<string, string>([
      ...(members.data ?? []).map(
        (m) => [m.user_id, m.display_name] as const,
      ),
      ...(agents.data ?? []).map((a) => [a.id, a.name] as const),
    ]);
    return (_kind: string, id: string) => names.get(id) ?? id;
  }, [members.data, agents.data]);

  const threads = useMemo(
    () => buildThreadNavThreads(comments.data ?? [], currentUserId),
    [comments.data, currentUserId],
  );

  return (
    <ThreadNavPanel
      threads={threads}
      onJump={jumpToThread}
      onHoverThread={onHoverThread}
      open={open}
      pinned={pinned}
      onOpenChange={onOpenChange}
      getActorName={getActorName}
    />
  );
}
