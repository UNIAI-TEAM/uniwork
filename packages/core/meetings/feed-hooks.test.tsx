import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import {
  meetingKeys,
  useAppendMeetingChat,
  useMeetingChat,
  useOlderMeetingChat,
  useOlderTranscript,
  useTranscript,
} from "./hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const msg = (id: string, sec: number) => ({
  id,
  meeting_id: "m1",
  sender_identity: "uw_participant_p1",
  sender_name: "An",
  message: id,
  sent_at: `2026-08-29T02:00:${String(sec).padStart(2, "0")}Z`,
});
const seg = (id: string, sec: number) => ({
  id,
  meeting_id: "m1",
  text: id,
  spoken_at: `2026-08-29T02:00:${String(sec).padStart(2, "0")}Z`,
});

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

const urls = () => vi.mocked(fetch).mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  setAccessToken("tok");
  vi.stubGlobal("fetch", vi.fn());
  configureRuntime({ apiUrl: "http://api.test" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfig();
  setAccessToken(null);
});

describe("useMeetingChat — a realtime frame reads a delta, not the history (G7)", () => {
  it("fetches the newest page once, then only after its cursor", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ messages: [msg("a", 1), msg("b", 2)], older_cursor: "o1", after_cursor: "t2" }))
      .mockResolvedValueOnce(json({ messages: [msg("b", 2), msg("c", 3)], after_cursor: "t3" }));
    const { result } = renderHook(() => useMeetingChat("m1"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.data?.map((m) => m.id)).toEqual(["a", "b"]));

    await act(() => qc.invalidateQueries({ queryKey: meetingKeys.chat("m1") }));
    await waitFor(() => expect(result.current.data?.map((m) => m.id)).toEqual(["a", "b", "c"]));
    expect(urls()).toEqual(["http://api.test/api/v1/meetings/m1/chat", "http://api.test/api/v1/meetings/m1/chat?after=t2"]);
  });

  it("puts the sender's own message in the cache without another read", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ messages: [msg("a", 1)], after_cursor: "t1" }))
      .mockResolvedValueOnce(json({ message: msg("mine", 4) }));
    const { result } = renderHook(() => ({ chat: useMeetingChat("m1"), send: useAppendMeetingChat("m1") }), {
      wrapper: wrapperFor(qc),
    });
    await waitFor(() => expect(result.current.chat.data).toHaveLength(1));
    await act(() => result.current.send.mutateAsync("mine"));
    await waitFor(() => expect(result.current.chat.data?.map((m) => m.id)).toEqual(["a", "mine"]));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("loads the older page on demand and says when there is none left", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ messages: [msg("c", 3)], older_cursor: "o3", after_cursor: "t3" }))
      .mockResolvedValueOnce(json({ messages: [msg("a", 1), msg("b", 2)] }));
    const { result } = renderHook(() => ({ chat: useMeetingChat("m1"), older: useOlderMeetingChat("m1") }), {
      wrapper: wrapperFor(qc),
    });
    await waitFor(() => expect(result.current.older.hasOlder).toBe(true));
    await act(() => result.current.older.loadOlder());
    await waitFor(() => expect(result.current.chat.data?.map((m) => m.id)).toEqual(["a", "b", "c"]));
    expect(result.current.older.hasOlder).toBe(false);
    expect(urls()[1]).toBe("http://api.test/api/v1/meetings/m1/chat?before=o3");
  });
});

describe("useTranscript — deltas merge late segments in spoken order (G18)", () => {
  it("reads after its cursor and places an earlier-spoken segment in order", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ segments: [seg("s2", 2), seg("s3", 3)], older_cursor: "o2", after_cursor: "t3" }))
      .mockResolvedValueOnce(json({ segments: [seg("late", 1)], after_cursor: "t4" }));
    const { result } = renderHook(() => ({ list: useTranscript("m1"), older: useOlderTranscript("m1") }), {
      wrapper: wrapperFor(qc),
    });
    await waitFor(() => expect(result.current.list.data).toHaveLength(2));
    expect(result.current.older.hasOlder).toBe(true);
    await act(() => qc.invalidateQueries({ queryKey: meetingKeys.transcript("m1") }));
    await waitFor(() => expect(result.current.list.data?.map((s) => s.id)).toEqual(["late", "s2", "s3"]));
    expect(urls()[1]).toBe("http://api.test/api/v1/meetings/m1/transcript?after=t3");
  });
});
