// The upstream seam for Markdown, typed from the pinned upstream source
// (genoffice 09485f884dc845cf3bf27fb7edfe489f9d457aad). vendor.ts binds them
// to the vendored copy in packages/office-upstream (G2-06b); unit tests may
// supply a fake. Nothing here imports upstream code.

/**
 * The editor's save request, apps/markdown/src/shared/ipc.ts:54
 * (SaveMarkdownRequest). `text` is the full document including frontmatter.
 * `imageSources` is the renderer's list of authored images: in UniWork it is
 * a hint, never authority - the manifest and the text decide what is saved.
 */
export interface UpstreamSaveMarkdownRequest {
  text: string;
  imageSources: string[];
  mode: "save" | "saveAs";
  suggestedName?: string;
}

export interface MarkdownUpstream {
  /** apps/markdown/src/main/asset-lifecycle.ts:841 - image destinations of
   * `![alt](src)` and inline `<img src>`, outside code, in document order. */
  extractMarkdownImageSources(markdown: string): string[];
  /** apps/markdown/src/main/asset-lifecycle.ts:872 - replace the destinations
   * found by the same scan; untouched ranges stay byte-identical. */
  rewriteMarkdownImageSources(markdown: string, rewrites: ReadonlyMap<string, string>): string;
}
