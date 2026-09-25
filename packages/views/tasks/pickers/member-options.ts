import { useMemo } from "react";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import type { Agent, Member } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import type { AssigneeOption } from "./assignee-picker";

/** A workspace member as the task surfaces show it: id, readable name, avatar. */
export type MemberOption = {
  id: string;
  name: string;
  avatarUrl?: string;
};

export function toMemberOptions(members: Member[]): MemberOption[] {
  return members.map((member) => ({
    id: member.user_id,
    name: member.display_name || member.email,
    ...(typeof member.avatar_url === "string"
      ? { avatarUrl: member.avatar_url }
      : {}),
  }));
}

/** Members and workspace agents in the same order used by assignee pickers. */
export function toWorkspaceAssigneeOptions(
  members: MemberOption[],
  agents: Agent[],
): AssigneeOption[] {
  return [
    ...members.map((member) => ({
      id: member.id,
      kind: "human" as const,
      name: member.name,
      avatarUrl: member.avatarUrl,
    })),
    ...agents.map((agent) => ({
      id: agent.id,
      kind: "agent" as const,
      name: agent.name,
      avatarUrl: agent.avatar_url,
    })),
  ];
}

export type WorkspaceAssigneeOptions = {
  options: AssigneeOption[];
  /** First load in flight; `options` is empty but the workspace may have members. */
  isLoading: boolean;
  /** The load failed and there is no earlier list to fall back on. */
  isError: boolean;
};

/**
 * Same member list and mapping the table's assignee picker receives. Loading
 * and error are returned beside the options, so an empty list is never read
 * as a workspace with no members.
 */
export function useWorkspaceAssigneeOptions(
  workspaceId: string,
): WorkspaceAssigneeOptions {
  const members = useMembers(workspaceId);
  const agents = useWorkspaceAgents(workspaceId);
  const options = useMemo(
    () => toWorkspaceAssigneeOptions(toMemberOptions(members.data ?? []), agents.data ?? []),
    [agents.data, members.data],
  );
  return {
    options,
    isLoading: members.isLoading || agents.isLoading,
    isError:
      (members.isError && members.data === undefined) ||
      (agents.isError && agents.data === undefined),
  };
}
