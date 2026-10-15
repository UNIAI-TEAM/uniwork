import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentEditLock } from "../api/endpoints/documents-edit-lock";
import { ApiError } from "../api/http";
import { heldEditLocks, releaseHeldEditLocks } from "./edit-lock-registry";
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

function setup(over: { transport?: ReturnType<typeof fakeTransport>; canReclaim?: () => boolean } = {}) {
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

describe("newEditorId", () => {
  it("mints a 26-character Crockford ULID that sorts by time", () => {
    const a = newEditorId(1_000);
    const b = newEditorId(2_000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
  });
});
