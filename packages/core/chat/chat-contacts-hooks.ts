"use client";
import { useCallback, useSyncExternalStore } from "react";
import type { ChatUserLookup } from "../api/endpoints/chat";
import {
  listChatContacts,
  removeChatContact,
  setChatContactRoom,
  upsertChatContact,
  type ChatContact,
} from "./contacts-store";

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
