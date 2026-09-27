import type { CapabilityEntry, Sha256HexFn } from "@uniwork/office-contracts";
import { createTextDocumentEngine, type TextDocumentEngine, type TextSnapshot } from "../assets/text-document";
import type { MarkdownUpstream, UpstreamSaveMarkdownRequest } from "./seam";

// Markdown adapter: the document is its Markdown SOURCE and relative asset
// mapping. It is never converted to page JSON; a caller that wants a page
// asks for an explicit conversion (G2-07), which this adapter does not do.

// Engine claims stay pending until G2-06b proves them on the vendored engine;
// the product projection (toProductCapability) keeps them unsupported.
const PENDING = "G2-06b binds packages/office-upstream and proves this row";
const MARKDOWN_CAPABILITIES: readonly CapabilityEntry[] = [
  { operation: "open", supported: false, runtime: "browser", evidence_level: "pending", reason: PENDING },
  { operation: "edit", supported: false, runtime: "browser", evidence_level: "pending", reason: PENDING },
  { operation: "serialize", supported: false, runtime: "browser", evidence_level: "pending", reason: PENDING },
  { operation: "convert", supported: false, runtime: "none", evidence_level: "pending", reason: "conversion is G2-07" },
  { operation: "export", supported: false, runtime: "none", evidence_level: "pending", reason: "export is G2-07" },
];

export interface FrontmatterRange {
  start: number;
  end: number;
}

export interface MarkdownEngine extends TextDocumentEngine {
  /** Take the editor's save request: its text becomes the source; its
   * imageSources are counted against the text and otherwise ignored. */
  acceptEditorText(
    ref: string,
    request: Pick<UpstreamSaveMarkdownRequest, "text" | "imageSources">,
  ): { snapshot: TextSnapshot; ignored_image_sources: number };
  /** YAML frontmatter span, kept verbatim inside the source. */
  frontmatter(ref: string): FrontmatterRange | null;
}

/** `---` on the first line through the next `---`/`...` line, CRLF or LF. */
export function findFrontmatter(text: string): FrontmatterRange | null {
  const open = /^---[ \t]*\r?\n/.exec(text);
  if (!open) return null;
  const close = /(^|\r?\n)(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/g;
  close.lastIndex = open[0].length - 1;
  const match = close.exec(text);
  if (!match) return null;
  return { start: 0, end: match.index + match[0].length };
}

export function createMarkdownEngine(options: { upstream: MarkdownUpstream; hash?: Sha256HexFn }): MarkdownEngine {
  const { upstream } = options;
  const core = createTextDocumentEngine(
    {
      format: "md",
      default_document_path: "document.md",
      scanReferences: (text) => upstream.extractMarkdownImageSources(text),
      rewriteReferences: (text, rewrites) =>
        rewrites.size === 0 ? text : upstream.rewriteMarkdownImageSources(text, rewrites),
      capabilities: MARKDOWN_CAPABILITIES,
    },
    { hash: options.hash },
  );
  return {
    ...core,
    acceptEditorText(ref, request) {
      const snapshot = core.replaceText(ref, request.text);
      const authored = new Set(snapshot.references);
      const ignored = request.imageSources.filter((source) => !authored.has(source)).length;
      return { snapshot, ignored_image_sources: ignored };
    },
    frontmatter: (ref) => findFrontmatter(core.snapshot(ref).text),
  };
}
