import * as chat from "../api/endpoints/chat";
import type { ChatUserLookup } from "../api/endpoints/chat";

const byUserId = new Map<string, ChatUserLookup>();
const byEmail = new Map<string, ChatUserLookup>();
const inflightByUserId = new Map<string, Promise<ChatUserLookup | null>>();
const inflightByEmail = new Map<string, Promise<ChatUserLookup | null>>();

function normalizeUserId(userId: string): string {
  return userId.trim().toUpperCase();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function userCacheKey(workspaceId: string, userId: string): string {
  return `${workspaceId}:${normalizeUserId(userId)}`;
}

function emailCacheKey(workspaceId: string, email: string): string {
  return `${workspaceId}:${normalizeEmail(email)}`;
}

function rememberLookup(lookup: ChatUserLookup | null): ChatUserLookup | null {
  if (!lookup) return null;
  return lookup;
}

export function peekCachedChatUserById(workspaceId: string, userId: string): ChatUserLookup | null {
  return byUserId.get(userCacheKey(workspaceId, userId)) ?? null;
}

export function peekCachedChatUserByEmail(workspaceId: string, email: string): ChatUserLookup | null {
  return byEmail.get(emailCacheKey(workspaceId, email)) ?? null;
}

export async function lookupChatUserByIdCached(
  workspaceId: string,
  userId: string,
): Promise<ChatUserLookup | null> {
  const key = userCacheKey(workspaceId, userId);
  const cached = byUserId.get(key);
  if (cached) return cached;

  const inflight = inflightByUserId.get(key);
  if (inflight) return inflight;

  const promise = chat
    .lookupChatUserById(workspaceId, normalizeUserId(userId))
    .then((result) => {
      const lookup = rememberLookup(result);
      if (lookup) {
        byUserId.set(key, lookup);
        byEmail.set(emailCacheKey(workspaceId, lookup.email), lookup);
      }
      return lookup;
    })
    .finally(() => {
      inflightByUserId.delete(key);
    });
  inflightByUserId.set(key, promise);
  return promise;
}

export async function lookupChatUserCached(
  workspaceId: string,
  email: string,
): Promise<ChatUserLookup | null> {
  const key = emailCacheKey(workspaceId, email);
  const cached = byEmail.get(key);
  if (cached) return cached;

  const inflight = inflightByEmail.get(key);
  if (inflight) return inflight;

  const promise = chat
    .lookupChatUser(workspaceId, normalizeEmail(email))
    .then((result) => {
      const lookup = rememberLookup(result);
      if (lookup) {
        byEmail.set(key, lookup);
        byUserId.set(userCacheKey(workspaceId, lookup.user_id), lookup);
      }
      return lookup;
    })
    .finally(() => {
      inflightByEmail.delete(key);
    });
  inflightByEmail.set(key, promise);
  return promise;
}

/** Test helper — clears module-level lookup cache between cases. */
export function resetChatUserLookupCacheForTests(): void {
  byUserId.clear();
  byEmail.clear();
  inflightByUserId.clear();
  inflightByEmail.clear();
}
