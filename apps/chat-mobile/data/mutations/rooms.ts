// What the chat does to its rooms: mute, leave, open a DM, join a channel,
// make a group or add people to one, mark a thread read, and ask the AI to
// catch up on a room. See command.ts for the layer's rule.
import {
  createGroup,
  inviteGroupMembers,
  joinChannel,
  leaveRoom,
  markThreadRead,
  resolveDMRoom,
  setChatNickname,
  setRoomMuted,
  setRoomWallpaper,
} from "../chat-actions";
import { chatApi } from "../chat-api";
import { useCommand } from "./command";

/** Optimistic on the room list; a failure restores the row and rejects. */
export const useSetRoomMuted = (wsId: string) =>
  useCommand("chat.mute_room", (qc, { roomId, muted }: { roomId: string; muted: boolean }) => setRoomMuted(qc, wsId, roomId, muted));

export const useSetRoomWallpaper = (wsId: string) =>
  useCommand("chat.wallpaper", (qc, { roomId, preset }: { roomId: string; preset: string }) => setRoomWallpaper(qc, wsId, roomId, preset));

export const useSetNickname = (wsId: string) =>
  useCommand("chat.nickname", (qc, { userId, nickname }: { userId: string; nickname: string }) => setChatNickname(qc, wsId, userId, nickname));

export const useLeaveRoom = (wsId: string) => useCommand("chat.leave_room", (qc, roomId: string) => leaveRoom(qc, wsId, roomId));

/** The DM with a person, created on first use; null when the server answers none. */
export const useResolveDM = (wsId: string) => useCommand("chat.resolve_dm", (qc, userId: string) => resolveDMRoom(qc, wsId, userId));

export const useJoinChannel = (wsId: string) => useCommand("chat.join_channel", (qc, roomId: string) => joinChannel(qc, wsId, roomId));

export const useCreateGroup = (wsId: string) =>
  useCommand("chat.create_group", (qc, input: { name: string; memberUserIds: string[] }) => createGroup(qc, wsId, input));

export const useInviteGroupMembers = (wsId: string, roomId: string) =>
  useCommand("chat.invite_members", (qc, memberUserIds: string[]) => inviteGroupMembers(qc, wsId, roomId, memberUserIds));

export const useMarkThreadRead = (wsId: string) => useCommand("chat.mark_thread_read", (_qc, rootId: string) => markThreadRead(wsId, rootId));

/** The AI's brief of a room (read-only on the server; the screen asks only with the person's AI consent). */
export const useCatchUp = (wsId: string) =>
  useCommand("chat.catch_up", (_qc, { roomId, locale }: { roomId: string; locale: string }) => chatApi.catchUp(wsId, { room_id: roomId, locale }));
