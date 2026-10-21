import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime } from "../../runtime-config";
import { setAccessToken } from "../session";
import { getMeetingDialIn, rotateMeetingDialInPin } from "./meeting-dial-in";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const off = { enabled: false, number: "", pin: "" };

describe("meeting dial-in endpoints", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getMeetingDialIn reads the number and PIN", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: true, number: "+84 28 7300 0000", pin: "042137" }));
    expect(await getMeetingDialIn("m1")).toEqual({ enabled: true, number: "+84 28 7300 0000", pin: "042137" });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("/api/v1/meetings/m1/dial-in");
  });

  it("getMeetingDialIn degrades to off on a malformed answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: "yes" })).mockResolvedValueOnce(json(null));
    expect(await getMeetingDialIn("m1")).toEqual(off);
    expect(await getMeetingDialIn("m1")).toEqual(off);
  });

  it("getMeetingDialIn keeps enabled when one field drifts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: true, number: 842873, pin: "042137" }));
    expect(await getMeetingDialIn("m1")).toEqual({ enabled: true, number: "", pin: "042137" });
  });

  it("rotateMeetingDialInPin posts and degrades on drift", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ enabled: true, number: "+84 28 7300 0000", pin: "981200" }))
      .mockResolvedValueOnce(json({ pin: 5 }));
    expect(await rotateMeetingDialInPin("m1")).toMatchObject({ pin: "981200" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("/api/v1/meetings/m1/dial-in/pin");
    expect(init?.method).toBe("POST");
    expect(await rotateMeetingDialInPin("m1")).toEqual(off);
  });
});
