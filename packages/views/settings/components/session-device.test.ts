import { describe, expect, it } from "vitest";
import { describeUserAgent, isLoopbackIp } from "./session-device";

describe("describeUserAgent", () => {
  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      { browser: "Chrome", os: "macOS", platform: "desktop" },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
      { browser: "Safari", os: "macOS", platform: "desktop" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      { browser: "Edge", os: "Windows", platform: "desktop" },
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
      { browser: "Firefox", os: "Linux", platform: "desktop" },
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      { browser: "Safari", os: "iOS", platform: "mobile" },
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
      { browser: "Chrome", os: "iOS", platform: "mobile" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
      { browser: "Samsung Internet", os: "Android", platform: "mobile" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) coc_coc_browser/128.0.0 Chrome/122.0.0.0 Safari/537.36",
      { browser: "Cốc Cốc", os: "Windows", platform: "desktop" },
    ],
  ])("reads %s", (ua, expected) => {
    expect(describeUserAgent(ua)).toEqual(expected);
  });

  it("returns nulls, not guesses, for an unknown or empty agent", () => {
    expect(describeUserAgent("")).toEqual({ browser: null, os: null, platform: "desktop" });
    expect(describeUserAgent("curl/8.7.1")).toEqual({ browser: null, os: null, platform: "desktop" });
  });
});

describe("isLoopbackIp", () => {
  it.each(["::1", "127.0.0.1", "127.0.1.1", "::ffff:127.0.0.1", " ::1 "])("treats %s as this machine", (ip) => {
    expect(isLoopbackIp(ip)).toBe(true);
  });

  it.each(["", "10.0.0.1", "1.1.1.1", "2001:db8::1", "::"])("treats %s as remote", (ip) => {
    expect(isLoopbackIp(ip)).toBe(false);
  });
});
