// Everything a conversation screen reads about its room besides messages:
// the record from the rooms list, its members, the names to print, whether
// the composer may send, the @mention list, who is typing and whether a DM's
// peer is online. Shared by the room and the thread screens.
import { useQuery } from "@tanstack/react-query";
import { chatRoomToContact, isDefaultWorkspaceChannel } from "@uniwork/core/chat/chat-room-helpers";
import { normalizeTypingUserId } from "@uniwork/core/chat/typing-user-id";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { nicknamesOptions, roomMembersOptions, roomsOptions, workspaceMembersOptions } from "@/data/queries/chat";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { useSidebarTypingStore } from "@/data/stores/chat-typing-store";
import { buildChatMentionCandidates } from "@/lib/mentions";
import { buildChatNameContext, senderLabelFor } from "@/lib/people-display";
import { roomTitle } from "@/lib/room-list";
import { canSendInRoom, displayLabelForChatContact, resolveChatNicknameForUser } from "@/lib/rooms-display";
import type { TimelineMessage } from "@/lib/timeline-display";
import { formatTypingLabel } from "@/lib/typing-display";
import type { ChatWorkspace } from "./use-chat-workspace";

const NOBODY: string[] = [];

export function useRoomContext(chat: ChatWorkspace, roomId: string) {
  const { t, i18n } = useTranslation();
  const rooms = useQuery(roomsOptions(chat.wsId));
  const room = rooms.data?.find((entry) => entry.id === roomId) ?? null;
  const members = useQuery(roomMembersOptions(chat.wsId, roomId));
  const nicknames = useQuery(nicknamesOptions(chat.wsId)).data;
  const workspaceMembers = useQuery(workspaceMembersOptions(chat.wsId)).data;

  const nameContext = useMemo(
    () =>
      buildChatNameContext(
        room?.kind === "dm" ? [chatRoomToContact(room)] : [],
        members.data ?? [],
        workspaceMembers ?? [],
        nicknames ?? {},
      ),
    [room, members.data, workspaceMembers, nicknames],
  );

  const candidates = useMemo(() => {
    if (!room) return [];
    const kind = room.kind === "workspace" || isDefaultWorkspaceChannel(room) ? "workspace" : room.kind;
    const profiles = Object.fromEntries((members.data ?? []).map((m) => [m.user_id, { user_id: m.user_id, email: m.email, display_name: m.display_name }]));
    return buildChatMentionCandidates(
      kind,
      chat.userId,
      workspaceMembers ?? [],
      profiles,
      (person) => resolveChatNicknameForUser(nicknames, person.user_id) || displayLabelForChatContact(person),
      (members.data ?? []).map((m) => m.user_id),
    );
  }, [room, members.data, workspaceMembers, nicknames, chat.userId]);

  /** A message's sender as the room names them; the record's own name before a raw id. */
  const senderName = useCallback(
    (message: TimelineMessage) => {
      const label = senderLabelFor(message, chat.userId, t("chat.you"), nameContext);
      return label === message.sender && message.record?.sender_display_name ? message.record.sender_display_name : label;
    },
    [chat.userId, nameContext, t],
  );

  const typingIds = useSidebarTypingStore((s) => s.byRoomId[roomId] ?? NOBODY);
  const typingNames = useMemo(() => typingIds.map((id) => senderLabelFor({ sender: id }, "", "", nameContext)), [typingIds, nameContext]);
  const typingLabel = typingNames.length ? formatTypingLabel(typingNames, t, i18n.language) : null;
  const peerId = room?.kind === "dm" ? room.peer_user_id : undefined;
  const peerOnline = usePresenceStore((s) => (peerId ? Boolean(s.onlineUserIds[normalizeTypingUserId(peerId)]) : false));

  return {
    room,
    title: room ? roomTitle(room, { nicknamesByUserId: nicknames ?? {}, workspaceName: chat.workspaceName, t }) : "",
    isGroup: room?.kind !== "dm",
    canSend: canSendInRoom(room, members.data ?? [], chat.userId),
    candidates,
    members: members.data ?? [],
    nameContext,
    senderName,
    typingLabel,
    /** Who is typing, first first: the typing bubble's avatar. */
    typingNames,
    typingIds,
    peerOnline,
  };
}
