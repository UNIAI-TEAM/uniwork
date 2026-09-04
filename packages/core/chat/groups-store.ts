"use client";

import { sessionStorageAdapter } from "../platform/storage";

export interface GroupChat {
  id: string;
  name: string;
  room_id: string;
  /** UniWork user ids (excluding self), sorted for stable matching. */
  member_user_ids: string[];
}

const storageKey = (userId: string) => `uniwork:chat-groups:${userId}`;

function readRaw(userId: string): GroupChat[] {
  const raw = sessionStorageAdapter.getItem(storageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is GroupChat =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as GroupChat).id === "string" &&
        typeof (item as GroupChat).name === "string" &&
        typeof (item as GroupChat).room_id === "string" &&
        Array.isArray((item as GroupChat).member_user_ids),
    );
  } catch {
    return [];
  }
}

function write(userId: string, groups: GroupChat[]): void {
  sessionStorageAdapter.setItem(storageKey(userId), JSON.stringify(groups));
}

export function memberSetKey(userIds: string[]): string {
  return [...userIds].map((id) => id.trim().toUpperCase()).sort().join("\u0000");
}

export function listGroupChats(userId: string): GroupChat[] {
  const groups = readRaw(userId);
  const roomIds = new Set(groups.map((g) => g.room_id));
  const hasDuplicateIds = groups.some((g) => g.id !== g.room_id);
  const hasDuplicateRooms = roomIds.size !== groups.length;
  if (!hasDuplicateIds && !hasDuplicateRooms) return groups;
  return dedupeGroupChats(userId);
}

export function upsertGroupChat(userId: string, group: GroupChat): GroupChat[] {
  const prev = readRaw(userId);
  const canonicalId = group.room_id.trim();
  const byRoom = prev.find((g) => g.room_id === canonicalId);
  const byId = prev.find((g) => g.id === group.id || g.id === canonicalId);
  const existing = byRoom ?? byId;
  const merged: GroupChat = existing
    ? {
        id: canonicalId,
        name: group.name.trim() ? group.name : existing.name,
        room_id: canonicalId,
        member_user_ids:
          group.member_user_ids.length > existing.member_user_ids.length
            ? group.member_user_ids
            : existing.member_user_ids,
      }
    : {
        ...group,
        id: canonicalId,
        room_id: canonicalId,
      };
  const next = [...prev.filter((g) => g.room_id !== canonicalId && g.id !== canonicalId), merged];
  write(userId, next);
  return next;
}

/** Collapse legacy rows that used a ULID id for the same Matrix room. */
export function dedupeGroupChats(userId: string): GroupChat[] {
  const prev = readRaw(userId);
  const byRoom = new Map<string, GroupChat>();
  for (const group of prev) {
    const roomId = group.room_id.trim();
    if (!roomId) continue;
    const existing = byRoom.get(roomId);
    if (!existing) {
      byRoom.set(roomId, { ...group, id: roomId, room_id: roomId });
      continue;
    }
    byRoom.set(roomId, {
      id: roomId,
      room_id: roomId,
      name: group.name.trim() ? group.name : existing.name,
      member_user_ids:
        group.member_user_ids.length > existing.member_user_ids.length
          ? group.member_user_ids
          : existing.member_user_ids,
    });
  }
  const next = [...byRoom.values()];
  write(userId, next);
  return next;
}

export function findGroupByRoomId(userId: string, roomId: string): GroupChat | undefined {
  return readRaw(userId).find((g) => g.room_id === roomId);
}

export function findGroupByMemberSet(userId: string, memberUserIds: string[]): GroupChat | undefined {
  const key = memberSetKey(memberUserIds);
  return readRaw(userId).find((g) => memberSetKey(g.member_user_ids) === key);
}

export function pruneGroupChatsNotInRooms(userId: string, roomIds: string[]): GroupChat[] {
  const keep = new Set(roomIds.map((id) => id.trim()).filter(Boolean));
  const next = readRaw(userId).filter((group) => keep.has(group.room_id));
  write(userId, next);
  return next;
}

export function removeGroupChat(userId: string, groupIdOrRoomId: string): GroupChat[] {
  const key = groupIdOrRoomId.trim();
  const next = readRaw(userId).filter((group) => group.id !== key && group.room_id !== key);
  write(userId, next);
  return next;
}

/** Test seam */
export function resetGroupChatsForTests(userId?: string): void {
  if (userId) sessionStorageAdapter.removeItem(storageKey(userId));
}
