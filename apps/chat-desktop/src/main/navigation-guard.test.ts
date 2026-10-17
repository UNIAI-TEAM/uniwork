import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeBlockedNavigation,
  installNavigationGuard,
  isTrustedNavigation,
  type NavigationGuardWindow,
} from "./navigation-guard";

const APP = "https://app.uniworkos.com";
const API = "https://api.uniworkos.com";
const TRUSTED = [APP, API];

describe("isTrustedNavigation", () => {
  it("trusts the app and api origins, including deeper paths", () => {
    expect(isTrustedNavigation(`${APP}/`, TRUSTED)).toBe(true);
    expect(isTrustedNavigation(`${APP}/acme/chat?x=1#y`, TRUSTED)).toBe(true);
    expect(isTrustedNavigation(`${API}/api/v1/auth`, TRUSTED)).toBe(true);
  });

  it("rejects a different origin", () => {
    expect(isTrustedNavigation("https://evil.example/", TRUSTED)).toBe(false);
    // Same host, different port — a different origin.
    expect(isTrustedNavigation("https://app.uniworkos.com:9999/", TRUSTED)).toBe(false);
    // Same host and port, different scheme.
    expect(isTrustedNavigation("http://app.uniworkos.com/", TRUSTED)).toBe(false);
  });

  it("rejects javascript: and file: URLs", () => {
    expect(isTrustedNavigation("javascript:alert(1)", TRUSTED)).toBe(false);
    expect(isTrustedNavigation("file:///Users/me/shot.png", TRUSTED)).toBe(false);
    // An opaque origin never matches, even when a caller lists it by mistake.
    expect(isTrustedNavigation("javascript:alert(1)", [...TRUSTED, "null"])).toBe(false);
  });

  it("rejects unparseable input", () => {
    expect(isTrustedNavigation("not a url", TRUSTED)).toBe(false);
    expect(isTrustedNavigation("", TRUSTED)).toBe(false);
  });
});

describe("describeBlockedNavigation", () => {
  it("logs the origin only, never the path", () => {
    expect(describeBlockedNavigation("https://evil.example/secret/path?token=abc")).toBe(
      "https://evil.example",
    );
    expect(describeBlockedNavigation("file:///Users/me/Desktop/private.png")).toBe("file:");
    expect(describeBlockedNavigation("javascript:alert(1)")).toBe("javascript:");
    expect(describeBlockedNavigation("nonsense")).toBe("invalid URL");
  });
});

describe("installNavigationGuard", () => {
  let listener: (event: { preventDefault(): void }, url: string) => void;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const window: NavigationGuardWindow = {
      webContents: {
        on: (_event, fn) => {
          listener = fn;
          return window;
        },
      },
    };
    installNavigationGuard(window, TRUSTED);
  });

  function navigate(url: string): boolean {
    const preventDefault = vi.fn();
    listener({ preventDefault }, url);
    return preventDefault.mock.calls.length > 0;
  }

  it("allows a navigation inside the app or api origin", () => {
    expect(navigate(`${APP}/acme/chat`)).toBe(false);
    expect(navigate(`${API}/api/v1/auth/desktop/start`)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("blocks a foreign origin and logs only its origin", () => {
    expect(navigate("https://evil.example/secret?token=abc")).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("https://evil.example"));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("secret"));
  });

  it("blocks javascript: and file: navigations", () => {
    expect(navigate("javascript:alert(1)")).toBe(true);
    expect(navigate("file:///Users/me/Desktop/shot.png")).toBe(true);
  });
});
