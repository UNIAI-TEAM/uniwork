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

function rememberLookup(lookup: ChatUserLookup | null): ChatUserLookup | null {
  if (!lookup) return null;
  byUserId.set(normalizeUserId(lookup.user_id), lookup);
  byEmail.set(normalizeEmail(lookup.email), lookup);
  return lookup;
}

export function peekCachedChatUserById(userId: string): ChatUserLookup | null {
  return byUserId.get(normalizeUserId(userId)) ?? null;
}

export function peekCachedChatUserByEmail(email: string): ChatUserLookup | null {
  return byEmail.get(normalizeEmail(email)) ?? null;
}

export async function lookupChatUserByIdCached(userId: string): Promise<ChatUserLookup | null> {
  const key = normalizeUserId(userId);
  const cached = byUserId.get(key);
  if (cached) return cached;

  const inflight = inflightByUserId.get(key);
  if (inflight) return inflight;

  const promise = chat
    .lookupChatUserById(key)
    .then((result) => rememberLookup(result))
    .finally(() => {
      inflightByUserId.delete(key);
    });
  inflightByUserId.set(key, promise);
  return promise;
}

export async function lookupChatUserCached(email: string): Promise<ChatUserLookup | null> {
  const key = normalizeEmail(email);
  const cached = byEmail.get(key);
  if (cached) return cached;

  const inflight = inflightByEmail.get(key);
  if (inflight) return inflight;

  const promise = chat
    .lookupChatUser(email)
    .then((result) => rememberLookup(result))
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
