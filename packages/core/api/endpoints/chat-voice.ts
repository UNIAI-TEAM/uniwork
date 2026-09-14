import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import { ChatVoiceTokenSchema, PendingChatVoiceInvitesSchema, enc } from "./chat-schemas";
import type { ChatVoiceToken, PendingChatVoiceInvite } from "./chat-schemas";

export async function listPendingChatVoiceInvites(
  workspaceId: string,
): Promise<PendingChatVoiceInvite[]> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/voice/pending`);
  const parsed = parseWithFallback(raw, PendingChatVoiceInvitesSchema, { invites: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/voice/pending",
  });
  return parsed.invites ?? [];
}

/** LiveKit JWT for a native chat room voice call. */
export async function mintChatVoiceToken(
  roomId: string,
  callId: string,
): Promise<ChatVoiceToken | null> {
  const raw = await request("/api/v1/chat/voice/token", {
    method: "POST",
    body: { room_id: roomId.trim(), call_id: callId.trim() },
  });
  return parseWithFallback<ChatVoiceToken | null>(raw, ChatVoiceTokenSchema, null, {
    endpoint: "POST /api/v1/chat/voice/token",
  });
}

export async function signalChatVoiceInvite(
  workspaceId: string,
  roomId: string,
  callId: string,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/voice/invite`,
    { method: "POST", body: { call_id: callId } },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/invite",
  });
  return parsed.status === "ok";
}

export async function signalChatVoiceAccept(
  workspaceId: string,
  roomId: string,
  callId: string,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/voice/accept`,
    { method: "POST", body: { call_id: callId } },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/accept",
  });
  return parsed.status === "ok";
}

export async function signalChatVoiceHangup(
  workspaceId: string,
  roomId: string,
  callId: string,
  durationSeconds?: number,
): Promise<boolean> {
  const body: { call_id: string; duration_seconds?: number } = { call_id: callId };
  if (durationSeconds != null && durationSeconds > 0) {
    body.duration_seconds = durationSeconds;
  }
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/voice/hangup`,
    { method: "POST", body },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/hangup",
  });
  return parsed.status === "ok";
}

export async function signalChatTyping(workspaceId: string, roomId: string): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/typing`,
    { method: "POST", body: {} },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/typing",
  });
  return parsed.status === "ok";
}

export async function signalChatPresence(
  workspaceId: string,
  state: "online" | "offline" = "online",
  opts: { keepalive?: boolean } = {},
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/presence`,
    { method: "POST", body: { state }, keepalive: opts.keepalive },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/presence",
  });
  return parsed.status === "ok";
}
