import { DESKTOP_INSTALLER_KINDS, type DesktopOS, type DesktopPlatform, type OfficeChannel, type OfficeInstallerOption } from "@uniwork/core/office";
import type { OfficeRelease, OfficeReleaseChannel, OfficeReleases } from "@uniwork/core/api/endpoints/office-releases";

// The manifest's types and the endpoint live in @uniwork/core; these helpers
// stay here because the office page is the only reader of the manifest.
export type ReleaseChannel = OfficeChannel;
export const RELEASE_CHANNELS: readonly ReleaseChannel[] = ["stable", "beta", "dev"];

/** The most stable channel that has a release; the section opens on it. */
export function defaultChannel(manifest: OfficeReleases): ReleaseChannel | null {
  return RELEASE_CHANNELS.find((channel) => manifest.channels[channel]) ?? null;
}

export function latestRelease(entry: OfficeReleaseChannel): OfficeRelease | undefined {
  return entry.releases.find((release) => release.version === entry.latest) ?? entry.releases[0];
}

export const channelLatests = (manifest: OfficeReleases): Record<string, string> =>
  Object.fromEntries(RELEASE_CHANNELS.flatMap((channel) => { const entry = manifest.channels[channel]; return entry ? [[channel, entry.latest]] : []; }));

/**
 * One thing a visitor can download, in the visitor's vocabulary: no checksums,
 * no signing state. Both macOS chips stay (named by chip, never "old" or "new").
 * The manifest and the `office_installers` fallback both reduce to this.
 */
export type FileId = "win" | "mac_arm" | "mac_intel" | "deb" | "appimage";
export interface DlFile { id: FileId; os: DesktopOS; url: string; size?: number }

export const FILE_OS: Record<FileId, DesktopOS> = { win: "windows", mac_arm: "macos", mac_intel: "macos", deb: "linux", appimage: "linux" };
const FILE_ORDER: readonly FileId[] = ["win", "mac_arm", "mac_intel", "deb", "appimage"];
const BY_PLATFORM: Partial<Record<DesktopPlatform, FileId>> = { "win32-x64": "win", "darwin-arm64": "mac_arm", "darwin-x64": "mac_intel", "linux-x64-deb": "deb", "linux-x64-appimage": "appimage" };
/** The manifest's (platform, arch, kind) of every build the page offers; any other row (checksums, a new arch) is not offered. */
const BY_ASSET: Record<string, FileId> = { "win32/x64/nsis": "win", "darwin/arm64/dmg": "mac_arm", "darwin/x64/dmg": "mac_intel", "linux/x64/deb": "deb", "linux/x64/appimage": "appimage" };

/** Fixed order, one file per build: a repeated row keeps the first link. */
function uniqueSorted(files: DlFile[]): DlFile[] {
  const seen = new Set<FileId>();
  return files.filter((file) => !seen.has(file.id) && seen.add(file.id)).sort((a, b) => FILE_ORDER.indexOf(a.id) - FILE_ORDER.indexOf(b.id));
}

export function releaseFiles(release: OfficeRelease): DlFile[] {
  return uniqueSorted(release.assets.flatMap((asset): DlFile[] => {
    const id = BY_ASSET[`${asset.platform}/${asset.arch}/${asset.kind}`];
    return id ? [{ id, os: FILE_OS[id], url: asset.url, size: asset.size }] : [];
  }));
}

/** The fallback: today's `office_installers` rows (a portable ZIP is not offered here). */
export function installerFiles(installers: readonly OfficeInstallerOption[]): DlFile[] {
  return uniqueSorted(installers.flatMap((row): DlFile[] => {
    const id = BY_PLATFORM[row.platform];
    return id ? [{ id, os: DESKTOP_INSTALLER_KINDS[row.platform].os, url: row.url, size: row.size_bytes }] : [];
  }));
}

/** Fixed group order, so the page never reshuffles; the visitor's own group is marked, not moved (on a phone CSS moves it first). */
export const OS_ORDER: readonly DesktopOS[] = ["windows", "macos", "linux"];

export const megabytes = (size: number): string => (size / 1048576).toFixed(1);
