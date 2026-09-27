import { EngineContractViolation } from "@uniwork/office-contracts";
import { type AssetManifest, type AssetManifestEntry, resolveAssetReference, uniqueAssetKey } from "./manifest";
import { isCanonicalDocumentPath, normaliseAssetReference, relativeReference, sanitizeAssetName } from "./references";
import { neededAssets, type AssetBytesSource } from "./save";

// Save-as rebasing. The new document gets its own manifest; every asset the
// save must carry is copied under a key that the ALREADY AUTHORED reference
// still resolves to from the new location whenever that is possible, so the
// text stays byte-identical. Only a reference that would escape the new
// package (e.g. "../shared/logo.png" saved to the package root) is moved to
// "<dir>/assets/<name>" and rewritten. Upstream (genoffice 09485f88,
// prepareAssetsForSaveAs, apps/markdown/src/main/asset-lifecycle.ts:940)
// always copies into assets/ on a directory change and silently skips a
// source it cannot resolve; here a carried entry is never skipped.

export interface SaveAsPlan {
  /** raw reference -> replacement raw reference, for the format's rewriter. */
  text_rewrites: Map<string, string>;
  manifest: AssetManifest;
  /** target key -> source key, for reading bytes from the source version. */
  copies: Map<string, string>;
}

function targetKeyFor(entry: AssetManifestEntry, source: AssetManifest, targetPath: string, taken: Set<string>): string {
  const relative = relativeReference(entry.key, source.document_path);
  const ref = normaliseAssetReference(relative, targetPath);
  if (ref.kind === "local" && ref.key !== targetPath && !taken.has(ref.key)) return ref.key;
  const draft: AssetManifest = { ...source, document_path: targetPath, entries: [] };
  return uniqueAssetKey(draft, sanitizeAssetName(entry.key.split("/").pop() ?? ""), new Set([...taken, targetPath]));
}

export function planSaveAsRebase(
  manifest: AssetManifest,
  references: readonly string[],
  targetDocumentPath: string,
): SaveAsPlan {
  if (!isCanonicalDocumentPath(targetDocumentPath)) {
    throw new EngineContractViolation("save_as.document_path", "canonical_path");
  }
  const carried = neededAssets(manifest, references).entries;
  const taken = new Set<string>();
  const keyMap = new Map<string, string>();
  const copies = new Map<string, string>();
  for (const entry of carried) {
    const targetKey = targetKeyFor(entry, manifest, targetDocumentPath, taken);
    taken.add(targetKey);
    keyMap.set(entry.key, targetKey);
    copies.set(targetKey, entry.key);
  }

  const text_rewrites = new Map<string, string>();
  for (const raw of references) {
    const resolved = resolveAssetReference(manifest, raw);
    if (resolved.status !== "resolved") continue;
    const targetKey = keyMap.get(resolved.entry.key);
    if (targetKey === undefined) continue;
    const fromTarget = normaliseAssetReference(raw, targetDocumentPath);
    if (fromTarget.kind === "local" && fromTarget.key === targetKey) continue;
    text_rewrites.set(raw, relativeReference(targetKey, targetDocumentPath) + resolved.reference.suffix);
  }

  return {
    text_rewrites,
    manifest: {
      version: manifest.version,
      document_path: targetDocumentPath,
      entries: carried.map((e) => ({ ...e, key: keyMap.get(e.key) ?? e.key })),
    },
    copies,
  };
}

/** Read target keys through the plan's copy map. */
export function rebasedSource(source: AssetBytesSource, copies: ReadonlyMap<string, string>): AssetBytesSource {
  return { read: (key) => source.read(copies.get(key) ?? key) };
}

/** Re-key session bytes to the target keys. */
export function rebasedPending(
  pending: ReadonlyMap<string, Uint8Array>,
  copies: ReadonlyMap<string, string>,
): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [targetKey, sourceKey] of copies) {
    const bytes = pending.get(sourceKey);
    if (bytes) out.set(targetKey, bytes);
  }
  return out;
}
