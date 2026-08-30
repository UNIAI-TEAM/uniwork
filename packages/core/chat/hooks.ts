"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import * as chat from "../api/endpoints/chat";
import type { ChatUserLookup } from "../api/endpoints/chat";
import { lookupChatUserByIdCached, lookupChatUserCached } from "./user-lookup";
import { ApiError } from "../api/http";
import { useAuthStore } from "../auth/store";
import {
  listChatContacts,
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
import { getMatrixSession } from "./matrix-store";

export const chatKeys = {
  room: (wsId: string) => ["chat", "room", wsId] as const,
  lookup: (email: string) => ["chat", "lookup", email] as const,
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
      const matrix = getMatrixSession();
      if (!matrix?.access_token) {
        throw new Error("matrix_session_missing");
      }
      const room = await chat.ensureWorkspaceChatRoom(workspaceId, matrix.access_token);
      if (!room) throw new Error("chat_room_failed");
      return room;
    },
    onSuccess: (room) => {
      qc.setQueryData(chatKeys.room(workspaceId), room);
    },
  });
}

export function useLookupChatUser(email: string, enabled: boolean) {
  const normalized = email.trim().toLowerCase();
  return useQuery({
    queryKey: chatKeys.lookup(normalized),
    queryFn: async (): Promise<ChatUserLookup | null> => {
      try {
        return await lookupChatUserCached(normalized);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: enabled && normalized.includes("@") && normalized.length >= 5,
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
        matrix_user_id: lookup.matrix_user_id ?? null,
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
    matrix_user_id: lookup.matrix_user_id ?? null,
  };
}

export function fetchChatUserById(userId: string): Promise<ChatUserLookup | null> {
  return lookupChatUserByIdCached(userId);
}

export function useChatVoiceToken() {
  return useMutation({
    mutationFn: (matrixRoomId: string) => chat.mintChatVoiceToken(matrixRoomId),
  });
}
