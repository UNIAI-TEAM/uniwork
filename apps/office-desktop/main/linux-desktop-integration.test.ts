import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { desktopEntryForAppImage, registerAppImageScheme } from "./linux-desktop-integration";

const options = {
  appImagePath: "/home/zone/Downloads/UniWork Office.AppImage",
  desktopFileName: "uniwork-office-test.desktop",
  productName: "UniWork Office (test)",
  scheme: "uniwork-office-dev",
  dataHomeDirectory: "/home/zone/.local/share",
  // A later launch finds this entry already the scheme's handler (never the real xdg-mime).
  query: () => "uniwork-office-test.desktop" as string | undefined,
};

function memoryFileSystem() {
  const files = new Map<string, string>();
  const directories: string[] = [];
  return {
    files,
    directories,
    fileSystem: {
      readFileSync: (path: string) => {
        const value = files.get(path);
        if (value === undefined) throw new Error("ENOENT");
        return value;
      },
      writeFileSync: (path: string, data: string) => { files.set(path, data); },
      mkdirSync: (path: string) => { directories.push(path); },
      copyFileSync: (source: string, destination: string) => { files.set(destination, `copy:${source}`); },
      existsSync: (path: string) => files.has(path),
    },
  };
}

describe("AppImage first-run scheme registration", () => {
  it("writes a quoted desktop entry with the scheme MimeType", () => {
    const entry = desktopEntryForAppImage(options);
    expect(entry).toContain('Exec="/home/zone/Downloads/UniWork Office.AppImage" %U');
    expect(entry).toContain("MimeType=x-scheme-handler/uniwork-office-dev;");
    expect(entry).toContain("Type=Application");
  });

  it("writes once and registers xdg-mime on the first run", () => {
    const memory = memoryFileSystem();
    const run = vi.fn(() => true);
    const result = registerAppImageScheme({ ...options, fileSystem: memory.fileSystem, run });
    expect(result.written).toBe(true);
    expect(result.registered).toBe(true);
    expect(result.desktopFilePath.replaceAll("\\", "/")).toBe("/home/zone/.local/share/applications/uniwork-office-test.desktop");
    expect(memory.directories).toEqual([join(options.dataHomeDirectory, "applications")]);
    expect(run).toHaveBeenCalledWith("xdg-mime", ["default", "uniwork-office-test.desktop", "x-scheme-handler/uniwork-office-dev"]);
    expect(memory.files.get(result.desktopFilePath)).toContain("MimeType=x-scheme-handler/uniwork-office-dev;");
  });

  it("registers on the first run only, so a user-chosen handler survives", () => {
    const memory = memoryFileSystem();
    const run = vi.fn(() => true);
    registerAppImageScheme({ ...options, fileSystem: memory.fileSystem, run });
    const second = registerAppImageScheme({ ...options, fileSystem: memory.fileSystem, run });
    expect(second.written).toBe(false);
    expect(second.registered).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries xdg-mime on a later launch when the first call failed, and stops once it holds", () => {
    const memory = memoryFileSystem();
    let handler = "";
    const run = vi.fn(() => { if (run.mock.calls.length < 2) return false; handler = "uniwork-office-test.desktop"; return true; });
    const launch = () => registerAppImageScheme({ ...options, fileSystem: memory.fileSystem, run, query: () => handler });
    expect(launch().registered).toBe(false);
    // The entry exists now, yet nothing handles the scheme: ask again.
    const second = launch();
    expect(second.written).toBe(false);
    expect(second.registered).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    launch();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never overrides the user's own handler on a later launch, nor retries when the answer is unreadable", () => {
    const memory = memoryFileSystem();
    const run = vi.fn(() => false);
    registerAppImageScheme({ ...options, fileSystem: memory.fileSystem, run });
    expect(run).toHaveBeenCalledTimes(1);
    expect(registerAppImageScheme({ ...options, fileSystem: memory.fileSystem, run, query: () => "firefox.desktop" }).registered).toBe(false);
    expect(registerAppImageScheme({ ...options, fileSystem: memory.fileSystem, run, query: () => undefined }).registered).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports a refused registration without throwing", () => {
    const memory = memoryFileSystem();
    const result = registerAppImageScheme({ ...options, fileSystem: memory.fileSystem, run: () => false });
    expect(result.written).toBe(true);
    expect(result.registered).toBe(false);
  });

  it("does not throw when xdg-mime is unavailable, on any host", () => {
    // The runner (Ubuntu) does have xdg-mime; the missing-binary path is
    // injected so the assertion does not depend on the host tooling.
    const root = mkdtempSync(join(tmpdir(), "uniwork-appimage-"));
    try {
      const result = registerAppImageScheme({ ...options, dataHomeDirectory: root, run: () => false });
      expect(readFileSync(result.desktopFilePath, "utf8")).toContain("x-scheme-handler/uniwork-office-dev;");
      expect(result.registered).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("installs the brand icon and ties the window to the entry", () => {
    const memory = memoryFileSystem();
    const result = registerAppImageScheme({ ...options, iconPath: "/app.asar/dist/icons/icon.png", wmClass: "uniwork-office-dev", fileSystem: memory.fileSystem, run: () => true });
    const entry = memory.files.get(result.desktopFilePath);
    expect(entry).toContain("Name=UniWork Office (test)");
    expect(entry).toContain("Icon=uniwork-office-test\n");
    expect(entry).toContain("StartupWMClass=uniwork-office-dev\n");
    expect(memory.files.get(join(options.dataHomeDirectory, "icons", "hicolor", "512x512", "apps", "uniwork-office-test.png"))).toBe("copy:/app.asar/dist/icons/icon.png");
  });

  it("keeps the entry when the icon cannot be copied", () => {
    const memory = memoryFileSystem();
    const fileSystem = { ...memory.fileSystem, copyFileSync: () => { throw new Error("EACCES"); } };
    const result = registerAppImageScheme({ ...options, iconPath: "/missing.png", fileSystem, run: () => true });
    expect(result.written).toBe(true);
    expect(memory.files.get(result.desktopFilePath)).toContain("Icon=uniwork-office-test");
  });

  it("adds Icon=/StartupWMClass= on upgrade without re-running xdg-mime, keeping the user's handler", () => {
    const memory = memoryFileSystem();
    const run = vi.fn(() => true);
    // The entry an older build wrote: no icon, no WM class.
    const first = registerAppImageScheme({ ...options, fileSystem: memory.fileSystem, run });
    expect(run).toHaveBeenCalledTimes(1);
    const upgraded = registerAppImageScheme({ ...options, iconPath: "/dist/icons/icon.png", wmClass: "uniwork-office-dev", fileSystem: memory.fileSystem, run });
    expect(upgraded.written).toBe(true);
    expect(upgraded.registered).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(memory.files.get(first.desktopFilePath)).toContain("Icon=uniwork-office-test\n");
    // A moved AppImage rewrites Exec= under the same desktop file name: still no new default.
    registerAppImageScheme({ ...options, appImagePath: "/opt/UniWork.AppImage", iconPath: "/dist/icons/icon.png", wmClass: "uniwork-office-dev", fileSystem: memory.fileSystem, run });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries a failed icon copy on the next launch, and copies nothing once the icon is installed", () => {
    const memory = memoryFileSystem();
    const iconTarget = join(options.dataHomeDirectory, "icons", "hicolor", "512x512", "apps", "uniwork-office-test.png");
    let failing = true;
    const copyFileSync = vi.fn((source: string, destination: string) => {
      if (failing) throw new Error("EACCES");
      memory.files.set(destination, `copy:${source}`);
    });
    const launch = () => registerAppImageScheme({ ...options, iconPath: "/dist/icons/icon.png", fileSystem: { ...memory.fileSystem, copyFileSync }, run: () => true });
    expect(launch().written).toBe(true);
    expect(memory.files.has(iconTarget)).toBe(false);
    failing = false;
    // The entry is unchanged, so nothing is rewritten, but the missing icon is copied.
    expect(launch().written).toBe(false);
    expect(memory.files.get(iconTarget)).toBe("copy:/dist/icons/icon.png");
    launch();
    expect(copyFileSync).toHaveBeenCalledTimes(2);
  });

  it("writes no Icon line without an icon", () => {
    expect(desktopEntryForAppImage(options)).not.toContain("Icon=");
    expect(desktopEntryForAppImage(options)).not.toContain("StartupWMClass=");
  });
});
