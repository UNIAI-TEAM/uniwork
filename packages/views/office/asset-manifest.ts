/** Browser-facing asset rows. Storage keys and host paths deliberately never
 * become UI identifiers; the view only accepts a relative path and an opaque
 * asset id supplied by the host. */
export interface AssetManifestEntryLike {
  key?: string;
  path?: string;
  assetId?: string;
  asset_id?: string;
  id?: string;
  status?: AssetStatus;
  error?: string | null;
}

export interface AssetManifestLike {
  entries: readonly AssetManifestEntryLike[];
}

export type AssetStatus = "ready" | "missing" | "unauthorised" | "failed";

export interface AssetManifestRow {
  path: string;
  assetId: string | null;
  status: AssetStatus;
  reason: string | null;
}

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * Convert an authored reference to the canonical relative form used by the
 * manifest. URL, absolute OS, traversal and control-character references are
 * rejected rather than repaired. A rejected value must never reach a host
 * asset resolver.
 */
export function normaliseAssetPath(value: string): string | null {
  if (typeof value !== "string" || value.length === 0 || Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  })) return null;
  if (value.includes("\\") || value.startsWith("/") || value.startsWith("//") || SCHEME.test(value)) return null;
  const parts = value.split("/");
  const clean: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;
    clean.push(part);
  }
  return clean.length > 0 ? clean.join("/") : null;
}

function opaqueId(entry: AssetManifestEntryLike): string | null {
  const id = entry.assetId ?? entry.asset_id ?? entry.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Build safe rows while preserving an invalid entry as a failed row. */
export function assetManifestRows(manifest: AssetManifestLike | null | undefined): AssetManifestRow[] {
  if (!manifest) return [];
  return manifest.entries.map((entry) => {
    const authored = entry.path ?? entry.key ?? "";
    const path = normaliseAssetPath(authored);
    const status = entry.status ?? (entry.error ? "failed" : "ready");
    return {
      path: path ?? authored,
      assetId: path ? opaqueId(entry) : null,
      status: path ? status : "failed",
      reason: path ? (entry.error ?? null) : "unsafe asset path",
    };
  });
}

export function hasFailedAsset(
  manifest: AssetManifestLike | null | undefined,
  failures: Readonly<Record<string, AssetStatus | boolean>> | undefined,
): boolean {
  const rows = assetManifestRows(manifest);
  if (rows.some((row) => row.status !== "ready" || row.assetId === null)) return true;
  return Object.entries(failures ?? {}).some(([path, state]) => {
    const normalised = normaliseAssetPath(path);
    return normalised !== null && (state === true || state === "missing" || state === "unauthorised" || state === "failed");
  });
}
