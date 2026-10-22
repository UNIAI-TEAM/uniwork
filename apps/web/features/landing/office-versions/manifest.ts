import type { DesktopOS } from "@uniwork/core/office";

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

/** The most stable channel that has a release; the page opens on it. */
export function defaultChannel(manifest: ReleasesManifest): ReleaseChannel | null {
  return RELEASE_CHANNELS.find((channel) => (manifest.channels[channel]?.releases.length ?? 0) > 0) ?? null;
}

export function latestRelease(entry: ChannelEntry): Release | undefined {
  return entry.releases.find((release) => release.version === entry.latest) ?? entry.releases[0];
}

export const channelLatests = (manifest: ReleasesManifest): Record<string, string> =>
  Object.fromEntries(RELEASE_CHANNELS.flatMap((channel) => { const entry = manifest.channels[channel]; return entry ? [[channel, entry.latest]] : []; }));

/** A release's installable files grouped by the visitor's vocabulary: Windows, macOS, Linux. */
export interface AssetGroup { os: DesktopOS; assets: ReleaseAsset[] }
const OS_OF = { win32: "windows", darwin: "macos", linux: "linux" } as const;
const OS_ORDER: readonly DesktopOS[] = ["windows", "macos", "linux"];

export function groupAssets(release: Release, own: DesktopOS | null): { groups: AssetGroup[]; checksums: ReleaseAsset | undefined } {
  const installable = release.assets.filter((asset) => asset.kind !== "checksums" && asset.platform !== "all");
  const groups = OS_ORDER.flatMap((os) => {
    const assets = installable.filter((asset) => OS_OF[asset.platform as keyof typeof OS_OF] === os);
    return assets.length > 0 ? [{ os, assets }] : [];
  });
  // The visitor's own system leads; the rest keep the published order.
  groups.sort((a, b) => Number(b.os === own) - Number(a.os === own));
  return { groups, checksums: release.assets.find((asset) => asset.kind === "checksums") };
}

/** The `office.desktop.install.fmt.*` key that names one installer ("Apple Silicon · .dmg"). */
export function formatKey(asset: ReleaseAsset): "win_exe" | "mac_arm" | "mac_intel" | "deb" | "appimage" {
  if (asset.kind === "nsis") return "win_exe";
  if (asset.kind === "dmg") return asset.arch === "arm64" ? "mac_arm" : "mac_intel";
  return asset.kind === "deb" ? "deb" : "appimage";
}

export function signedOf(release: Release, os: DesktopOS): boolean {
  return release.signed[os];
}

export const shortSha = (sha256: string): string => `${sha256.slice(0, 8)}…${sha256.slice(-6)}`;
export const megabytes = (size: number): string => (size / 1048576).toFixed(1);
