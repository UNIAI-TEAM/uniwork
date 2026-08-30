"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  fetchChatUserById,
  useChatContactActions,
  useChatContacts,
  useChatVoiceToken,
  useEnsureWorkspaceChatRoom,
  useGroupChatActions,
  useGroupChats,
  useWorkspaceChatRoom,
} from "@uniwork/core/chat";
import { ApiError } from "@uniwork/core/api/http";
import { peekCachedChatUserById } from "@uniwork/core/chat/user-lookup";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact, isPlaceholderChatDisplayName, listChatContacts } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { listGroupChats } from "@uniwork/core/chat/groups-store";
import { resolveDmRoomId, sendMatrixTyping } from "./matrix-dm";
import { defaultGroupName, inviteMembersToGroupRoom, isAdHocGroupRoom, readGroupMemberUserIds, readGroupRoomMembers, resolveGroupRoomId } from "./matrix-group";
import { installMatrixClientNoiseFilter } from "./matrix-client-config";
import { AddGroupMembersDialog } from "./add-group-members-dialog";
import { DmChatToolbar, DmSettingsSheet } from "./dm-settings-sheet";
import { GroupChatToolbar, GroupSettingsSheet } from "./group-settings-sheet";
import { ChatMessagePanel, useChatMessageCount } from "./chat-message-panel";
import type { ChatMessage } from "./chat-messages";
import { sendMatrixTextReply } from "./matrix-message-actions";
import { syncIncomingDmContacts, sanitizeContactDmRooms } from "./sync-incoming-dms";
import { syncIncomingGroupChats } from "./sync-incoming-groups";
import { leaveAndForgetRoom } from "./matrix-room-leave";
import { isValidDmRoomId } from "./matrix-room-sync";
import { useMatrixTyping, useMatrixTypingSender } from "./use-matrix-typing";
import { useMarkRoomAsRead, useMatrixUnread } from "./use-matrix-unread";
import {
  displayNameForMatrixSender,
  matrixUserIdForMember,
} from "@uniwork/core/chat/matrix-users";
import { useMatrixStore } from "@uniwork/core/chat/matrix-store";
import { useAuthStore } from "@uniwork/core/auth";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { Button } from "@uniwork/ui/components/ui/button";
import { createClient, ClientEvent, RoomEvent, type MatrixClient } from "matrix-js-sdk";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { ChatSidebar, type ChatSidebarTarget } from "./chat-sidebar";
import { ChatComposer } from "./chat-composer";
import { formatTypingLabel, resolveTypingDisplayName } from "./typing-indicator";
import { useVoiceCall } from "./use-voice-call";
import { VoiceCallOverlay } from "./voice-call-overlay";

function matrixBaseUrl(session: ReturnType<typeof useMatrixStore.getState>["session"]): string {
  if (session?.base_url) return session.base_url;
  return runtimeConfig().matrixHomeserverUrl;
}

function matrixIdForContact(
  contact: ChatContact,
  session: NonNullable<ReturnType<typeof useMatrixStore.getState>["session"]>,
): string {
  return contact.matrix_user_id ?? matrixUserIdForMember(contact.user_id, session);
}

function memberSetChanged(previous: string[], next: string[]): boolean {
  if (previous.length !== next.length) return true;
  const prevKey = [...previous].map((id) => id.toUpperCase()).sort().join("\u0000");
  const nextKey = [...next].map((id) => id.toUpperCase()).sort().join("\u0000");
  return prevKey !== nextKey;
}

