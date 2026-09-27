import { canonicalJson, EngineContractViolation } from "@uniwork/office-contracts";
import { isCanonicalDocumentPath, normaliseAssetReference, type AssetReference, type RefusalReason } from "./references";

// The asset manifest of one text document: which keys exist, with the digest
// and length the bytes must match. Resolve (open, preview) and serialise
// (save, save-as) read the SAME manifest, so a document can never be saved
// with a different idea of its assets than the one it was opened and shown
// with. Upstream (genoffice 09485f88) keeps a filesystem-side ownership file
// instead (OwnedAssetManifest, apps/markdown/src/main/asset-lifecycle.ts:24)
// and trusts the renderer's imageSources list (SaveMarkdownRequest,
// apps/markdown/src/shared/ipc.ts:54); here the renderer list is never
// authority - the manifest and the text are.

const ASSET_MANIFEST_VERSION = 1 as const;

export interface AssetManifestEntry {
  /** Canonical package-relative POSIX key ("assets/my image.png"). */
  key: string;
  sha256: string;
  byte_length: number;
  media_type: string;
  /** "owned": created by this editor (dropped once no text references it).
   * "imported": arrived with the document - kept even when no scanner finds
   * a reference, because a script or stylesheet may load it in ways a
   * scanner cannot see. Upstream draws the same line (app-owned files only
   * are reconciled, asset-lifecycle.ts:1161). */
  origin: AssetOrigin;
}

type AssetOrigin = "owned" | "imported";

export interface AssetManifest {
  version: typeof ASSET_MANIFEST_VERSION;
  /** Canonical package-relative path of the document itself ("document.md"). */
  document_path: string;
  entries: AssetManifestEntry[];
}

const SHA256_RE = /^[0-9a-f]{64}$/;

export function emptyAssetManifest(documentPath: string): AssetManifest {
  if (!isCanonicalDocumentPath(documentPath)) {
    throw new EngineContractViolation("asset_manifest.document_path", "canonical_path");
  }
  return { version: ASSET_MANIFEST_VERSION, document_path: documentPath, entries: [] };
}

function isCanonicalKey(key: string): boolean {
  // A key is canonical when normalising it from the package root yields itself.
  const ref = normaliseAssetReference(key, "_");
  return ref.kind === "local" && ref.key === key && ref.suffix === "";
}

/**
 * Validate an untrusted manifest (from storage or the wire). Every key must be
 * canonical - no traversal, no absolute or drive path, no scheme - and unique.
 * A bad manifest is a contract violation, never silently repaired.
 */
export function parseAssetManifest(value: unknown): AssetManifest {
  if (value === null || typeof value !== "object") {
    throw new EngineContractViolation("asset_manifest", "not_object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== ASSET_MANIFEST_VERSION) {
    throw new EngineContractViolation("asset_manifest.version", "unsupported_version");
  }
  if (typeof raw.document_path !== "string" || !isCanonicalDocumentPath(raw.document_path)) {
    throw new EngineContractViolation("asset_manifest.document_path", "canonical_path");
  }
  if (!Array.isArray(raw.entries)) {
    throw new EngineContractViolation("asset_manifest.entries", "not_array");
  }
  const seen = new Set<string>();
  const entries = raw.entries.map((item: unknown, index): AssetManifestEntry => {
    const at = "asset_manifest.entries[" + index + "]";
    if (item === null || typeof item !== "object") throw new EngineContractViolation(at, "not_object");
    const e = item as Record<string, unknown>;
    if (typeof e.key !== "string" || !isCanonicalKey(e.key)) {
      throw new EngineContractViolation(at + ".key", "canonical_key");
    }
    if (e.key === raw.document_path) throw new EngineContractViolation(at + ".key", "is_document");
    if (seen.has(e.key)) throw new EngineContractViolation(at + ".key", "duplicate");
    seen.add(e.key);
    if (typeof e.sha256 !== "string" || !SHA256_RE.test(e.sha256)) {
      throw new EngineContractViolation(at + ".sha256", "sha256_hex");
    }
    if (typeof e.byte_length !== "number" || !Number.isSafeInteger(e.byte_length) || e.byte_length < 0) {
      throw new EngineContractViolation(at + ".byte_length", "non_negative_integer");
    }
    if (typeof e.media_type !== "string" || e.media_type.length === 0) {
      throw new EngineContractViolation(at + ".media_type", "non_empty");
    }
    if (e.origin !== "owned" && e.origin !== "imported") {
      throw new EngineContractViolation(at + ".origin", "asset_origin");
    }
    return { key: e.key, sha256: e.sha256, byte_length: e.byte_length, media_type: e.media_type, origin: e.origin };
  });
  return { version: ASSET_MANIFEST_VERSION, document_path: raw.document_path, entries };
}

/** Canonical, key-sorted JSON - the stored form of the manifest. */
export function serializeAssetManifest(manifest: AssetManifest): string {
  const entries = [...manifest.entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return canonicalJson({ ...manifest, entries });
}

export type ResolvedReference =
  | { status: "resolved"; reference: Extract<AssetReference, { kind: "local" }>; entry: AssetManifestEntry }
  /** A local reference with no manifest entry: there are no bytes to carry. */
  | { status: "dangling"; reference: Extract<AssetReference, { kind: "local" }> }
  | { status: "refused"; reference: AssetReference; reason: RefusalReason }
  /** inline / external / fragment / empty: not a manifest matter. */
  | { status: "not_asset"; reference: AssetReference };

/** Resolve one authored reference against the manifest. */
export function resolveAssetReference(manifest: AssetManifest, raw: string): ResolvedReference {
  const reference = normaliseAssetReference(raw, manifest.document_path);
  if (reference.kind === "refused") return { status: "refused", reference, reason: reference.reason };
  if (reference.kind !== "local") return { status: "not_asset", reference };
  const entry = manifest.entries.find((e) => e.key === reference.key);
  return entry ? { status: "resolved", reference, entry } : { status: "dangling", reference };
}

/** A key under `<document dir>/assets/` that is not yet taken. */
export function uniqueAssetKey(manifest: AssetManifest, name: string, taken: ReadonlySet<string> = new Set()): string {
  const dir = manifest.document_path.split("/").slice(0, -1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const used = new Set([...manifest.entries.map((e) => e.key), ...taken]);
  for (let n = 0; n < 100_000; n++) {
    const key = [...dir, "assets", n === 0 ? name : stem + "-" + n + ext].join("/");
    if (!used.has(key)) return key;
  }
  throw new EngineContractViolation("asset_manifest.entries", "name_space_exhausted");
}
