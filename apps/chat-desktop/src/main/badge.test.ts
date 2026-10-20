import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { setBadgeCount: vi.fn(() => true) },
  nativeImage: { createFromDataURL: vi.fn((url: string) => ({ url })) },
}));

import { app, nativeImage } from "electron";
import { applyBadge, clampBadgeCount, MAX_BADGE_COUNT } from "./badge";

const overlayWindow = () => ({ setOverlayIcon: vi.fn() });

beforeEach(() => vi.clearAllMocks());

describe("clampBadgeCount", () => {
  it("floors, never goes negative and caps at the maximum", () => {
    expect(clampBadgeCount(-4)).toBe(0);
    expect(clampBadgeCount(1.9)).toBe(1);
    expect(clampBadgeCount(5000)).toBe(MAX_BADGE_COUNT);
    expect(clampBadgeCount(Number.NaN)).toBe(0);
  });
});

describe("applyBadge", () => {
  it("uses the dock/launcher count on macOS and Linux", () => {
    const win = overlayWindow();
    applyBadge(7, win, "darwin");
    applyBadge(0, win, "linux");
    expect(vi.mocked(app.setBadgeCount).mock.calls).toEqual([[7], [0]]);
    expect(win.setOverlayIcon).not.toHaveBeenCalled();
  });

  it("clamps before it reaches the OS", () => {
    applyBadge(10_000, null, "darwin");
    expect(app.setBadgeCount).toHaveBeenCalledWith(MAX_BADGE_COUNT);
  });

  it("draws a red dot overlay on Windows and clears it at zero", () => {
    const win = overlayWindow();
    applyBadge(3, win, "win32");
    expect(nativeImage.createFromDataURL).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/));
    expect(win.setOverlayIcon).toHaveBeenCalledWith(expect.objectContaining({ url: expect.any(String) }), "3 unread");
    applyBadge(0, win, "win32");
    expect(win.setOverlayIcon).toHaveBeenLastCalledWith(null, "");
    expect(app.setBadgeCount).not.toHaveBeenCalled();
  });

  it("is a no-op on Windows without a window", () => {
    expect(() => applyBadge(3, null, "win32")).not.toThrow();
    expect(app.setBadgeCount).not.toHaveBeenCalled();
  });
});
