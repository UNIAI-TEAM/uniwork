import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ desktopCapturer: { getSources: vi.fn() } }));

import { desktopCapturer } from "electron";
import { installScreenShare, supportsSystemPicker } from "./screen-share";

type Handler = (request: { audioRequested: boolean }, callback: (streams: unknown) => void) => void;

function install(platform: NodeJS.Platform, release: string) {
  const session = { setDisplayMediaRequestHandler: vi.fn() };
  installScreenShare(session, platform, release);
  const [handler, opts] = session.setDisplayMediaRequestHandler.mock.calls[0] as [Handler, { useSystemPicker: boolean }];
  const request = (): Promise<unknown> =>
    new Promise((resolve) => handler({ audioRequested: false }, resolve));
  return { opts, request };
}

beforeEach(() => vi.clearAllMocks());

describe("supportsSystemPicker", () => {
  it("is macOS 15 (Darwin 24) and newer only", () => {
    expect(supportsSystemPicker("darwin", "24.6.0")).toBe(true);
    expect(supportsSystemPicker("darwin", "25.0.0")).toBe(true);
    expect(supportsSystemPicker("darwin", "23.6.0")).toBe(false);
    expect(supportsSystemPicker("win32", "24.0.0")).toBe(false);
  });
});

describe("installScreenShare", () => {
  it("asks for the system picker where it exists", () => {
    expect(install("darwin", "24.6.0").opts).toEqual({ useSystemPicker: true });
    expect(install("linux", "6.8.0").opts).toEqual({ useSystemPicker: false });
  });

  it("grants the first screen, video only", async () => {
    const screen = { id: "screen:0", name: "Screen 1" };
    vi.mocked(desktopCapturer.getSources).mockResolvedValue([screen, { id: "screen:1", name: "Screen 2" }] as never);
    const { request } = install("win32", "10.0.0");
    await expect(request()).resolves.toEqual({ video: screen });
    expect(desktopCapturer.getSources).toHaveBeenCalledWith({ types: ["screen"] });
  });

  it("answers with no stream when there is no screen or the capturer fails", async () => {
    vi.mocked(desktopCapturer.getSources).mockResolvedValueOnce([]);
    const { request } = install("linux", "6.8.0");
    await expect(request()).resolves.toEqual({});
    vi.mocked(desktopCapturer.getSources).mockRejectedValueOnce(new Error("no capturer"));
    await expect(request()).resolves.toEqual({});
  });
});
