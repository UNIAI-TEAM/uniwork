import { describe, expect, it } from "vitest";
import { detectDesktopPlatform } from "./desktop-platform";

describe("detectDesktopPlatform", () => {
  it.each([
    ["Windows Edge", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0", "win32-x64", "certain"],
    ["Windows Chrome", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36", "win32-x64", "certain"],
    ["Windows Microsoft WebView", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Microsoft Office/16.0", "win32-x64", "certain"],
    ["Mac Safari", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", "darwin-arm64", "uncertain"],
    ["Mac Chrome", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36", "darwin-arm64", "uncertain"],
    ["Ubuntu Firefox", "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0", "linux-x64-deb", "certain"],
    ["Ubuntu Chrome", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36", "linux-x64-deb", "certain"],
    ["Linux arm64", "Mozilla/5.0 (X11; Linux aarch64; rv:140.0) Gecko/20100101 Firefox/140.0", null, "unsupported"],
    ["ChromeOS", "Mozilla/5.0 (X11; CrOS x86_64 16267.0.0) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36", null, "unsupported"],
    ["Android", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36", null, "unsupported"],
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1", null, "unsupported"],
    ["iPad", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", null, "unsupported"],
    ["unknown", "unknown", null, "unsupported"],
    ["unrelated machine token", "Mozilla/5.0 (Test machine x64)", null, "unsupported"],
  ])("detects %s without trusting the frozen Mac Intel UA", (_name, userAgent, platform, confidence) => {
    expect(detectDesktopPlatform({ userAgent })).toMatchObject({ platform, confidence });
  });
  it.each([["arm", "darwin-arm64"], ["arm64", "darwin-arm64"], ["x86", "darwin-x64"], ["x64", "darwin-x64"]])("uses high entropy Mac architecture %s", (architecture, platform) => {
    expect(detectDesktopPlatform({ userAgentData: { platform: "macOS", architecture, bitness: "64" } })).toEqual({ platform, confidence: "certain" });
  });
  it("rejects mobile and Linux arm hints even when the reduced UA looks desktop", () => {
    expect(detectDesktopPlatform({ userAgentData: { platform: "Android", mobile: true } }).platform).toBeNull();
    expect(detectDesktopPlatform({ userAgentData: { platform: "Linux", architecture: "arm", bitness: "64" } }).platform).toBeNull();
    expect(detectDesktopPlatform({ userAgentData: { platform: "Windows", architecture: "x86", bitness: "32" } }).platform).toBeNull();
  });
});
