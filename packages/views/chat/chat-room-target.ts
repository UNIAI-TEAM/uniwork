import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { displayLabelForChatContact, type ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { ChatSidebarTarget } from "./chat-sidebar-types";

/** Maps a room id to the sidebar target that opens it, when the page knows that room. */
export function resolveChatRoomTarget(
  roomId: string,
  {
    workspaceRoomId,
    workspaceTitle,
    channels,
    groups,
    contacts,
    nicknamesByUserId,
  }: {
    workspaceRoomId: string | null;
    workspaceTitle: string;
    channels: ChatRoomRecord[];
    groups: GroupChat[];
    contacts: ChatContact[];
    nicknamesByUserId: Record<string, string>;
  },
): { target: ChatSidebarTarget; title: string } | null {
  if (roomId === workspaceRoomId) return { target: { kind: "workspace" }, title: workspaceTitle };
  const channel = channels.find((entry) => entry.id === roomId);
  if (channel) return { target: { kind: "channel", channel }, title: channel.name };
  const group = groups.find((entry) => entry.room_id === roomId);
  if (group) return { target: { kind: "group", group }, title: group.name };
  const contact = contacts.find((entry) => entry.dm_room_id === roomId);
  if (contact) {
    return {
      target: { kind: "dm", contact },
      title: displayLabelForChatContact(contact, nicknamesByUserId),
    };
  }
  return null;
}
