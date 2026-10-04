/**
 * Markdown image resolution (M5) — the pure rule, no DOM and no transport.
 *
 * A Markdown image authors a RELATIVE path ("assets/logo.png"). The bytes live
 * behind an opaque asset id the host issued; the ONLY way from one to the other
 * is the document asset MANIFEST. This module never builds a bucket name, an
 * object key or an OS path, and it never falls back to the raw authored string:
 * a path that is not in the manifest (or whose entry is not `ready`) becomes a
 * typed `unavailable` state the caller must render as such.
 *
 * The display URL is NOT computed here: the host owns it (a signed URL, an
 * object URL, a proxy route). The view asks the injected `ImageAssetPort` for
 * the URL of an asset id, so the view never learns where the bytes live.
 */
import {
  assetManifestRows,
  hasFailedAsset,
  normaliseAssetPath,
  type AssetManifestLike,
  type AssetStatus,
} from "../../asset-manifest";

/** Why an authored reference did not resolve to a manifest asset. */
export type ImageUnavailableReason =
  | "unsafe_path"
  | "not_in_manifest"
  | "missing"
  | "unauthorised"
  | "failed";

export type ImageResolution =
  /** A relative path with a ready manifest entry and an opaque asset id. */
  | { status: "manifest"; path: string; assetId: string }
  /** A data: URI or an http(s) URL: it carries its own bytes, not a manifest key. */
  | { status: "external"; url: string }
  /** Anything else: a typed refusal, never a raw-path fallback. */
  | { status: "unavailable"; path: string; reason: ImageUnavailableReason };

/** Schemes that carry their own bytes and are not manifest keys. */
const EXTERNAL_SOURCE = /^(?:https?:|data:)/i;

/** The host port that turns an opaque asset id into a display URL. */
export interface ImageAssetPort {
  displayUrl(assetId: string): string | null;
}

/**
 * Resolve one authored `src` against the manifest.
 *
 * `normaliseAssetPath` rejects traversal, absolute/OS paths, drive letters,
 * foreign schemes and control characters, so a rejected value can never reach
 * a host resolver. It returns null for those, which is `unsafe_path` here.
 */
export function resolveImageSource(
  src: string,
  manifest: AssetManifestLike | null | undefined,
): ImageResolution {
  const raw = typeof src === "string" ? src.trim() : "";
  if (raw.length === 0) return { status: "unavailable", path: "", reason: "not_in_manifest" };
  if (EXTERNAL_SOURCE.test(raw)) return { status: "external", url: raw };
  const path = normaliseAssetPath(raw);
  if (path === null) return { status: "unavailable", path: raw, reason: "unsafe_path" };
  const row = assetManifestRows(manifest).find((candidate) => candidate.path === path);
  if (!row) return { status: "unavailable", path, reason: "not_in_manifest" };
  if (row.status === "ready" && row.assetId !== null) {
    return { status: "manifest", path, assetId: row.assetId };
  }
  return { status: "unavailable", path, reason: row.status === "ready" ? "not_in_manifest" : row.status };
}

/**
 * The URL to render, or null when there is nothing honest to show. A null
 * result is what makes an unresolved image a typed unavailable state instead
 * of a silent fallback to the authored path.
 */
export function imageDisplayUrl(
  resolution: ImageResolution,
  port: ImageAssetPort | undefined | null,
): string | null {
  if (resolution.status === "external") return resolution.url;
  if (resolution.status !== "manifest" || !port) return null;
  const url = port.displayUrl(resolution.assetId);
  return typeof url === "string" && url.length > 0 ? url : null;
}

/**
 * The failed-asset invariant, shared with the source editor: a document whose
 * manifest has any non-ready entry (or any recorded host failure) cannot be
 * saved. A failed paste/drop upload is recorded here too, so the save control
 * stays blocked until the asset is available.
 */
export function imageSaveBlocked(
  manifest: AssetManifestLike | null | undefined,
  failures: Readonly<Record<string, AssetStatus | boolean>> | undefined,
): boolean {
  return hasFailedAsset(manifest, failures);
}

/** Stable key/test id for a resolution, used by the NodeView and its tests. */
export function imageResolutionStatus(resolution: ImageResolution): string {
  return resolution.status === "unavailable" ? `unavailable:${resolution.reason}` : resolution.status;
}
