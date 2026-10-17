import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentEditLock } from "../api/endpoints/documents-edit-lock";
import { ApiError } from "../api/http";
import { heldEditLockId, heldEditLocks, releaseHeldEditLocks } from "./edit-lock-registry";
import { EditLockSession, newEditorId, type EditLockSessionState, type EditLockTransport } from "./edit-lock-session";

// UNI-1645 addendum §9 and edges 6 / 13, against a fake transport. Fake timers
// fake Date too, and the session reads Date.now() as its monotonic clock here,
// so vi.setSystemTime() models a sleeping machine: the clock jumps and no
// timer fires.

const lock = (over: Partial<DocumentEditLock> = {}): DocumentEditLock => ({
  lock_id: "L1",
  document_id: "d1",
  holder_id: "u1",
  client: "web_page",
  acquired_at: "2026-10-15T03:12:00Z",
  expires_at: "2026-10-15T03:14:00Z",
  granted_via: "acquire",
  heartbeat_interval_ms: 30_000,
  ttl_ms: 120_000,
  server_time: "2026-10-15T03:12:00Z",
  ...over,
});

const beat = (lockId = "L1") => ({ lock_id: lockId, expires_at: "2026-10-15T03:16:00Z", server_time: "2026-10-15T03:14:00Z" });
const lost = (reason: string, by?: { by_id: string; by_name: string }) =>
  new ApiError("lost", "edit_lock_lost", 409, undefined, { reason, ...by });
const offline = () => new TypeError("Failed to fetch");

function fakeTransport() {
  const transport = {
    acquire: vi.fn<EditLockTransport["acquire"]>(async () => lock()),
    heartbeat: vi.fn<EditLockTransport["heartbeat"]>(async (lockId) => beat(lockId)),
    release: vi.fn<EditLockTransport["release"]>(async () => undefined),
  };
  return transport;
}

