import { buildMarkdownPreviewCopy } from "@uniwork/office-engine/markdown";

// The web host's Markdown -> HTML preview renderer (S3c, UNI-928).
//
// The renderer itself lives in the engine lane (packages/office-engine/src/
// markdown/preview-copy.ts) because apps/web/platform/office is a browser
// boundary root that may not import @tiptap/*, @uniwork/views/office/markdown
// or marked (scripts/office/check-boundaries.mjs). This file is only the thin
// host wrapper the preview port takes as `renderMarkdown`: it names the
// document path and delegates. It never parses.
//
// Local image references are kept authored here; the engine's copy pass inside
// the frame resolves them against the document manifest and points them at the
// scoped asset proxy, exactly as it does for an HTML document.

const PREVIEW_DOCUMENT_PATH = "document.md";

export function renderMarkdownPreview(source: string): string {
  return buildMarkdownPreviewCopy({ source, document_path: PREVIEW_DOCUMENT_PATH });
}
