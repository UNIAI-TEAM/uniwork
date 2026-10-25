import type { MeetingParticipant } from "@uniwork/core/types";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";

/** What an invitee may answer; PENDING (or anything newer) reads as no answer yet. */
export type RsvpAnswer = "ACCEPTED" | "TENTATIVE" | "DECLINED";
export type RsvpState = RsvpAnswer | "PENDING";

type ParticipantLike = Pick<MeetingParticipant, "id" | "user_id">;
type InvitationLike = Pick<MeetingInvitation, "participant_id" | "response_status">;

/** An invitation's `response_status` as an answer, with anything unknown read as not answered. */
export function rsvpState(status: string | null | undefined): RsvpState {
  return status === "ACCEPTED" || status === "TENTATIVE" || status === "DECLINED" ? status : "PENDING";
}

/** The viewer's own invitation: their active participant row, then the invitation sent to it. */
export function myInvitation<I extends InvitationLike>(
  participants: readonly ParticipantLike[],
  invitations: readonly I[],
  userId: string,
): I | undefined {
  const mine = participants.find((p) => p.user_id === userId);
  return mine ? invitations.find((inv) => inv.participant_id === mine.id) : undefined;
}

/**
 * The tally behind "1 nhận lời · 1 chưa phản hồi" and "1 người chưa phản hồi:
 * Minh Trần": one count per answer over the invitations of active
 * participants, plus who has not answered yet (in roster order).
 */
export function rsvpCounts(
  participants: readonly (ParticipantLike & { display_name_snapshot?: string | null })[],
  invitations: readonly InvitationLike[],
): Record<RsvpState, number> & { pendingNames: string[] } {
  const counts = { ACCEPTED: 0, TENTATIVE: 0, DECLINED: 0, PENDING: 0, pendingNames: [] as string[] };
  for (const p of participants) {
    const invitation = invitations.find((inv) => inv.participant_id === p.id);
    if (!invitation) continue;
    const state = rsvpState(invitation.response_status);
    counts[state] += 1;
    if (state === "PENDING") counts.pendingNames.push(p.display_name_snapshot ?? "");
  }
  return counts;
}
