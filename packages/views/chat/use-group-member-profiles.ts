"use client";

import { useEffect, useRef, useState } from "react";
import { fetchChatUserById } from "@uniwork/core/chat";
import { peekCachedChatUserById } from "@uniwork/core/chat/user-lookup";
import { listGroupChats } from "@uniwork/core/chat/groups-store";
import type { useMatrixStore } from "@uniwork/core/chat/matrix-store";
import { ClientEvent, RoomEvent, type MatrixClient } from "matrix-js-sdk";
import { readGroupMemberUserIds } from "./matrix-group";
import type { GroupMemberProfile } from "./chat-page-utils";
import { memberSetChanged } from "./chat-page-utils";

export function useGroupMemberProfiles({
  targetKind,
  matrixClient,
  matrixSession,
  activeRoomId,
  selectedGroupId,
  currentUserId,
  saveGroup,
}: {
  targetKind: "workspace" | "dm" | "group";
  matrixClient: MatrixClient | null;
  matrixSession: NonNullable<ReturnType<typeof useMatrixStore.getState>["session"]> | null;
  activeRoomId: string | null;
  selectedGroupId: string | null;
  currentUserId: string;
  saveGroup: (group: import("@uniwork/core/chat/groups-store").GroupChat) => void;
}) {
  const [groupMemberProfiles, setGroupMemberProfiles] = useState<
    Record<string, GroupMemberProfile>
  >({});
  const profileDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (targetKind !== "group" || !matrixClient || !matrixSession || !activeRoomId || !selectedGroupId) {
      setGroupMemberProfiles((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    const refreshMembers = () => {
      const memberUserIds = readGroupMemberUserIds(
        matrixClient,
        activeRoomId,
        matrixSession.user_id,
      );
      if (memberUserIds.length === 0) return;

      const stored = listGroupChats(currentUserId).find(
        (group) => group.id === selectedGroupId || group.room_id === selectedGroupId,
      );
      if (!stored || !memberSetChanged(stored.member_user_ids, memberUserIds)) return;
      saveGroup({ ...stored, member_user_ids: memberUserIds });
    };

    const refreshProfiles = () => {
      const memberUserIds = readGroupMemberUserIds(
        matrixClient,
        activeRoomId,
        matrixSession.user_id,
      );

      const fromCache: Record<string, GroupMemberProfile> = {};
      for (const userId of memberUserIds) {
        const cached = peekCachedChatUserById(userId);
        if (!cached) continue;
        fromCache[cached.user_id] = {
          user_id: cached.user_id,
          display_name: cached.display_name,
          email: cached.email,
          matrix_user_id: cached.matrix_user_id ?? null,
        };
      }
      if (Object.keys(fromCache).length > 0) {
        setGroupMemberProfiles((prev) => {
          const merged = { ...prev, ...fromCache };
          return JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged;
        });
      }

      const missing = memberUserIds.filter((userId) => !peekCachedChatUserById(userId));
      if (missing.length === 0) return;

      void Promise.all(missing.map((userId) => fetchChatUserById(userId)))
        .then((profiles) => {
          const next: Record<string, GroupMemberProfile> = {};
          for (const profile of profiles) {
            if (!profile) continue;
            next[profile.user_id] = {
              user_id: profile.user_id,
              display_name: profile.display_name,
              email: profile.email,
              matrix_user_id: profile.matrix_user_id ?? null,
            };
          }
          setGroupMemberProfiles((prev) => {
            const merged = { ...prev, ...next };
            const prevKey = JSON.stringify(prev);
            const nextKey = JSON.stringify(merged);
            return prevKey === nextKey ? prev : merged;
          });
        })
        .catch(() => undefined);
    };

    refreshMembers();
    refreshProfiles();

    const onActivity = () => {
      refreshMembers();
      if (profileDebounceRef.current) clearTimeout(profileDebounceRef.current);
      profileDebounceRef.current = setTimeout(() => {
        profileDebounceRef.current = null;
        refreshProfiles();
      }, 600);
    };
    matrixClient.on(RoomEvent.Timeline, onActivity);
    matrixClient.on(ClientEvent.Room, onActivity);

    return () => {
      if (profileDebounceRef.current) clearTimeout(profileDebounceRef.current);
      matrixClient.removeListener(RoomEvent.Timeline, onActivity);
      matrixClient.removeListener(ClientEvent.Room, onActivity);
    };
  }, [selectedGroupId, activeRoomId, matrixClient, matrixSession, saveGroup, targetKind, currentUserId]);

  const clearGroupMemberProfiles = () => {
    setGroupMemberProfiles({});
  };

  return { groupMemberProfiles, clearGroupMemberProfiles };
}
