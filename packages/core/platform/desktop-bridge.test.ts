import { afterEach, describe, expect, it, vi } from "vitest";
import { getDesktopBridge } from "./desktop-bridge";

afterEach(() => vi.unstubAllGlobals());

describe("getDesktopBridge", () => {
  it("is null without a bridge", () => {
    vi.stubGlobal("window", {});
    expect(getDesktopBridge()).toBeNull();
  });

  it("ignores a desktopAPI that is not UniChat", () => {
    vi.stubGlobal("window", { desktopAPI: { app: "uniwork-office", downloadURL: () => {} } });
    expect(getDesktopBridge()).toBeNull();
  });

  it("returns the UniChat bridge", () => {
    const desktopAPI = { app: "unichat", setBadgeCount: vi.fn() };
    vi.stubGlobal("window", { desktopAPI });
    expect(getDesktopBridge()).toBe(desktopAPI);
  });
});
