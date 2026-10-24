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
  const index = userId ? (joinOrder(members).get(userId) ?? -1) : -1;
  return index < 0 ? "gray" : MEETING_AVATAR_TINTS[index % MEETING_AVATAR_TINTS.length]!;
}

// Built once per members list (a query's data, never mutated): every face on the page looks itself up in it.
const joinOrders = new WeakMap<readonly { user_id: string }[], Map<string, number>>();

function joinOrder(members: readonly { user_id: string }[]): Map<string, number> {
  const cached = joinOrders.get(members);
  if (cached) return cached;
  const order = new Map<string, number>();
  // The first row wins, as findIndex did.
  members.forEach(({ user_id }, i) => {
    if (!order.has(user_id)) order.set(user_id, i);
  });
  joinOrders.set(members, order);
  return order;
}
