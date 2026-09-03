"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import * as chat from "../api/endpoints/chat";
import type { ChatUserLookup, ChatRoomRecord } from "../api/endpoints/chat";
import { listChatRoomMessages } from "../api/endpoints/chat";
import { lookupChatUserByIdCached, lookupChatUserCached } from "./user-lookup";
import { ApiError } from "../api/http";
import { useAuthStore } from "../auth/store";
import {
  listChatContacts,
  mergeChatContact,
  removeChatContact,
  setChatContactRoom,
  upsertChatContact,
  type ChatContact,
} from "./contacts-store";
import {
  dedupeGroupChats,
  listGroupChats,
  pruneGroupChatsNotInRooms,
  removeGroupChat,
  upsertGroupChat,
  type GroupChat,
} from "./groups-store";

export const chatKeys = {
  room: (wsId: string) => ["chat", "room", wsId] as const,
  rooms: (wsId: string) => ["chat", "rooms", wsId] as const,
  messages: (wsId: string) => ["chat", "messages", wsId] as const,
  roomMessages: (wsId: string, roomId: string) => ["chat", "room-messages", wsId, roomId] as const,
  lookup: (wsId: string, email: string) => ["chat", "lookup", wsId, email] as const,
  block: (wsId: string, userId: string) => ["chat", "block", wsId, userId] as const,
};

export function useWorkspaceChatRoom(workspaceId: string) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.room(workspaceId),
    queryFn: () => chat.getWorkspaceChatRoom(workspaceId),
    enabled: !!workspaceId && authReady,
    retry: 2,
    retryDelay: 400,
  });
}

export function useEnsureWorkspaceChatRoom(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const room = await chat.ensureWorkspaceChatRoom(workspaceId);
      if (!room?.room_id) throw new Error("chat_room_failed");
      return room;
    },
    onSuccess: (room) => {
      qc.setQueryData(chatKeys.room(workspaceId), room);
    },
  });
}

export function useWorkspaceChatMessages(workspaceId: string, enabled: boolean) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.messages(workspaceId),
    queryFn: () => chat.listWorkspaceChatMessages(workspaceId),
    enabled: !!workspaceId && authReady && enabled,
    refetchInterval: false,
  });
}

export function useSendWorkspaceChatMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; reply_to_message_id?: string }) =>
      chat.sendWorkspaceChatMessage(workspaceId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.messages(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.room(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function useChatRooms(workspaceId: string) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.rooms(workspaceId),
    queryFn: () => chat.listChatRooms(workspaceId),
    enabled: !!workspaceId && authReady,
  });
}

export function useResolveDMRoom(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => chat.resolveDMRoom(workspaceId, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function useCreateChatGroup(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; member_user_ids: string[] }) =>
      chat.createChatGroup(workspaceId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function useInviteChatGroupMembers(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roomId: string; memberUserIds: string[] }) =>
      chat.inviteChatGroupMembers(workspaceId, input.roomId, input.memberUserIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function useLeaveChatRoom(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => chat.leaveChatRoom(workspaceId, roomId),
    onSuccess: (_data, roomId) => {
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
      void qc.removeQueries({ queryKey: chatKeys.roomMessages(workspaceId, roomId) });
    },
  });
}

export function useSendChatRoomMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roomId: string; body: string; reply_to_message_id?: string }) =>
      chat.sendChatRoomMessage(workspaceId, input.roomId, input),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({
        queryKey: chatKeys.roomMessages(workspaceId, variables.roomId),
      });
      void qc.invalidateQueries({ queryKey: chatKeys.messages(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function useToggleChatReaction(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roomId: string; messageId: string; emoji: string }) =>
      chat.toggleChatMessageReaction(workspaceId, input.roomId, input.messageId, input.emoji),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({
        queryKey: chatKeys.roomMessages(workspaceId, variables.roomId),
      });
    },
  });
}

export function useChatBlockStatus(workspaceId: string, userId: string, enabled: boolean) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.block(workspaceId, userId),
    queryFn: () => chat.getChatBlockStatus(workspaceId, userId),
    enabled: !!workspaceId && !!userId && authReady && enabled,
    staleTime: 0,
  });
}

export function useBlockChatUser(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => chat.blockChatUser(workspaceId, userId),
    onSuccess: (_data, userId) => {
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.block(workspaceId, userId) });
    },
  });
}

