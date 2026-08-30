"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchChatUserById } from "@uniwork/core/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { listChatContacts } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { useMatrixStore } from "@uniwork/core/chat/matrix-store";
import { createClient, ClientEvent, type MatrixClient } from "matrix-js-sdk";
import { installMatrixClientNoiseFilter } from "./matrix-client-config";
import { isAdHocGroupRoom } from "./matrix-group";
import { syncIncomingDmContacts, sanitizeContactDmRooms } from "./sync-incoming-dms";
import { syncIncomingGroupChats } from "./sync-incoming-groups";
import { matrixBaseUrl } from "./chat-page-utils";

export function useChatMatrixClient({
  matrixSession,
  currentUserId,
  upsertContact,
  saveGroup,
  reconcileGroups,
  onConnectError,
}: {
  matrixSession: NonNullable<ReturnType<typeof useMatrixStore.getState>["session"]> | null;
  currentUserId: string;
  upsertContact: (contact: ChatContact) => void;
  saveGroup: (group: GroupChat) => void;
  reconcileGroups: (activeGroupRoomIds: string[]) => void;
  onConnectError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [matrixClient, setMatrixClient] = useState<MatrixClient | null>(null);
  const clientRef = useRef<MatrixClient | null>(null);
  const clientStartedRef = useRef(false);
  const workspaceRoomIdRef = useRef<string | null>(null);

  const setWorkspaceRoomId = (roomId: string | null) => {
    workspaceRoomIdRef.current = roomId;
  };

  useEffect(() => {
    if (!matrixSession || clientStartedRef.current) return;
    const baseUrl = matrixBaseUrl(matrixSession);
    if (!baseUrl) return;

    clientStartedRef.current = true;
    installMatrixClientNoiseFilter();
    const client = createClient({
      baseUrl,
      accessToken: matrixSession.access_token,
      userId: matrixSession.user_id,
    });
    clientRef.current = client;
    setMatrixClient(client);

    const syncIncomingRef = { current: false };
    const syncDebounceRef = { current: null as ReturnType<typeof setTimeout> | null };

    const runIncomingSync = () => {
      if (syncIncomingRef.current) return;
      syncIncomingRef.current = true;
      const existingContacts = listChatContacts(currentUserId);
      void syncIncomingDmContacts(
        client,
        matrixSession.user_id,
        workspaceRoomIdRef.current,
        async (userId) => {
          try {
            return await fetchChatUserById(userId);
          } catch {
            return null;
          }
        },
        upsertContact,
        existingContacts,
      )
        .then(() =>
          syncIncomingGroupChats(
            client,
            matrixSession.user_id,
            workspaceRoomIdRef.current,
            async (userId) => {
              try {
                return await fetchChatUserById(userId);
              } catch {
                return null;
              }
            },
            saveGroup,
            t("chat.new_group"),
          ),
        )
        .then(() => {
          const activeGroupRoomIds = client
            .getRooms()
            .filter((room) =>
              isAdHocGroupRoom(room, matrixSession.user_id, workspaceRoomIdRef.current),
            )
            .map((room) => room.roomId);
          reconcileGroups(activeGroupRoomIds);
          sanitizeContactDmRooms(
            client,
            matrixSession.user_id,
            workspaceRoomIdRef.current,
            listChatContacts(currentUserId),
            upsertContact,
          );
        })
        .finally(() => {
          syncIncomingRef.current = false;
        });
    };

    const scheduleIncomingSync = () => {
      if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
      syncDebounceRef.current = setTimeout(() => {
        syncDebounceRef.current = null;
        runIncomingSync();
      }, 1500);
    };

    client.on(ClientEvent.Sync, (state: string) => {
      if (state === "PREPARED") runIncomingSync();
    });
    client.on(ClientEvent.Room, scheduleIncomingSync);

    void client
      .startClient({ initialSyncLimit: 10 })
      .then(() => runIncomingSync())
      .catch((err: unknown) => {
        onConnectError(err instanceof Error ? err.message : "connect_failed");
      });

    return () => {
      if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
      client.stopClient();
      clientRef.current = null;
      setMatrixClient(null);
      clientStartedRef.current = false;
    };
  }, [matrixSession, upsertContact, saveGroup, reconcileGroups, t, currentUserId, onConnectError]);

  return { matrixClient, clientRef, setWorkspaceRoomId };
}
