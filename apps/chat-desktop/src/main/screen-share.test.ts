import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ desktopCapturer: { getSources: vi.fn() }, dialog: { showMessageBox: vi.fn() } }));

import { desktopCapturer } from "electron";
import { installScreenShare, supportsSystemPicker } from "./screen-share";

type Handler = (
  request: { audioRequested: boolean; securityOrigin: string; userGesture: boolean },
  callback: (streams: unknown) => void,
) => void;

const APP = "https://app.uniworkos.com";

function install(platform: NodeJS.Platform, release: string, confirmed = true) {
  const session = { setDisplayMediaRequestHandler: vi.fn() };
  const confirm = vi.fn(async () => confirmed);
  installScreenShare(session, APP, platform, release, confirm);
  const [handler, opts] = session.setDisplayMediaRequestHandler.mock.calls[0] as [Handler, { useSystemPicker: boolean }];
  const request = (securityOrigin = `${APP}/`, userGesture = true): Promise<unknown> =>
    new Promise((resolve) => handler({ audioRequested: false, securityOrigin, userGesture }, resolve));
  return { opts, request, confirm };
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

  it("grants the first screen, video only, once the person confirms", async () => {
    const screen = { id: "screen:0", name: "Screen 1" };
    vi.mocked(desktopCapturer.getSources).mockResolvedValue([screen, { id: "screen:1", name: "Screen 2" }] as never);
    const { request, confirm } = install("win32", "10.0.0");
    await expect(request()).resolves.toEqual({ video: screen });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(desktopCapturer.getSources).toHaveBeenCalledWith({ types: ["screen"] });
  });

  // Script on the app origin (an XSS, a bad deploy) must not record the whole
  // screen, other apps included, without the person seeing and saying yes.
  it("answers with no stream to a request without a click, or one the person declines", async () => {
    const { request, confirm } = install("win32", "10.0.0");
    await expect(request(`${APP}/`, false)).resolves.toEqual({});
    expect(confirm).not.toHaveBeenCalled();
    const declined = install("linux", "6.8.0", false);
    await expect(declined.request()).resolves.toEqual({});
    expect(declined.confirm).toHaveBeenCalledTimes(1);
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  it("answers with no stream to a requester outside the app origin, without asking the capturer", async () => {
    const { request } = install("win32", "10.0.0");
    await expect(request("https://evil.example")).resolves.toEqual({});
    await expect(request("file://")).resolves.toEqual({});
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  it("answers with no stream when there is no screen or the capturer fails", async () => {
    vi.mocked(desktopCapturer.getSources).mockResolvedValueOnce([]);
    const { request } = install("linux", "6.8.0");
    await expect(request()).resolves.toEqual({});
    vi.mocked(desktopCapturer.getSources).mockRejectedValueOnce(new Error("no capturer"));
    await expect(request()).resolves.toEqual({});
  });
});
