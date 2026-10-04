/**
 * Markdown print (M8): the host print port and the SANITIZED copy it receives.
 *
 * A Markdown document is untrusted text. Printing it must never hand the raw
 * source to a print surface, and the view must never open the system dialog
 * itself: it renders the document, neutralises it, and calls the INJECTED port
 * (browser print on web, host print on desktop). `window.print()` appears
 * nowhere here.
 *
 * The copy is built in two layers, both owned by the engine:
 *
 *   1. `buildHtmlPreviewCopy` (@uniwork/office-engine/html) - the SAME preview
 *      copy the isolated iframe renders. Every URL-bearing slot is resolved
 *      against the manifest and either pointed at the scoped asset proxy or
 *      neutralised (`about:blank#blocked`), so an external, dangling or
 *      `javascript:` reference becomes inert. The document's own scripts are
 *      never allowed to load (`scripts: false`).
 *   2. `stripActiveContent` - the browser parses the copy and every script
 *      element (any namespace) and every `on*` handler is removed, along with
 *      the elements that embed another browsing context (`iframe`, `object`,
 *      `embed`, `base`, ...). The engine's pass models URLs as strings; this
 *      pass lets the real parser decide what an element is.
 *
 * The result is what a print payload may contain: a script-free, URL-inert
 * HTML document. Nothing here parses Markdown or touches the saved bytes.
 */
import { emptyAssetManifest, type AssetManifest } from "@uniwork/office-engine/assets";
import { buildHtmlPreviewCopy } from "@uniwork/office-engine/html";

/** Content-Security-Policy for the print copy. Script-free by construction;
 * a caller that lets images resolve through an asset proxy must pass a CSP
 * naming that origin. */
export const PRINT_COPY_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:; " +
  "script-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; " +
  "object-src 'none'; form-action 'none'; base-uri 'none'";

/** What a print port receives. `html` is the sanitized copy, never the source. */
export interface MarkdownPrintRequest {
  /** The SANITIZED preview copy: script-free and URL-neutralised. */
  html: string;
  /** Accessible document title, for the printed page and the frame name. */
  title: string;
}

export type MarkdownPrintOutcome =
  | { outcome: "printed" }
  | { outcome: "cancelled" }
  | { outcome: "failed"; reason: string };

/**
 * The host print path. Web implements it by mounting the copy in the isolated
 * print frame and printing that frame; desktop hands it to the host print
 * service. The view only ever calls this port.
 */
export interface MarkdownPrintPort {
  print(request: MarkdownPrintRequest): MarkdownPrintOutcome | Promise<MarkdownPrintOutcome>;
}

export interface MarkdownPrintCopyOptions {
  /** The preview's asset manifest; defaults to none, so every local reference
   * is neutralised rather than loaded. */
  manifest?: AssetManifest;
  /** The scoped proxy URL for a manifest key, or null when not granted. */
  assetUrl?(key: string): string | null;
  /** CSP written into the copy. Defaults to {@link PRINT_COPY_CSP}. */
  csp?: string;
}

/** Elements that embed or load another browsing context, plus `noscript`
 * (its body parses differently with scripts on). Dropped whole. */
const DROPPED_ELEMENTS: ReadonlySet<string> = new Set([
  "script", "base", "iframe", "frame", "frameset", "object", "embed", "applet", "portal", "fencedframe", "noscript",
]);

/** Every `on*` attribute (onclick, onerror, ...), in any case. */
const EVENT_HANDLER = /^on[a-z]+$/;

/** The empty document a host with no DOM gets: nothing can be proven safe. */
const EMPTY_DOCUMENT = "<!DOCTYPE html><html><head></head><body></body></html>";

/** The parser-level strip pass (see the module comment). */
function stripActiveContent(html: string): string {
  // Print runs in a DOM host; without one no copy can be verified, so the
  // print payload is empty rather than the unverified input.
  if (typeof DOMParser === "undefined") return EMPTY_DOCUMENT;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    if (DROPPED_ELEMENTS.has(element.localName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      if (EVENT_HANDLER.test(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
    }
  }
  return doc.documentElement.outerHTML;
}

/**
 * The sanitized print copy of a rendered document: the engine preview copy,
 * then the parser strip. Pure apart from `DOMParser`.
 */
export function sanitizePrintCopy(html: string, options: MarkdownPrintCopyOptions = {}): string {
  const copy = buildHtmlPreviewCopy({
    text: html,
    manifest: options.manifest ?? emptyAssetManifest("document.md"),
    assetUrl: options.assetUrl ?? (() => null),
    scripts: false,
    csp: options.csp ?? PRINT_COPY_CSP,
  });
  return stripActiveContent(copy);
}

export interface MarkdownPrintActionOptions extends MarkdownPrintCopyOptions {
  /** The host print path. */
  port: MarkdownPrintPort;
  /** Renders the CURRENT document to HTML (the preview render). */
  renderHtml(): string;
  /** Accessible document title. */
  title: string;
}

/**
 * The print action: render, sanitize, then hand the copy to the host port. A
 * port that throws becomes a typed failure, never a crash in the menu.
 */
export async function printMarkdownDocument(options: MarkdownPrintActionOptions): Promise<MarkdownPrintOutcome> {
  const html = sanitizePrintCopy(options.renderHtml(), options);
  try {
    return await options.port.print({ html, title: options.title });
  } catch (error) {
    return { outcome: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}
