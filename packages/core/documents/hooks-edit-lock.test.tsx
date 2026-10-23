import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { releaseHeldEditLocks } from "./edit-lock-registry";
import { useDocumentEditLock } from "./hooks-edit-lock";

// UNI-1645: the hook wires EditLockSession to the endpoints and the R1 query.
// The transport is a routed fake fetch; the session's timers never fire here.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const lock = (lockId: string, over: Record<string, unknown> = {}) => ({
  lock_id: lockId,
  document_id: "d1",
  holder_id: "me",
  client: "web_page",
  acquired_at: "2026-10-15T03:12:00Z",
  expires_at: "2026-10-15T03:14:00Z",
  granted_via: "acquire",
  heartbeat_interval_ms: 30000,
  ttl_ms: 120000,
  server_time: "2026-10-15T03:12:00Z",
  ...over,
});

const summary = (over: Record<string, unknown> = {}) => ({
  holder_id: "u2",
  holder_name: "Bình",
  since: "2026-10-15T03:00:00Z",
  expires_at: "2026-10-15T03:14:00Z",
  reserved: false,
  held_by_me: false,
  ...over,
});

const r1 = (over: Record<string, unknown> = {}) => ({
  lock: summary({ holder_id: "me", held_by_me: true }),
  my_request: null,
  pending_requests: [],
  can_take_over: false,
  can_request: false,
  server_time: "2026-10-15T03:12:00Z",
  ...over,
});

const locked = () =>
  json({ error: { code: "document_locked", message: "locked", fields: { holder_id: "u2", holder_name: "Bình", held_by_me: false } } }, 423);

