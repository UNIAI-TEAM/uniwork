"use client";
import { useCallback, useSyncExternalStore } from "react";
import {
  dedupeGroupChats,
  listGroupChats,
  pruneGroupChatsNotInRooms,
  removeGroupChat,
  upsertGroupChat,
  type GroupChat,
} from "./groups-store";

const groupListeners = new Set<() => void>();
const EMPTY_GROUPS: GroupChat[] = [];
const groupSnapshots = new Map<string, { key: string; value: GroupChat[] }>();

function groupsSnapshotKey(groups: GroupChat[]): string {
  return JSON.stringify(groups);
}

function getGroupsSnapshot(userId: string): GroupChat[] {
  const groups = listGroupChats(userId);
  const key = groupsSnapshotKey(groups);
  const cached = groupSnapshots.get(userId);
  if (cached?.key === key) return cached.value;
  const value = groups.length === 0 ? EMPTY_GROUPS : groups.map((g) => ({ ...g }));
  groupSnapshots.set(userId, { key, value });
  return value;
}

function bumpGroups(): void {
  groupSnapshots.clear();
  groupListeners.forEach((l) => l());
}

function subscribeGroups(listener: () => void): () => void {
  groupListeners.add(listener);
  return () => groupListeners.delete(listener);
}

export function useGroupChats(userId: string): GroupChat[] {
  return useSyncExternalStore(
    subscribeGroups,
    () => getGroupsSnapshot(userId),
    () => EMPTY_GROUPS,
  );
}

export function useGroupChatActions(userId: string) {
  const saveGroup = useCallback(
    (group: GroupChat) => {
      upsertGroupChat(userId, group);
      bumpGroups();
    },
    [userId],
  );

  const removeGroup = useCallback(
    (groupIdOrRoomId: string) => {
      removeGroupChat(userId, groupIdOrRoomId);
      bumpGroups();
    },
    [userId],
  );

  const reconcileGroups = useCallback(
    (activeRoomIds: string[]) => {
      dedupeGroupChats(userId);
      pruneGroupChatsNotInRooms(userId, activeRoomIds);
      bumpGroups();
    },
    [userId],
  );

  return { saveGroup, removeGroup, reconcileGroups };
}
