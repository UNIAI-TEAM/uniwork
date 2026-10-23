import { normalizeChatUserId } from "@uniwork/core/chat/contacts-store";

/** Same rule as workspace members settings: only a non-empty string counts. */
export function memberAvatarUrl(avatar_url: unknown): string | undefined {
  return typeof avatar_url === "string" && avatar_url.trim() ? avatar_url.trim() : undefined;
}

export type MemberAvatarUrlMap = Record<string, string>;

export function buildMemberAvatarUrlMap(
  members: ReadonlyArray<{ user_id: string; avatar_url?: unknown }>,
): MemberAvatarUrlMap {
  const map: MemberAvatarUrlMap = {};
  for (const member of members) {
    const url = memberAvatarUrl(member.avatar_url);
    if (url) map[normalizeChatUserId(member.user_id)] = url;
  }
  return map;
}

export function lookupMemberAvatarUrl(map: MemberAvatarUrlMap, userId: string): string | undefined {
  return map[normalizeChatUserId(userId)];
}

/** Session avatar wins over a stale members cache for the signed-in user. */
export function withSelfAvatarFromUser(
  map: MemberAvatarUrlMap,
  userId: string | undefined,
  avatar_url: unknown,
): MemberAvatarUrlMap {
  const url = memberAvatarUrl(avatar_url);
  if (!userId || !url) return map;
  const key = normalizeChatUserId(userId);
  if (map[key] === url) return map;
  return { ...map, [key]: url };
}

export function applySelfAvatarToNameContext<T extends { user_id: string; avatar_url?: string }>(
  entries: T[],
  userId: string | undefined,
  avatar_url: unknown,
): T[] {
  const url = memberAvatarUrl(avatar_url);
  if (!userId || !url) return entries;
  const key = normalizeChatUserId(userId);
  let changed = false;
  const next = entries.map((entry) => {
    if (normalizeChatUserId(entry.user_id) !== key) return entry;
    if (entry.avatar_url === url) return entry;
    changed = true;
    return { ...entry, avatar_url: url };
  });
  return changed ? next : entries;
}

export function resolveAvatarUrlFromNameContext(
  nameContext: ReadonlyArray<{ user_id: string; avatar_url?: string }>,
  userId: string,
): string | undefined {
  const key = normalizeChatUserId(userId);
  const entry = nameContext.find((item) => normalizeChatUserId(item.user_id) === key);
  return entry?.avatar_url;
}
