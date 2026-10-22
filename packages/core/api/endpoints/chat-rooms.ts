import { request } from "../http";
import { createChatRoomsApi } from "./chat-rooms-api";
import { readRoom } from "./chat-endpoint-kit";
import { enc } from "./chat-schemas";
import type { ChatRoomRecord } from "./chat-schemas";
import { webChatRequest } from "./chat-web-request";

// The web's binding of the shared chat room endpoints (chat-rooms-api.ts) to its transport.
export const {
  listChatRooms,
  getChatUnreadSummary,
  resolveDMRoom,
  createChatGroup,
  inviteChatGroupMembers,
  removeChatRoomAvatar,
  leaveChatRoom,
  removeChatRoomMember,
  listChatRoomMembers,
  patchChatRoomMember,
  getWorkspaceChatRoom,
  ensureWorkspaceChatRoom,
  getChatRoom,
  patchChatRoom,
} = createChatRoomsApi(webChatRequest);

/** Sets a group's avatar; PNG, JPEG, GIF or WebP up to 2 MiB. A browser File, so it stays off the JSON factory. */
export async function uploadChatRoomAvatar(
  workspaceId: string,
  roomId: string,
  file: File,
): Promise<ChatRoomRecord | null> {
  const form = new FormData();
  form.append("file", file);
  return readRoom(
    request(`/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/avatar`, { method: "POST", body: form }),
    "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/avatar",
  );
}

export async function removeWorkspaceChatRoomMember(
  workspaceId: string,
  roomId: string,
  userId: string,
): Promise<boolean> {
  return removeChatRoomMember(workspaceId, roomId, userId);
}