function setup(over: { transport?: ReturnType<typeof fakeTransport>; canReclaim?: () => boolean | Promise<boolean> } = {}) {
  const transport = over.transport ?? fakeTransport();
  let wake: () => void = () => undefined;
  const session = new EditLockSession({
    documentId: "d1",
    client: "web_page",
    transport,
    editorId: "E1",
    now: () => Date.now(),
    onWake: (cb) => {
      wake = cb;
      return () => undefined;
    },
    canReclaim: over.canReclaim,
  });
  const states: EditLockSessionState[] = [];
  session.subscribe(() => states.push(session.getState()));
  return { session, transport, states, wake: () => wake() };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("EditLockSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T03:12:00Z"));
  });
  afterEach(async () => {
    vi.useRealTimers();
    // Locks a case left held: drop them without reaching the network.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await releaseHeldEditLocks(0);
    vi.unstubAllGlobals();
  });

  it("acquires on start with its editor id and becomes editable", async () => {
    const { session, transport } = setup();
    session.start();
    expect(session.getState()).toMatchObject({ phase: "acquiring", editable: false, readOnly: false });
    await flush();
    expect(transport.acquire).toHaveBeenCalledWith({ editor_id: "E1", client: "web_page" });
    expect(session.getState()).toMatchObject({ phase: "mine", editable: true, readOnly: false });
    expect(session.getState().lock?.lock_id).toBe("L1");
    expect(heldEditLocks()).toEqual([["d1", "L1"]]);
    // A restore or a new file version sent from outside the editor names this lock.
    expect(heldEditLockId("d1")).toBe("L1");
    expect(heldEditLockId("d2")).toBeUndefined();
  });

  it("acquiring never emits a read-only state, and turns slow after 1 s", async () => {
    let grant: (value: DocumentEditLock) => void = () => undefined;
    const transport = fakeTransport();
    transport.acquire.mockImplementationOnce(() => new Promise((resolve) => (grant = resolve)));
    const { session, states } = setup({ transport });
    session.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(session.getState().slow).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.getState()).toMatchObject({ phase: "acquiring", slow: true });
    grant(lock());
    await flush();
    const acquiring = states.filter((s) => s.phase === "acquiring");
    expect(acquiring.length).toBeGreaterThan(0);
    expect(acquiring.every((s) => !s.readOnly && !s.editable)).toBe(true);
    expect(session.getState()).toMatchObject({ phase: "mine", slow: false });
  });

  it("a 423 makes it read-only with the holder the server named", async () => {
    const transport = fakeTransport();
    transport.acquire.mockRejectedValueOnce(
      new ApiError("locked", "document_locked", 423, undefined, {
        holder_id: "u2",
        holder_name: "Bình",
        since: "2026-10-15T03:00:00Z",
        expires_at: "2026-10-15T03:20:00Z",
        offline_hold_until: "2026-10-15T11:00:00Z",
        held_by_me: false,
        current_revision: "42",
      }),
    );
    const { session } = setup({ transport });
    session.start();
    await flush();
    expect(session.getState()).toMatchObject({
      phase: "other",
      readOnly: true,
      editable: false,
      holder: { id: "u2", name: "Bình", offlineHoldUntil: "2026-10-15T11:00:00Z", heldByMe: false, currentRevision: "42" },
    });
    expect(heldEditLocks()).toEqual([]);
  });

  it("heartbeats every interval while held", async () => {
    const { session, transport } = setup();
    session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(30_000 * 4);
    expect(transport.heartbeat).toHaveBeenCalledTimes(4);
    expect(transport.heartbeat).toHaveBeenLastCalledWith("L1");
    expect(session.getState().phase).toBe("mine");
  });

  it("409 edit_lock_lost ends the hold with the reason and who took it", async () => {
    const transport = fakeTransport();
    transport.heartbeat.mockRejectedValueOnce(lost("taken_over", { by_id: "u3", by_name: "Chi" }));
    const { session } = setup({ transport });
    session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(session.getState()).toMatchObject({
      phase: "lost",
      readOnly: true,
      editable: false,
      lock: null,
      lostReason: "taken_over",
      lostBy: { id: "u3", name: "Chi" },
    });
    expect(heldEditLocks()).toEqual([]);
    // A lost lock is never heartbeaten again.
    await vi.advanceTimersByTimeAsync(300_000);
    expect(transport.heartbeat).toHaveBeenCalledTimes(1);
  });

  it("markLost (a write answered 423) ends a held lock like edit_lock_lost; ignored otherwise", async () => {
    const transport = fakeTransport();
    const { session } = setup({ transport });
    session.markLost("taken_over", { id: "u3", name: "Chi" });
    expect(session.getState().phase).toBe("idle");
    session.start();
    await flush();
    session.markLost("taken_over", { id: "u3", name: "Chi" });
    expect(session.getState()).toMatchObject({ phase: "lost", lock: null, lostReason: "taken_over", lostBy: { id: "u3", name: "Chi" } });
    expect(heldEditLocks()).toEqual([]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(transport.heartbeat).not.toHaveBeenCalled();
  });

  it("a 403/404 heartbeat ends it as access_lost", async () => {
    const transport = fakeTransport();
    transport.heartbeat.mockRejectedValueOnce(new ApiError("gone", "not_found", 404));
    const { session } = setup({ transport });
    session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(session.getState()).toMatchObject({ phase: "lost", lostReason: "access_lost" });
  });

  // Edge 6: offline with no hold. The server expires the lock after the TTL;
  // the editor turns read-only by its own clock once the TTL passes since the
  // last successful heartbeat, without waiting for any answer.
  it("heartbeat fails past TTL -> read-only, local content kept (edge 6)", async () => {
    const transport = fakeTransport();
    transport.heartbeat.mockRejectedValue(offline());
    const { session } = setup({ transport });
    session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(119_999);
    expect(session.getState().phase).toBe("mine");
    await vi.advanceTimersByTimeAsync(1);
    expect(session.getState()).toMatchObject({ phase: "lost", lostReason: "expired", readOnly: true, editable: false });
    // Nothing is released or discarded: the session only stops claiming the lock.
    expect(transport.release).not.toHaveBeenCalled();
  });

  it("a heartbeat that never answers still turns read-only at the TTL (edge 6)", async () => {
    const transport = fakeTransport();
    transport.heartbeat.mockImplementation(() => new Promise(() => undefined));
    const { session } = setup({ transport });
    session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(session.getState()).toMatchObject({ phase: "lost", lostReason: "expired" });
  });

  // Edge 13: a hidden tab's timers run about once a minute (Chrome intensive
  // throttling). TTL 120 s >= 2 x 60 s, so a 60 s cadence keeps the lock.
  it("a 60 s heartbeat cadence (throttled tab) keeps the lock (edge 13)", async () => {
    const transport = fakeTransport();
    transport.acquire.mockResolvedValueOnce(lock({ heartbeat_interval_ms: 60_000 }));
    const { session } = setup({ transport });
    session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(session.getState().phase).toBe("mine");
    expect(transport.heartbeat).toHaveBeenCalledTimes(10);
  });

  it("waking heartbeats at once instead of at the next beat (edge 13)", async () => {
    const { session, transport, wake } = setup();
    session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    wake();
    await flush();
    expect(transport.heartbeat).toHaveBeenCalledTimes(1);
    expect(session.getState().phase).toBe("mine");
  });

  it("after a 5 min sleep, a wake takes the lock back when the base is unchanged (edge 13)", async () => {
    const transport = fakeTransport();
    transport.heartbeat.mockRejectedValueOnce(lost("expired"));
    transport.acquire.mockResolvedValueOnce(lock()).mockResolvedValueOnce(lock({ lock_id: "L2" }));
    const canReclaim = vi.fn(() => true);
    const { session, wake } = setup({ transport, canReclaim });
    session.start();
    await flush();
    vi.setSystemTime(Date.now() + 5 * 60_000); // asleep: the clock moves, no timer fires
    wake();
    await flush();
    expect(transport.heartbeat).toHaveBeenCalledWith("L1");
    expect(canReclaim).toHaveBeenCalledTimes(1);
    expect(transport.acquire).toHaveBeenCalledTimes(2);
    expect(transport.acquire).toHaveBeenLastCalledWith({ editor_id: "E1", client: "web_page" });
    expect(session.getState()).toMatchObject({ phase: "mine", editable: true });
    expect(session.getState().lock?.lock_id).toBe("L2");
    expect(heldEditLocks()).toEqual([["d1", "L2"]]);
  });

  it("after a 5 min sleep, a moved base stays lost for the conflict path (edge 13)", async () => {
    const transport = fakeTransport();
    transport.heartbeat.mockRejectedValueOnce(lost("expired"));
    const { session, wake } = setup({ transport, canReclaim: () => false });
    session.start();
    await flush();
    vi.setSystemTime(Date.now() + 5 * 60_000);
    wake();
    await flush();
    expect(transport.acquire).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ phase: "lost", lostReason: "expired", baseChanged: true, readOnly: true });
    // A later wake does not try again: the host resolves the conflict.
    wake();
    await flush();
    expect(transport.heartbeat).toHaveBeenCalledTimes(1);
  });

  it("after a sleep, a lock the server still holds simply resumes", async () => {
    const { session, transport, wake } = setup();
    session.start();
    await flush();
    vi.setSystemTime(Date.now() + 3 * 60_000);
    wake();
    await flush();
    expect(transport.heartbeat).toHaveBeenCalledWith("L1");
    expect(transport.acquire).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ phase: "mine", lock: { lock_id: "L1" } });
  });

  it("after a sleep, a lock taken over meanwhile is not taken back", async () => {
    const transport = fakeTransport();
    transport.heartbeat.mockRejectedValueOnce(lost("taken_over", { by_id: "u3", by_name: "Chi" }));
    const { session, wake } = setup({ transport, canReclaim: () => true });
    session.start();
    await flush();
    vi.setSystemTime(Date.now() + 5 * 60_000);
    wake();
    await flush();
    expect(transport.acquire).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ phase: "lost", lostReason: "taken_over", lostBy: { id: "u3" } });
  });

  it("release deletes the tenure with keepalive and forgets it", async () => {
    const { session, transport } = setup();
    session.start();
    await flush();
    await session.release({ keepalive: true });
    expect(transport.release).toHaveBeenCalledWith("L1", { keepalive: true });
    expect(session.getState()).toMatchObject({ phase: "released", lock: null, editable: false, readOnly: false });
    expect(heldEditLocks()).toEqual([]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(transport.heartbeat).not.toHaveBeenCalled();
  });

  it("a release during R2 gives back the lock R2 grants late", async () => {
    let grant: (value: DocumentEditLock) => void = () => undefined;
    const transport = fakeTransport();
    transport.acquire.mockImplementationOnce(() => new Promise((resolve) => (grant = resolve)));
    const { session } = setup({ transport });
    session.start();
    await session.release();
    grant(lock());
    await flush();
    expect(transport.release).toHaveBeenCalledWith("L1", {});
    expect(session.getState().phase).toBe("released");
    expect(heldEditLocks()).toEqual([]);
  });

  it("moveHere acquires with move_from_self; adopt holds a take-over lock", async () => {
    const transport = fakeTransport();
    transport.acquire.mockRejectedValueOnce(new ApiError("locked", "document_locked", 423, undefined, { held_by_me: true }));
    transport.acquire.mockResolvedValueOnce(lock({ lock_id: "L2", granted_via: "move_here" }));
    const { session } = setup({ transport });
    session.start();
    await flush();
    expect(session.getState().holder?.heldByMe).toBe(true);
    await session.moveHere();
    expect(transport.acquire).toHaveBeenLastCalledWith({ editor_id: "E1", client: "web_page", move_from_self: true });
    expect(session.getState()).toMatchObject({ phase: "mine", lock: { lock_id: "L2" } });
    session.adopt(lock({ lock_id: "L3", granted_via: "take_over" }));
    expect(session.getState().lock?.lock_id).toBe("L3");
    expect(heldEditLocks()).toEqual(expect.arrayContaining([["d1", "L3"]]));
  });

  it("a network failure on R2 retries after the interval; a 403 does not", async () => {
    const transport = fakeTransport();
    transport.acquire.mockRejectedValueOnce(offline());
    const { session } = setup({ transport });
    session.start();
    await flush();
    expect(session.getState()).toMatchObject({ phase: "error", readOnly: false, editable: false });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(session.getState().phase).toBe("mine");

    const refusing = fakeTransport();
    refusing.acquire.mockRejectedValueOnce(new ApiError("no", "forbidden", 403));
    const second = setup({ transport: refusing });
    second.session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(second.session.getState()).toMatchObject({ phase: "error", errorCode: "forbidden" });
    expect(refusing.acquire).toHaveBeenCalledTimes(1);
  });

  it("a malformed R2 answer is an error, never a held lock", async () => {
    const transport = fakeTransport();
    transport.acquire.mockResolvedValueOnce(null);
    const { session } = setup({ transport });
    session.start();
    await flush();
    expect(session.getState()).toMatchObject({ phase: "error", lock: null, editable: false });
  });

  it("dispose stops timers and ignores late answers", async () => {
    const { session, transport, states } = setup();
    session.start();
    await flush();
    session.dispose();
    const seen = states.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(transport.heartbeat).not.toHaveBeenCalled();
    expect(states).toHaveLength(seen);
  });
});

