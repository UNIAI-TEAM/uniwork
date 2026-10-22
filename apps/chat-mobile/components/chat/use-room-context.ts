// Everything a conversation screen reads about its room besides messages:
// the record from the rooms list, its members, the names to print, whether
// the composer may send, the @mention list and whether a DM's peer is online.
// Shared by the room and the thread screens. Who is typing is not here: the
// bubble and the header line read it themselves (room-typing.tsx), so a typing
// frame does not redraw the conversation. What names a sender stays the same
// object while the people and nicknames do: a new message
// changes the room's record, not its DM peer, so the rows keep their names
// without being read again (lib/message-row-model.ts).
import { useQuery } from "@tanstack/react-query";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { chatRoomToContact, isDefaultWorkspaceChannel } from "@uniwork/core/chat/chat-room-helpers";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useIsOnline } from "@/components/people/use-is-online";
import { nicknamesOptions, roomMembersOptions, roomsOptions, workspaceMembersOptions } from "@/data/queries/chat";
import { buildChatMentionCandidates } from "@uniwork/core/chat/chat-mention-utils";
import { buildChatNameContext, senderLabelFor } from "@/lib/people-display";
import { roomTitle } from "@/lib/room-list";
import { canSendInRoom } from "@/lib/rooms-display";
import { displayLabelForChatContact, resolveChatNicknameForUser } from "@uniwork/core/chat/contact-labels";
import type { TimelineMessage } from "@/lib/timeline-display";
import type { ChatWorkspace } from "./use-chat-workspace";

export function useRoomContext(chat: ChatWorkspace, roomId: string) {
  const { t } = useTranslation();
  const rooms = useQuery(roomsOptions(chat.wsId));
  const room = rooms.data?.find((entry) => entry.id === roomId) ?? null;
  const members = useQuery(roomMembersOptions(chat.wsId, roomId));
  const nicknames = useQuery(nicknamesOptions(chat.wsId)).data;
  const workspaceMembers = useQuery(workspaceMembersOptions(chat.wsId)).data;
  // The DM's peer as a contact, kept the same object by the query's structural sharing while it reads the same.
  const selectDmContact = useCallback(
    (rooms: ChatRoomRecord[]) => {
      const record = rooms.find((entry) => entry.id === roomId);
      return record?.kind === "dm" ? chatRoomToContact(record) : null;
    },
    [roomId],
  );
  const dmContact = useQuery({ ...roomsOptions(chat.wsId), select: selectDmContact }).data ?? null;

  const nameContext = useMemo(
    () => buildChatNameContext(dmContact ? [dmContact] : [], members.data ?? [], workspaceMembers ?? [], nicknames ?? {}),
    [dmContact, members.data, workspaceMembers, nicknames],
  );

  const candidates = useMemo(() => {
    if (!room) return [];
    const kind = room.kind === "workspace" || isDefaultWorkspaceChannel(room) ? "workspace" : room.kind;
    const profiles = Object.fromEntries(
      (members.data ?? []).map((m) => [m.user_id, { user_id: m.user_id, email: m.email, display_name: m.display_name }]),
    );
    return buildChatMentionCandidates(
      kind,
      chat.userId,
      workspaceMembers ?? [],
      profiles,
      (person) => resolveChatNicknameForUser(nicknames, person.user_id) || displayLabelForChatContact(person),
      (members.data ?? []).map((m) => m.user_id),
    );
  }, [room, members.data, workspaceMembers, nicknames, chat.userId]);

  // One look-up per sender, not one scan of the room's people per message per change of the timeline.
  const labels = useMemo(() => {
    const cache = new Map<string, string>();
    const you = t("chat.you");
    return (sender: string) => {
      let label = cache.get(sender);
      if (label === undefined) {
        label = senderLabelFor({ sender }, chat.userId, you, nameContext);
        cache.set(sender, label);
      }
      return label;
    };
  }, [chat.userId, nameContext, t]);
  /** A message's sender as the room names them; the record's own name before a raw id. */
  const senderName = useCallback(
    (message: TimelineMessage) => {
      const label = labels(message.sender);
      return label === message.sender && message.record?.sender_display_name ? message.record.sender_display_name : label;
    },
    [labels],
  );

  const peerOnline = useIsOnline(room?.kind === "dm" ? room.peer_user_id : undefined);
  const roomMembers = members.data;
  const title = room ? roomTitle(room, { nicknamesByUserId: nicknames ?? {}, workspaceName: chat.workspaceName, t }) : "";
  const canSend = canSendInRoom(room, roomMembers ?? [], chat.userId);

  // One object while nothing it holds changed: the conversation's memoized parts compare it.
  return useMemo(
    () => ({
      room,
      title,
      isGroup: room?.kind !== "dm",
      canSend,
      candidates,
      members: roomMembers ?? NO_MEMBERS,
      nameContext,
      senderName,
      peerOnline,
    }),
    [room, title, canSend, candidates, roomMembers, nameContext, senderName, peerOnline],
  );
}

const NO_MEMBERS: never[] = [];
