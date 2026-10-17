import { desktopCapturer, type Session } from "electron";
import { release } from "node:os";
import { hasAppOrigin } from "./ipc/schema";

/** Electron's system picker exists on macOS 15+ (Darwin 24); it bypasses the handler entirely. */
export function supportsSystemPicker(platform: NodeJS.Platform, darwinRelease: string): boolean {
  return platform === "darwin" && Number.parseInt(darwinRelease, 10) >= 24;
}

export function installScreenShare(
  session: Pick<Session, "setDisplayMediaRequestHandler">,
  appOrigin: string,
  platform: NodeJS.Platform = process.platform,
  osRelease: string = release(),
): void {
  session.setDisplayMediaRequestHandler(
    (request, callback) => {
      // Only the app document may capture a screen; anything else gets no stream.
      if (!hasAppOrigin(request.securityOrigin, appOrigin)) return callback({});
      // shortcut: the first screen, video only, no picker; D2 adds a source chooser for the other platforms
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: supportsSystemPicker(platform, osRelease) },
  );
}
