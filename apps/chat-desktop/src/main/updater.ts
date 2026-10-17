import type { AppUpdater } from "electron-updater";

/** A chat app stays open for days; check this often, not only at launch. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateMode = "install" | "notify";

/** Squirrel.Mac installs updates only into a signed app, so an unsigned mac
 * build can only say a newer one exists. Windows and Linux install either way. */
export function updateMode(platform: NodeJS.Platform, macSigned: boolean): UpdateMode {
  return platform === "darwin" && !macSigned ? "notify" : "install";
}

export interface UpdaterDeps {
  updater: Pick<AppUpdater, "autoDownload" | "checkForUpdates" | "on">;
  mode: UpdateMode;
  notify: (notice: { title: string; body: string }, onClick?: () => void) => void;
  openDownloadPage: () => void;
}

const TITLE = "Đã có bản UniChat mới";

/** Feed, channel and signature checks come from app-update.yml (electron-builder.ts). */
export function startUpdater({ updater, mode, notify, openDownloadPage }: UpdaterDeps): void {
  updater.autoDownload = mode === "install";
  if (mode === "install") {
    // autoInstallOnAppQuit (default) installs it when the app quits.
    updater.on("update-downloaded", (info) =>
      notify({ title: TITLE, body: `Bản ${info.version} sẽ được cài khi bạn thoát UniChat.` }),
    );
  } else {
    let shown: string | undefined;
    updater.on("update-available", (info) => {
      if (info.version === shown) return;
      shown = info.version;
      notify({ title: TITLE, body: `Bản ${info.version} đã có. Bấm để mở trang tải về.` }, openDownloadPage);
    });
  }
  // electron-updater logs each failure through its own `error` listener; the
  // catch only keeps a failed check or download from becoming an unhandled rejection.
  const check = (): void => {
    updater
      .checkForUpdates()
      .then((result) => result?.downloadPromise)
      .catch(() => undefined);
  };
  check();
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}
