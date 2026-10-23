import { z } from "zod";
import { parseWithFallback } from "../schema";
import { ChatBlockStatusSchema, ChatUserLookupSchema, enc } from "./chat-schemas";
import type { ChatBlockStatus, ChatRequest, ChatUserLookup } from "./chat-schemas";

/**
 * The chat user endpoints (lookup, block, nicknames) over any transport:
 * chat-users.ts binds them to the web's, and the phone (apps/chat-mobile,
 * ADR 0011) to its own, so the two read every answer the same way. Pure: no
 * transport of its own, which is what lets the phone import it.
 */

const StatusSchema = z.object({ status: z.string().optional() });

// One drifted entry is dropped, not the whole map.
const ChatNicknamesSchema = z.object({ nicknames: z.record(z.string(), z.unknown()).catch({}) });

const NOT_BLOCKED: ChatBlockStatus = { blocked_by_me: false, blocked_me: false };

export function createChatUsersApi(request: ChatRequest) {
  const users = (workspaceId: string) => `/api/v1/workspaces/${enc(workspaceId)}/chat/users`;
  const block = (workspaceId: string, userId: string) => `${users(workspaceId)}/${enc(userId)}/block`;

  async function ok(raw: Promise<unknown>, endpoint: string): Promise<boolean> {
    return parseWithFallback(await raw, StatusSchema, { status: "" }, { endpoint }).status === "ok";
  }

  async function lookup(workspaceId: string, query: string): Promise<ChatUserLookup | null> {
    const raw = await request(`${users(workspaceId)}/lookup?${query}`);
    return parseWithFallback<ChatUserLookup | null>(raw, ChatUserLookupSchema, null, {
      endpoint: "GET /api/v1/workspaces/{ws}/chat/users/lookup",
    });
  }

  return {
    lookupChatUser(workspaceId: string, email: string): Promise<ChatUserLookup | null> {
      return lookup(workspaceId, `email=${enc(email.trim().toLowerCase())}`);
    },

    lookupChatUserById(workspaceId: string, userId: string): Promise<ChatUserLookup | null> {
      return lookup(workspaceId, `user_id=${enc(userId.trim().toUpperCase())}`);
    },

    /** Unreadable reads as "not blocked": the composer stays usable and the server still refuses a blocked send. */
    async getChatBlockStatus(workspaceId: string, userId: string, signal?: AbortSignal): Promise<ChatBlockStatus> {
      const raw = await request(block(workspaceId, userId), { signal });
      return parseWithFallback(raw, ChatBlockStatusSchema, NOT_BLOCKED, {
        endpoint: "GET /api/v1/workspaces/{ws}/chat/users/{userID}/block",
      });
    },

    blockChatUser(workspaceId: string, userId: string): Promise<boolean> {
      return ok(request(block(workspaceId, userId), { method: "POST", body: {} }), "POST /api/v1/workspaces/{ws}/chat/users/{userID}/block");
    },

    unblockChatUser(workspaceId: string, userId: string): Promise<boolean> {
      return ok(request(block(workspaceId, userId), { method: "DELETE" }), "DELETE /api/v1/workspaces/{ws}/chat/users/{userID}/block");
    },

    /** Nicknames keyed by the upper-cased user id; a blank id or a non-string nickname is dropped alone. */
    async listChatNicknames(workspaceId: string): Promise<Record<string, string>> {
      const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/chat/nicknames`);
      const parsed = parseWithFallback<{ nicknames: Record<string, unknown> }>(raw, ChatNicknamesSchema, { nicknames: {} }, {
        endpoint: "GET /api/v1/workspaces/{ws}/chat/nicknames",
      });
      const out: Record<string, string> = {};
      for (const [userId, nickname] of Object.entries(parsed.nicknames)) {
        const key = userId.trim().toUpperCase();
        if (key && typeof nickname === "string") out[key] = nickname;
      }
      return out;
    },

    setChatNickname(workspaceId: string, userId: string, nickname: string): Promise<boolean> {
      return ok(
        request(`${users(workspaceId)}/${enc(userId)}/nickname`, { method: "PUT", body: { nickname } }),
        "PUT /api/v1/workspaces/{ws}/chat/users/{userID}/nickname",
      );
    },
  };
}

export type ChatUsersApi = ReturnType<typeof createChatUsersApi>;
