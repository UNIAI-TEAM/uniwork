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
 * Task surfaces only offer human members as assignees; agent assignment is not
 * offered from the table or the row menu (see assignee-picker.tsx, task-2 report).
 */
export function toHumanAssigneeOptions(
  members: MemberOption[],
): AssigneeOption[] {
  return members.map((member) => ({
    id: member.id,
    kind: "human",
    name: member.name,
    avatarUrl: member.avatarUrl,
  }));
}

/** Same member list and mapping the table's assignee picker receives. */
export function useWorkspaceAssigneeOptions(
  workspaceId: string,
): AssigneeOption[] {
  const { data } = useMembers(workspaceId);
  return useMemo(
    () => toHumanAssigneeOptions(toMemberOptions(data ?? [])),
    [data],
  );
}
