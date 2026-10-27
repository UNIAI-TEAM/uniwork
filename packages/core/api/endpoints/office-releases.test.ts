import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOfficeReleases, OFFICE_RELEASES_URL } from "./office-releases";

const BASE = "https://uniworkos.com/downloads/office";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// The shape tools/release/release-manifest.mjs (uniwork-office) writes: schema 1, per-platform checksum rows,
// `latest_deb_url` beside a channel whose deb carries the apt source, `apt.version` with the tilde.
function asset(platform: string, arch: string, kind: string, file: string, size = 1000) {
  return { platform, arch, kind, file, url: `${BASE}/dev/0.11.0-dev.3/${file}`, size, sha256: "a".repeat(64), signed: !file.includes("_unsigned_") };
}
const RELEASE = {
  version: "0.11.0-dev.3", channel: "dev", tag: "v0.11.0-dev.3", published_at: "2026-10-24T03:40:00Z", git_sha: "b".repeat(40),
  notes_markdown: "### Mới\n- Một điều mới", notes_url: null, signed: { windows: false, macos: true, linux: true },
  apt: { suite: "dev", package: "uniwork-office", version: "0.11.0~dev.3" },
  assets: [
    asset("win32", "x64", "nsis", "UniWork-Office_0.11.0-dev.3_unsigned_win32_x64-setup.exe"),
    asset("darwin", "arm64", "dmg", "UniWork-Office_0.11.0-dev.3_darwin_arm64.dmg"),
    asset("linux", "x64", "deb", "uniwork-office_0.11.0-dev.3_linux_x64.deb"),
    asset("linux", "x64", "checksums", "SHA256SUMS-linux-x64.txt", 120),
  ],
};
const MANIFEST = {
  schema: 1, generated_at: "2026-10-24T03:41:00Z", base_url: BASE,
  channels: { dev: { latest: "0.11.0-dev.3", apt_suite: "dev", latest_deb_url: `${BASE}/apt/latest/dev/uniwork-office_amd64.deb`, releases: [RELEASE] } },
};

describe("office releases endpoint", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reads the same-origin manifest without credentials or cache, and keeps only what the page shows", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(MANIFEST));
    const signal = new AbortController().signal;
    const manifest = await getOfficeReleases(signal);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(OFFICE_RELEASES_URL, { cache: "no-store", credentials: "omit", signal });
    expect(OFFICE_RELEASES_URL).toBe("/downloads/office/releases.json");
    expect(manifest).toEqual({
      channels: {
        dev: {
          latest: "0.11.0-dev.3",
          releases: [{
            version: "0.11.0-dev.3", published_at: "2026-10-24T03:40:00Z", notes_markdown: "### Mới\n- Một điều mới",
            assets: RELEASE.assets.map(({ platform, arch, kind, url, size }) => ({ platform, arch, kind, url, size })),
          }],
        },
      },
    });
  });

  it("returns null for a file that is not a manifest", async () => {
    for (const body of [null, [], "releases", { schema: 1 }, { channels: [] }, { channels: "dev" }]) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(getOfficeReleases()).resolves.toBeNull();
    }
  });

  it("throws on a failed request or a body that is not JSON, so the caller can fall back", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: "missing" }, 404));
    await expect(getOfficeReleases()).rejects.toThrow("404");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("<html>gateway</html>", { status: 200 }));
    await expect(getOfficeReleases()).rejects.toThrow();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(getOfficeReleases()).rejects.toThrow("Failed to fetch");
  });

  it("drops unknown channels, empty channels and broken releases, and keeps the rest", async () => {
    const broken = { ...RELEASE, version: 7 };
    vi.mocked(fetch).mockResolvedValueOnce(json({
      ...MANIFEST,
      future: { anything: true },
      channels: {
        ...MANIFEST.channels,
        nightly: MANIFEST.channels.dev,
        beta: { latest: "1", apt_suite: "beta", releases: [broken] },
        stable: "soon",
      },
    }));
    const manifest = await getOfficeReleases();
    expect(Object.keys(manifest?.channels ?? {})).toEqual(["dev"]);
  });

  it("degrades drifted fields one by one instead of losing the release", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({
      schema: 2,
      channels: {
        dev: {
          latest: 42,
          releases: [
            { version: "0.11.0-dev.3", published_at: "not a date", notes_markdown: 12, assets: [
              { ...RELEASE.assets[0], size: "big" },
              { ...RELEASE.assets[1], url: "javascript:alert(1)" },
              { ...RELEASE.assets[2], url: "http://uniworkos.com/x.deb" },
              { platform: "linux", kind: "deb" },
              "garbage",
            ] },
            { version: "0.11.0-dev.2", assets: "none" },
            { notes_markdown: "no version" },
          ],
        },
      },
    }));
    const dev = (await getOfficeReleases())?.channels.dev;
    // A `latest` that names no listed release falls back to the newest listed one.
    expect(dev?.latest).toBe("0.11.0-dev.3");
    expect(dev?.releases.map((release) => release.version)).toEqual(["0.11.0-dev.3", "0.11.0-dev.2"]);
    const [latest, older] = dev?.releases ?? [];
    expect(latest?.published_at).toBeUndefined();
    expect(latest?.notes_markdown).toBeNull();
    // Only https links survive; a size that is not a number is simply not shown.
    expect(latest?.assets).toEqual([{ platform: "win32", arch: "x64", kind: "nsis", url: RELEASE.assets[0]!.url }]);
    expect(older?.assets).toEqual([]);
    expect(older?.notes_markdown).toBeNull();
  });
});
