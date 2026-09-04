import type { JoinMeetingBody } from "@uniwork/core/api/endpoints/meetings";
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
}

export function clearCachedJoinDecision(linkId: string): void {
  sessionStorage.removeItem(inviteStorageKey(linkId, "joinDecision"));
}
