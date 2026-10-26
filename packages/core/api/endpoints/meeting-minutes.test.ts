import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  createMeetingMinutes,
  finalizeMeetingMinutes,
  getMeetingMinutes,
  refreshMeetingMinutes,
  reopenMeetingMinutes,
} from "./meeting-minutes";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const finalized = {
  document_id: "d1",
  finalized: true,
  finalized_at: "2026-10-20T03:00:00Z",
  finalized_by: "u1",
  finalized_version_id: "v1",
  finalized_version: 2,
  edited_since_finalized: true,
  can_edit: true,
  pending_items: 2,
};

describe("meeting minutes endpoints", () => {
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

  it("reads the minutes and sends each command to its route", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ minutes: finalized })));
    expect(await getMeetingMinutes("m 1")).toEqual(finalized);
    await createMeetingMinutes("m 1", "en");
    await finalizeMeetingMinutes("m 1");
    await reopenMeetingMinutes("m 1");
    await refreshMeetingMinutes("m 1");
    const calls = vi.mocked(fetch).mock.calls.map(([url, init]) => [String(url), init?.method ?? "GET"]);
    expect(calls).toEqual([
      ["http://api.test/api/v1/meetings/m%201/minutes", "GET"],
      ["http://api.test/api/v1/meetings/m%201/minutes", "POST"],
      ["http://api.test/api/v1/meetings/m%201/minutes/finalize", "POST"],
      ["http://api.test/api/v1/meetings/m%201/minutes/reopen", "POST"],
      ["http://api.test/api/v1/meetings/m%201/minutes/refresh", "POST"],
    ]);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toEqual({ locale: "en" });
  });

  it("reads no minutes as null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ minutes: null }));
    expect(await getMeetingMinutes("m1")).toBeNull();
  });

  it("degrades a malformed answer instead of throwing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ minutes: { document_id: 7 } }));
    expect(await getMeetingMinutes("m1")).toBeNull();
    // A reader the page is closed to gets no page id.
    vi.mocked(fetch).mockResolvedValueOnce(json({ minutes: { document_id: null, finalized: true } }));
    expect((await getMeetingMinutes("m1"))?.document_id).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ minutes: { document_id: "d1", finalized: "yes", can_edit: null } }));
    expect(await getMeetingMinutes("m1")).toEqual({
      document_id: "d1",
      finalized: false,
      edited_since_finalized: false,
      can_edit: false,
      pending_items: 0,
    });
    vi.mocked(fetch).mockResolvedValueOnce(json("nope"));
    expect(await finalizeMeetingMinutes("m1")).toBeNull();
    // A pending count that is not a count reads as none; an old server sends none.
    vi.mocked(fetch).mockResolvedValueOnce(json({ minutes: { ...finalized, pending_items: "two" } }));
    expect((await refreshMeetingMinutes("m1"))?.pending_items).toBe(0);
    vi.mocked(fetch).mockResolvedValueOnce(json({ minutes: { ...finalized, pending_items: -1 } }));
    expect((await getMeetingMinutes("m1"))?.pending_items).toBe(0);
  });
});
