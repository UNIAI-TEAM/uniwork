import { DESKTOP_INSTALLER_KINDS, type DesktopOS, type DesktopPlatform, type OfficeInstallerOption } from "@uniwork/core/office";

/** The public release manifest, schema v1 (`/downloads/office/releases.json`). */
export type ReleaseChannel = "dev" | "beta" | "stable";
export const RELEASE_CHANNELS: readonly ReleaseChannel[] = ["stable", "beta", "dev"];

export interface ReleaseAsset {
  platform: "win32" | "darwin" | "linux" | "all";
  arch: "x64" | "arm64" | "all";
  kind: "nsis" | "dmg" | "deb" | "appimage" | "checksums";
  file: string;
  url: string;
  size: number;
  sha256: string;
  signed: boolean;
}

export interface Release {
  version: string;
  channel: ReleaseChannel;
  tag: string;
  published_at: string;
  git_sha: string;
  /** Untrusted markdown: rendered only through `ReleaseNotes`. */
  notes_markdown: string | null;
  notes_url: null;
  signed: { windows: boolean; macos: boolean; linux: boolean };
  apt: { suite: string; package: string; version: string } | null;
  assets: ReleaseAsset[];
}

export interface ChannelEntry { latest: string; apt_suite: string; releases: Release[] }
export interface ReleasesManifest {
  schema: 1;
  generated_at: string;
  base_url: string;
  /** A channel that was never published is absent (stable, today). */
  channels: Partial<Record<ReleaseChannel, ChannelEntry>>;
}

/** The most stable channel that has a release; the section opens on it. */
export function defaultChannel(manifest: ReleasesManifest): ReleaseChannel | null {
  return RELEASE_CHANNELS.find((channel) => (manifest.channels[channel]?.releases.length ?? 0) > 0) ?? null;
}

export function latestRelease(entry: ChannelEntry): Release | undefined {
  return entry.releases.find((release) => release.version === entry.latest) ?? entry.releases[0];
}

export const channelLatests = (manifest: ReleasesManifest): Record<string, string> =>
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
const sortFiles = (files: DlFile[]): DlFile[] => files.sort((a, b) => FILE_ORDER.indexOf(a.id) - FILE_ORDER.indexOf(b.id));

export function releaseFiles(release: Release): DlFile[] {
  const files = release.assets.flatMap((asset): DlFile[] => {
    const id: FileId | null = asset.kind === "nsis" ? "win" : asset.kind === "deb" ? "deb" : asset.kind === "appimage" ? "appimage" : asset.kind === "dmg" ? (asset.arch === "arm64" ? "mac_arm" : "mac_intel") : null;
    return id ? [{ id, os: FILE_OS[id], url: asset.url, size: asset.size }] : [];
  });
  return sortFiles(files);
}

/** The fallback: today's `office_installers` rows (a portable ZIP is not offered here). */
export function installerFiles(installers: readonly OfficeInstallerOption[]): DlFile[] {
  const files = installers.flatMap((row): DlFile[] => {
    const id = BY_PLATFORM[row.platform];
    return id ? [{ id, os: DESKTOP_INSTALLER_KINDS[row.platform].os, url: row.url, size: row.size_bytes }] : [];
  });
  return sortFiles(files);
}

/** The visitor's system leads: its files first (a proven Mac chip first among them), then everyone else's. */
export function orderFor(files: readonly DlFile[], own: DesktopOS | null, chip: FileId | null): { lead: DlFile[]; others: DlFile[] } {
  const mine = own ? files.filter((file) => file.os === own).sort((a, b) => Number(b.id === chip) - Number(a.id === chip)) : [];
  return { lead: mine, others: files.filter((file) => !mine.includes(file)) };
}

export const megabytes = (size: number): string => (size / 1048576).toFixed(1);
