import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
}>;

export type LinuxSchemeRegistrationOptions = Readonly<{
  appImagePath: string;
  desktopFileName: string;
  productName: string;
  scheme: string;
  dataHomeDirectory: string;
  /** Test seams: the real defaults write to the OS and run xdg-mime. */
  fileSystem?: LinuxDesktopFileSystem;
  run?: (command: string, args: readonly string[]) => boolean;
}>;

const nodeFileSystem: LinuxDesktopFileSystem = { readFileSync, writeFileSync, mkdirSync };

export function desktopEntryForAppImage(options: Pick<LinuxSchemeRegistrationOptions, "appImagePath" | "productName" | "scheme">): string {
  return [
    "[Desktop Entry]",
    `Name=${options.productName}`,
    `Exec="${options.appImagePath}" %U`,
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

export function registerAppImageScheme(options: LinuxSchemeRegistrationOptions): LinuxSchemeRegistration {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const applicationsDirectory = join(options.dataHomeDirectory, "applications");
  const desktopFilePath = join(applicationsDirectory, options.desktopFileName);
  const content = desktopEntryForAppImage(options);
  let existing: string | undefined;
  try { existing = fileSystem.readFileSync(desktopFilePath, "utf8"); } catch { /* no previous entry */ }
  let written = false;
  if (existing !== content) {
    fileSystem.mkdirSync(applicationsDirectory, { recursive: true });
    fileSystem.writeFileSync(desktopFilePath, content, { mode: 0o644 });
    written = true;
  }
  // First run only: once the entry exists, a deliberate user choice of another
  // handler must survive the next launch.
  const run = options.run ?? runCommand;
  const registered = written ? run("xdg-mime", ["default", options.desktopFileName, `x-scheme-handler/${options.scheme}`]) : false;
  return { desktopFilePath, written, registered };
}
