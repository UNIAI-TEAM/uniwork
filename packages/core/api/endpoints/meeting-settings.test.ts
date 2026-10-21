import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { getMeetingSettings, setMeetingAutoSummary } from "./meeting-settings";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const malformedBodies = [{ nope: true }, { organization_id: "o1", auto_summary_enabled: "yes" }, null, [], "str"];

describe("meeting settings endpoints (UNI-2026)", () => {
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

  it("getMeetingSettings reads the organization switch", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ organization_id: "o1", auto_summary_enabled: true }));
    const out = await getMeetingSettings("o1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/orgs/o1/meetings/settings");
    expect(init?.method ?? "GET").toBe("GET");
    expect(out).toEqual({ organization_id: "o1", auto_summary_enabled: true });
  });

  it("setMeetingAutoSummary PUTs the switch", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ organization_id: "o1", auto_summary_enabled: false, updated_by: "u1", updated_by_kind: "human" }),
    );
    const out = await setMeetingAutoSummary("o1", false);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/orgs/o1/meetings/settings");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ auto_summary_enabled: false });
    expect(out?.auto_summary_enabled).toBe(false);
  });

  it.each(malformedBodies)("getMeetingSettings degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getMeetingSettings("o1")).resolves.toBeNull();
  });

  it.each(malformedBodies)("setMeetingAutoSummary degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(setMeetingAutoSummary("o1", true)).resolves.toBeNull();
  });
});
