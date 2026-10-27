import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../../api/session";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import type { Meeting } from "../../types/meeting";
import { memoryRecordingStore, type RecordingStore } from "./store";
import { useSendRecording } from "./use-send-recording";

const API = "http://api.test";
const T0 = Date.parse("2026-10-28T08:00:00Z");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refusal = (status: number, code: string) => json({ error: { code, message: code } }, status);

const meeting = (status: string): Meeting => ({
  id: "m1",
  workspace_id: "ws1",
  title: "Giao ban",
  description: "",
  starts_at: "2026-10-28T08:00:00Z",
  ends_at: "2026-10-28T09:00:00Z",
  room_name: "",
  created_by: "u1",
  status,
  venue: "in_person",
});

type Call = { method: string; path: string; body: unknown };
type Route = (call: Call) => Response | undefined | void | Promise<Response | undefined>;

/** A fake server behind the real transport: `route` answers first, the defaults after it. */
function fakeServer(route: Route = () => undefined) {
  const calls: Call[] = [];
  let sessions = 0;
  const completed = new Set<string>();
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const call = { method, path: url.host === "s3.test" ? `s3:${url.pathname}` : url.pathname, body };
    calls.push(call);
    const answer = await route(call);
    if (answer) return answer;
    const sess = /\/upload-sessions\/([^/]+)/.exec(url.pathname)?.[1] ?? "";
    const snapshot = (id: string) => ({
      session_id: id,
      status: "open",
      part_size: 1024,
      total_parts: 1,
      completed_parts: completed.has(id) ? [{ part_number: 1, etag: '"e1"' }] : [],
      parts: [{ part_number: 1, url: `https://s3.test/${id}/part-1`, expires_at: "2099-01-01T00:00:00Z" }],
      expires_at: "2099-01-01T00:00:00Z",
    });
    if (method === "POST" && call.path === "/api/v1/meetings/m1/held") return json({ meeting: meeting("ENDED") });
    if (method === "GET" && call.path === "/api/v1/meetings/m1") return json({ meeting: meeting("ENDED") });
    if (method === "POST" && call.path === "/api/v1/meetings/m1/audio-upload-sessions") {
      sessions += 1;
      return json(snapshot(`sess-${sessions}`), 201);
    }
    if (method === "PUT" && call.path.startsWith("s3:")) {
      completed.add(call.path.split("/")[1]!);
      return new Response(null, { status: 200, headers: { ETag: '"e1"' } });
    }
    if (method === "GET" && call.path.startsWith("/api/v1/upload-sessions/")) return json(snapshot(sess));
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (method === "POST" && call.path.endsWith("/complete")) {
      return json({ upload_id: `up-${sess}`, checksum_sha256: "c", size_bytes: 1, claim_expires_at: "2099-01-01T00:00:00Z" });
    }
    if (method === "POST" && call.path === "/api/v1/meetings/m1/transcriptions") {
      return json({ transcription: { id: `t-${calls.length}`, meeting_id: "m1", status: "QUEUED" } }, 201);
    }
    throw new Error(`Unexpected ${method} ${call.path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, paths: () => calls.map((c) => `${c.method} ${c.path}`) };
}

let run = 0;
/** Two parts: 0–1450 s, then 1500–2538 s from the first start. Ids differ per test so no upload record leaks. */
async function twoParts(store: RecordingStore, mimeType = "audio/webm"): Promise<[string, string]> {
  run += 1;
  const ids: [string, string] = [`p1-${run}`, `p2-${run}`];
  const spans: Array<[number, number, number]> = [
    [0, 1_450_000, 0],
    [1_500_000, 2_538_000, 1500],
  ];
  for (const [i, [from, to, offsetSeconds]] of spans.entries()) {
    const id = ids[i]!;
    await store.createPart({
      id,
      userId: "u1",
      meetingId: "m1",
      startedAt: T0 + from,
      lastChunkAt: T0 + from,
      endedAt: null,
      mimeType,
      bytes: 0,
      language: "vi",
      offsetSeconds,
    });
    await store.appendChunk(id, 0, new Blob([`audio-${i}`]), T0 + to);
    await store.finishPart(id, T0 + to);
  }
  return ids;
}

function renderSend(store: RecordingStore, status = "SCHEDULED") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useSendRecording({ workspaceId: "ws1", meeting: meeting(status), userId: "u1", store }), { wrapper });
}

describe("useSendRecording", () => {
  beforeEach(() => {
    setAccessToken("tok");
    configureRuntime({ apiUrl: API });
    // Part bytes go through fetch, not XHR, so the fake server sees them.
    vi.stubGlobal("XMLHttpRequest", undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
    resetRuntimeConfig();
  });

  it("records the meeting held by duration, then sends each part with its offset", async () => {
    const store = memoryRecordingStore();
    const [p1] = await twoParts(store);
    const server = fakeServer();
    const { result } = renderSend(store);
    await act(() => result.current.send());

    expect(result.current.phase).toBe("done");
    expect(result.current.percent).toBe(100);
    expect(await store.listParts("u1", "m1")).toEqual([]);
    const paths = server.paths().filter((p) => !p.startsWith("PUT") && !p.includes("/complete"));
    expect(paths).toEqual([
      "POST /api/v1/meetings/m1/held",
      "POST /api/v1/meetings/m1/audio-upload-sessions",
      "POST /api/v1/meetings/m1/transcriptions",
      "POST /api/v1/meetings/m1/audio-upload-sessions",
      "POST /api/v1/meetings/m1/transcriptions",
    ]);
    expect(server.calls[0]!.body).toEqual({ duration_seconds: 2538 });
    const open = server.calls.find((c) => c.path.endsWith("audio-upload-sessions"))!;
    expect(open.body).toMatchObject({ filename: `ghi-am-${p1}.webm`, duration_seconds: 1450 });
    const queued = server.calls.filter((c) => c.path.endsWith("/transcriptions")).map((c) => c.body);
    expect(queued).toEqual([
      { upload_id: "up-sess-1", language: "vi", consent: true, duration_seconds: 1450, offset_seconds: 0 },
      { upload_id: "up-sess-2", language: "vi", consent: true, duration_seconds: 1038, offset_seconds: 1500 },
    ]);
  });

  it("skips record-held when the meeting already ended", async () => {
    const store = memoryRecordingStore();
    await twoParts(store);
    const server = fakeServer();
    const { result } = renderSend(store, "ENDED");
    await act(() => result.current.send());
    expect(result.current.phase).toBe("done");
    expect(server.paths()).not.toContain("POST /api/v1/meetings/m1/held");
  });

  it("continues when record-held answers invalid_meeting_state", async () => {
    const store = memoryRecordingStore();
    await twoParts(store);
    const server = fakeServer((c) => (c.path === "/api/v1/meetings/m1/held" ? refusal(409, "invalid_meeting_state") : undefined));
    const { result } = renderSend(store);
    await act(() => result.current.send());
    expect(result.current.phase).toBe("done");
    expect(server.paths().slice(0, 2)).toEqual(["POST /api/v1/meetings/m1/held", "GET /api/v1/meetings/m1"]);
    expect(await store.listParts("u1", "m1")).toEqual([]);
  });

  it("fails when record-held is refused and the meeting has not ended", async () => {
    const store = memoryRecordingStore();
    await twoParts(store);
    fakeServer((c) => {
      if (c.path === "/api/v1/meetings/m1/held") return refusal(409, "invalid_meeting_state");
      if (c.method === "GET" && c.path === "/api/v1/meetings/m1") return json({ meeting: meeting("LIVE") });
    });
    const { result } = renderSend(store);
    await act(() => result.current.send());
    expect(result.current.phase).toBe("failed");
    expect(await store.listParts("u1", "m1")).toHaveLength(2);
  });

  it("waits offline and resumes on the online event", async () => {
    const store = memoryRecordingStore();
    await twoParts(store);
    let drop = true;
    const server = fakeServer((c) => {
      if (drop && c.path.endsWith("/transcriptions")) {
        drop = false;
        throw new TypeError("Failed to fetch");
      }
    });
    const { result } = renderSend(store, "ENDED");
    await act(() => result.current.send());
    expect(result.current.phase).toBe("waiting");
    expect(result.current.error).toBeInstanceOf(TypeError);
    expect(await store.listParts("u1", "m1")).toHaveLength(2);

    act(() => void window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(await store.listParts("u1", "m1")).toEqual([]);
    // The staged first part is queued again without sending its bytes twice.
    expect(server.paths().filter((p) => p.startsWith("PUT"))).toHaveLength(2);
  });

  it("a part whose queue answer was lost counts as sent", async () => {
    const store = memoryRecordingStore();
    await twoParts(store);
    // The server queues each upload once; the answer to the first is lost on the way back.
    const queued: string[] = [];
    fakeServer((c) => {
      if (!c.path.endsWith("/transcriptions")) return;
      const id = (c.body as { upload_id: string }).upload_id;
      if (queued.includes(id)) return refusal(409, "transcription_in_progress");
      queued.push(id);
      if (id === "up-sess-1") throw new TypeError("Failed to fetch");
    });
    const { result } = renderSend(store, "ENDED");
    await act(() => result.current.send());
    expect(result.current.phase).toBe("waiting");

    act(() => void window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(await store.listParts("u1", "m1")).toEqual([]);
    expect(queued).toEqual(["up-sess-1", "up-sess-2"]);
    expect(result.current.sentBytes).toBe(result.current.totalBytes);
  });

  it("a stalled send retries on its own while the browser says it is online", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const store = memoryRecordingStore();
      await twoParts(store);
      let drops = 2;
      const server = fakeServer((c) => {
        if (c.path.endsWith("audio-upload-sessions") && drops > 0) {
          drops -= 1;
          throw new TypeError("Failed to fetch");
        }
      });
      const opens = () => server.paths().filter((p) => p.endsWith("audio-upload-sessions")).length;
      const { result } = renderSend(store, "ENDED");
      await act(() => result.current.send());
      expect(navigator.onLine).toBe(true);
      expect(result.current.phase).toBe("waiting");

      await act(() => vi.advanceTimersByTimeAsync(9_999));
      expect(opens()).toBe(1);
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(opens()).toBe(2);
      expect(result.current.phase).toBe("waiting");

      // The second wait is 30 s.
      await act(() => vi.advanceTimersByTimeAsync(29_999));
      expect(opens()).toBe(2);
      await act(() => vi.advanceTimersByTimeAsync(1));
      await vi.waitFor(() => expect(result.current.phase).toBe("done"));
      expect(await store.listParts("u1", "m1")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rebuilds the same File key on retry", async () => {
    const store = memoryRecordingStore();
    const [p1] = await twoParts(store);
    let drop = true;
    const server = fakeServer((c) => {
      if (drop && c.path.endsWith("/complete")) {
        drop = false;
        throw new TypeError("Failed to fetch");
      }
    });
    const first = renderSend(store, "ENDED");
    await act(() => first.result.current.send());
    expect(first.result.current.phase).toBe("waiting");
    first.unmount();

    // A reload: a new hook reads the part again and builds a new File from it.
    const second = renderSend(store, "ENDED");
    await act(() => second.result.current.send());
    expect(second.result.current.phase).toBe("done");
    const opens = server.calls.filter((c) => c.path.endsWith("audio-upload-sessions"));
    expect(opens[0]!.body).toMatchObject({ filename: `ghi-am-${p1}.webm` });
    // The first part resumed its session (no second open for it, no byte sent again).
    expect(server.paths()).toContain("GET /api/v1/upload-sessions/sess-1");
    expect(opens).toHaveLength(2);
    expect(server.paths().filter((p) => p.startsWith("PUT s3:/sess-1"))).toHaveLength(1);
  });

  it("a refusal keeps the parts", async () => {
    const store = memoryRecordingStore();
    await twoParts(store);
    fakeServer((c) => (c.path.endsWith("/transcriptions") ? refusal(402, "quota_exceeded") : undefined));
    const { result } = renderSend(store, "ENDED");
    await act(() => result.current.send());
    expect(result.current.phase).toBe("failed");
    expect(await store.listParts("u1", "m1")).toHaveLength(2);
  });

  it("names a part without a MIME type as webm and ends an unfinished part at its last chunk", async () => {
    const store = memoryRecordingStore();
    run += 1;
    await store.createPart({
      id: `p-${run}`,
      userId: "u1",
      meetingId: "m1",
      startedAt: T0,
      lastChunkAt: T0,
      endedAt: null,
      mimeType: "",
      bytes: 0,
      language: "en",
      offsetSeconds: 0,
    });
    await store.appendChunk(`p-${run}`, 0, new Blob(["x"]), T0 + 61_400);
    const server = fakeServer();
    const { result } = renderSend(store);
    await act(() => result.current.send());
    expect(result.current.phase).toBe("done");
    expect(server.calls[0]!.body).toEqual({ duration_seconds: 61 });
    const open = server.calls.find((c) => c.path.endsWith("audio-upload-sessions"))!;
    expect(open.body).toMatchObject({ filename: `ghi-am-p-${run}.webm`, duration_seconds: 61 });
  });

  it("send skips a part another tab is still writing", async () => {
    const store = memoryRecordingStore();
    await twoParts(store);
    run += 1;
    // Another tab's part: open, its last chunk saved a moment ago.
    const now = Date.now();
    await store.createPart({ id: `live-${run}`, userId: "u1", meetingId: "m1", startedAt: now - 60_000, lastChunkAt: now - 2_000, endedAt: null, mimeType: "audio/webm", bytes: 0, language: "vi", offsetSeconds: 0 });
    const server = fakeServer();
    const { result } = renderSend(store, "ENDED");
    await act(() => result.current.send());

    expect(result.current.phase).toBe("done");
    expect(server.calls.filter((c) => c.path.endsWith("/transcriptions"))).toHaveLength(2);
    expect((await store.listParts("u1", "m1")).map((p) => p.id)).toEqual([`live-${run}`]);
  });

  it("stop leaves the parts on the device", async () => {
    const store = memoryRecordingStore();
    await twoParts(store);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fakeServer(async (c) => {
      if (c.method === "PUT") await gate;
      return undefined;
    });
    const { result } = renderSend(store, "ENDED");
    let sending!: Promise<void>;
    act(() => void (sending = result.current.send()));
    await waitFor(() => expect(result.current.phase).toBe("uploading"));
    await act(() => result.current.stop());
    release();
    await act(() => sending);
    expect(result.current.phase).toBe("idle");
    expect(await store.listParts("u1", "m1")).toHaveLength(2);
  });
});
