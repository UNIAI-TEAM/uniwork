import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { createMeetingSummary, getMeetingSummary } from "./meeting-summary";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const summary = {
  id: "s1",
  meeting_id: "m1",
  summary: "S",
  decisions: ["D"],
  model: "claude-sonnet",
  created_by: "u-host",
  created_at: "2026-09-04T03:00:00Z",
};

function sentBody(): unknown {
  const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe("meeting summary endpoints", () => {
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

  it("getMeetingSummary answers null for no summary, an old server's 404, and a summary that does not parse", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: null }));
    expect(await getMeetingSummary("m1")).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "not_found", message: "not found" } }, 404));
    expect(await getMeetingSummary("m1")).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { id: "x" } }));
    expect(await getMeetingSummary("m1")).toBeNull();
  });

  it("getMeetingSummary drops one malformed decision, not the whole summary", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { ...summary, decisions: ["D", 7], model: null } }));
    const got = await getMeetingSummary("m1");
    expect(got?.summary).toBe("S");
    expect(got?.decisions).toEqual(["D"]);
  });

  it("createMeetingSummary sends the locale and degrades to null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary }));
    expect((await createMeetingSummary("m1", "vi"))?.summary).toBe("S");
    expect(sentBody()).toEqual({ locale: "vi" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { summary: 1 } }));
    expect(await createMeetingSummary("m1", "en")).toBeNull();
  });
});