describe("EditLockSession review fixes (CFE-1-6, CFE-1-7)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T03:12:00Z"));
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await releaseHeldEditLocks(0);
    vi.unstubAllGlobals();
  });

  it("CFE-1-6: acquire while acquiring is ignored unless it is moveFromSelf", async () => {
    let grant: (value: DocumentEditLock) => void = () => undefined;
    const transport = fakeTransport();
    transport.acquire.mockImplementationOnce(() => new Promise((resolve) => (grant = resolve)));
    const { session } = setup({ transport });
    session.start();
    void session.acquire();
    void session.acquire();
    expect(transport.acquire).toHaveBeenCalledTimes(1);
    grant(lock());
    await flush();
    expect(transport.release).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ phase: "mine", lock: { lock_id: "L1" } });
    expect(heldEditLocks()).toEqual([["d1", "L1"]]);
  });

  it("CFE-1-7: a failed moveHere from mine forgets the old lock id", async () => {
    const transport = fakeTransport();
    const { session } = setup({ transport });
    session.start();
    await flush();
    expect(heldEditLockId("d1")).toBe("L1");
    transport.acquire.mockRejectedValueOnce(new ApiError("locked", "document_locked", 423, undefined, { held_by_me: true }));
    await session.moveHere();
    expect(session.getState().phase).toBe("other");
    expect(heldEditLockId("d1")).toBeUndefined();
    expect(heldEditLocks()).toEqual([]);
  });
});

