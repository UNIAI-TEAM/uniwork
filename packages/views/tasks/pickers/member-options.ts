import { useMemo } from "react";
import type { Member } from "@uniwork/core/types";
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

/**
 * Human members as assignee options. The row menu and batch toolbar offer
 * only these; the table cell and the properties sidebar add the agents.
 */
function toHumanAssigneeOptions(
  members: MemberOption[],
): AssigneeOption[] {
  return members.map((member) => ({
    id: member.id,
    kind: "human",
    name: member.name,
    avatarUrl: member.avatarUrl,
  }));
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
  const { data, isLoading, isError } = useMembers(workspaceId);
  const options = useMemo(
    () => toHumanAssigneeOptions(toMemberOptions(data ?? [])),
    [data],
  );
  return { options, isLoading, isError: isError && data === undefined };
}
