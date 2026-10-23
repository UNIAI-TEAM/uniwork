"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useChatRoomMembers } from "@uniwork/core/chat";
import { fetchChatUserById } from "@uniwork/core/chat/user-lookup";
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
  activeChannel?: { id: string } | null;
}) {
  const [groupMemberProfiles, setGroupMemberProfiles] = useState<
    Record<string, GroupMemberProfile>
  >({});
  // A channel's sidebar row carries only its size: its roster, with names,
  // comes from one room-members call instead of a lookup per member.
  const { data: channelMembers } = useChatRoomMembers(
    workspaceId,
    activeChannel?.id ?? "",
    targetKind === "channel",
  );
  const channelMemberProfiles = useMemo(() => {
    const next: Record<string, GroupMemberProfile> = {};
    for (const member of channelMembers ?? []) {
      next[member.user_id] = {
        user_id: member.user_id,
        display_name: member.display_name,
        email: member.email,
      };
    }
    return next;
  }, [channelMembers]);

  useEffect(() => {
    const memberIds = targetKind === "group" ? activeGroup?.member_user_ids : undefined;
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
  }, [workspaceId, targetKind, activeGroup]);

  const clearGroupMemberProfiles = useCallback(() => {
    setGroupMemberProfiles({});
  }, []);

  return {
    groupMemberProfiles: targetKind === "channel" ? channelMemberProfiles : groupMemberProfiles,
    clearGroupMemberProfiles,
  };
}