describe("EditLockSession review fixes (CFE-1-8, CFE-1-9, CFE-1-10)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T03:12:00Z"));
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await releaseHeldEditLocks(0);
    vi.unstubAllGlobals();
  });

  it("CFE-1-8: the TTL runs from when R2 was sent, not when it answered", async () => {
    let grant: (value: DocumentEditLock) => void = () => undefined;
    const transport = fakeTransport();
    transport.acquire.mockImplementationOnce(() => new Promise((resolve) => (grant = resolve)));
    transport.heartbeat.mockRejectedValue(offline());
    const { session } = setup({ transport });
    session.start();
    await vi.advanceTimersByTimeAsync(100_000);
    grant(lock());
    await vi.advanceTimersByTimeAsync(19_999);
    expect(session.getState().phase).toBe("mine");
    await vi.advanceTimersByTimeAsync(1);
    expect(session.getState()).toMatchObject({ phase: "lost", lostReason: "expired" });
  });

  it("CFE-1-8: a heartbeat stamps the deadline from its send time", async () => {
    let answer: (value: ReturnType<typeof beat>) => void = () => undefined;
    const transport = fakeTransport();
    transport.heartbeat.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    transport.heartbeat.mockRejectedValue(offline());
    const { session } = setup({ transport });
    session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(30_000); // beat sent at t=30 s
    await vi.advanceTimersByTimeAsync(60_000);
    answer(beat());
    await vi.advanceTimersByTimeAsync(59_999); // t=149.999 s
    expect(session.getState().phase).toBe("mine");
    await vi.advanceTimersByTimeAsync(1); // 30 s + 120 s
    expect(session.getState()).toMatchObject({ phase: "lost", lostReason: "expired" });
  });

  it.each([400, 409, 410, 413, 422])("CFE-1-9: R2 %i is a terminal error, never retried", async (status) => {
    const transport = fakeTransport();
    transport.acquire.mockRejectedValue(new ApiError("no", "refused", status));
    const { session } = setup({ transport });
    session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(transport.acquire).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ phase: "error", errorCode: "refused" });
  });

  it("CFE-1-9: R2 429 waits retry_after_s before retrying", async () => {
    const transport = fakeTransport();
    transport.acquire.mockRejectedValueOnce(new ApiError("slow", "rate_limited", 429, undefined, { retry_after_s: 7 }));
    const { session } = setup({ transport });
    session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(6_999);
    expect(transport.acquire).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.acquire).toHaveBeenCalledTimes(2);
    expect(session.getState().phase).toBe("mine");
  });

  it("CFE-1-10: a canReclaim rejection is swallowed and the lock stays lost", async () => {
    const transport = fakeTransport();
    transport.heartbeat.mockRejectedValueOnce(lost("expired"));
    const { session, wake } = setup({ transport, canReclaim: () => Promise.reject(new Error("boom")) });
    session.start();
    await flush();
    vi.setSystemTime(Date.now() + 5 * 60_000);
    wake();
    await flush();
    expect(session.getState()).toMatchObject({ phase: "lost", lostReason: "expired", baseChanged: true });
    expect(transport.acquire).toHaveBeenCalledTimes(1);
  });
});

