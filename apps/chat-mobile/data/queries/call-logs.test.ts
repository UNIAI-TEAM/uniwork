import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ request: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>() }));
vi.mock("../api", () => ({ api: apiMock }));

import { callLogsOptions, fetchCallLogs } from "./call-logs";

const row = {
  message_id: "m1",
  room_id: "r1",
  room_kind: "dm",
  room_name: "Chat B",
  peer_user_id: "U2",
  call_id: "c1",
  outcome: "completed",
  video: false,
  caller_id: "U1",
  caller_name: "Chat A",
  duration_seconds: 125,
  started_at: "2026-10-17T08:58:00Z",
  ended_at: "2026-10-17T09:00:05Z",
  participants: [{ user_id: "U1", display_name: "Chat A" }],
};

describe("fetchCallLogs", () => {
  it("asks the workspace route with the cursor and parses the page", async () => {
    apiMock.request.mockResolvedValueOnce({ call_logs: [row], next_cursor: "1.m1" });
    const signal = new AbortController().signal;
    const page = await fetchCallLogs("w 1", "17.0A", signal);
    expect(apiMock.request).toHaveBeenCalledWith("/api/v1/workspaces/w%201/chat/call-logs?cursor=17.0A", { signal });
    expect(page.next_cursor).toBe("1.m1");
    expect(page.call_logs).toEqual([expect.objectContaining({ message_id: "m1", room_name: "Chat B", duration_seconds: 125 })]);
  });

  it("drops a row it cannot read and keeps the rest, with defaults for drifted fields", async () => {
    apiMock.request.mockResolvedValueOnce({
      call_logs: [{ room_id: "r9" }, { ...row, message_id: "m2", video: "yes", participants: "x", peer_user_id: 7 }],
    });
    const page = await fetchCallLogs("w1", null);
    expect(apiMock.request).toHaveBeenLastCalledWith("/api/v1/workspaces/w1/chat/call-logs", { signal: undefined });
    expect(page.next_cursor).toBeNull();
    expect(page.call_logs).toHaveLength(1);
    expect(page.call_logs[0]).toMatchObject({ message_id: "m2", video: false, participants: [], peer_user_id: undefined });
  });

  it("reads a malformed body as an empty last page instead of throwing", async () => {
    apiMock.request.mockResolvedValueOnce({ unexpected: true });
    expect(await fetchCallLogs("w1", null)).toEqual({ call_logs: [], next_cursor: null });
  });
});

describe("callLogsOptions", () => {
  it("keys by workspace and follows next_cursor until it is null", async () => {
    const options = callLogsOptions("w1");
    expect(options.queryKey).toEqual(["chat-call-logs", "w1"]);
    expect(options.initialPageParam).toBeNull();
    expect(options.getNextPageParam({ call_logs: [], next_cursor: "c2" }, [], null, [])).toBe("c2");
    expect(options.getNextPageParam({ call_logs: [], next_cursor: null }, [], null, [])).toBeUndefined();
    apiMock.request.mockResolvedValueOnce({ call_logs: [], next_cursor: null });
    const queryFn = options.queryFn as (ctx: { pageParam: string | null; signal: AbortSignal }) => Promise<unknown>;
    await queryFn({ pageParam: "c2", signal: new AbortController().signal });
    expect(apiMock.request).toHaveBeenLastCalledWith("/api/v1/workspaces/w1/chat/call-logs?cursor=c2", expect.anything());
  });
});
