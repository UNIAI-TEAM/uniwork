// The upstream seam for HTML, typed from the pinned upstream source
// (genoffice 09485f884dc845cf3bf27fb7edfe489f9d457aad). Upstream's HTML
// document model is the source text plus a parse5 source map over it; every
// edit compiles down to source patches. vendor.ts binds these to the vendored
// copy in packages/office-upstream (G2-06b); unit tests may supply a fake.
// Nothing here imports upstream code.

/** apps/html/src/renderer/document/parse-map.ts:3 (ElementEntry). */
interface UpstreamElementEntry {
  sid: number;
  tag: string;
  parentSid: number | null;
  depth: number;
  range: [number, number];
  startTag: [number, number];
  endTag: [number, number] | null;
  inner: [number, number];
  path: string;
  textNodes: Array<[number, number]>;
}

/** apps/html/src/renderer/document/parse-map.ts:22 (ParseMap). */
export interface UpstreamParseMap {
  version: number;
  elements: UpstreamElementEntry[];
  bySid: Map<number, UpstreamElementEntry>;
  errorCount: number;
}

/** apps/html/src/renderer/document/patch.ts:2 (Patch). */
export interface UpstreamPatch {
  from: number;
  to: number;
  text: string;
}

/** apps/html/src/renderer/document/patch.ts:8 (PatchOrigin). */
type UpstreamPatchOrigin = "manual" | "ai" | "inspector" | "format" | "load";

/** apps/html/src/renderer/document/patch.ts:10 (PatchSet). */
export interface UpstreamPatchSet {
  patches: UpstreamPatch[];
  baseVersion: number;
  origin: UpstreamPatchOrigin;
  label: string;
}

/** apps/html/src/renderer/document/patch.ts:17 (PatchError). */
export type UpstreamPatchError =
  | { kind: "stale"; baseVersion: number; currentVersion: number }
  | { kind: "bounds"; index: number }
  | { kind: "overlap"; index: number };

export interface HtmlUpstream {
  /** apps/html/src/renderer/document/parse-map.ts:102 */
  buildParseMap(text: string, version: number, previous?: UpstreamParseMap | null): UpstreamParseMap;
  /** apps/html/src/renderer/document/patch.ts:22 */
  validatePatchSet(set: UpstreamPatchSet, currentVersion: number, length: number): UpstreamPatchError | null;
  /** apps/html/src/renderer/document/patch.ts:46 - patches already validated. */
  applyPatches(text: string, patches: readonly UpstreamPatch[]): string;
  /** apps/html/src/renderer/document/blank.ts:7 */
  isDocEmpty(text: string): boolean;
  /** apps/html/src/main/asset-lifecycle.ts:851 - <img src> references only. */
  extractDocumentImageSources(html: string): string[];
}
