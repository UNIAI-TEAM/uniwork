"use client";
import { useMemo } from "react";
import { useMembers } from "@uniwork/core/workspaces";

type Member = NonNullable<ReturnType<typeof useMembers>["data"]>[number];

/**
 * Workspace members keyed by user id, built once per members response so
 * rows (roster, activity, action items) resolve a person without scanning
 * the whole list each time. `loaded` tells "not a member any more" apart
 * from "members still loading".
 */
export function useMemberIndex(workspaceId: string): {
  memberOf: (userId?: string | null) => Member | undefined;
  members: Member[];
  loaded: boolean;
} {
  const { data } = useMembers(workspaceId);
  return useMemo(() => {
    const members = data ?? [];
    const byId = new Map(members.map((m) => [m.user_id, m]));
    return {
      memberOf: (userId?: string | null) => (userId ? byId.get(userId) : undefined),
      members,
      loaded: data !== undefined,
    };
  }, [data]);
}
