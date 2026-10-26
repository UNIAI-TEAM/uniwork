import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { setCaptionLanguage } from "./meeting-captions";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("meeting caption endpoints", () => {
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

  it("setCaptionLanguage puts lang and reports the server's confirmation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    expect(await setCaptionLanguage("m1", "en")).toBe(true);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/meetings/m1/caption-language");
    expect(init!.method).toBe("PUT");
    expect(JSON.parse(init!.body as string)).toEqual({ lang: "en" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await setCaptionLanguage("m1", "");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1]![1]!.body as string)).toEqual({ lang: "" });
  });

  it("setCaptionLanguage degrades to false on a malformed answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: 3 }));
    expect(await setCaptionLanguage("m1", "vi")).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(json(["nope"]));
    expect(await setCaptionLanguage("m1", "vi")).toBe(false);
  });
});