export function useUnblockChatUser(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => chat.unblockChatUser(workspaceId, userId),
    onSuccess: (_data, userId) => {
      void qc.invalidateQueries({ queryKey: chatKeys.block(workspaceId, userId) });
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function chatRoomToContact(room: ChatRoomRecord): ChatContact {
  return {
    user_id: room.peer_user_id ?? room.member_user_ids[0] ?? "",
    email: room.peer_email ?? "",
    display_name: room.peer_display_name ?? room.name,
    dm_room_id: room.id,
  };
}

export function chatRoomToGroup(room: ChatRoomRecord): GroupChat {
  return {
    id: room.id,
    name: room.name,
    room_id: room.id,
    member_user_ids: room.member_user_ids,
  };
}

export function unreadMapFromRooms(rooms: ChatRoomRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const room of rooms) {
    if (room.unread_count > 0) out[room.id] = room.unread_count;
  }
  return out;
}

export function sidebarFromChatRooms(rooms: ChatRoomRecord[]) {
  return {
    workspaceRoom: rooms.find((room) => room.kind === "workspace") ?? null,
    contacts: dedupeDmContacts(rooms.filter((room) => room.kind === "dm").map(chatRoomToContact)),
    groups: rooms.filter((room) => room.kind === "group").map(chatRoomToGroup),
  };
}

function normalizeChatUserId(userId: string): string {
  return userId.trim().toUpperCase();
}

/** One sidebar row per peer — merges API rows with different casing or missing email. */
export function dedupeDmContacts(contacts: ChatContact[]): ChatContact[] {
  const byUser = new Map<string, ChatContact>();
  for (const contact of contacts) {
    const key = normalizeChatUserId(contact.user_id);
    if (!key) continue;
    const existing = byUser.get(key);
    byUser.set(key, existing ? mergeChatContact(existing, contact) : contact);
  }
  return [...byUser.values()];
}

/** Keep the open DM in the sidebar before rooms refetch catches up. */
export function mergeActiveDmContact(
  contacts: ChatContact[],
  activeContact: ChatContact | null,
  resolvedRoomId: string | null,
): ChatContact[] {
  if (!activeContact?.user_id) return dedupeDmContacts(contacts);
  const roomId = activeContact.dm_room_id ?? resolvedRoomId ?? undefined;
  const merged: ChatContact = roomId ? { ...activeContact, dm_room_id: roomId } : activeContact;
  const peerKey = normalizeChatUserId(merged.user_id);
  const hasPeer = contacts.some((contact) => normalizeChatUserId(contact.user_id) === peerKey);
  const withActive = hasPeer
    ? contacts.map((contact) =>
        normalizeChatUserId(contact.user_id) === peerKey ? mergeChatContact(contact, merged) : contact,
      )
    : [...contacts, merged];
  return dedupeDmContacts(withActive);
}

export function useChatRoomMessages(workspaceId: string, roomId: string | null, limit = 50) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.roomMessages(workspaceId, roomId ?? ""),
    queryFn: () => listChatRoomMessages(workspaceId, roomId!, { limit }),
    enabled: !!workspaceId && !!roomId && authReady,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useLookupChatUser(workspaceId: string, email: string, enabled: boolean) {
  const normalized = email.trim().toLowerCase();
  return useQuery({
    queryKey: chatKeys.lookup(workspaceId, normalized),
    queryFn: async (): Promise<ChatUserLookup | null> => {
      try {
        return await lookupChatUserCached(workspaceId, normalized);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!workspaceId && enabled && normalized.includes("@") && normalized.length >= 5,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

const contactListeners = new Set<() => void>();
const EMPTY_CONTACTS: ChatContact[] = [];
const contactSnapshots = new Map<string, { key: string; value: ChatContact[] }>();

function contactsSnapshotKey(contacts: ChatContact[]): string {
  return JSON.stringify(contacts);
}

/** Stable reference for useSyncExternalStore — getSnapshot must not return a new array every call. */
function getContactsSnapshot(userId: string): ChatContact[] {
  const contacts = listChatContacts(userId);
  const key = contactsSnapshotKey(contacts);
  const cached = contactSnapshots.get(userId);
  if (cached?.key === key) return cached.value;
  const value = contacts.length === 0 ? EMPTY_CONTACTS : contacts.map((c) => ({ ...c }));
  contactSnapshots.set(userId, { key, value });
  return value;
}

function bumpContacts(): void {
  contactSnapshots.clear();
  contactListeners.forEach((l) => l());
}

function subscribeContacts(listener: () => void): () => void {
  contactListeners.add(listener);
  return () => contactListeners.delete(listener);
}

export function useChatContacts(userId: string): ChatContact[] {
  return useSyncExternalStore(
    subscribeContacts,
    () => getContactsSnapshot(userId),
    () => EMPTY_CONTACTS,
  );
}

export function useChatContactActions(userId: string) {
  const addFromLookup = useCallback(
    (lookup: ChatUserLookup): ChatContact => {
      const contact: ChatContact = {
        user_id: lookup.user_id,
        email: lookup.email,
        display_name: lookup.display_name,
      };
      upsertChatContact(userId, contact);
      bumpContacts();
      return contact;
    },
    [userId],
  );

  const rememberRoom = useCallback(
    (contactUserId: string, dmRoomId: string) => {
      setChatContactRoom(userId, contactUserId, dmRoomId);
      bumpContacts();
    },
    [userId],
  );

  const upsertContact = useCallback(
    (contact: ChatContact) => {
      upsertChatContact(userId, contact);
      bumpContacts();
    },
    [userId],
  );

  const removeContact = useCallback(
    (contactUserId: string) => {
      removeChatContact(userId, contactUserId);
      bumpContacts();
    },
    [userId],
  );

  return { addFromLookup, rememberRoom, upsertContact, removeContact };
}

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

export function toChatContactFromLookup(lookup: ChatUserLookup): ChatContact {
  return {
    user_id: lookup.user_id,
    email: lookup.email,
    display_name: lookup.display_name,
  };
}

export function fetchChatUserById(workspaceId: string, userId: string): Promise<ChatUserLookup | null> {
  return lookupChatUserByIdCached(workspaceId, userId);
}

export function useChatVoiceToken() {
  return useMutation({
    mutationFn: ({ roomId, callId }: { roomId: string; callId: string }) =>
      chat.mintChatVoiceToken(roomId, callId),
  });
}

export {
  DEFAULT_CHAT_SCOPE_LIMIT,
  selectLazyChatScopeRoomIds,
} from "./lazy-chat-scopes";
