import { release as osRelease } from "node:os";
import { join } from "node:path";
import { DESKTOP_IDENTITY, DESKTOP_IDENTITY_MANIFEST } from "../shared/identity";
import type { DeploymentProfile } from "../shared/deployment";
import { evaluatePlatformGate, forcedPlatformGate, readLinuxOsRelease } from "./platform-gate";
import { registerAppImageScheme } from "./linux-desktop-integration";

/** Node exposes the runtime glibc through the diagnostic report header; absent
 * on musl or when the report is unavailable, in which case the gate cannot
 * refuse on glibc alone. */
export function runtimeGlibcVersion(): string | undefined {
  try {
    const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: unknown } } | undefined;
    const value = report?.header?.glibcVersionRuntime;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Minimum OS/architecture check before anything else: a wrong-machine install
 * shows one native error box and exits before a user-data path is created or
 * any file is written. The forced flag is a dev/smoke-only test seam. Returns
 * false once the process is exiting. */
export async function passPlatformGate(app: Pick<Electron.App, "isPackaged" | "whenReady" | "exit">, dialog: Pick<Electron.Dialog, "showErrorBox">, smokeMode: boolean): Promise<boolean> {
  const gate = evaluatePlatformGate({
    platform: process.platform,
    arch: process.arch,
    release: osRelease(),
    systemVersion: typeof process.getSystemVersion === "function" ? process.getSystemVersion() : undefined,
    osRelease: process.platform === "linux" ? readLinuxOsRelease() : undefined,
    glibcVersion: process.platform === "linux" ? runtimeGlibcVersion() : undefined,
    forcedFailure: forcedPlatformGate(process.argv, { packaged: app.isPackaged, smokeMode }),
  });
  if (gate.ok) return true;
  const failure = gate.failure;
  // The native error box needs the ready state on Linux (before it Electron
  // only writes to stderr). Nothing is created or written here: the user-data
  // path is never set and no window is made.
  await app.whenReady();
  dialog.showErrorBox("UniWork Office", `${failure.messageVi}\n\n${failure.messageEn}`);
  app.exit(1);
  return false;
}

/** An AppImage has no install step, so register the scheme from the running
 * AppImage on first launch (the .deb does this in its postinst). */
export function registerAppImageOnFirstRun(app: Pick<Electron.App, "getPath">): void {
  if (process.platform !== "linux" || !process.env.APPIMAGE) return;
  try {
    registerAppImageScheme({
      appImagePath: process.env.APPIMAGE,
      desktopFileName: `${DESKTOP_IDENTITY.executable}.desktop`,
      productName: DESKTOP_IDENTITY_MANIFEST.product,
      scheme: DESKTOP_IDENTITY.userScheme,
      dataHomeDirectory: process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.length > 0 ? process.env.XDG_DATA_HOME : join(app.getPath("home"), ".local", "share"),
    });
  } catch { /* desktop integration is best effort; the app still runs */ }
}

export async function runSmokeDiagnostics(window: Electron.BrowserWindow, sessionGeneration: string, deploymentProfile?: DeploymentProfile): Promise<void> {
  const result = await window.webContents.executeJavaScript(
    `window.uniworkOffice.call("desktop:diagnostics", ${JSON.stringify({ sessionGeneration })})`,
    true,
  );
  if (!result || result.appId !== DESKTOP_IDENTITY.appId || result.channel !== DESKTOP_IDENTITY_MANIFEST.build.channel || result.buildId !== DESKTOP_IDENTITY_MANIFEST.build.buildId || (deploymentProfile && (result.deploymentId !== deploymentProfile.deploymentId || result.originHost !== new URL(deploymentProfile.apiOrigin).host))) {
    throw new Error("desktop launch smoke diagnostics did not match the accepted identity manifest");
  }
  process.stdout.write(`${JSON.stringify({ event: "office-desktop-smoke", readyToShow: true, diagnostics: result })}\n`);
}
