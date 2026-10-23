import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { useCreateMeeting, useSetMeetingAISharing } from "./hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const meeting = {
  id: "m1", workspace_id: "ws1", title: "Sync", description: "", starts_at: "2026-10-25T02:00:00Z",
  ends_at: "2026-10-25T03:00:00Z", room_name: "uw_mtg_m1", created_by: "u1",
};
const body = { title: "Sync", description: "", starts_at: meeting.starts_at, ends_at: meeting.ends_at };

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const calls = () => vi.mocked(fetch).mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${new URL(String(url)).pathname}`);

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

// UNI-1995 access (#16): the schedule form's "Thư ký AI" switch.
describe("useCreateMeeting with the scribe switch", () => {
  it("sends no second call when the meeting already starts as asked", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ meeting: { ...meeting, scribe_enabled: true } }));
    const { result } = renderHook(() => useCreateMeeting("ws1"), { wrapper: wrapper() });
    act(() => result.current.mutate({ ...body, scribe: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls()).toEqual(["POST /api/v1/workspaces/ws1/meetings"]);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).not.toHaveProperty("scribe");
  });

  it("switches the scribe on when the organization's policy started it off", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ meeting: { ...meeting, scribe_enabled: false } }))
      .mockResolvedValueOnce(json({ meeting: { ...meeting, scribe_enabled: true } }));
    const { result } = renderHook(() => useCreateMeeting("ws1"), { wrapper: wrapper() });
    act(() => result.current.mutate({ ...body, scribe: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls()).toEqual(["POST /api/v1/workspaces/ws1/meetings", "PUT /api/v1/meetings/m1/scribe"]);
    expect(result.current.data?.scribe_enabled).toBe(true);
  });

  it("keeps the created meeting when the switch call fails, so a retry cannot create it twice", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ meeting: { ...meeting, scribe_enabled: true } }))
      .mockResolvedValueOnce(json({ error: { code: "scribe_off_by_policy", message: "x" } }, 409));
    const { result } = renderHook(() => useCreateMeeting("ws1"), { wrapper: wrapper() });
    act(() => result.current.mutate({ ...body, scribe: false }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ id: "m1", scribe_enabled: true });
  });
});

describe("useSetMeetingAISharing", () => {
  it("fails on an answer that does not parse instead of a silent success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    const { result } = renderHook(() => useSetMeetingAISharing("m1"), { wrapper: wrapper() });
    act(() => result.current.mutate(true));
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
