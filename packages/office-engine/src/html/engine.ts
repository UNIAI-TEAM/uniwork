import { EngineBoundaryError, type CapabilityEntry, type Sha256HexFn } from "@uniwork/office-contracts";
import { createTextDocumentEngine, type TextDocumentEngine, type TextSnapshot } from "../assets/text-document";
import { extractHtmlAssetReferences, rewriteHtmlAssetReferences } from "./references";
import type { HtmlUpstream, UpstreamParseMap, UpstreamPatchSet } from "./seam";

// HTML adapter: the document is its HTML SOURCE, with upstream's parse map as
// the structural model over it and source patches as the only edit primitive
// (upstream apps/html/src/renderer/document/patch.ts:2). Never page JSON.

// Proven by test/replay/g2-06-replay.mjs through scripts/office/replay-fixtures.mjs
// (html: 10 rows): every G0 fixture round-trips byte-identically and create/edit/
// save/reopen twice, UTF-8, a spaced image path, save-as rebasing and asset
// failure injection pass on the vendored upstream (pinned 09485f88). The
// seam is environment-neutral; the replay runs it under Node.
const PROVEN = "vendored upstream 09485f88; proven by the G2-06 fixture replay (html: 10 rows)";
const HTML_CAPABILITIES: readonly CapabilityEntry[] = [
  { operation: "open", supported: true, runtime: "browser", evidence_level: "proven", reason: PROVEN },
  { operation: "edit", supported: true, runtime: "browser", evidence_level: "proven", reason: PROVEN },
  { operation: "serialize", supported: true, runtime: "browser", evidence_level: "proven", reason: PROVEN },
  { operation: "convert", supported: false, runtime: "none", evidence_level: "pending", reason: "conversion is G2-07" },
  { operation: "export", supported: false, runtime: "none", evidence_level: "pending", reason: "export is G2-07" },
  // The isolated preview: engine preview copy (html/preview-copy.ts) in a
  // sandboxed opaque-origin iframe, behind the web host's browser-parser final
  // gate (apps/web/platform/office/preview-gate.ts). Proven only once a
  // product route renders it (G2-07).
  {
    operation: "preview",
    supported: false,
    runtime: "browser",
    evidence_level: "pending",
    reason: "sandboxed iframe + preview-gate.ts DOMParser final gate; route proof in G2-07",
  },
];

export interface HtmlEngine extends TextDocumentEngine {
  /** Upstream parse map for the current source; its version is the session revision. */
  parseMap(ref: string): UpstreamParseMap;
  /** Validate with upstream against the current revision, then apply. */
  applyPatchSet(ref: string, set: UpstreamPatchSet): TextSnapshot;
  isEmpty(ref: string): boolean;
}

export function createHtmlEngine(options: { upstream: HtmlUpstream; hash?: Sha256HexFn }): HtmlEngine {
  const { upstream } = options;
  const scanReferences = (text: string): string[] => {
    const ours = extractHtmlAssetReferences(text);
    const seen = new Set(ours);
    // Upstream's <img> scan is a cross-check: anything it finds that ours did
    // not is still carried, and a save-as that cannot rewrite it fails loudly
    // (TextDocumentEngine.saveAs verifies every replacement).
    return [...ours, ...upstream.extractDocumentImageSources(text).filter((s) => !seen.has(s))];
  };
  const core = createTextDocumentEngine(
    {
      format: "html",
      default_document_path: "index.html",
      scanReferences,
      rewriteReferences: rewriteHtmlAssetReferences,
      capabilities: HTML_CAPABILITIES,
    },
    { hash: options.hash },
  );
  const maps = new Map<string, UpstreamParseMap>();
  return {
    ...core,
    parseMap(ref) {
      const snap = core.snapshot(ref);
      const previous = maps.get(ref) ?? null;
      if (previous && previous.version === snap.revision) return previous;
      const map = upstream.buildParseMap(snap.text, snap.revision, previous);
      maps.set(ref, map);
      return map;
    },
    applyPatchSet(ref, set) {
      const snap = core.snapshot(ref);
      const error = upstream.validatePatchSet(set, snap.revision, snap.text.length);
      if (error) {
        throw new EngineBoundaryError(error.kind === "stale" ? "base_version_mismatch" : "invalid_transition", {
          reason: "patch_" + error.kind,
        });
      }
      if (set.patches.length === 0) return snap;
      return core.replaceText(ref, upstream.applyPatches(snap.text, set.patches));
    },
    isEmpty: (ref) => upstream.isDocEmpty(core.snapshot(ref).text),
    close(ref) {
      maps.delete(ref);
      core.close(ref);
    },
  };
}
