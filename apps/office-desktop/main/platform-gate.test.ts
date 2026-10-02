import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareVersions, evaluatePlatformGate, forcedPlatformGate, forcedGateFailure, parseOsRelease, readLinuxOsRelease, PLATFORM_GATE_FLAG } from "./platform-gate";

const UBUNTU_24 = 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\nVERSION_ID="24.04"\n';
const UBUNTU_20 = 'NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="20.04"\n';
const DEBIAN_12 = 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nID=debian\nVERSION_ID="12"\n';

describe("platform release parsing", () => {
  it("parses quoted, bare and commented os-release lines", () => {
    expect(parseOsRelease('A="one"\nB=two\n# comment\n\nC=\'three\'\n')).toEqual({ A: "one", B: "two", C: "three" });
    expect(parseOsRelease("NO_EQUALS\n=empty")).toEqual({});
  });

  it("compares dotted versions numerically with missing segments as zero", () => {
    expect(compareVersions("22.04", "22.04")).toBe(0);
    expect(compareVersions("24.04", "22.04")).toBeGreaterThan(0);
    expect(compareVersions("20.04", "22.04")).toBeLessThan(0);
    expect(compareVersions("12", "11.9")).toBeGreaterThan(0);
    expect(compareVersions("9", "10")).toBeLessThan(0);
  });

  it("reads an os-release file and returns undefined when it cannot be read", () => {
    const root = mkdtempSync(join(tmpdir(), "uniwork-os-release-"));
    try {
      const file = join(root, "os-release");
      writeFileSync(file, DEBIAN_12);
      expect(readLinuxOsRelease(file)).toContain("ID=debian");
      expect(readLinuxOsRelease(join(root, "missing"))).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("startup platform gate", () => {
  it("accepts the supported Windows, macOS and Linux floors", () => {
    expect(evaluatePlatformGate({ platform: "win32", arch: "x64", release: "10.0.19045" })).toEqual({ ok: true });
    expect(evaluatePlatformGate({ platform: "win32", arch: "x64", release: "10.0.22631" })).toEqual({ ok: true });
    expect(evaluatePlatformGate({ platform: "darwin", arch: "arm64", systemVersion: "13.6.1" })).toEqual({ ok: true });
    expect(evaluatePlatformGate({ platform: "darwin", arch: "x64", systemVersion: "15.0" })).toEqual({ ok: true });
    expect(evaluatePlatformGate({ platform: "linux", arch: "x64", osRelease: UBUNTU_24 })).toEqual({ ok: true });
    expect(evaluatePlatformGate({ platform: "linux", arch: "x64", osRelease: DEBIAN_12 })).toEqual({ ok: true });
  });

  it("refuses Windows older than 10 with the reported release", () => {
    const result = evaluatePlatformGate({ platform: "win32", arch: "x64", release: "6.3.9600" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("windows_too_old");
    expect(result.failure.messageEn).toContain("6.3.9600");
    expect(result.failure.messageVi).toContain("Windows 10");
  });

  it("refuses a non-x64 Windows architecture", () => {
    const result = evaluatePlatformGate({ platform: "win32", arch: "ia32", release: "10.0.19045" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("windows_not_64bit");
    expect(result.failure.messageEn).toContain("ia32");
  });

  it("refuses macOS before 13 and accepts an unknown version", () => {
    const old = evaluatePlatformGate({ platform: "darwin", arch: "arm64", systemVersion: "12.7.6" });
    expect(old.ok).toBe(false);
    if (!old.ok) expect(old.failure.code).toBe("macos_too_old");
    expect(evaluatePlatformGate({ platform: "darwin", arch: "arm64" })).toEqual({ ok: true });
  });

  it("refuses Ubuntu before 22.04 and Debian before 11 but allows other distributions", () => {
    const oldUbuntu = evaluatePlatformGate({ platform: "linux", arch: "x64", osRelease: UBUNTU_20 });
    expect(oldUbuntu.ok).toBe(false);
    if (!oldUbuntu.ok) {
      expect(oldUbuntu.failure.code).toBe("linux_too_old");
      expect(oldUbuntu.failure.messageEn).toContain("Ubuntu 20.04");
    }
    const oldDebian = evaluatePlatformGate({ platform: "linux", arch: "x64", osRelease: 'ID=debian\nVERSION_ID="10"\n' });
    expect(oldDebian.ok).toBe(false);
    if (!oldDebian.ok) expect(oldDebian.failure.code).toBe("linux_too_old");
    expect(evaluatePlatformGate({ platform: "linux", arch: "x64", osRelease: 'ID=fedora\nVERSION_ID="40"\n' })).toEqual({ ok: true });
    expect(evaluatePlatformGate({ platform: "linux", arch: "x64" })).toEqual({ ok: true });
  });

  it("maps the dev test seam to the production failure it simulates", () => {
    expect(forcedGateFailure("windows_too_old", { platform: "linux", arch: "x64" }).messageEn).toContain("Windows 10");
    expect(forcedGateFailure("windows_not_64bit", { platform: "linux", arch: "x64" }).code).toBe("windows_not_64bit");
    expect(forcedGateFailure("macos_too_old", { platform: "linux", arch: "x64" }).messageEn).toContain("macOS 13");
    expect(forcedGateFailure("linux_too_old", { platform: "win32", arch: "x64" }).messageEn).toContain("20.04");
    expect(forcedGateFailure("linux_unsupported_distribution", { platform: "win32", arch: "x64" }).messageEn).toContain("Fedora");
    expect(forcedGateFailure("anything-else", { platform: "win32", arch: "x64" }).code).toBe("forced");
    // A forced failure for another platform never leaks this host's strings.
    expect(forcedGateFailure("macos_too_old", { platform: "linux", arch: "x64", systemVersion: "6.12.94+" }).messageEn).toContain("12.7.6");
    expect(forcedGateFailure("windows_too_old", { platform: "linux", arch: "x64", release: "6.12.94" }).messageEn).toContain("10.0.10240");
    const forced = evaluatePlatformGate({ platform: "linux", arch: "x64", osRelease: UBUNTU_24, forcedFailure: "windows_too_old" });
    expect(forced.ok).toBe(false);
    if (!forced.ok) expect(forced.failure.code).toBe("windows_too_old");
  });

  it("honors the forced flag only for dev or smoke launches", () => {
    expect(forcedPlatformGate([`${PLATFORM_GATE_FLAG}macos_too_old`, "app"], { packaged: false, smokeMode: false })).toBe("macos_too_old");
    expect(forcedPlatformGate([`${PLATFORM_GATE_FLAG}macos_too_old`], { packaged: true, smokeMode: true })).toBe("macos_too_old");
    expect(forcedPlatformGate([`${PLATFORM_GATE_FLAG}macos_too_old`], { packaged: true, smokeMode: false })).toBeUndefined();
    expect(forcedPlatformGate(["app"], { packaged: false, smokeMode: false })).toBeUndefined();
  });
});
