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
});
