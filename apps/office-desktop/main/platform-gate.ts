import { readFileSync } from "node:fs";

/** Platform minimums every artifact enforces before the host creates a window
 * or writes any user data. Same floor as spec §6.6: Windows 10/11 x64,
 * macOS 13 Ventura, Ubuntu 22.04 / Debian 11. A Linux install on any other
 * x64 distribution is allowed only because the AppImage targets it; the .deb
 * installer's preinst already refuses it. */
export type PlatformGateCode =
  | "windows_too_old"
  | "windows_not_64bit"
  | "macos_too_old"
  | "linux_too_old"
  | "linux_glibc_too_old"
  | "linux_unsupported_distribution"
  | "forced";

export type PlatformGateFailure = Readonly<{
  code: PlatformGateCode;
  messageVi: string;
  messageEn: string;
}>;

export type PlatformGateResult = Readonly<{ ok: true }> | Readonly<{ ok: false; failure: PlatformGateFailure }>;

export type PlatformGateInput = Readonly<{
  platform: string;
  arch: string;
  release?: string;
  systemVersion?: string;
  osRelease?: string;
  /** From process.report header (glibcVersionRuntime) when Node supplies it. */
  glibcVersion?: string;
  /** Dev/smoke-only seam (--office-desktop-platform-gate=<code>); packaged
   * production launches never pass it. */
  forcedFailure?: string;
}>;

export const WINDOWS_MINIMUM_MAJOR = 10;
export const MACOS_MINIMUM_MAJOR = 13;
export const UBUNTU_MINIMUM_VERSION = "22.04";
export const DEBIAN_MINIMUM_VERSION = "11";
export const GLIBC_MINIMUM_VERSION = "2.31";
export const PLATFORM_GATE_FLAG = "--office-desktop-platform-gate=";

export function parseOsRelease(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || !match[1]) continue;
    let value = (match[2] ?? "").trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

/** Numeric dotted-version comparison; missing segments count as zero. */
export function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function windowsTooOld(release: string): PlatformGateFailure {
  return {
    code: "windows_too_old",
    messageVi: `UniWork Office cần Windows 10 hoặc mới hơn, bản 64-bit. Máy này: Windows ${release}.`,
    messageEn: `UniWork Office requires Windows 10 or newer, 64-bit. This machine reports Windows ${release}.`,
  };
}

function windowsNot64Bit(arch: string): PlatformGateFailure {
  return {
    code: "windows_not_64bit",
    messageVi: `UniWork Office cần bản Windows 64-bit (x64). Kiến trúc hiện tại: ${arch}.`,
    messageEn: `UniWork Office requires 64-bit Windows (x64). Current architecture: ${arch}.`,
  };
}

function macosTooOld(version: string): PlatformGateFailure {
  return {
    code: "macos_too_old",
    messageVi: `UniWork Office cần macOS 13 Ventura trở lên. Máy này: macOS ${version}.`,
    messageEn: `UniWork Office requires macOS 13 Ventura or newer. This machine reports macOS ${version}.`,
  };
}

function linuxTooOld(identity: string, version: string): PlatformGateFailure {
  return {
    code: "linux_too_old",
    messageVi: `UniWork Office cần Ubuntu 22.04/24.04 hoặc Debian 11 trở lên (x64). Máy này: ${identity} ${version}.`,
    messageEn: `UniWork Office requires Ubuntu 22.04/24.04 or Debian 11+ (x64). This machine reports ${identity} ${version}.`,
  };
}

function linuxGlibcTooOld(version: string): PlatformGateFailure {
  return {
    code: "linux_glibc_too_old",
    messageVi: `UniWork Office cần glibc 2.31 trở lên (Ubuntu 22.04/24.04 hoặc Debian 11+). Máy này: glibc ${version}.`,
    messageEn: `UniWork Office requires glibc 2.31+ (Ubuntu 22.04/24.04 or Debian 11+). This machine reports glibc ${version}.`,
  };
}

/** The test seam produces the same failure object a real check would, so a
 * screenshot of the forced dialog shows the production message. A forced code
 * for another platform uses canned values so it never leaks this host's kernel
 * or release string into the message. */
export function forcedGateFailure(code: string, input: PlatformGateInput): PlatformGateFailure {
  if (code === "windows_too_old") return windowsTooOld(input.platform === "win32" ? input.release ?? "10.0.10240" : "10.0.10240");
  if (code === "windows_not_64bit") return windowsNot64Bit(input.platform === "win32" ? input.arch : "ia32");
  if (code === "macos_too_old") return macosTooOld(input.platform === "darwin" ? input.systemVersion ?? "12.7.6" : "12.7.6");
  if (code === "linux_too_old") return linuxTooOld("Ubuntu", "20.04");
  if (code === "linux_glibc_too_old") return linuxGlibcTooOld("2.28");
  if (code === "linux_unsupported_distribution") return linuxTooOld("Fedora", "40");
  return { code: "forced", messageVi: `Kiểm tra nền tảng (thử nghiệm): ${code}`, messageEn: `Platform gate test seam: ${code}` };
}

export function evaluatePlatformGate(input: PlatformGateInput): PlatformGateResult {
  const force = (failure: PlatformGateFailure): PlatformGateResult => ({ ok: false, failure });
  if (input.forcedFailure) return force(forcedGateFailure(input.forcedFailure, input));
  if (input.platform === "win32") {
    const major = Number.parseInt((input.release ?? "").split(".")[0] ?? "", 10);
    if (!Number.isFinite(major) || major < WINDOWS_MINIMUM_MAJOR) return force(windowsTooOld(input.release ?? "unknown"));
    if (input.arch !== "x64") return force(windowsNot64Bit(input.arch));
    return { ok: true };
  }
  if (input.platform === "darwin") {
    const major = Number.parseInt((input.systemVersion ?? "").split(".")[0] ?? "", 10);
    if (Number.isFinite(major) && major < MACOS_MINIMUM_MAJOR) return force(macosTooOld(input.systemVersion ?? "unknown"));
    return { ok: true };
  }
  if (input.platform === "linux") {
    if (input.glibcVersion && compareVersions(input.glibcVersion, GLIBC_MINIMUM_VERSION) < 0) return force(linuxGlibcTooOld(input.glibcVersion));
    const release = parseOsRelease(input.osRelease ?? "");
    const id = (release.ID ?? "").toLowerCase();
    const version = release.VERSION_ID ?? "";
    if (id === "ubuntu" && compareVersions(version, UBUNTU_MINIMUM_VERSION) < 0) return force(linuxTooOld("Ubuntu", version || "unknown"));
    if (id === "debian" && compareVersions(version, DEBIAN_MINIMUM_VERSION) < 0) return force(linuxTooOld("Debian", version || "unknown"));
    return { ok: true };
  }
  return { ok: true };
}

export function readLinuxOsRelease(path = "/etc/os-release"): string | undefined {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
}

/** The forced-failure flag is honored only for an unpackaged dev launch or an
 * explicit smoke run; a packaged production launch ignores it. */
export function forcedPlatformGate(argv: readonly string[], options: { packaged: boolean; smokeMode: boolean }): string | undefined {
  if (options.packaged && !options.smokeMode) return undefined;
  const value = argv.find((argument) => argument.startsWith(PLATFORM_GATE_FLAG));
  return value?.slice(PLATFORM_GATE_FLAG.length);
}
