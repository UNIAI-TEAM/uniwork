import { EngineBoundaryError, type Sha256HexFn } from "@uniwork/office-contracts";
import { resolveAssetReference, type AssetManifest, type AssetManifestEntry } from "./manifest";
import type { RefusalReason } from "./references";

// The text + assets save transaction (plan G2-06, "publish only when every
// needed byte is staged"). Order is fixed:
//
//   1. the caller has already serialised the text (text_bytes);
//   2. every manifest entry the text references is read, checked against the
//      manifest digest and staged - one failure aborts the whole save;
//   3. only then is `publish` called, once, with the text, the manifest of
//      exactly the staged entries and the staging receipts.
//
// An asset I/O failure after text serialisation therefore surfaces as a
// failed save (EngineBoundaryError), never as a published version that would
// reopen without its images. The host ports are the seams: the engine never
// names a storage location, it hands bytes to staging and gets receipts back.

/** Committed bytes of the document's current version, by manifest key. */
export interface AssetBytesSource {
  read(key: string): Promise<Uint8Array>;
}

interface StagedAsset {
  key: string;
  sha256: string;
  byte_length: number;
  media_type: string;
  origin: AssetManifestEntry["origin"];
  /** Opaque host receipt (a FileService staging id); never a path. */
  staged_id: string;
}

/** Host staging port (FileService intent upload in G2-02/G2-07). */
export interface AssetStagingPort {
  stage(input: { key: string; sha256: string; media_type: string; bytes: Uint8Array }): Promise<{ staged_id: string }>;
}

export interface PublishInput {
  text_bytes: Uint8Array;
  text_sha256: string;
  manifest: AssetManifest;
  staged: readonly StagedAsset[];
}

export interface AssetSaveReport {
  manifest: AssetManifest;
  staged: StagedAsset[];
  /** Local references with no manifest entry: kept in the text, no bytes to carry. */
  dangling_count: number;
  /** References refused by the normaliser (traversal, absolute path, scheme ...). */
  refused: RefusalReason[];
}

export interface SaveWithAssetsInput<R> {
  text_bytes: Uint8Array;
  /** Every authored reference in the serialised text, in document order. */
  references: readonly string[];
  manifest: AssetManifest;
  /** Bytes added in this session and not yet committed, by key. */
  pending: ReadonlyMap<string, Uint8Array>;
  source: AssetBytesSource;
  staging: AssetStagingPort;
  publish(input: PublishInput): Promise<R>;
  hash: Sha256HexFn;
}

function fail(reason: string, entry: AssetManifestEntry, cause?: unknown): never {
  // asset_key is a canonical relative key - never a host path - so it is
  // public-safe; the cause message is not, and is deliberately not forwarded.
  void cause;
  const code = reason === "asset_checksum_mismatch" ? "upload_checksum_mismatch" : "commit_failed";
  throw new EngineBoundaryError(code, { reason, asset_key: entry.key });
}

async function stageEntry(
  entry: AssetManifestEntry,
  input: Pick<SaveWithAssetsInput<unknown>, "pending" | "source" | "staging" | "hash">,
): Promise<StagedAsset> {
  let bytes: Uint8Array;
  try {
    bytes = input.pending.get(entry.key) ?? (await input.source.read(entry.key));
  } catch (error) {
    fail("asset_read_failed", entry, error);
  }
  if (bytes.byteLength !== entry.byte_length || (await input.hash(bytes)) !== entry.sha256) {
    fail("asset_checksum_mismatch", entry);
  }
  let receipt: { staged_id: string };
  try {
    receipt = await input.staging.stage({ key: entry.key, sha256: entry.sha256, media_type: entry.media_type, bytes });
  } catch (error) {
    fail("asset_stage_failed", entry, error);
  }
  if (typeof receipt?.staged_id !== "string" || receipt.staged_id.length === 0) {
    fail("asset_stage_failed", entry);
  }
  return {
    key: entry.key,
    sha256: entry.sha256,
    byte_length: entry.byte_length,
    media_type: entry.media_type,
    origin: entry.origin,
    staged_id: receipt.staged_id,
  };
}

/** Which manifest entries the save must carry - every entry the text
 * references plus every imported entry - and what the text references but
 * cannot carry. */
export function neededAssets(
  manifest: AssetManifest,
  references: readonly string[],
): { entries: AssetManifestEntry[]; dangling_count: number; refused: RefusalReason[] } {
  const entries = new Map<string, AssetManifestEntry>();
  let dangling = 0;
  const refused: RefusalReason[] = [];
  for (const raw of references) {
    const resolved = resolveAssetReference(manifest, raw);
    if (resolved.status === "resolved") entries.set(resolved.entry.key, resolved.entry);
    else if (resolved.status === "dangling") dangling++;
    else if (resolved.status === "refused") refused.push(resolved.reason);
  }
  for (const entry of manifest.entries) {
    if (entry.origin === "imported" && !entries.has(entry.key)) entries.set(entry.key, entry);
  }
  return { entries: [...entries.values()], dangling_count: dangling, refused };
}

/**
 * Stage every needed asset, then publish once. Staging runs sequentially so a
 * failure stops further uploads; receipts already issued are left to the
 * host's staging expiry (FileService owns GC, ADR 0022) - the engine never
 * deletes bytes.
 */
export async function saveWithAssets<R>(input: SaveWithAssetsInput<R>): Promise<{ result: R; report: AssetSaveReport }> {
  const needed = neededAssets(input.manifest, input.references);
  const staged: StagedAsset[] = [];
  for (const entry of needed.entries) staged.push(await stageEntry(entry, input));
  const manifest: AssetManifest = {
    version: input.manifest.version,
    document_path: input.manifest.document_path,
    entries: needed.entries.map((e) => ({ ...e })),
  };
  const text_sha256 = await input.hash(input.text_bytes);
  const result = await input.publish({ text_bytes: input.text_bytes, text_sha256, manifest, staged });
  return { result, report: { manifest, staged, dangling_count: needed.dangling_count, refused: needed.refused } };
}