describe("EditLockSession review fixes (CFE-1-4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T03:12:00Z"));
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await releaseHeldEditLocks(0);
    vi.unstubAllGlobals();
  });

  it("CFE-1-4: a heartbeat answered edit_lock_lost/expired reclaims quietly when the base is unchanged", async () => {
    const transport = fakeTransport();
    transport.heartbeat.mockRejectedValueOnce(lost("expired")).mockRejectedValueOnce(lost("expired"));
    transport.acquire.mockResolvedValueOnce(lock()).mockResolvedValueOnce(lock({ lock_id: "L2" }));
    const canReclaim = vi.fn(() => true);
    const { session } = setup({ transport, canReclaim });
    session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(canReclaim).toHaveBeenCalledTimes(1);
    expect(transport.acquire).toHaveBeenCalledTimes(2);
    expect(session.getState()).toMatchObject({ phase: "mine", lock: { lock_id: "L2" } });
    expect(heldEditLocks()).toEqual([["d1", "L2"]]);
  });

  it("CFE-1-4: the same answer with a moved base stays lost for the conflict path", async () => {
    const transport = fakeTransport();
    transport.heartbeat.mockRejectedValueOnce(lost("expired")).mockRejectedValueOnce(lost("expired"));
    const { session } = setup({ transport, canReclaim: () => false });
    session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.acquire).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ phase: "lost", lostReason: "expired", baseChanged: true });
  });

  it("CFE-1-4: a wake that arrives while a beat is in flight runs after it settles", async () => {
    let answer: (value: ReturnType<typeof beat>) => void = () => undefined;
    const transport = fakeTransport();
    transport.heartbeat.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const { session, wake } = setup({ transport });
    session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.heartbeat).toHaveBeenCalledTimes(1);
    wake();
    await flush();
    expect(transport.heartbeat).toHaveBeenCalledTimes(1);
    answer(beat());
    await flush();
    expect(transport.heartbeat).toHaveBeenCalledTimes(2);
    expect(session.getState().phase).toBe("mine");
  });

  it("CFE-2-2: a wake queued behind a beat that ends expired sends no beat on the lost session", async () => {
    let refuse: (err: unknown) => void = () => undefined;
    const transport = fakeTransport();
    transport.heartbeat
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (refuse = reject)))
      // The reclaim's own heartbeat of the old tenure: the server confirms it expired.
      .mockRejectedValueOnce(lost("expired"));
    const { session, wake } = setup({ transport, canReclaim: () => false });
    session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.heartbeat).toHaveBeenCalledTimes(1);
    wake();
    await flush();
    refuse(lost("expired"));
    await flush();
    expect(session.getState()).toMatchObject({ phase: "lost", lostReason: "expired", baseChanged: true });
    // One beat plus the reclaim's check: the queued wake did not become a third call.
    expect(transport.heartbeat).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(transport.heartbeat).toHaveBeenCalledTimes(2);
    expect(session.getState().phase).toBe("lost");
  });
});

