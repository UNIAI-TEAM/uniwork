import { desktopCapturer, dialog, type Session } from "electron";
import { release } from "node:os";
import { hasAppOrigin } from "./ipc/schema";

/** Electron's system picker exists on macOS 15+ (Darwin 24); it bypasses the handler entirely. */
export function supportsSystemPicker(platform: NodeJS.Platform, darwinRelease: string): boolean {
  return platform === "darwin" && Number.parseInt(darwinRelease, 10) >= 24;
}

/** Without the system picker, nothing else tells the person their whole screen is about to be shared. */
async function confirmWholeScreen(): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Chia sẻ màn hình", "Huỷ"],
    defaultId: 1,
    cancelId: 1,
    message: "Chia sẻ toàn bộ màn hình?",
    detail: "Người trong cuộc gọi sẽ thấy màn hình chính của bạn, kể cả các ứng dụng khác đang mở.",
  });
  return response === 0;
}

export function installScreenShare(
  session: Pick<Session, "setDisplayMediaRequestHandler">,
  appOrigin: string,
  platform: NodeJS.Platform = process.platform,
  osRelease: string = release(),
  confirm: () => Promise<boolean> = confirmWholeScreen,
): void {
  session.setDisplayMediaRequestHandler(
    (request, callback) => {
      // Only the app document may capture a screen, only after a click, and only
      // once the person says yes; anything else gets no stream.
      if (!hasAppOrigin(request.securityOrigin, appOrigin) || !request.userGesture) return callback({});
      // shortcut: the first screen, video only, no source chooser; add one when people share a second screen or a window
      confirm()
        .then((ok) => (ok ? desktopCapturer.getSources({ types: ["screen"] }) : []))
        .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: supportsSystemPicker(platform, osRelease) },
  );
}
