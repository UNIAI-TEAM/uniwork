// HTML vendored-engine binding (G2-06b) — maps the packages/office-upstream
// source onto this lane's seam. The modules arrive already imported (the
// replay driver or a Node host bundles and imports them), so this file stays
// free of Node/fs and the browser boundary holds.
//
// Upstream surface bound here (pinned 09485f88):
//   apps/html/src/renderer/document/parse-map.ts:102  buildParseMap
//   apps/html/src/renderer/document/patch.ts:22       validatePatchSet
//   apps/html/src/renderer/document/patch.ts:46       applyPatches
//   apps/html/src/renderer/document/blank.ts:7        isDocEmpty
//   apps/html/src/main/asset-lifecycle.ts:851         extractDocumentImageSources
import { EngineBoundaryError } from "@uniwork/office-contracts";
import type { HtmlUpstream, UpstreamParseMap, UpstreamPatch, UpstreamPatchError, UpstreamPatchSet } from "./seam";

/** The vendored modules, each the subset this seam consumes. */
export interface UpstreamHtmlModules {
  parseMap: { buildParseMap(text: string, version: number, previous?: UpstreamParseMap | null): UpstreamParseMap };
  patch: {
    validatePatchSet(set: UpstreamPatchSet, currentVersion: number, length: number): UpstreamPatchError | null;
    applyPatches(text: string, patches: readonly UpstreamPatch[]): string;
  };
  blank: { isDocEmpty(text: string): boolean };
  assets: { extractDocumentImageSources(html: string): string[] };
}

function requireFunction(mod: object | undefined, module: string, name: string): void {
  if (!mod || typeof (mod as Record<string, unknown>)[name] !== "function") {
    throw new EngineBoundaryError("engine_incompatible", { reason: "vendored_html_surface", missing: module + "." + name });
  }
}

function invalid(reason: string): never {
  throw new EngineBoundaryError("engine_result_invalid", { reason });
}

/** Bind the vendored modules to the seam; a missing function is refused at bind time. */
export function bindHtmlUpstream(mods: UpstreamHtmlModules): HtmlUpstream {
  requireFunction(mods.parseMap, "parseMap", "buildParseMap");
  requireFunction(mods.patch, "patch", "validatePatchSet");
  requireFunction(mods.patch, "patch", "applyPatches");
  requireFunction(mods.blank, "blank", "isDocEmpty");
  requireFunction(mods.assets, "assets", "extractDocumentImageSources");
  return {
    buildParseMap(text, version, previous) {
      const map = mods.parseMap.buildParseMap(text, version, previous ?? null);
      if (!map || !Array.isArray(map.elements) || typeof map.version !== "number") invalid("html_parse_map");
      return map;
    },
    validatePatchSet: (set, currentVersion, length) => mods.patch.validatePatchSet(set, currentVersion, length),
    applyPatches(text, patches) {
      const out = mods.patch.applyPatches(text, patches);
      if (typeof out !== "string") invalid("html_apply_patches");
      return out;
    },
    isDocEmpty: (text) => mods.blank.isDocEmpty(text) === true,
    extractDocumentImageSources(html) {
      const sources = mods.assets.extractDocumentImageSources(html);
      if (!Array.isArray(sources) || sources.some((s) => typeof s !== "string")) invalid("html_image_sources");
      return sources;
    },
  };
}
