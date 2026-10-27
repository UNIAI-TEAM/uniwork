import { PARTICIPANT_IDENTITY_PREFIX } from "../meeting-signals";

/** Mic and camera as they were on leaving: "Vào lại" brings them back the same. */
export type ExitMedia = { audio: boolean; video: boolean };

/** Why the room gave way to a leave screen (spec 2026-10-27 §2: A, B, C, D, F). */
export type RoomExit =
  | { kind: "left"; media: ExitMedia }
  | { kind: "leftHost"; media: ExitMedia }
  | { kind: "handedOver"; media: ExitMedia; toUserId: string; toName: string }
  | { kind: "ended"; at: string }
  | { kind: "removed"; at: string };

/** The kinds a viewer can come back from with "Vào lại". */
export function canRejoin(exit: RoomExit): exit is Extract<RoomExit, { media: ExitMedia }> {
  return exit.kind === "left" || exit.kind === "leftHost" || exit.kind === "handedOver";
}

/** The participant id in a LiveKit join token's `sub` (`uw_participant_<id>`); null for anything else. */
export function participantIdFromToken(token: string | undefined): string | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as { sub?: unknown };
    const sub = claims.sub;
    return typeof sub === "string" && sub.startsWith(PARTICIPANT_IDENTITY_PREFIX)
      ? sub.slice(PARTICIPANT_IDENTITY_PREFIX.length)
      : null;
  } catch {
    return null;
  }
}
