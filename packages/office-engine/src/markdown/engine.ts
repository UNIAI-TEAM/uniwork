import type { CapabilityEntry, Sha256HexFn } from "@uniwork/office-contracts";
import { createTextDocumentEngine, type TextDocumentEngine, type TextSnapshot } from "../assets/text-document";
import type { MarkdownUpstream, UpstreamSaveMarkdownRequest } from "./seam";

// Markdown adapter: the document is its Markdown SOURCE and relative asset
// mapping. It is never converted to page JSON; a caller that wants a page
// asks for an explicit conversion (G2-07), which this adapter does not do.

// Engine claims stay pending until G2-06b proves them on the vendored engine;
// the product projection (toProductCapability) keeps them unsupported.
// Proven by test/replay/g2-06-replay.mjs through scripts/office/replay-fixtures.mjs
// (md: 10 rows): every G0 fixture round-trips byte-identically and create/edit/
// save/reopen twice, UTF-8, a spaced image path, save-as rebasing and asset
// failure injection pass on the vendored upstream (pinned 09485f88). The
// replay bundles seam and vendored code for the browser platform with every
// Node builtin stubbed to throw, and a row fails if any is touched.
const PROVEN = "vendored upstream 09485f88; proven by the G2-06 fixture replay (md: 10 rows)";
const MARKDOWN_CAPABILITIES: readonly CapabilityEntry[] = [
  { operation: "open", supported: true, runtime: "browser", evidence_level: "proven", reason: PROVEN },
  { operation: "edit", supported: true, runtime: "browser", evidence_level: "proven", reason: PROVEN },
  { operation: "serialize", supported: true, runtime: "browser", evidence_level: "proven", reason: PROVEN },
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
