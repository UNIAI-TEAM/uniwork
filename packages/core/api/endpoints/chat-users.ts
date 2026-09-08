import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import {
  ChatBlockStatusSchema,
  ChatNicknameMapSchema,
  ChatUserLookupSchema,
  enc,
} from "./chat-schemas";
import type { ChatBlockStatus, ChatNicknameMap, ChatUserLookup } from "./chat-schemas";

export async function lookupChatUser(
  workspaceId: string,
  email: string,
): Promise<ChatUserLookup | null> {
  const q = enc(email.trim().toLowerCase());
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/users/lookup?email=${q}`,
  );
  return parseWithFallback<ChatUserLookup | null>(raw, ChatUserLookupSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/users/lookup",
  });
}

export async function lookupChatUserById(
  workspaceId: string,
  userId: string,
): Promise<ChatUserLookup | null> {
  const q = enc(userId.trim().toUpperCase());
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/users/lookup?user_id=${q}`,
  );
  return parseWithFallback<ChatUserLookup | null>(raw, ChatUserLookupSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/users/lookup",
  });
}

export async function getChatBlockStatus(
  workspaceId: string,
  userId: string,
): Promise<ChatBlockStatus> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/users/${enc(userId)}/block`,
  );
  return parseWithFallback(raw, ChatBlockStatusSchema, { blocked_by_me: false, blocked_me: false }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/users/{userID}/block",
  });
}

export async function blockChatUser(workspaceId: string, userId: string): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/users/${enc(userId)}/block`,
    { method: "POST", body: {} },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "POST /api/v1/workspaces/{ws}/chat/users/{userID}/block",
  });
  return parsed.status === "ok";
}

export async function unblockChatUser(workspaceId: string, userId: string): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/users/${enc(userId)}/block`,
    { method: "DELETE" },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "DELETE /api/v1/workspaces/{ws}/chat/users/{userID}/block",
  });
  return parsed.status === "ok";
}

export async function listChatNicknames(workspaceId: string): Promise<Record<string, string>> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/nicknames`);
  const parsed = parseWithFallback<ChatNicknameMap>(raw, ChatNicknameMapSchema, { nicknames: {} }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/nicknames",
  });
  const entries = parsed.nicknames ?? {};
  const out: Record<string, string> = {};
  for (const [userId, nickname] of Object.entries(entries)) {
    const key = userId.trim().toUpperCase();
    if (!key) continue;
    if (typeof nickname !== "string") continue;
    out[key] = nickname;
  }
  return out;
}

export async function setChatNickname(
  workspaceId: string,
  userId: string,
  nickname: string,
): Promise<boolean> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/users/${enc(userId)}/nickname`,
    { method: "PUT", body: { nickname } },
  );
  const parsed = parseWithFallback(raw, z.object({ status: z.string().optional() }), { status: "" }, {
    endpoint: "PUT /api/v1/workspaces/{ws}/chat/users/{userID}/nickname",
  });
  return parsed.status === "ok";
}
