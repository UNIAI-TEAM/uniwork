import { ApiError } from "@uniwork/core/api";
import type { InviteLinkState, InviteMeetingState, PublicInviteLink } from "@uniwork/core/api/endpoints/meetings";

/** Every screen the public invite page can settle on before the join form. */
export type InviteClosedState =
  | "expired"
  | "revoked"
  | "exhausted"
  | "invalid"
  | "error"
  | "ended"
  | "canceled"
  | "past_scheduled_end";

export type InviteViewState = "loading" | "ok" | InviteClosedState;

function linkState(res: PublicInviteLink): InviteLinkState {
  switch (res.link_state) {
    case "active":
    case "expired":
    case "revoked":
    case "exhausted":
      return res.link_state;
    default:
      // A server that predates link_state only says `expired` (revoked or past expiry).
      return res.expired ? "expired" : "active";
  }
}

function meetingState(res: PublicInviteLink): InviteMeetingState {
  switch (res.meeting_state) {
    case "ended":
    case "canceled":
    case "past_scheduled_end":
      return res.meeting_state;
    default:
      return "open";
  }
}

/**
 * A closed meeting outranks the link: "the meeting ended" is the answer a
 * guest can act on, whatever state the link is in.
 */
export function inviteStateFromResolve(res: PublicInviteLink): InviteViewState {
  const meeting = meetingState(res);
  if (meeting !== "open") return meeting;
  const link = linkState(res);
  return link === "active" ? "ok" : link;
}

/** A refused link and an unreachable server read differently to a guest. */
export function resolveFailureState(err: unknown): InviteClosedState {
  if (!(err instanceof ApiError)) return "error";
  switch (err.code) {
    case "invite_link_expired":
      return "expired";
    case "invite_link_revoked":
      return "revoked";
    case "invite_link_limit_reached":
      return "exhausted";
    case "invite_link_invalid":
      return "invalid";
    default:
      return "error";
  }
}

/** i18n keys for the card each closed state shows. */
export function inviteStateCopy(state: InviteClosedState): { title: string; hint: string } {
  switch (state) {
    case "expired":
      return { title: "meetings.publicInviteExpired", hint: "meetings.publicInviteExpiredHint" };
    case "revoked":
      return { title: "meetings.publicInviteRevoked", hint: "meetings.publicInviteRevokedHint" };
    case "exhausted":
      return { title: "meetings.publicInviteExhausted", hint: "meetings.publicInviteExhaustedHint" };
    case "invalid":
      return { title: "meetings.publicInviteInvalid", hint: "meetings.publicInviteInvalidHint" };
    case "ended":
      return { title: "meetings.endedCannotJoin", hint: "meetings.publicInviteClosedHint" };
    case "canceled":
      return { title: "meetings.canceledCannotJoin", hint: "meetings.publicInviteClosedHint" };
    case "past_scheduled_end":
      return { title: "meetings.pastScheduledEnd", hint: "meetings.publicInvitePastEndHint" };
    case "error":
    default:
      return { title: "meetings.publicInviteLoadFailed", hint: "meetings.publicInviteLoadFailedHint" };
  }
}
