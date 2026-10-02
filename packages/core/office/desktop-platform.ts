import type { OfficeChannel } from "./desktop-handoff";

// Ordered artifact contract shared with the server and desktop packager.
export const DESKTOP_INSTALLER_KINDS = {
  "win32-x64": { os: "windows", kind: ".exe", format: "win_exe", requirement: "windows", steps: ["extract", "win_exe_run", "win_exe_unsigned"] },
  "win32-x64-zip": { os: "windows", kind: ".zip", format: "win_zip", requirement: "windows", steps: ["extract", "win_zip_extract", "win_zip_run"] },
  "darwin-arm64": { os: "macos", kind: ".dmg", format: "mac_arm", requirement: "macos", steps: ["extract", "mac_open", "mac_drag", "mac_unsigned"] },
  "darwin-x64": { os: "macos", kind: ".dmg", format: "mac_intel", requirement: "macos", steps: ["extract", "mac_open", "mac_drag", "mac_unsigned"] },
  "linux-x64-deb": { os: "linux", kind: ".deb", format: "deb", requirement: "deb", steps: ["extract", "deb_install", "deb_open"] },
  "linux-x64-appimage": { os: "linux", kind: ".AppImage", format: "appimage", requirement: "appimage", steps: ["extract", "appimage_run", "appimage_fuse"] },
} as const;

export const DESKTOP_INSTALLER_COMMANDS: Partial<Record<string, string>> = {
  deb_install: "sudo apt install ./{{file}}",
  appimage_run: "chmod +x ./{{file}} && ./{{file}}",
  appimage_fuse: "sudo apt install libfuse2",
};

export type DesktopPlatform = keyof typeof DESKTOP_INSTALLER_KINDS;
export type DesktopOS = (typeof DESKTOP_INSTALLER_KINDS)[DesktopPlatform]["os"];
export const DESKTOP_PLATFORMS = Object.keys(DESKTOP_INSTALLER_KINDS) as DesktopPlatform[];
export function isDesktopPlatform(value: string): value is DesktopPlatform {
  return Object.hasOwn(DESKTOP_INSTALLER_KINDS, value);
}

export interface OfficeInstallerOption {
  platform: DesktopPlatform;
  url: string;
  kind: string;
  channel: OfficeChannel;
  size_bytes?: number;
  sha256?: string;
  version?: string;
  unsigned?: boolean;
  requirements?: string;
}

export interface DesktopPlatformGuess {
  platform: DesktopPlatform | null;
  confidence: "certain" | "uncertain" | "unsupported";
}

export interface DesktopPlatformHints {
  userAgent?: string;
  userAgentData?: { platform?: string; architecture?: string; bitness?: string; mobile?: boolean };
}

/** Browser hosts gather UA Client Hints; core never reads navigator. Mac UAs
 * are frozen as Intel on Apple Silicon, so only high entropy hints prove arch. */
export function detectDesktopPlatform(hints: DesktopPlatformHints): DesktopPlatformGuess {
  const ua = hints.userAgent?.toLowerCase() ?? "";
  const data = hints.userAgentData;
  const platform = data?.platform?.toLowerCase() ?? "";
  const arch = data?.architecture?.toLowerCase() ?? "";
  const unsupported: DesktopPlatformGuess = { platform: null, confidence: "unsupported" };
  if (data?.mobile || /android|iphone|ipad|ipod|mobile|cros/.test(ua) || /android|ios|chrome ?os/.test(platform)) return unsupported;
  if (/windows/.test(platform || ua)) {
    if (data?.bitness === "32" || (!arch && /wow32|win32|i[3-6]86/.test(ua))) return unsupported;
    return { platform: "win32-x64", confidence: "certain" };
  }
  if (/mac/.test(platform || ua)) {
    if (/arm/.test(arch)) return { platform: "darwin-arm64", confidence: "certain" };
    if (/x86|x64|amd64/.test(arch)) return { platform: "darwin-x64", confidence: "certain" };
    return { platform: "darwin-arm64", confidence: "uncertain" };
  }
  if (/linux|ubuntu/.test(platform || ua)) {
    if (/arm|aarch/.test(arch || ua) || data?.bitness === "32") return unsupported;
    if (/x86|x64|amd64/.test(arch) || /x86_64|amd64/.test(ua)) return { platform: "linux-x64-deb", confidence: "certain" };
  }
  return unsupported;
}
