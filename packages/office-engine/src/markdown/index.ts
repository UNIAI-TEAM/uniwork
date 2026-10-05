// @uniwork/office-engine/markdown - Markdown source + relative assets. Pure:
// no Node, Electron or native imports (scripts/office/check-boundaries.mjs).
export { createMarkdownEngine, findFrontmatter, type FrontmatterRange, type MarkdownEngine } from "./engine";
export { buildMarkdownPreviewCopy, type MarkdownPreviewCopyOptions } from "./preview-copy";
export type { MarkdownUpstream, UpstreamSaveMarkdownRequest } from "./seam";
export { bindMarkdownUpstream, type UpstreamMarkdownAssetModule } from "./vendor";