export function ChatPageView({
  workspaceId,
  currentUserId,
}: {
  workspaceId: string;
  currentUserId: string;
}) {
  const { t, i18n } = useTranslation();
  const matrixSession = useMatrixStore((s) => s.session);
  const authReady = useAuthStore((s) => s.status === "authed");
  const matrixEnabled = Boolean(matrixBaseUrl(matrixSession));
  const { data: room, isFetched, isError, refetch, isFetching } = useWorkspaceChatRoom(workspaceId);
  const ensureRoom = useEnsureWorkspaceChatRoom(workspaceId);
  const { rememberRoom, upsertContact, removeContact } = useChatContactActions(currentUserId);
  const { saveGroup, removeGroup, reconcileGroups } = useGroupChatActions(currentUserId);
  const contacts = useChatContacts(currentUserId);
  const groups = useGroupChats(currentUserId);
  const [target, setTarget] = useState<ChatSidebarTarget>({ kind: "workspace" });
  const [dmRoomId, setDmRoomId] = useState<string | null>(null);
  const [groupRoomId, setGroupRoomId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [dmSettingsOpen, setDmSettingsOpen] = useState(false);
  const [leavingConversation, setLeavingConversation] = useState(false);
  const [invitingMembers, setInvitingMembers] = useState(false);
  const [groupMemberProfiles, setGroupMemberProfiles] = useState<
    Record<string, { user_id: string; display_name: string; email: string; matrix_user_id: string | null }>
  >({});
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [matrixClient, setMatrixClient] = useState<MatrixClient | null>(null);
  const clientRef = useRef<MatrixClient | null>(null);
  const syncedRef = useRef(false);
  const clientStartedRef = useRef(false);
  const workspaceRoomIdRef = useRef<string | null>(null);
  const groupResolveRef = useRef<string | null>(null);

  const workspaceRoomId = room?.room_id ?? ensureRoom.data?.room_id ?? null;
  workspaceRoomIdRef.current = workspaceRoomId;
  const activeContact = target.kind === "dm" ? target.contact : null;
  const activeGroup = useMemo(() => {
    if (target.kind !== "group") return null;
    const key = target.group.room_id || target.group.id;
    return (
      groups.find((group) => group.id === key || group.room_id === key || group.id === target.group.id) ??
      target.group
    );
  }, [target, groups]);
  const activeRoomId =
    target.kind === "workspace"
      ? workspaceRoomId
      : target.kind === "dm"
        ? (dmRoomId ?? activeContact?.dm_room_id ?? null)
        : (groupRoomId ?? activeGroup?.room_id ?? null);

  const trackedRoomIds = useMemo(() => {
    const ids = new Set<string>();
    const groupRoomIds = new Set(groups.map((group) => group.room_id));
    if (workspaceRoomId) ids.add(workspaceRoomId);
    for (const contact of contacts) {
      if (contact.dm_room_id && !groupRoomIds.has(contact.dm_room_id)) {
        ids.add(contact.dm_room_id);
      }
    }
    for (const group of groups) {
      if (group.room_id) ids.add(group.room_id);
    }
    return [...ids];
  }, [workspaceRoomId, contacts, groups]);

  const { counts: unreadByRoomId, badgesReady: unreadBadgesReady } = useMatrixUnread(
    matrixClient,
    trackedRoomIds,
    matrixSession?.user_id ?? null,
    activeRoomId,
  );

  const roomQuerySettled = isFetched && !isFetching;

  const showLoading =
    target.kind === "workspace"
      ? !workspaceRoomId && (ensureRoom.isPending || !roomQuerySettled || !authReady)
      : target.kind === "dm"
        ? !activeRoomId
        : !activeRoomId;

  const messageCount = useChatMessageCount(matrixClient, activeRoomId);

  useMarkRoomAsRead(
    matrixClient,
    activeRoomId,
    Boolean(activeRoomId) && !showLoading,
    messageCount,
  );

  const chatVoiceToken = useChatVoiceToken();
  const mintVoiceToken = useCallback(
    async (matrixRoomId: string) => chatVoiceToken.mutateAsync(matrixRoomId),
    [chatVoiceToken],
  );
  const { voiceCall, startCall, acceptCall, declineCall, hangUp, inCall } = useVoiceCall({
    client: matrixClient,
    myMatrixUserId: matrixSession?.user_id ?? null,
    mintToken: mintVoiceToken,
  });

  const handleStartVoiceCall = useCallback(async () => {
    if (target.kind !== "dm" || !activeRoomId || !activeContact) return;
    try {
      const ok = await startCall(
        activeRoomId,
        displayLabelForChatContact(activeContact),
      );
      if (!ok) {
        toast.error(t("chat.voice_call_failed"));
      }
    } catch (err) {
      const msg =
        err instanceof ApiError && err.code === "livekit_not_configured"
          ? t("chat.voice_call_not_configured")
          : t("chat.voice_call_failed");
      toast.error(msg);
    }
  }, [target.kind, activeRoomId, activeContact, startCall, t]);

  const handleAcceptVoiceCall = useCallback(async () => {
    try {
      const ok = await acceptCall();
      if (!ok) toast.error(t("chat.voice_call_failed"));
    } catch (err) {
      const msg =
        err instanceof ApiError && err.code === "livekit_not_configured"
          ? t("chat.voice_call_not_configured")
          : t("chat.voice_call_failed");
      toast.error(msg);
      void declineCall();
    }
  }, [acceptCall, declineCall, t]);

  useEffect(() => {
    if (!matrixSession || !authReady || syncedRef.current) return;
    syncedRef.current = true;
    void ensureRoom.mutate();
  }, [matrixSession, authReady, ensureRoom]);

  useEffect(() => {
    if (!authReady) return;
    void refetch();
  }, [authReady, refetch]);

  useEffect(() => {
    if (!matrixClient || !matrixSession) return;
    const activeGroupRoomIds = matrixClient
      .getRooms()
      .filter((room) => isAdHocGroupRoom(room, matrixSession.user_id, workspaceRoomId))
      .map((room) => room.roomId);
    reconcileGroups(activeGroupRoomIds);
  }, [matrixClient, matrixSession, workspaceRoomId, reconcileGroups]);

  const syncIncomingRef = useRef(false);
  const syncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setConnectError(err instanceof Error ? err.message : "connect_failed");
      });

    return () => {
      if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
      client.stopClient();
      clientRef.current = null;
      setMatrixClient(null);
      clientStartedRef.current = false;
      syncIncomingRef.current = false;
    };
  }, [matrixSession, upsertContact, saveGroup, reconcileGroups, t, currentUserId]);

  const selectedGroupId = target.kind === "group" ? (activeGroup?.room_id ?? target.group.id) : null;
  const activeGroupRoomId = activeGroup?.room_id ?? null;
  const activeDmUserId = target.kind === "dm" ? target.contact.user_id : null;
  const activeDmCachedRoomId = target.kind === "dm" ? (target.contact.dm_room_id ?? null) : null;

  // Open cached group/DM room instantly when the user picks a sidebar target.
  useEffect(() => {
    if (!selectedGroupId) {
      setGroupRoomId((prev) => (prev === null ? prev : null));
      return;
    }
    if (!activeGroupRoomId) return;
    setGroupRoomId((prev) => (prev === activeGroupRoomId ? prev : activeGroupRoomId));
  }, [selectedGroupId, activeGroupRoomId]);

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
  }, [target.kind, activeDmUserId, activeDmCachedRoomId, contacts]);

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
  }, [matrixSession, matrixClient, target, activeContact, rememberRoom, workspaceRoomId]);

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
  }, [target, contacts, upsertContact]);

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
  ]);

  useEffect(() => {
    if (target.kind !== "group" || !matrixClient || !matrixSession || !activeRoomId || !selectedGroupId) {
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

      const fromCache: typeof groupMemberProfiles = {};
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
          const next: typeof groupMemberProfiles = {};
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
  }, [selectedGroupId, activeRoomId, matrixClient, matrixSession, saveGroup, target.kind, currentUserId]);

  useEffect(() => {
    if (!matrixClient || !activeRoomId) return;
    const membership = matrixClient.getRoom(activeRoomId)?.getMyMembership();
    if (membership === "invite") {
      void matrixClient.joinRoom(activeRoomId);
    }
  }, [matrixClient, activeRoomId]);

  const typingUserIds = useMatrixTyping(matrixClient, activeRoomId, matrixSession?.user_id ?? null);
  useMatrixTypingSender(matrixClient, activeRoomId, draft);

  const provisionAndSend = async () => {
    const text = draft.trim();
    if (!text || !matrixSession) return;
    let targetRoomId = activeRoomId;
    if (target.kind === "workspace" && !targetRoomId) {
      const created = await ensureRoom.mutateAsync();
      if (!created.room_id) return;
      targetRoomId = created.room_id;
    }
    if (!targetRoomId) return;

    const client = clientRef.current;
    if (client) {
      const membership = client.getRoom(targetRoomId)?.getMyMembership();
      if (membership === "invite") {
        await client.joinRoom(targetRoomId);
      }
      await sendMatrixTyping(client, targetRoomId, false);
      if (replyTo) {
        await sendMatrixTextReply(client, targetRoomId, text, replyTo.id);
        setReplyTo(null);
      } else {
        await client.sendTextMessage(targetRoomId, text);
      }
      setDraft("");
      return;
    }
    const baseUrl = matrixBaseUrl(matrixSession);
    if (!baseUrl) return;
    const temp = createClient({
      baseUrl,
      accessToken: matrixSession.access_token,
      userId: matrixSession.user_id,
    });
    if (replyTo) {
      await sendMatrixTextReply(temp, targetRoomId, text, replyTo.id);
      setReplyTo(null);
    } else {
      await temp.sendTextMessage(targetRoomId, text);
    }
    setDraft("");
  };

  const handleCreateGroup = (members: ChatContact[], name: string) => {
    if (!matrixClient || !matrixSession || members.length < 2) return;
    setCreatingGroup(true);
    setConnectError(null);

    const inviteMatrixUserIds = members.map((member) => matrixIdForContact(member, matrixSession));
    const resolvedName =
      name.trim() ||
      defaultGroupName(
        members.map((member) => displayLabelForChatContact(member)),
        t("chat.new_group"),
      );

    void resolveGroupRoomId(matrixClient, {
      name: resolvedName,
      inviteMatrixUserIds,
      myMatrixUserId: matrixSession.user_id,
      workspaceRoomId,
    })
      .then((roomId) => {
        const group: GroupChat = {
          id: roomId,
          name: resolvedName,
          room_id: roomId,
          member_user_ids: [...members.map((member) => member.user_id)].sort(),
        };
        saveGroup(group);
        setGroupRoomId(roomId);
        setTarget({ kind: "group", group });
        setCreateGroupOpen(false);
      })
      .catch((err: unknown) => {
        setConnectError(err instanceof Error ? err.message : "group_failed");
      })
      .finally(() => {
        setCreatingGroup(false);
      });
  };

  const handleAddGroupMembers = (members: ChatContact[]) => {
    if (!matrixClient || !matrixSession || !activeGroup || members.length === 0) return;
    setInvitingMembers(true);
    setConnectError(null);

    const inviteMatrixUserIds = members.map((member) => matrixIdForContact(member, matrixSession));

    void inviteMembersToGroupRoom(matrixClient, activeGroup.room_id, inviteMatrixUserIds)
      .then(() => {
        const memberUserIds = readGroupMemberUserIds(
          matrixClient,
          activeGroup.room_id,
          matrixSession.user_id,
        );
        if (memberSetChanged(activeGroup.member_user_ids, memberUserIds)) {
          saveGroup({ ...activeGroup, member_user_ids: memberUserIds });
        }
        setAddMembersOpen(false);
      })
      .catch((err: unknown) => {
        setConnectError(err instanceof Error ? err.message : "group_invite_failed");
      })
      .finally(() => {
        setInvitingMembers(false);
      });
  };

  const handleLeaveConversation = async (roomId: string, cleanup: () => void) => {
    if (!matrixClient || !roomId) return;
    setLeavingConversation(true);
    setConnectError(null);
    try {
      await leaveAndForgetRoom(matrixClient, roomId);
      cleanup();
      setTarget({ kind: "workspace" });
      setDmSettingsOpen(false);
      setGroupSettingsOpen(false);
      setGroupRoomId(null);
      setDmRoomId(null);
      setGroupMemberProfiles({});
      groupResolveRef.current = null;
    } catch (err: unknown) {
      setConnectError(err instanceof Error ? err.message : t("chat.leave_conversation_failed"));
    } finally {
      setLeavingConversation(false);
    }
  };

  const headerTitle = (() => {
    if (target.kind === "workspace") return t("chat.title");
    if (target.kind === "group") {
      return groups.find((group) => group.id === target.group.id)?.name ?? target.group.name;
    }
    return t("chat.dm_with", {
      name: displayLabelForChatContact(
        contacts.find((c) => c.user_id === target.contact.user_id) ?? target.contact,
      ),
    });
  })();

  const nameContext = contacts.map((c) => ({
    user_id: c.user_id,
    display_name: displayLabelForChatContact(c),
    matrix_user_id: c.matrix_user_id,
  }));
  if (activeContact) {
    nameContext.push({
      user_id: activeContact.user_id,
      display_name: displayLabelForChatContact(activeContact),
      matrix_user_id: activeContact.matrix_user_id,
    });
  }
  if (activeGroup) {
    for (const memberId of activeGroup.member_user_ids) {
      if (nameContext.some((entry) => entry.user_id === memberId)) continue;
      const profile = groupMemberProfiles[memberId];
      if (profile) {
        nameContext.push({
          user_id: profile.user_id,
          display_name: profile.display_name,
          matrix_user_id: profile.matrix_user_id,
        });
        continue;
      }
      const contact = contacts.find((entry) => entry.user_id === memberId);
      if (contact) {
        nameContext.push({
          user_id: contact.user_id,
          display_name: displayLabelForChatContact(contact),
          matrix_user_id: contact.matrix_user_id,
        });
      }
    }
  }

  if (!matrixEnabled) {
    return (
      <div className="flex h-full flex-col">
        <CollectionPageHeader icon={MessageSquare} title={t("chat.title")} />
        <CollectionPageState
          icon={MessageSquare}
          title={t("chat.matrix_disabled")}
          description={t("chat.empty_description")}
        />
      </div>
    );
  }

  if (!matrixSession) {
    return (
      <div className="flex h-full flex-col">
        <CollectionPageHeader icon={MessageSquare} title={t("chat.title")} />
        <CollectionPageState
          icon={MessageSquare}
          title={t("chat.no_matrix_session")}
          description={t("chat.empty_description")}
        />
      </div>
    );
  }

  const typingLabel = formatTypingLabel(
    typingUserIds.map((id) => {
      const roomMember = matrixClient?.getRoom(activeRoomId ?? "")?.getMember(id);
      return resolveTypingDisplayName(id, nameContext, roomMember?.name);
    }),
    t,
    i18n.language,
  );

  const dmReaderMatrixUserId =
    target.kind === "dm" && activeContact
      ? matrixIdForContact(activeContact, matrixSession)
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CollectionPageHeader icon={MessageSquare} title={headerTitle} />
      {target.kind === "group" && activeGroup ? (
        <>
          <GroupSettingsSheet
            open={groupSettingsOpen}
            onOpenChange={setGroupSettingsOpen}
            group={activeGroup}
            client={matrixClient}
            roomId={activeRoomId}
            myMatrixUserId={matrixSession.user_id}
            youLabel={t("chat.you")}
            memberProfiles={groupMemberProfiles}
            onAddMembers={() => setAddMembersOpen(true)}
            leaving={leavingConversation}
            onLeave={() =>
              activeRoomId
                ? handleLeaveConversation(activeRoomId, () => removeGroup(activeGroup.id))
                : undefined
            }
          />
          <AddGroupMembersDialog
            open={addMembersOpen}
            onOpenChange={setAddMembersOpen}
            group={activeGroup}
            currentUserId={currentUserId}
            inviting={invitingMembers}
            onInvite={handleAddGroupMembers}
          />
        </>
      ) : null}
      {target.kind === "dm" && activeContact ? (
        <DmSettingsSheet
          open={dmSettingsOpen}
          onOpenChange={setDmSettingsOpen}
          contact={
            contacts.find((entry) => entry.user_id === activeContact.user_id) ?? activeContact
          }
          youLabel={t("chat.you")}
          leaving={leavingConversation}
          leaveDisabled={!matrixClient || !activeRoomId}
          onLeave={() =>
            activeRoomId
              ? handleLeaveConversation(activeRoomId, () => removeContact(activeContact.user_id))
              : undefined
          }
        />
      ) : null}
      <div className="mx-auto grid h-full min-h-0 w-full max-w-5xl flex-1 gap-4 p-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <ChatSidebar
          currentUserId={currentUserId}
          target={target}
          onTargetChange={setTarget}
          onCreateGroup={handleCreateGroup}
          creatingGroup={creatingGroup}
          createGroupOpen={createGroupOpen}
          onCreateGroupOpenChange={setCreateGroupOpen}
          workspaceRoomId={workspaceRoomId}
          unreadByRoomId={unreadByRoomId}
          unreadBadgesReady={unreadBadgesReady}
        />

        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          {isError && target.kind === "workspace" ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2">
              <p className="text-caption text-muted-foreground">{t("chat.room_load_failed")}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                {t("chat.retry")}
              </Button>
            </div>
          ) : null}
          {connectError && (target.kind === "dm" || target.kind === "group") ? (
            <p className="rounded-md border border-border bg-surface px-3 py-2 text-caption text-muted-foreground">
              {connectError}
            </p>
          ) : null}
          {showLoading ? (
            <CollectionPageState
              icon={MessageSquare}
              title={t("chat.loading")}
              description={
                target.kind === "workspace"
                  ? t("chat.group_description")
                  : target.kind === "group"
                    ? t("chat.group_loading")
                    : t("chat.dm_hint")
              }
            />
          ) : matrixClient && activeRoomId ? (
            <>
              {target.kind === "group" ? (
                <GroupChatToolbar
                  title={headerTitle}
                  memberCount={readGroupRoomMembers(matrixClient, activeRoomId).length}
                  onOpenSettings={() => setGroupSettingsOpen(true)}
                />
              ) : null}
              {target.kind === "dm" && activeContact ? (
                <DmChatToolbar
                  contact={
                    contacts.find((entry) => entry.user_id === activeContact.user_id) ?? activeContact
                  }
                  onOpenSettings={() => setDmSettingsOpen(true)}
                  onVoiceCall={() => void handleStartVoiceCall()}
                  voiceCallDisabled={!activeRoomId || inCall || chatVoiceToken.isPending}
                />
              ) : null}
              <ChatMessagePanel
                client={matrixClient}
                roomId={activeRoomId}
                currentUserId={currentUserId}
                myMatrixUserId={matrixSession.user_id}
                readReceiptReaderId={dmReaderMatrixUserId}
                nameContext={nameContext}
                youLabel={t("chat.you")}
                replyTo={replyTo}
                onReplyToChange={setReplyTo}
                emptyLabel={
                target.kind === "workspace"
                  ? t("chat.group_description")
                  : target.kind === "group"
                    ? t("chat.group_empty", { name: headerTitle })
                    : t("chat.dm_empty", {
                      name: displayLabelForChatContact(target.contact),
                    })
              }
            />
            </>
          ) : matrixClient && target.kind === "workspace" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface p-4">
              <p className="text-body text-muted-foreground">{t("chat.group_description")}</p>
            </div>
          ) : null}
          <ChatComposer
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => void provisionAndSend()}
            disabled={(showLoading && !activeRoomId) || !matrixClient}
            placeholder={t("chat.message_placeholder")}
            sendLabel={t("chat.send")}
            typingLabel={typingLabel}
          />
        </div>
      </div>
      <VoiceCallOverlay
        state={voiceCall}
        onAccept={() => void handleAcceptVoiceCall()}
        onDecline={() => void declineCall()}
        onEnd={() => void hangUp()}
      />
    </div>
  );
}
