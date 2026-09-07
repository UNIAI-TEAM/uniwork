import type { JoinMeetingBody } from "@uniwork/core/api/endpoints/meetings";
import { setGuestSession } from "@uniwork/core/api/guest-session";
import type { JoinDecision } from "@uniwork/core/types/meeting";

export function inviteStorageKey(linkId: string, suffix: string): string {
  return `uw.meeting-invite.${linkId}.${suffix}`;
}

export function readInviteJoinBody(linkId: string): JoinMeetingBody | undefined {
  const secret = sessionStorage.getItem(inviteStorageKey(linkId, "secret")) ?? "";
  if (!secret) return undefined;
  const displayName = sessionStorage.getItem(inviteStorageKey(linkId, "displayName")) ?? "";
  return {
    invite_link_id: linkId,
    secret,
    display_name: displayName || undefined,
  };
}

export function readCachedJoinDecision(linkId: string): JoinDecision | undefined {
  const raw = sessionStorage.getItem(inviteStorageKey(linkId, "joinDecision"));
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as JoinDecision;
  } catch {
    return undefined;
  }
}

export function writeCachedJoinDecision(linkId: string, decision: JoinDecision): void {
  sessionStorage.setItem(inviteStorageKey(linkId, "joinDecision"), JSON.stringify(decision));
  if (decision.guest_session) {
    writeGuestSession(linkId, decision.guest_session);
  }
}

export function writeGuestSession(linkId: string, guestSession: string): void {
  const value = guestSession.trim();
  if (!value) return;
  sessionStorage.setItem(inviteStorageKey(linkId, "guestSession"), value);
  setGuestSession(value);
}

export function readGuestSession(linkId: string): string | undefined {
  let stored = sessionStorage.getItem(inviteStorageKey(linkId, "guestSession")) ?? "";
  if (!stored) {
    stored = readCachedJoinDecision(linkId)?.guest_session ?? "";
    if (stored) {
      sessionStorage.setItem(inviteStorageKey(linkId, "guestSession"), stored);
    }
  }
  if (stored) setGuestSession(stored);
  return stored || undefined;
}

export function writeInviteDisplayName(linkId: string, displayName: string): void {
  sessionStorage.setItem(inviteStorageKey(linkId, "displayName"), displayName.trim());
}

export function clearCachedJoinDecision(linkId: string): void {
  sessionStorage.removeItem(inviteStorageKey(linkId, "joinDecision"));
}