type Handler = () => Response;
function routes(table: Record<string, Handler[]>) {
  const calls: { key: string; init: RequestInit }[] = [];
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${new URL(String(input)).pathname}`;
    calls.push({ key, init });
    const queue = table[key];
    const handler = queue && (queue.length > 1 ? queue.shift() : queue[0]);
    if (!handler) throw new Error(`unexpected ${key}`);
    return handler();
  });
  return calls;
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const BASE = "/api/v1/documents/d1/edit-lock";

describe("useDocumentEditLock (UNI-1645)", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(async () => {
    await releaseHeldEditLocks(0);
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("acquires for an editor, exposes the lock id and releases on unmount", async () => {
    const calls = routes({
      [`GET ${BASE}`]: [() => json(r1())],
      [`POST ${BASE}`]: [() => json(lock("L1"), 201)],
      [`DELETE ${BASE}/L1`]: [() => new Response(null, { status: 204 })],
    });
    const { wrapper } = setup();
    const { result, unmount } = renderHook(() => useDocumentEditLock("w1", "d1", { canEdit: true, client: "web_page" }), { wrapper });
    await waitFor(() => expect(result.current.editLockId).toBe("L1"));
    expect(result.current.state).toMatchObject({ phase: "mine", editable: true });
    await waitFor(() => expect(result.current.lockState.data?.lock?.held_by_me).toBe(true));
    const post = calls.find((c) => c.key === `POST ${BASE}`);
    expect(JSON.parse(String(post?.init.body))).toMatchObject({ client: "web_page", editor_id: expect.stringMatching(/^[0-9A-Z]{26}$/) });
    unmount();
    await waitFor(() => expect(calls.some((c) => c.key === `DELETE ${BASE}/L1`)).toBe(true));
  });

  it("a viewer reads the state but never asks for the lock", async () => {
    const calls = routes({ [`GET ${BASE}`]: [() => json(r1({ lock: summary(), can_request: false }))] });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentEditLock("w1", "d1", { canEdit: false, client: "web_page" }), { wrapper });
    await waitFor(() => expect(result.current.lockState.data?.lock?.holder_name).toBe("Bình"));
    expect(result.current.state).toMatchObject({ phase: "idle", readOnly: false, editable: false });
    expect(calls.every((c) => c.key === `GET ${BASE}`)).toBe(true);
  });

  it("pagehide releases with keepalive", async () => {
    const calls = routes({
      [`GET ${BASE}`]: [() => json(r1())],
      [`POST ${BASE}`]: [() => json(lock("L1"), 201)],
      [`DELETE ${BASE}/L1`]: [() => new Response(null, { status: 204 })],
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentEditLock("w1", "d1", { canEdit: true, client: "web_page" }), { wrapper });
    await waitFor(() => expect(result.current.editLockId).toBe("L1"));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await waitFor(() => expect(result.current.state.phase).toBe("released"));
    expect(calls.find((c) => c.key === `DELETE ${BASE}/L1`)?.init.keepalive).toBe(true);
  });

  it("take-over sends the R1 lock id as expected_lock_id and holds the new tenure", async () => {
    const calls = routes({
      [`GET ${BASE}`]: [() => json(r1({ lock: summary({ lock_id: "L0" }), can_take_over: true }))],
      [`POST ${BASE}`]: [locked],
      [`POST ${BASE}/take-over`]: [() => json(lock("L5", { granted_via: "take_over" }), 201)],
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentEditLock("w1", "d1", { canEdit: true, client: "web_office" }), { wrapper });
    await waitFor(() => expect(result.current.state.phase).toBe("other"));
    await waitFor(() => expect(result.current.lockState.data?.lock?.lock_id).toBe("L0"));
    await act(async () => {
      await result.current.takeOver.mutateAsync(undefined);
    });
    const body = JSON.parse(String(calls.find((c) => c.key === `POST ${BASE}/take-over`)?.init.body));
    expect(body).toMatchObject({ client: "web_office", expected_lock_id: "L0" });
    await waitFor(() => expect(result.current.editLockId).toBe("L5"));
  });

  it("CFE-1-3: a bfcache restore (pageshow persisted) after pagehide acquires a fresh lock", async () => {
    const calls = routes({
      [`GET ${BASE}`]: [() => json(r1())],
      [`POST ${BASE}`]: [() => json(lock("L1"), 201), () => json(lock("L2"), 201)],
      [`DELETE ${BASE}/L1`]: [() => new Response(null, { status: 204 })],
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentEditLock("w1", "d1", { canEdit: true, client: "web_page" }), { wrapper });
    await waitFor(() => expect(result.current.editLockId).toBe("L1"));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await waitFor(() => expect(result.current.state.phase).toBe("released"));
    // A pageshow that is not a bfcache restore changes nothing.
    act(() => {
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
    });
    expect(calls.filter((c) => c.key === `POST ${BASE}`)).toHaveLength(1);
    act(() => {
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    });
    await waitFor(() => expect(result.current.editLockId).toBe("L2"));
    expect(result.current.state).toMatchObject({ phase: "mine", editable: true });
  });

  it("CFE-2-2: R2 still flying across pagehide + pageshow: the late grant is released with keepalive and the new session ends mine", async () => {
    const heldByMe = () =>
      json({ error: { code: "document_locked", message: "locked", fields: { holder_id: "me", holder_name: "Tôi", held_by_me: true } } }, 423);
    const calls = routes({
      [`GET ${BASE}`]: [() => json(r1())],
      // 1st: the R2 that is still flying at pagehide; 2nd: the new session meets that tenure; 3rd: after its release.
      [`POST ${BASE}`]: [() => json(lock("L1"), 201), heldByMe, () => json(lock("L2"), 201)],
      [`DELETE ${BASE}/L1`]: [() => new Response(null, { status: 204 })],
    });
    const route = vi.mocked(fetch).getMockImplementation();
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let posts = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const first = init?.method === "POST" && String(input).endsWith(BASE) && ++posts === 1;
      const answer = route!(input, init);
      if (first) await gate;
      return answer;
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentEditLock("w1", "d1", { canEdit: true, client: "web_page" }), { wrapper });
    await waitFor(() => expect(calls.filter((c) => c.key === `POST ${BASE}`)).toHaveLength(1));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await waitFor(() => expect(result.current.state.phase).toBe("released"));
    act(() => {
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    });
    await waitFor(() => expect(calls.filter((c) => c.key === `POST ${BASE}`)).toHaveLength(2));
    // The new session waits for the old R2 to settle instead of reading its own tenure as another tab's.
    expect(result.current.state.phase).toBe("acquiring");
    open();
    await waitFor(() => expect(result.current.editLockId).toBe("L2"));
    expect(result.current.state).toMatchObject({ phase: "mine", editable: true });
    expect(calls.find((c) => c.key === `DELETE ${BASE}/L1`)?.init.keepalive).toBe(true);
  });

  it("CFE-1-11: a take-over granted after unmount is released, not leaked", async () => {
    const calls = routes({
      [`GET ${BASE}`]: [() => json(r1({ lock: summary({ lock_id: "L0" }), can_take_over: true }))],
      [`POST ${BASE}`]: [locked],
      [`POST ${BASE}/take-over`]: [() => json(lock("L5", { granted_via: "take_over" }), 201)],
      [`DELETE ${BASE}/L5`]: [() => new Response(null, { status: 204 })],
    });
    const route = vi.mocked(fetch).getMockImplementation();
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/take-over")) await gate;
      return route!(input, init);
    });
    const { wrapper } = setup();
    const { result, unmount } = renderHook(() => useDocumentEditLock("w1", "d1", { canEdit: true, client: "web_office" }), { wrapper });
    await waitFor(() => expect(result.current.state.phase).toBe("other"));
    await waitFor(() => expect(result.current.lockState.data?.lock?.lock_id).toBe("L0"));
    const pending = result.current.takeOver.mutateAsync(undefined).catch(() => undefined);
    unmount();
    open();
    await pending;
    await waitFor(() => expect(calls.some((c) => c.key === `DELETE ${BASE}/L5`)).toBe(true));
  });

  it("claims a handover reserved for this user once R1 shows it", async () => {
    let reserved = false;
    routes({
      [`GET ${BASE}`]: [() => json(r1({ lock: reserved ? summary({ reserved: true, held_by_me: true }) : summary() }))],
      [`POST ${BASE}`]: [locked, () => json(lock("L7", { granted_via: "handover" }))],
    });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useDocumentEditLock("w1", "d1", { canEdit: true, client: "web_page" }), { wrapper });
    await waitFor(() => expect(result.current.state.phase).toBe("other"));
    reserved = true;
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["documents", "w1", "edit-lock", "d1"] });
    });
    await waitFor(() => expect(result.current.editLockId).toBe("L7"));
  });

  it("request, cancel and answer go through the edit-request routes", async () => {
    const request = { request_id: "r1", document_id: "d1", requester_id: "u2", requester_name: "Bình", holder_id: "me", status: "pending", created_at: "x", expires_at: "y" };
    const calls = routes({
      [`GET ${BASE}`]: [() => json(r1())],
      [`POST ${BASE}`]: [() => json(lock("L1"), 201)],
      ["POST /api/v1/documents/d1/edit-requests"]: [() => json(request, 201)],
      ["DELETE /api/v1/documents/d1/edit-requests/r1"]: [() => new Response(null, { status: 204 })],
      ["POST /api/v1/documents/d1/edit-requests/r1/answer"]: [() => json({ ...request, status: "declined" })],
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentEditLock("w1", "d1", { canEdit: true, client: "web_page" }), { wrapper });
    await waitFor(() => expect(result.current.editLockId).toBe("L1"));
    await act(async () => {
      await result.current.requestEdit.mutateAsync();
      await result.current.cancelRequest.mutateAsync("r1");
      await result.current.answerRequest.mutateAsync({ requestId: "r1", decision: "decline" });
    });
    const answer = calls.find((c) => c.key === "POST /api/v1/documents/d1/edit-requests/r1/answer");
    expect(JSON.parse(String(answer?.init.body))).toEqual({ decision: "decline", lock_id: "L1" });
    expect(calls.some((c) => c.key === "DELETE /api/v1/documents/d1/edit-requests/r1")).toBe(true);
  });
  describe("another holder's lease runs out", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 20 });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    // Mounts as a second editor against a held lock and waits until the
    // phase-change refetches have settled, so later GETs are the deadline's.
    async function mountOther(over: Record<string, unknown>) {
      const calls = routes({
        [`GET ${BASE}`]: [() => json(r1({ lock: summary(over) }))],
        [`POST ${BASE}`]: [locked],
      });
      const { wrapper } = setup();
      const view = renderHook(() => useDocumentEditLock("w1", "d1", { canEdit: true, client: "web_page" }), { wrapper });
      await waitFor(() => expect(view.result.current.state.phase).toBe("other"));
      await waitFor(() => expect(view.result.current.lockState.data?.lock?.holder_name).toBe("Bình"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      const reads = () => calls.filter((c) => c.key === `GET ${BASE}`).length;
      return { ...view, reads, baseline: reads() };
    }

    it("rereads R1 once, with grace, when expires_at passes", async () => {
      // server_time 03:12:00, expires_at 03:14:00: 120 s + 2 s grace.
      const { reads, baseline } = await mountOther({});
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(reads()).toBe(baseline);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_500);
      });
      await waitFor(() => expect(reads()).toBe(baseline + 1));
    });

    it("waits for an offline hold that outlasts expires_at", async () => {
      const { reads, baseline } = await mountOther({ offline_hold_until: "2026-10-15T03:20:00Z" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200_000);
      });
      expect(reads()).toBe(baseline);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(285_000);
      });
      await waitFor(() => expect(reads()).toBe(baseline + 1));
    });

    it("clears the timer on unmount", async () => {
      const { reads, baseline, unmount } = await mountOther({});
      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300_000);
      });
      expect(reads()).toBe(baseline);
    });
  });
});
