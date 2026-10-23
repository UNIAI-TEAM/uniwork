import { describe, expect, it } from "vitest";
import type { DocumentEditLockState } from "@uniwork/core/api/endpoints/documents-edit-lock";
import { editLockBannerView, editLockHeaderHolder } from "./edit-lock-view-model";

// CFE-1-15: "not released" is only for a request that was declined or ran out.

const holder = { lock_id: "L1", holder_id: "u2", holder_name: "An", since: "2026-10-15T03:12:00Z", expires_at: "2026-10-15T03:14:00Z", reserved: false, held_by_me: false } as never;
const request = (over: Record<string, unknown>) => ({ request_id: "r1", document_id: "d1", requester_id: "me", requester_name: "Bình", holder_id: "u2", status: "pending", created_at: "2026-10-15T03:12:00Z", expires_at: "2999-01-01T00:00:00Z", ...over }) as never;
const state = (myRequest: unknown): DocumentEditLockState =>
  ({ lock: holder, my_request: myRequest, pending_requests: [], can_take_over: false, can_request: true, server_time: "2026-10-15T03:12:00Z" }) as DocumentEditLockState;
const view = (myRequest: unknown, notReleased = false) =>
  editLockBannerView({
    session: { phase: "other", holder: null, lostReason: null, lostBy: null },
    lockState: state(myRequest), showLost: false, notReleased, rateLimitedMinutes: null,
  });
const requestOf = (v: ReturnType<typeof view>) => (v.kind === "other" ? v.request : "n/a");

describe("editLockBannerView: the request this user sent", () => {
  it("a cancelled request leaves no 'still editing' note", () => {
    expect(requestOf(view(request({ status: "cancelled" })))).toBeNull();
  });
  it("a declined or expired request says the holder is still editing", () => {
    expect(requestOf(view(request({ status: "declined" })))).toEqual({ state: "notReleased" });
    expect(requestOf(view(request({ status: "expired" })))).toEqual({ state: "notReleased" });
  });
  it("a pending request past its expiry reads as expired", () => {
    expect(requestOf(view(request({ expires_at: "2000-01-01T00:00:00Z" })))).toEqual({ state: "notReleased" });
  });
  it("a live pending request is pending", () => {
    expect(requestOf(view(request({})))).toMatchObject({ state: "pending", requestId: "r1" });
  });
  it("the hook's own declined/expired signal still shows the note without a request row", () => {
    expect(requestOf(view(null, true))).toEqual({ state: "notReleased" });
  });
});

describe("editLockHeaderHolder (V3-9)", () => {
  const sessionHolder = {
    id: "me",
    name: "Minh",
    since: "2026-10-15T03:12:00Z",
    expiresAt: "2026-10-15T03:14:00Z",
    offlineHoldUntil: null,
    heldByMe: true,
    currentRevision: "3",
  };

  it("shows the holder for state 4 (self elsewhere) both before R1 settles and once R1 settles", () => {
    const beforeR1 = editLockHeaderHolder(
      { phase: "other", holder: sessionHolder, lostReason: null, lostBy: null },
      undefined,
    );
    expect(beforeR1).toEqual({ holder_name: "Minh", holder_avatar_url: null });

    const afterR1 = editLockHeaderHolder(
      { phase: "other", holder: sessionHolder, lostReason: null, lostBy: null },
      { ...state(null), lock: { ...(holder as object), holder_id: "me", holder_name: "Minh", held_by_me: true } as never },
    );
    expect(afterR1).toEqual({ holder_name: "Minh", holder_avatar_url: undefined });
  });

  it("hides the holder when this editor holds the lock, while acquiring, or when a handover is reserved for this user", () => {
    const selfLock = { ...state(null), lock: { ...(holder as object), holder_id: "me", holder_name: "Minh", held_by_me: true } as never };
    expect(editLockHeaderHolder({ phase: "mine", holder: null, lostReason: null, lostBy: null }, selfLock)).toBeNull();
    expect(editLockHeaderHolder({ phase: "acquiring", holder: null, lostReason: null, lostBy: null }, selfLock)).toBeNull();
    const reservedLock = { ...state(null), lock: { ...(holder as object), holder_id: "me", holder_name: "Minh", held_by_me: true, reserved: true } as never };
    expect(editLockHeaderHolder({ phase: "other", holder: sessionHolder, lostReason: null, lostBy: null }, reservedLock)).toBeNull();
  });
});
