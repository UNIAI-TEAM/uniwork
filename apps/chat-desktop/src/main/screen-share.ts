import { desktopCapturer, type Session } from "electron";
import { release } from "node:os";

/** Electron's system picker exists on macOS 15+ (Darwin 24); it bypasses the handler entirely. */
export function supportsSystemPicker(platform: NodeJS.Platform, darwinRelease: string): boolean {
  return platform === "darwin" && Number.parseInt(darwinRelease, 10) >= 24;
}

export function installScreenShare(
  session: Pick<Session, "setDisplayMediaRequestHandler">,
  platform: NodeJS.Platform = process.platform,
  osRelease: string = release(),
): void {
  session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      // shortcut: the first screen, video only, no picker; D2 adds a source chooser for the other platforms
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: supportsSystemPicker(platform, osRelease) },
  );
}
