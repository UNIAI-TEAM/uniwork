"use client";

import { useEffect, useRef } from "react";
import { fetchChatUserById } from "@uniwork/core/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { isPlaceholderChatDisplayName, listChatContacts } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { listGroupChats } from "@uniwork/core/chat/groups-store";
import { matrixUserIdForMember } from "@uniwork/core/chat/matrix-users";
import type { useMatrixStore } from "@uniwork/core/chat/matrix-store";
import type { MatrixClient } from "matrix-js-sdk";
import { resolveDmRoomId } from "./matrix-dm";
import { resolveGroupRoomId } from "./matrix-group";
import { isValidDmRoomId } from "./matrix-room-sync";
import type { ChatSidebarTarget } from "./chat-sidebar";
import { matrixIdForContact } from "./chat-page-utils";

export function useChatRoomResolution({
  target,
  setTarget,
  contacts,
  matrixSession,
  matrixClient,
  workspaceRoomId,
  activeContact,
  activeGroup,
  selectedGroupId,
  activeGroupRoomId,
  rememberRoom,
  saveGroup,
  upsertContact,
  currentUserId,
  dmRoomId,
  setDmRoomId,
  groupRoomId,
  setGroupRoomId,
  setConnectError,
}: {
  target: ChatSidebarTarget;
  setTarget: React.Dispatch<React.SetStateAction<ChatSidebarTarget>>;
  contacts: ChatContact[];
  matrixSession: NonNullable<ReturnType<typeof useMatrixStore.getState>["session"]> | null;
  matrixClient: MatrixClient | null;
  workspaceRoomId: string | null;
  activeContact: ChatContact | null;
  activeGroup: GroupChat | null;
  selectedGroupId: string | null;
  activeGroupRoomId: string | null;
  rememberRoom: (userId: string, roomId: string) => void;
  saveGroup: (group: GroupChat) => void;
  upsertContact: (contact: ChatContact) => void;
  currentUserId: string;
  dmRoomId: string | null;
  setDmRoomId: React.Dispatch<React.SetStateAction<string | null>>;
  groupRoomId: string | null;
  setGroupRoomId: React.Dispatch<React.SetStateAction<string | null>>;
  setConnectError: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const groupResolveRef = useRef<string | null>(null);
  const activeDmUserId = target.kind === "dm" ? target.contact.user_id : null;
  const activeDmCachedRoomId = target.kind === "dm" ? (target.contact.dm_room_id ?? null) : null;

  useEffect(() => {
    if (!selectedGroupId) {
      setGroupRoomId((prev) => (prev === null ? prev : null));
      return;
    }
    if (!activeGroupRoomId) return;
    setGroupRoomId((prev) => (prev === activeGroupRoomId ? prev : activeGroupRoomId));
  }, [selectedGroupId, activeGroupRoomId, setGroupRoomId]);

  useEffect(() => {
    groupResolveRef.current = null;
  }, [selectedGroupId]);

  useEffect(() => {
    if (target.kind !== "dm" || !activeDmUserId) {
      setDmRoomId((prev) => (prev === null ? prev : null));
      return;
    }
    const cached =
      contacts.find((c) => c.user_id === activeDmUserId)?.dm_room_id ??
      activeDmCachedRoomId ??
      null;
    if (!cached) return;
    setDmRoomId((prev) => (prev === cached ? prev : cached));
  }, [target.kind, activeDmUserId, activeDmCachedRoomId, contacts, setDmRoomId]);

  useEffect(() => {
    if (target.kind !== "dm" || !matrixSession || !activeContact || !matrixClient) return;
    let cancelled = false;

    const targetMatrixId = matrixIdForContact(activeContact, matrixSession);
    const cachedDmRoomId =
      activeContact.dm_room_id &&
      isValidDmRoomId(
        matrixClient,
        activeContact.dm_room_id,
        matrixSession.user_id,
        targetMatrixId,
        workspaceRoomId,
      )
        ? activeContact.dm_room_id
        : null;

    void resolveDmRoomId(matrixClient, targetMatrixId, matrixSession.user_id, cachedDmRoomId)
      .then((id) => {
        if (cancelled) return;
        setDmRoomId(id);
        rememberRoom(activeContact.user_id, id);
        setTarget((current) => {
          if (current.kind !== "dm" || current.contact.user_id !== activeContact.user_id) return current;
          if (current.contact.dm_room_id === id) return current;
          return { kind: "dm", contact: { ...current.contact, dm_room_id: id } };
        });
        setConnectError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setConnectError(err instanceof Error ? err.message : "dm_failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    matrixSession,
    matrixClient,
    target,
    activeContact,
    rememberRoom,
    workspaceRoomId,
    setDmRoomId,
    setTarget,
    setConnectError,
  ]);

  useEffect(() => {
    if (target.kind !== "dm") return;
    const contact = contacts.find((c) => c.user_id === target.contact.user_id) ?? target.contact;
    if (!isPlaceholderChatDisplayName(contact.display_name, contact.user_id)) return;

    void fetchChatUserById(contact.user_id)
      .then((profile) => {
        if (!profile) return;
        upsertContact({
          user_id: profile.user_id,
          email: profile.email,
          display_name: profile.display_name,
          matrix_user_id: profile.matrix_user_id ?? contact.matrix_user_id,
          dm_room_id: contact.dm_room_id ?? target.contact.dm_room_id,
        });
        setTarget((current) => {
          if (current.kind !== "dm" || current.contact.user_id !== profile.user_id) return current;
          return {
            kind: "dm",
            contact: {
              ...current.contact,
              email: profile.email,
              display_name: profile.display_name,
              matrix_user_id: profile.matrix_user_id ?? current.contact.matrix_user_id,
            },
          };
        });
      })
      .catch(() => undefined);
  }, [target, contacts, upsertContact, setTarget]);

  useEffect(() => {
    if (!selectedGroupId || !matrixSession || !matrixClient) return;

    const groupSnapshot = listGroupChats(currentUserId).find(
      (group) => group.id === selectedGroupId || group.room_id === selectedGroupId,
    );
    if (!groupSnapshot) return;

    const resolveKey = `${selectedGroupId}:${activeGroupRoomId ?? ""}:${workspaceRoomId ?? ""}`;
    if (groupResolveRef.current === resolveKey) return;
    groupResolveRef.current = resolveKey;

    let cancelled = false;

    void resolveGroupRoomId(matrixClient, {
      name: groupSnapshot.name,
      inviteMatrixUserIds: groupSnapshot.member_user_ids.map((userId) =>
        matrixUserIdForMember(userId, matrixSession),
      ),
      myMatrixUserId: matrixSession.user_id,
      workspaceRoomId,
      cachedRoomId: groupSnapshot.room_id,
    })
      .then((id) => {
        if (cancelled) return;
        groupResolveRef.current = `${selectedGroupId}:${id}:${workspaceRoomId ?? ""}`;
        setGroupRoomId((prev) => (prev === id ? prev : id));
        if (groupSnapshot.room_id !== id) {
          saveGroup({ ...groupSnapshot, room_id: id });
        }
        setConnectError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          groupResolveRef.current = null;
          setConnectError(err instanceof Error ? err.message : "group_failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedGroupId,
    activeGroupRoomId,
    matrixSession,
    matrixClient,
    workspaceRoomId,
    saveGroup,
    currentUserId,
    setGroupRoomId,
    setConnectError,
  ]);

  return { groupResolveRef };
}
