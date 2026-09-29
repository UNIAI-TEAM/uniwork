// Markdown vendored-engine binding (G2-06b) — maps the packages/office-upstream
// source onto this lane's seam. The module arrives already imported (the
// replay driver or a Node host bundles and imports it), so this file stays
// free of Node/fs and the browser boundary holds.
//
// Upstream surface bound here (pinned 09485f88):
//   apps/markdown/src/main/asset-lifecycle.ts:841  extractMarkdownImageSources
//   apps/markdown/src/main/asset-lifecycle.ts:872  rewriteMarkdownImageSources
import { EngineBoundaryError } from "@uniwork/office-contracts";
import type { MarkdownUpstream } from "./seam";

/** The vendored asset-lifecycle module's export surface (subset this seam consumes). */
export interface UpstreamMarkdownAssetModule {
  extractMarkdownImageSources(markdown: string): string[];
  rewriteMarkdownImageSources(markdown: string, rewrites: ReadonlyMap<string, string>): string;
}

function requireFunction(mod: object, name: string): void {
  if (typeof (mod as Record<string, unknown>)[name] !== "function") {
    throw new EngineBoundaryError("engine_incompatible", { reason: "vendored_markdown_surface", missing: name });
  }
}

/**
 * Bind the vendored module to the seam. A module missing a function is an
 * incompatible engine build, refused at bind time rather than at first save;
 * a result of the wrong type is a malformed engine result.
 */
export function bindMarkdownUpstream(mod: UpstreamMarkdownAssetModule): MarkdownUpstream {
  requireFunction(mod, "extractMarkdownImageSources");
  requireFunction(mod, "rewriteMarkdownImageSources");
  return {
    extractMarkdownImageSources(markdown) {
      const sources = mod.extractMarkdownImageSources(markdown);
      if (!Array.isArray(sources) || sources.some((s) => typeof s !== "string")) {
        throw new EngineBoundaryError("engine_result_invalid", { reason: "markdown_image_sources" });
      }
      return sources;
    },
    rewriteMarkdownImageSources(markdown, rewrites) {
      const out = mod.rewriteMarkdownImageSources(markdown, rewrites);
      if (typeof out !== "string") throw new EngineBoundaryError("engine_result_invalid", { reason: "markdown_rewrite" });
      return out;
    },
  };
}
