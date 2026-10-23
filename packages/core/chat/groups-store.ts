"use client";

export interface GroupChat {
  id: string;
  name: string;
  room_id: string;
  /** UniWork user ids (excluding self), sorted for stable matching. */
  member_user_ids: string[];
  /** The group's uploaded photo from the rooms list: a signed URL that expires, so not worth keeping. */
  avatar_url?: string;
}

export function memberSetKey(userIds: string[]): string {
  return [...userIds].map((id) => id.trim().toUpperCase()).sort().join("\u0000");
}
