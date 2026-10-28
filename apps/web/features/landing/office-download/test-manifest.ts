/**
 * Test data only: a release manifest in the shape the release job writes
 * (uniwork-office tools/release/release-manifest.mjs, schema 1), served the way
 * the page reads it. dev has two releases, beta one, stable none.
 */
const BASE = "https://uniworkos.com/downloads/office";
const MB = 1048576;

export const assetUrl = (channel: string, version: string, file: string) => `${BASE}/${channel}/${version}/${file}`;

function release(channel: string, version: string, publishedAt: string, notes: string | null, skip: readonly string[] = []) {
  const files = [
    ["win32", "x64", "nsis", `UniWork-Office_${version}_unsigned_win32_x64-setup.exe`, 94.8],
    ["darwin", "arm64", "dmg", `UniWork-Office_${version}_darwin_arm64.dmg`, 108.2],
    ["darwin", "x64", "dmg", `UniWork-Office_${version}_darwin_x64.dmg`, 112.4],
    ["linux", "x64", "deb", `uniwork-office_${version}_linux_x64.deb`, 82.6],
    ["linux", "x64", "appimage", `UniWork-Office_${version}_linux_x64.AppImage`, 118.3],
    ["linux", "x64", "checksums", "SHA256SUMS-linux-x64.txt", 0.001],
  ] as const;
  return {
    version, channel, tag: `v${version}`, published_at: publishedAt, git_sha: "c".repeat(40), notes_markdown: notes, notes_url: null,
    signed: { windows: false, macos: true, linux: true },
    apt: { suite: channel, package: "uniwork-office", version: version.replace(`-${channel}`, `~${channel}`) },
    assets: files.filter(([, , kind]) => !skip.includes(kind)).map(([platform, arch, kind, file, mb]) => ({
      platform, arch, kind, file, url: assetUrl(channel, version, file), size: Math.round(mb * MB), sha256: "d".repeat(64), signed: !file.includes("_unsigned_"),
    })),
  };
}

/** `newer` adds the dev release a later re-check finds; `skip` leaves those kinds out of every release. */
export function testManifest({ newer = false, skip = [] }: { newer?: boolean; skip?: readonly string[] } = {}) {
  const dev = [
    release("dev", "0.11.0-dev.3", "2026-10-24T03:40:00Z", "### Mới\n- Mở file `.xlsx` lớn nhanh hơn.", skip),
    release("dev", "0.11.0-dev.2", "2026-10-20T09:12:00Z", "### Đã sửa\n- Sửa lỗi khi mở PDF có mật khẩu.", skip),
  ];
  if (newer) dev.unshift(release("dev", "0.11.0-dev.4", "2026-10-25T11:30:00Z", null, skip));
  const channel = (releases: ReturnType<typeof release>[], name: string) => ({
    latest: releases[0]!.version, apt_suite: name, latest_deb_url: `${BASE}/apt/latest/${name}/uniwork-office_amd64.deb`, releases,
  });
  return {
    schema: 1, generated_at: "2026-10-25T11:31:00Z", base_url: BASE,
    channels: { dev: channel(dev, "dev"), beta: channel([release("beta", "0.10.0-beta.1", "2026-10-14T08:30:00Z", null, skip)], "beta") },
  };
}

/** Every link the manifest publishes, checksums included. */
export const manifestUrls = (manifest: ReturnType<typeof testManifest>) =>
  new Set(Object.values(manifest.channels).flatMap((entry) => entry.releases.flatMap((item) => item.assets.map((asset) => asset.url))));

export const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
