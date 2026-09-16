import { z } from "zod";
import { ApiError, request, requestBlob } from "../http";
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

const ChatVoiceRecordingSchema = z.object({
  recording: z
    .object({
      id: z.string(),
      room_id: z.string().optional(),
      call_id: z.string().optional(),
      status: z.string(),
      file_url: z.string().optional().default(""),
      started_by: z.string().optional().default(""),
      started_at: z.string().optional().default(""),
      ended_at: z.string().optional().default(""),
    })
    .optional(),
});

type ChatVoiceRecordingRow = {
  id: string;
  room_id?: string;
  call_id?: string;
  status: string;
  file_url?: string;
  started_by?: string;
  started_at?: string;
  ended_at?: string;
};

type ChatVoiceRecordingEnvelope = { recording?: ChatVoiceRecordingRow };

export type ChatVoiceRecording = {
  id: string;
  status: string;
  file_url: string;
  started_by: string;
};

function toChatVoiceRecording(row: ChatVoiceRecordingRow): ChatVoiceRecording {
  return {
    id: row.id,
    status: row.status,
    file_url: row.file_url ?? "",
    started_by: row.started_by ?? "",
  };
}

export async function getActiveChatVoiceRecording(
  workspaceId: string,
  roomId: string,
  callId: string,
): Promise<ChatVoiceRecording | null> {
  try {
    const raw = await request(
      `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/voice/recording/active?call_id=${enc(callId)}`,
    );
    const parsed = parseWithFallback<ChatVoiceRecordingEnvelope>(raw, ChatVoiceRecordingSchema, {}, {
      endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/recording/active",
    });
    if (!parsed.recording?.id) return null;
    return toChatVoiceRecording(parsed.recording);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function startChatVoiceRecording(
  workspaceId: string,
  roomId: string,
  callId: string,
): Promise<ChatVoiceRecording | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/voice/recording/start`,
    { method: "POST", body: { call_id: callId } },
  );
  const parsed = parseWithFallback<ChatVoiceRecordingEnvelope>(raw, ChatVoiceRecordingSchema, {}, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/recording/start",
  });
  if (!parsed.recording?.id) return null;
  return toChatVoiceRecording(parsed.recording);
}

const ChatVoiceRecordingListSchema = z.object({
  recordings: z
    .array(
      z.object({
        id: z.string(),
        room_id: z.string().optional(),
        call_id: z.string().optional(),
        status: z.string(),
        file_url: z.string().optional().default(""),
        started_by: z.string().optional().default(""),
        started_at: z.string().optional().default(""),
        ended_at: z.string().optional().default(""),
      }),
    )
    .optional()
    .default([]),
});

type ChatVoiceRecordingListRow = ChatVoiceRecordingRow;

type ChatVoiceRecordingListEnvelope = { recordings: ChatVoiceRecordingListRow[] };

export type ChatVoiceRecordingItem = {
  id: string;
  call_id: string;
  status: string;
  file_url: string;
  started_by: string;
  started_at: string;
  ended_at: string;
};

export async function listChatVoiceRecordings(
  workspaceId: string,
  roomId: string,
  limit = 50,
): Promise<ChatVoiceRecordingItem[]> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/voice/recordings?limit=${limit}`,
  );
  const parsed = parseWithFallback<ChatVoiceRecordingListEnvelope>(raw, ChatVoiceRecordingListSchema, { recordings: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/recordings",
  });
  return (parsed.recordings ?? []).map((row) => ({
    id: row.id,
    call_id: row.call_id ?? "",
    status: row.status,
    file_url: row.file_url ?? "",
    started_by: row.started_by ?? "",
    started_at: row.started_at ?? "",
    ended_at: row.ended_at ?? "",
  }));
}

const ChatVoiceRecordingPlaybackSchema = z.object({
  playback_url: z.string().optional().default(""),
  expires_at: z.string().optional().default(""),
});

export type ChatVoiceRecordingPlayback = {
  playback_url: string;
  expires_at: string;
};

/** Short-lived presigned URL for direct MP4 streaming (seek-friendly). */
export async function getChatVoiceRecordingPlaybackUrl(
  workspaceId: string,
  roomId: string,
  recordingId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ChatVoiceRecordingPlayback | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/voice/recordings/${enc(recordingId)}/playback-url`,
    { signal: opts.signal },
  );
  const parsed = parseWithFallback(raw, ChatVoiceRecordingPlaybackSchema, { playback_url: "", expires_at: "" }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/recordings/{id}/playback-url",
  });
  if (!parsed.playback_url.trim()) return null;
  return { playback_url: parsed.playback_url, expires_at: parsed.expires_at };
}

export function loadChatVoiceRecordingBlob(
  workspaceId: string,
  roomId: string,
  recordingId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<Blob> {
  return requestBlob(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/voice/recordings/${enc(recordingId)}/content`,
    opts,
  );
}

export type ChatVoiceRecordingPlaybackSource =
  | { kind: "remote"; url: string; expiresAt: string }
  | { kind: "blob"; url: string };

/**
 * Prefer presigned streaming URL; fall back to authenticated blob proxy when
 * presign is unavailable or the storage endpoint is not browser-reachable.
 */
export async function resolveChatVoiceRecordingPlayback(
  workspaceId: string,
  roomId: string,
  recordingId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ChatVoiceRecordingPlaybackSource> {
  try {
    const presigned = await getChatVoiceRecordingPlaybackUrl(
      workspaceId,
      roomId,
      recordingId,
      opts,
    );
    if (presigned?.playback_url) {
      return {
        kind: "remote",
        url: presigned.playback_url,
        expiresAt: presigned.expires_at,
      };
    }
  } catch {
    /* presign optional — proxy blob below */
  }
  const blob = await loadChatVoiceRecordingBlob(workspaceId, roomId, recordingId, opts);
  return { kind: "blob", url: URL.createObjectURL(blob) };
}

export async function stopChatVoiceRecording(
  workspaceId: string,
  roomId: string,
  callId: string,
): Promise<ChatVoiceRecording | null> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/rooms/${enc(roomId)}/voice/recording/stop`,
    { method: "POST", body: { call_id: callId } },
  );
  const parsed = parseWithFallback<ChatVoiceRecordingEnvelope>(raw, ChatVoiceRecordingSchema, {}, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/rooms/{roomID}/voice/recording/stop",
  });
  if (!parsed.recording?.id) return null;
  return toChatVoiceRecording(parsed.recording);
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
