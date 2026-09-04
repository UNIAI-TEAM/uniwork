"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchChatUserById } from "@uniwork/core/chat";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { GroupMemberProfile } from "./chat-page-utils";

export function useNativeGroupMemberProfiles({
  workspaceId,
  targetKind,
  activeGroup,
}: {
  workspaceId: string;
  targetKind: "workspace" | "dm" | "group";
  activeGroup: GroupChat | null;
}) {
  const [groupMemberProfiles, setGroupMemberProfiles] = useState<
    Record<string, GroupMemberProfile>
  >({});

  useEffect(() => {
    if (targetKind !== "group" || !activeGroup) {
      setGroupMemberProfiles((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    let cancelled = false;
    void Promise.all(
      activeGroup.member_user_ids.map(async (userId) => fetchChatUserById(workspaceId, userId)),
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
  }, [workspaceId, targetKind, activeGroup]);

  const clearGroupMemberProfiles = useCallback(() => {
    setGroupMemberProfiles({});
  }, []);

  return { groupMemberProfiles, clearGroupMemberProfiles };
}
