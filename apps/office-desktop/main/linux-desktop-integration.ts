import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** AppImage first-run desktop integration: an AppImage has no install step, so
 * the running image writes its own desktop entry and registers the manifest
 * user scheme with xdg-mime. The .deb does the same from its after-install
 * script. Every failure is non-fatal for the host. */
export type LinuxSchemeRegistration = Readonly<{
  desktopFilePath: string;
  written: boolean;
  registered: boolean;
}>;

export type LinuxDesktopFileSystem = Readonly<{
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, data: string, options: { mode: number }): void;
  mkdirSync(path: string, options: { recursive: true }): void;
  copyFileSync?(source: string, destination: string): void;
  existsSync?(path: string): boolean;
}>;

export type LinuxSchemeRegistrationOptions = Readonly<{
  appImagePath: string;
  desktopFileName: string;
  productName: string;
  scheme: string;
  dataHomeDirectory: string;
  /** The brand png (main/branding.ts brandIconPath). Installed into the
   * user's hicolor theme under the desktop file's name, so the launcher and
   * the taskbar show UniWork Office instead of a generic icon. */
  iconPath?: string;
  /** app.getName() of the running process: Electron sets the window's
   * WM_CLASS from it, and StartupWMClass ties the window to this entry. */
  wmClass?: string;
  /** Test seams: the real defaults write to the OS and run xdg-mime. */
  fileSystem?: LinuxDesktopFileSystem;
  run?: (command: string, args: readonly string[]) => boolean;
  /** Prints what a command answers on stdout; undefined when it failed or is missing. */
  query?: (command: string, args: readonly string[]) => string | undefined;
}>;

const nodeFileSystem: LinuxDesktopFileSystem = { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync };

function iconNameFor(desktopFileName: string): string {
  return desktopFileName.replace(/.desktop$/, "");
}

export function desktopEntryForAppImage(options: Pick<LinuxSchemeRegistrationOptions, "appImagePath" | "productName" | "scheme" | "wmClass"> & { iconName?: string }): string {
  return [
    "[Desktop Entry]",
    `Name=${options.productName}`,
    `Exec="${options.appImagePath}" %U`,
    ...(options.iconName ? [`Icon=${options.iconName}`] : []),
    ...(options.wmClass ? [`StartupWMClass=${options.wmClass}`] : []),
    "Type=Application",
    "Terminal=false",
    `MimeType=x-scheme-handler/${options.scheme};`,
    "",
  ].join("\n");
}

function runCommand(command: string, args: readonly string[]): boolean {
  try {
    return spawnSync(command, [...args], { stdio: "ignore", windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

function queryCommand(command: string, args: readonly string[]): string | undefined {
  try {
    const result = spawnSync(command, [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    return result.status === 0 ? result.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function registerAppImageScheme(options: LinuxSchemeRegistrationOptions): LinuxSchemeRegistration {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const applicationsDirectory = join(options.dataHomeDirectory, "applications");
  const desktopFilePath = join(applicationsDirectory, options.desktopFileName);
  const iconName = options.iconPath && fileSystem.copyFileSync ? iconNameFor(options.desktopFileName) : undefined;
  const content = desktopEntryForAppImage({ ...options, iconName });
  let existing: string | undefined;
  try { existing = fileSystem.readFileSync(desktopFilePath, "utf8"); } catch { /* no previous entry */ }
  let written = false;
  if (existing !== content) {
    fileSystem.mkdirSync(applicationsDirectory, { recursive: true });
    fileSystem.writeFileSync(desktopFilePath, content, { mode: 0o644 });
    written = true;
  }
  // The icon is installed whenever it is missing, not only when the entry was
  // written, so a copy that failed on one launch is retried on the next.
  const iconDirectory = join(options.dataHomeDirectory, "icons", "hicolor", "512x512", "apps");
  const iconTarget = iconName ? join(iconDirectory, `${iconName}.png`) : undefined;
  const iconMissing = iconTarget !== undefined && (fileSystem.existsSync ? !fileSystem.existsSync(iconTarget) : written);
  if (iconMissing && iconTarget && options.iconPath && fileSystem.copyFileSync) {
    try {
      fileSystem.mkdirSync(iconDirectory, { recursive: true });
      fileSystem.copyFileSync(options.iconPath, iconTarget);
    } catch { /* the entry still launches; the theme shows a generic icon */ }
  }
  // The default is set on the first run, and on a later launch only while the
  // scheme still has NO handler (the first call failed): a deliberate user choice
  // of another handler answers non-empty and survives every launch. A rewrite (the
  // upgrade that adds Icon=/StartupWMClass=, a moved AppImage's Exec=) keeps the
  // same desktop file name, which is all `xdg-mime default` points at, so it needs
  // no new default. An unreadable answer (no xdg-mime) is never a reason to retry.
  const run = options.run ?? runCommand;
  const mimeType = `x-scheme-handler/${options.scheme}`;
  const needsDefault = existing === undefined || (options.query ?? queryCommand)("xdg-mime", ["query", "default", mimeType]) === "";
  const registered = needsDefault ? run("xdg-mime", ["default", options.desktopFileName, mimeType]) : false;
  return { desktopFilePath, written, registered };
}
