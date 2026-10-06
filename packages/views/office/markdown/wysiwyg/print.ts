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
 *   2. `stripActiveContent` - the browser parses the copy and: every script
 *      element (any namespace) and every `on*` handler is removed; the
 *      elements that embed another browsing context (`iframe`, `object`,
 *      `embed`, `base`, ...) are removed whole; every `meta[http-equiv]`
 *      except the copy's own CSP meta is dropped (a document-supplied CSP
 *      must not loosen the copy); every `srcdoc` attribute is dropped; and
 *      every URL-bearing attribute whose value is a live script URL
 *      (`javascript:`, `vbscript:`, `data:text/html`) is dropped rather than
 *      rewritten. The engine's pass models URLs as strings; this pass lets the
 *      real parser decide what an element and an attribute is.
 *
 * The result is what a print payload may contain: a script-free, URL-inert
 * HTML document. Nothing here parses Markdown or touches the saved bytes.
 */
import { emptyAssetManifest, type AssetManifest } from "@uniwork/office-engine/assets";
import { buildHtmlPreviewCopy, dropBlockedResourceUrls } from "@uniwork/office-engine/html";

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
 * (its body parses differently with scripts on) and `template` (its content
 * is a separate fragment that `querySelectorAll` does not descend into).
 * Dropped whole. */
const DROPPED_ELEMENTS: ReadonlySet<string> = new Set([
  "script", "base", "iframe", "frame", "frameset", "object", "embed", "applet", "portal", "fencedframe", "noscript",
  "template",
]);

/** Every `on*` attribute (onclick, onerror, ...), in any case. */
const EVENT_HANDLER = /^on[a-z]+$/;

/** URL-bearing attributes whose value can make the copy navigate or load
 * something. `srcdoc` is handled separately (a whole document) and `srcset`
 * per entry. The engine's string pass rewrites the ones it models; this
 * parser pass DROPS any of them whose value is still a live script URL. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "href", "src", "action", "formaction", "poster", "background", "cite", "data", "ping",
  "longdesc", "usemap", "manifest", "codebase", "classid", "archive", "icon", "dynsrc", "lowsrc",
  "xlink:href",
]);

/** Schemes a browser executes when it follows them. `data:image/svg+xml` is
 * deliberately NOT here: the copy's CSP (`script-src 'none'`) blocks any
 * script such an image could carry, so an SVG data: image stays renderable. */
const DANGEROUS_SCHEMES: readonly string[] = ["javascript:", "vbscript:", "data:text/html"];

/** The ASCII whitespace and control characters a browser strips from a URL
 * before it reads the scheme (`java\tscript:` is `javascript:`). A charCode
 * filter, not a regex: the repo lint forbids control characters in patterns. */
function stripUrlNoise(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code > 0x20 && code !== 0x7f) out += char;
  }
  return out;
}

function isDangerousUrl(value: string): boolean {
  const normalised = stripUrlNoise(value).toLowerCase();
  return DANGEROUS_SCHEMES.some((scheme) => normalised.startsWith(scheme));
}

/** A `srcset` is a comma-separated list of "URL descriptor" entries:
 * dangerous if any entry is. */
function isDangerousSrcset(value: string): boolean {
  return value.split(",").some((entry) => isDangerousUrl(entry));
}

/** Page geometry for a copy that brings none of its own (Markdown, plain HTML):
 * A4 with a real margin, so page 1 is content with a border of white and not
 * edge-to-edge text. It goes right after the copy's CSP meta (which stays the
 * first thing in the head) and ahead of the document's own styles, so those
 * still win. A copy that already carries an `@page` rule (DOCX sections, a
 * styled HTML file) is left alone. A table or a quote taller than the rest of
 * a page flows on (a gap of white is worse than a split); a row or a code
 * block stays whole. */
const DEFAULT_PAGE_CSS =
  "@page{size:A4;margin:18mm}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
  "img,svg,video{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}" +
  "h1,h2,h3,h4,h5,h6{break-after:avoid}pre,tr,img,figure{break-inside:avoid}thead{display:table-header-group}";

/** CSS comments and quoted strings: an `@page` inside one is not a rule. */
const CSS_COMMENT_OR_STRING = /\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;

function hasPageRule(style: Element): boolean {
  return /@page\b/i.test((style.textContent ?? "").replace(CSS_COMMENT_OR_STRING, ""));
}

function addDefaultPageGeometry(doc: Document): void {
  if (Array.from(doc.querySelectorAll("style")).some(hasPageRule)) return;
  const style = doc.createElement("style");
  style.setAttribute("data-print-page", "");
  style.textContent = DEFAULT_PAGE_CSS;
  const csp = Array.from(doc.head.querySelectorAll("meta[http-equiv]")).find(
    (meta) => (meta.getAttribute("http-equiv") ?? "").trim().toLowerCase() === "content-security-policy",
  );
  if (csp) csp.after(style);
  else doc.head.prepend(style);
}

/** The empty document a host with no DOM gets: nothing can be proven safe. */
const EMPTY_DOCUMENT = "<!DOCTYPE html><html><head></head><body></body></html>";

/** The parser-level strip pass (see the module comment). */
function stripActiveContent(html: string): string {
  // Print runs in a DOM host; without one no copy can be verified, so the
  // print payload is empty rather than the unverified input.
  if (typeof DOMParser === "undefined") return EMPTY_DOCUMENT;
  // A blocked reference paints a broken-image icon before its alt text: the
  // engine's drop pass turns it into the alt text alone.
  const doc = new DOMParser().parseFromString(dropBlockedResourceUrls(html), "text/html");
  // Exactly the copy's own CSP meta survives. Every other `http-equiv` meta is
  // dropped, including a second CSP meta the document supplied: a weaker
  // document policy must not be able to loosen the copy. The copy writes its
  // CSP first, so the first CSP meta in document order is the one to keep.
  let keptCsp = false;
  for (const meta of Array.from(doc.querySelectorAll("meta[http-equiv]"))) {
    const isCsp = (meta.getAttribute("http-equiv") ?? "").trim().toLowerCase() === "content-security-policy";
    if (isCsp && !keptCsp) {
      keptCsp = true;
      continue;
    }
    meta.remove();
  }
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    if (DROPPED_ELEMENTS.has(element.localName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (EVENT_HANDLER.test(name) || name === "srcdoc") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "srcset") {
        if (isDangerousSrcset(attribute.value)) element.removeAttribute(attribute.name);
        continue;
      }
      if (URL_ATTRIBUTES.has(name) && isDangerousUrl(attribute.value)) element.removeAttribute(attribute.name);
    }
  }
  addDefaultPageGeometry(doc);
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
  try {
    const html = sanitizePrintCopy(options.renderHtml(), options);
    return await options.port.print({ html, title: options.title });
  } catch (error) {
    return { outcome: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}
