import type { DocumentEditLockState } from "@uniwork/core/api/endpoints/documents-edit-lock";
import type { useDocumentEditLock } from "@uniwork/core/documents/hooks-edit-lock";

type EditLockSessionState = ReturnType<typeof useDocumentEditLock>["state"];

// What the edit-lock banner says (addendum §11.3), derived from this editor's
// session and the R1 state. R1 is the truth once it is read: a lock frame
// refetches it, so "free" and "someone else" follow the server, not the 423
// that first made the editor read-only.

/** A lost lock the banner still names (the Office frame has no dialog of its own yet). */
export interface EditLockLostNote {
  reason: string | null;
  byName: string;
}

export type EditLockRequestView =
  | { state: "pending"; requestId: string; expiresAt: string }
  | { state: "notReleased" };

export type EditLockBannerView =
  /** Acquiring, holding, released, or a cannot-edit reader: nothing to say. */
  | { kind: "none" }
  /** R2 failed for another reason; the session retries by itself. */
  | { kind: "error" }
  | { kind: "free"; lost?: EditLockLostNote }
  | { kind: "selfElsewhere"; lost?: EditLockLostNote }
  | {
      kind: "other";
      holderName: string;
      since: string;
      offlineHoldUntil: string | null;
      /** manage: "Take over editing". */
      canTakeOver: boolean;
      /** edit: "Request to edit" (a manager takes over instead). */
      canRequest: boolean;
      request: EditLockRequestView | null;
      rateLimitedMinutes: number | null;
      lost?: EditLockLostNote;
    };

export interface EditLockViewInput {
  session: Pick<EditLockSessionState, "phase" | "holder" | "lostReason" | "lostBy">;
  /** The R1 query data: undefined until read, null when malformed. */
  lockState: DocumentEditLockState | null | undefined;
  /** Keep a lost lock's reason on the banner (Office frame; a page uses the dialog instead). */
  showLost: boolean;
  /** The request this user sent was answered "decline" or ran out. */
  notReleased: boolean;
  /** 429 edit_request_rate_limited: minutes until another request may go. */
  rateLimitedMinutes: number | null;
}

export function editLockBannerView(input: EditLockViewInput): EditLockBannerView {
  const { session, lockState, showLost } = input;
  switch (session.phase) {
    case "other":
    case "lost":
      break;
    case "error":
      return { kind: "error" };
    default:
      return { kind: "none" };
  }
  // A revoked session goes the sign-out path; it never explains itself here.
  if (session.phase === "lost" && session.lostReason === "session_revoked") return { kind: "none" };
  const lost = session.phase === "lost" && showLost
    ? { reason: session.lostReason, byName: session.lostBy?.name ?? "" }
    : undefined;
  const withLost = <T extends object>(view: T): T => (lost ? { ...view, lost } : view);

  if (!lockState) {
    // R1 not read yet (or malformed): the 423's holder is all there is.
    const holder = session.holder;
    if (!holder) return withLost({ kind: "free" as const });
    if (holder.heldByMe) return withLost({ kind: "selfElsewhere" as const });
    return withLost({
      kind: "other" as const, holderName: holder.name, since: holder.since, offlineHoldUntil: holder.offlineHoldUntil,
      canTakeOver: false, canRequest: false, request: null, rateLimitedMinutes: null,
    });
  }

  const lock = lockState.lock;
  if (!lock) return withLost({ kind: "free" as const });
  // A handover reserved for this user: the hook claims it now.
  if (lock.reserved && lock.held_by_me) return { kind: "none" };
  if (lock.held_by_me) return withLost({ kind: "selfElsewhere" as const });

  const mine = lockState.my_request;
  const pending = mine && mine.status === "pending" && !(Date.parse(mine.expires_at) <= Date.now());
  const request: EditLockRequestView | null = pending
    ? { state: "pending", requestId: mine.request_id, expiresAt: mine.expires_at }
    : input.notReleased || mine ? { state: "notReleased" } : null;
  return withLost({
    kind: "other" as const,
    holderName: lock.holder_name,
    since: lock.since,
    offlineHoldUntil: lock.offline_hold_until ?? null,
    canTakeOver: lockState.can_take_over,
    canRequest: !lockState.can_take_over && (lockState.can_request || request?.state === "notReleased"),
    request,
    rateLimitedMinutes: input.rateLimitedMinutes,
  });
}
