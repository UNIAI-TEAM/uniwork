import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { meetingKeys } from "./hooks";
import { useDeleteTranscript, useFullTranscript, useTranscriptFromStart } from "./transcript-hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const seg = (id: string) => ({ id, meeting_id: "m1", text: id, spoken_at: "2026-08-29T02:00:00Z" });
const urls = () => vi.mocked(fetch).mock.calls.map((c) => String(c[0]));

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

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

describe("transcript hooks (UNI-1995 #9)", () => {
  it("reads an ended meeting from its start and loads more at the bottom", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ segments: [seg("a"), seg("b")], newer_cursor: "1.b" }))
      .mockResolvedValueOnce(json({ segments: [seg("c")] }));
    const { result } = renderHook(() => useTranscriptFromStart("m1", ""), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(["a", "b"]));
    expect(result.current.hasNextPage).toBe(true);
    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(["a", "b", "c"]));
    expect(result.current.hasNextPage).toBe(false);
    expect(urls()).toEqual([
      "http://api.test/api/v1/meetings/m1/transcript?order=asc&limit=200",
      "http://api.test/api/v1/meetings/m1/transcript?from=1.b&limit=200",
    ]);
  });

  it("opens around a cited line and loads the lines before it", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ segments: [seg("c"), seg("d")], older_cursor: "1.c" }))
      .mockResolvedValueOnce(json({ segments: [seg("a"), seg("b")] }));
    const { result } = renderHook(() => useTranscriptFromStart("m1", "d"), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(["c", "d"]));
    expect(result.current.hasPreviousPage).toBe(true);
    await act(() => result.current.fetchPreviousPage());
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(["a", "b", "c", "d"]));
    expect(urls()[0]).toBe("http://api.test/api/v1/meetings/m1/transcript?around=d&limit=200");
    expect(urls()[1]).toBe("http://api.test/api/v1/meetings/m1/transcript?before=1.c&limit=200");
  });

  it("keeps every loaded line when a list opened around a line refetches", async () => {
    // The server's before= page carries the cursor forward (UNI-1995 #14):
    // a refetch starts from that first page and must come back to the rest.
    const pages: Record<string, unknown> = {
      "around=d": { segments: [seg("c"), seg("d")], older_cursor: "1.c" },
      "before=1.c": { segments: [seg("a"), seg("b")], newer_cursor: "1.b" },
      "from=1.b": { segments: [seg("c"), seg("d")] },
    };
    vi.mocked(fetch).mockImplementation(async (input) => {
      const key = Object.keys(pages).find((k) => String(input).includes(`?${k}&`));
      return json(key ? pages[key] : { segments: [] });
    });
    const qc = newClient();
    const { result } = renderHook(() => useTranscriptFromStart("m1", "d"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(["c", "d"]));
    await act(() => result.current.fetchPreviousPage());
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(["a", "b", "c", "d"]));
    await act(() => qc.invalidateQueries({ queryKey: meetingKeys.transcriptRead("m1") }));
    await waitFor(() => expect(urls()).toContain("http://api.test/api/v1/meetings/m1/transcript?from=1.b&limit=200"));
    expect(result.current.rows.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("reads the whole transcript for the captions, page after page", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ segments: [seg("a")], newer_cursor: "1.a" }))
      .mockResolvedValueOnce(json({ segments: [seg("b")] }));
    const { result } = renderHook(() => useFullTranscript("m1"), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.data?.map((r) => r.id)).toEqual(["a", "b"]));
    expect(urls()[1]).toBe("http://api.test/api/v1/meetings/m1/transcript?from=1.a&limit=400");
  });

  it("a delete makes every read of the transcript and the summary stale", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ deleted: 2 }));
    const qc = newClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteTranscript("m1"), { wrapper: wrapperFor(qc) });
    let deleted: number | null = null;
    await act(async () => {
      deleted = await result.current.mutateAsync({ all: true });
    });
    expect(deleted).toBe(2);
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const k of [meetingKeys.transcript("m1"), meetingKeys.transcriptRead("m1"), meetingKeys.summary("m1")]) {
      expect(keys).toContain(JSON.stringify(k));
    }
  });
});
