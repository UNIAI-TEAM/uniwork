// What the phone makes of an invitation (spec §5.2): where it leads, how long it has left, and what a refused one
// means, in the web's words (packages/views/workspace/accept-invite/invite-error.tsx, invite-screens.tsx). Joining
// another organization is a switch the phone does not run: a person who still belongs to one finishes on the web
// (ADR 0032), so `switch` is a way out, not an error. Pure; the screens are components/workspace/invitation-*.tsx.
import { invitationWorkspaces, type InvitationPreview, type PendingInvitation } from "@uniwork/core/types/workspace";
import { pathOf } from "./unknown-shape";

/** An invitation that cannot be used any more, as the server words its state or its 410. */
export type GoneReason = "expired" | "revoked" | "accepted";

/** Why the server refused to show or join an invitation; `failed` when it said nothing this knows. */
export type InviteErrorReason =
  | "gone"
  | "deactivated"
  | "wrongAccount"
  | "unverified"
  | "suspended"
  | "deletionScheduled"
  | "rateLimited"
  | "busy"
  | "offline"
  | "failed";

export type InviteRefusal =
  /** The account still belongs to another organization: the switch is the web's. */
  | { kind: "switch" }
  | { kind: "gone"; reason: GoneReason }
  | { kind: "error"; reason: InviteErrorReason };

/** The server codes inviteRefusal turns into words: answers, not contract drift (data/report.ts). */
export const INVITE_HANDLED_CODES = [
  "organization_switch_required",
  "invitation_expired",
  "invitation_revoked",
  "invitation_accepted",
  "invitation_email_mismatch",
  "member_deactivated",
  "email_unverified",
  "organization_suspended",
  "organization_deletion_scheduled",
  "membership_busy",
  "not_found",
] as const;

const ERROR_CODES: Record<string, InviteErrorReason> = {
  not_found: "gone",
  member_deactivated: "deactivated",
  // The link was opened under another account than the address it was sent to: a forwarded link redeems nothing.
  invitation_email_mismatch: "wrongAccount",
  email_unverified: "unverified",
  organization_suspended: "suspended",
  organization_deletion_scheduled: "deletionScheduled",
  // Another change to the account's memberships is under way (a second tap, another device).
  membership_busy: "busy",
};

/** The gone reason of a preview's status or an accept's 410, or null for anything else. */
export function goneReason(value: unknown): GoneReason | null {
  switch (value) {
    case "expired":
    case "invitation_expired":
      return "expired";
    case "revoked":
    case "invitation_revoked":
      return "revoked";
    case "accepted":
    case "invitation_accepted":
      return "accepted";
    default:
      return null;
  }
}

/** What a refused preview or accept means. The bearer client keeps the server's envelope (data/api.ts › ApiError). */
export function inviteRefusal(err: unknown): InviteRefusal {
  const code = pathOf(err, "body", "error", "code");
  if (code === "organization_switch_required") return { kind: "switch" };
  const gone = goneReason(code);
  if (gone) return { kind: "gone", reason: gone };
  const known = typeof code === "string" ? ERROR_CODES[code] : undefined;
  if (known) return { kind: "error", reason: known };
  const status = pathOf(err, "status");
  if (status === 404) return { kind: "error", reason: "gone" };
  if (status === 429) return { kind: "error", reason: "rateLimited" };
  // 0 is no answer at all (data/api.ts).
  if (status === 0) return { kind: "error", reason: "offline" };
  return { kind: "error", reason: "failed" };
}

/** The sentence for an error reason; the network and the rate limit say what the rest of the app says. */
export function inviteErrorKey(reason: InviteErrorReason): string {
  switch (reason) {
    case "rateLimited":
      return "mobile.account.rate_limited";
    case "offline":
      return "mobile.account.offline";
    case "busy":
      return "invitations.switch.busy";
    default:
      return `workspace.acceptInviteError.${reason}`;
  }
}

/** The line under it that says what to do next, where there is one beyond trying again. */
export function inviteErrorHintKey(reason: InviteErrorReason): string | null {
  switch (reason) {
    case "gone":
      return "workspace.acceptInviteError.hint";
    case "wrongAccount":
      return "workspace.acceptInviteError.wrongAccountHint";
    case "suspended":
    case "deletionScheduled":
    case "deactivated":
      return "workspace.acceptInviteError.askInviterHint";
    default:
      return null;
  }
}

/** Whether trying again may work: a blip, not a verdict. */
export function inviteErrorRetries(reason: InviteErrorReason): boolean {
  return reason === "rateLimited" || reason === "busy" || reason === "offline" || reason === "failed";
}

/** The workspaces joining leads into, by name, in the order the server listed them; empty for the organization alone. */
export function invitationWorkspaceNames(invitation: Pick<PendingInvitation, "workspace" | "workspaces">): string[] {
  return invitationWorkspaces(invitation).map((workspace) => workspace.name);
}

/** What the screen shows of a preview: one to join (or to switch for, on the web), or one that no longer works. */
export type PreviewState = { kind: "pending"; switchFirst: boolean } | { kind: "gone"; reason: GoneReason };

export function previewState(preview: InvitationPreview): PreviewState {
  const gone = goneReason(preview.invitation.status);
  if (gone) return { kind: "gone", reason: gone };
  // Any organization standing in the way, whatever it needs (leave, transfer, close, or blocked), is the web's step.
  return { kind: "pending", switchFirst: preview.conflicts.length > 0 };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** An invitation this close to lapsing is flagged, so it is opened first (as the web's list does). */
const SOON_MS = 2 * DAY_MS;

/** Whole days left, at least one while it still runs; null when the date does not read or has passed. */
export function daysLeft(expiresAt: string, now: number): number | null {
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at) || at <= now) return null;
  return Math.max(1, Math.ceil((at - now) / DAY_MS));
}

export function expiresSoon(expiresAt: string, now: number): boolean {
  const at = Date.parse(expiresAt);
  return !Number.isNaN(at) && at > now && at - now < SOON_MS;
}

/** The label for an organization role; an unknown role shows as it came (packages/views/workspace/role-label.ts). */
export function roleKey(role: string): string | null {
  return role === "owner" || role === "admin" || role === "member" ? `people.role_${role}` : null;
}
