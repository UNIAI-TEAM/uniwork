"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchChatUserById } from "@uniwork/core/chat";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { GroupMemberProfile } from "./chat-page-utils";

export function useNativeGroupMemberProfiles({
  workspaceId,
  targetKind,
  activeGroup,
  activeChannel = null,
}: {
  workspaceId: string;
  targetKind: "workspace" | "dm" | "group" | "channel";
  activeGroup: GroupChat | null;
  activeChannel?: { member_user_ids: string[] } | null;
}) {
  const [groupMemberProfiles, setGroupMemberProfiles] = useState<
    Record<string, GroupMemberProfile>
  >({});

  useEffect(() => {
    const memberIds =
      targetKind === "group"
        ? activeGroup?.member_user_ids
        : targetKind === "channel"
          ? activeChannel?.member_user_ids
          : undefined;
    if (!memberIds) {
      setGroupMemberProfiles((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    let cancelled = false;
    void Promise.all(
      memberIds.map(async (userId) => fetchChatUserById(workspaceId, userId)),
    ).then((users) => {
      if (cancelled) return;
      const next: Record<string, GroupMemberProfile> = {};
      for (const user of users) {
        if (!user) continue;
        next[user.user_id] = {
          user_id: user.user_id,
          display_name: user.display_name,
          email: user.email,
        };
      }
      setGroupMemberProfiles(next);
    });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, targetKind, activeGroup, activeChannel]);

  const clearGroupMemberProfiles = useCallback(() => {
    setGroupMemberProfiles({});
  }, []);

  return { groupMemberProfiles, clearGroupMemberProfiles };
}
