import { resolve } from "node:path";
import { createLaunchBridge, type DeepLinkSystem } from "./deep-links";

type LaunchApp = Pick<Electron.App, "on" | "hasSingleInstanceLock" | "requestSingleInstanceLock" | "setAsDefaultProtocolClient" | "isPackaged" | "quit">;

/** Must run at module load, before the app is ready: the OS can deliver a
 * file, a URL or a second launch before the host attaches its own listeners. */
export function captureEarlyLaunchEvents(app: LaunchApp) {
  const nativeFiles: string[] = [];
  app.on("open-file", (event, path) => { event.preventDefault(); nativeFiles.push(path); });

  // macOS delivers a cold-start deep link through open-url, which can fire before
  // the app is ready and the host has attached its handler. Queue those URLs at
  // module load; the deep-link system drains them once it is registered.
  const pendingOpenUrls: string[] = [];
  let captureOpenUrls = true;
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (captureOpenUrls) pendingOpenUrls.push(url);
  });

  // A second launch (deep link from a browser/launcher) can arrive while the
  // primary is still booting, before the host attaches its listener. Queue the
  // command line at module load; the deep-link system drains it once registered.
  const pendingSecondInstance: string[][] = [];
  let captureSecondInstance = true;
  app.on("second-instance", (_event, argv) => {
    if (captureSecondInstance) pendingSecondInstance.push([...argv]);
  });

  const createDeepLinkSystem = (): DeepLinkSystem => ({
    // The host already took the lock at bootstrap; report the held state so a
    // repeated call cannot be mistaken for a secondary instance.
    requestSingleInstanceLock: () => (typeof app.hasSingleInstanceLock === "function" ? app.hasSingleInstanceLock() : app.requestSingleInstanceLock()),
    registerProtocolClient: (scheme) => {
      if (process.platform === "win32" && app.isPackaged) app.setAsDefaultProtocolClient(scheme);
      else if (process.platform === "linux") {
        // A .deb registers the scheme from its .desktop MimeType postinst; an
        // AppImage registers itself on first run (registerAppImageScheme).
        // Both paths call this Electron helper too, best effort only.
        app.setAsDefaultProtocolClient(scheme);
      } else if (process.argv[1]) app.setAsDefaultProtocolClient(scheme, process.execPath, [resolve(process.argv[1])]);
      else app.setAsDefaultProtocolClient(scheme);
    },
    onSecondInstance: (listener) => {
      app.on("second-instance", (event, argv) => listener(event, argv));
    },
    onOpenUrl: (listener) => {
      app.on("open-url", (event, url) => listener(event, url));
    },
    takePendingOpenUrls: () => {
      captureOpenUrls = false;
      return pendingOpenUrls.splice(0);
    },
    takePendingSecondInstance: () => {
      captureSecondInstance = false;
      return pendingSecondInstance.splice(0);
    },
    quit: () => app.quit(),
  });

  return { nativeFiles, createDeepLinkSystem };
}

export function createNoopLaunchBridge(deploymentId: string) {
  return createLaunchBridge({
    trustedDeploymentId: deploymentId,
    getSession: () => undefined,
    exchange: { exchange: async () => ({ kind: "refused", reason: "not_found" as const }) },
  });
}
