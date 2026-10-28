import { z } from "zod";
import { parseWithFallback } from "../schema";
import type { OfficeChannel } from "../../office/desktop-handoff";

/**
 * The public release manifest of UniWork Office (schema 1), written by the
 * release job (uniwork-office `tools/release/release-manifest.mjs`) and served
 * beside the installers on the site's own origin. It needs no session, so it
 * is read with `fetch` rather than the API transport.
 */
export const OFFICE_RELEASES_URL = "/downloads/office/releases.json";

const CHANNELS: readonly OfficeChannel[] = ["dev", "beta", "stable"];

/** One downloadable file. `platform`, `arch` and `kind` stay strings: the page ignores the ones it does not know. */
export interface OfficeReleaseAsset { platform: string; arch: string; kind: string; url: string; size?: number }
export interface OfficeRelease {
  version: string;
  published_at?: string;
  /** Untrusted markdown; the page renders it without HTML. */
  notes_markdown: string | null;
  assets: OfficeReleaseAsset[];
}
/** `latest` always names one of `releases`, which is never empty. */
export interface OfficeReleaseChannel { latest: string; releases: OfficeRelease[] }
/** A channel that was never published (stable, today) is absent. */
export interface OfficeReleases { channels: Partial<Record<OfficeChannel, OfficeReleaseChannel>> }

function isHttps(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

/** A list whose broken rows are dropped one by one; anything that is not a list reads as empty. */
function listOf<T>(item: z.ZodType<T>) {
  return z.array(z.unknown()).catch([]).transform((rows) => rows.flatMap((row) => {
    const parsed = item.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  }));
}

// Only what the page shows is read. tag, git_sha, signed, sha256, apt and
// latest_deb_url are left out on purpose: the page names no signing state or
// checksum, and every apt line comes from @uniwork/core/office.
const AssetSchema = z.object({
  platform: z.string(),
  arch: z.string(),
  kind: z.string(),
  url: z.string().refine(isHttps),
  size: z.number().positive().optional().catch(undefined),
});

const ReleaseSchema = z.object({
  version: z.string().min(1),
  published_at: z.string().refine((value) => !Number.isNaN(Date.parse(value))).optional().catch(undefined),
  notes_markdown: z.string().nullable().catch(null).default(null),
  assets: listOf(AssetSchema),
});

const ChannelSchema = z.object({
  latest: z.string().catch(""),
  releases: listOf(ReleaseSchema),
}).transform((entry): OfficeReleaseChannel | null => {
  const latest = entry.releases.find((release) => release.version === entry.latest) ?? entry.releases[0];
  return latest ? { latest: latest.version, releases: entry.releases } : null;
});

const ReleasesSchema = z.object({ channels: z.record(z.string(), z.unknown()) }).transform(({ channels }): OfficeReleases => {
  const out: OfficeReleases["channels"] = {};
  for (const channel of CHANNELS) {
    const parsed = ChannelSchema.safeParse(channels[channel]);
    if (parsed.success && parsed.data) out[channel] = parsed.data;
  }
  return { channels: out };
});

/**
 * The manifest as the page reads it. A failed request or a body that is not
 * JSON throws, and a JSON answer that is not a manifest is `null`: either way
 * the caller falls back to the installers it already knows.
 */
export async function getOfficeReleases(signal?: AbortSignal): Promise<OfficeReleases | null> {
  const res = await fetch(OFFICE_RELEASES_URL, { cache: "no-store", credentials: "omit", signal });
  if (!res.ok) throw new Error(`office releases: HTTP ${res.status}`);
  const raw: unknown = await res.json();
  return parseWithFallback<OfficeReleases | null>(raw, ReleasesSchema, null, { endpoint: "office-releases" });
}