describe("EditLockSession review fixes (CFE-1-3, CFE-1-5, CFE-1-11)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T03:12:00Z"));
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await releaseHeldEditLocks(0);
    vi.unstubAllGlobals();
  });

  it("CFE-1-3: a keepalive release during R2 sends the late grant's release with keepalive", async () => {
    let grant: (value: DocumentEditLock) => void = () => undefined;
    const transport = fakeTransport();
    transport.acquire.mockImplementationOnce(() => new Promise((resolve) => (grant = resolve)));
    const { session } = setup({ transport });
    session.start();
    await session.release({ keepalive: true });
    grant(lock());
    await flush();
    expect(transport.release).toHaveBeenCalledWith("L1", { keepalive: true });
  });

  it("CFE-2-4: a keepalive release during an R2 that then fails leaves nothing behind for a later op", async () => {
    let fail: (err: unknown) => void = () => undefined;
    const transport = fakeTransport();
    transport.acquire.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
    const { session } = setup({ transport });
    session.start();
    await session.release({ keepalive: true });
    fail(offline());
    await flush();
    // The op number of the failed R2 is gone: a grant that reuses no number must not be read as a pagehide one.
    expect((session as unknown as { keepaliveOps: Set<number> }).keepaliveOps.size).toBe(0);
    expect(transport.release).not.toHaveBeenCalled();
  });

  it("CFE-1-5: a remount whose R2 meets its own old tenure waits for that release and retries once", async () => {
    let grantOld: (value: DocumentEditLock) => void = () => undefined;
    const oldTransport = fakeTransport();
    oldTransport.acquire.mockImplementationOnce(() => new Promise((resolve) => (grantOld = resolve)));
    const old = setup({ transport: oldTransport }).session;
    old.start();
    await old.release();
    old.dispose();

    const transport = fakeTransport();
    transport.acquire
      .mockRejectedValueOnce(new ApiError("locked", "document_locked", 423, undefined, { held_by_me: true }))
      .mockResolvedValueOnce(lock({ lock_id: "L2" }));
    const fresh = setup({ transport }).session;
    fresh.start();
    await flush();
    // The old R2 was granted server-side; its answer (and release) is still on the way.
    expect(fresh.getState().phase).toBe("acquiring");
    grantOld(lock());
    await flush();
    expect(oldTransport.release).toHaveBeenCalledWith("L1", {});
    expect(transport.acquire).toHaveBeenCalledTimes(2);
    expect(fresh.getState()).toMatchObject({ phase: "mine", lock: { lock_id: "L2" } });
  });

  it("CFE-1-5: held_by_me with nothing of this tab settling is still the other-tab state", async () => {
    const transport = fakeTransport();
    transport.acquire.mockRejectedValueOnce(new ApiError("locked", "document_locked", 423, undefined, { held_by_me: true }));
    const { session } = setup({ transport });
    session.start();
    await flush();
    expect(session.getState()).toMatchObject({ phase: "other", holder: { heldByMe: true } });
    expect(transport.acquire).toHaveBeenCalledTimes(1);
  });

  it("CFE-1-11: adopt after dispose refuses", () => {
    const { session } = setup();
    session.dispose();
    expect(session.adopt(lock({ lock_id: "L3", granted_via: "take_over" }))).toBe(false);
  });
});

describe("newEditorId", () => {
  it("mints a 26-character Crockford ULID that sorts by time", () => {
    const a = newEditorId(1_000);
    const b = newEditorId(2_000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
  });
});
