import type { MeetingParticipant } from "@uniwork/core/types";
import { PARTICIPANT_IDENTITY_PREFIX } from "./meeting-signals";

/** Whether this participant's seat is in the LiveKit room right now. */
function inRoom(p: { id: string }, liveIdentities: ReadonlySet<string>): boolean {
  return liveIdentities.has(PARTICIPANT_IDENTITY_PREFIX + p.id);
}

/**
 * Who the host can hand the room to before leaving: workspace people in the
 * room now (MeetingService.TransferHost refuses a guest or someone not
 * active), the secretary first, then by name.
 */
export function handoverCandidates(
  participants: readonly MeetingParticipant[],
  liveIdentities: ReadonlySet<string>,
  hostUserId: string | undefined,
  collator: Intl.Collator,
): MeetingParticipant[] {
  const seen = new Set<string>();
  return participants
    .filter((p) => {
      if (p.principal_type.toUpperCase() !== "USER" || p.status !== "ACTIVE") return false;
      if (!p.user_id || p.user_id === hostUserId || seen.has(p.user_id)) return false;
      if (!inRoom(p, liveIdentities)) return false;
      seen.add(p.user_id);
      return true;
    })
    .sort(
      (a, b) =>
        Number(b.is_secretary === true) - Number(a.is_secretary === true) ||
        collator.compare(a.display_name_snapshot ?? "", b.display_name_snapshot ?? ""),
    );
}

/** Whether the meeting's host holds a seat in the room. */
export function hostInRoom(
  participants: readonly MeetingParticipant[],
  liveIdentities: ReadonlySet<string>,
  hostUserId: string | undefined,
): boolean {
  if (!hostUserId) return false;
  return participants.some((p) => p.user_id === hostUserId && inRoom(p, liveIdentities));
}
