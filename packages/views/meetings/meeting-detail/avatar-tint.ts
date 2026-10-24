import type { Tint } from "@uniwork/ui/components/common/icon-tile";

const MEETING_AVATAR_TINTS = ["blue", "pink", "teal", "orange", "green"] as const satisfies readonly Tint[];

/**
 * A person's avatar tint on the meeting detail page (PLAN D11): the five
 * kit tints by workspace join order — the members list comes ordered by
 * `created_at` — and gray for a guest or anyone not (or no longer) a member.
 * Deterministic per workspace, and violet stays the meetings module's own.
 */
export function meetingAvatarTint(
  userId: string | null | undefined,
  members: readonly { user_id: string }[],
): Tint {
  const index = userId ? members.findIndex((m) => m.user_id === userId) : -1;
  return index < 0 ? "gray" : MEETING_AVATAR_TINTS[index % MEETING_AVATAR_TINTS.length]!;
}
