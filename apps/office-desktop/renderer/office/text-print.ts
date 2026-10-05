import { emptyAssetManifest } from "@uniwork/office-engine/assets";
import { buildHtmlPreviewCopy } from "@uniwork/office-engine/html";
import { buildMarkdownPreviewCopy } from "@uniwork/office-engine/markdown";

/**
 * Desktop Markdown/HTML print. Mirrors the sanitized payload of
 * packages/views/office/markdown/wysiwyg/print.ts (the source of truth; that
 * module is not exported from the views package): engine preview copy, then a
 * parser strip. The copy is printed from a sandboxed iframe inside the renderer
 * (like packages/views/office/pdf/print/browser-print.ts); the raw source is
 * never handed to a print surface and no IPC is involved.
 */

/** Same string as PRINT_COPY_CSP in views print.ts. */
const PRINT_COPY_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:; " +
  "script-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; " +
  "object-src 'none'; form-action 'none'; base-uri 'none'";

const DROPPED_ELEMENTS: ReadonlySet<string> = new Set([
  "script", "base", "iframe", "frame", "frameset", "object", "embed", "applet", "portal", "fencedframe", "noscript", "template",
]);
const EVENT_HANDLER = /^on[a-z]+$/;
const URL_ATTRIBUTES: ReadonlySet<string> = new Set(["href", "src", "action", "formaction", "xlink:href"]);
const EMPTY_DOCUMENT = "<!DOCTYPE html><html><head></head><body></body></html>";
const LOAD_TIMEOUT_MS = 10_000;

export type DesktopPrintOutcome = { outcome: "printed" } | { outcome: "failed"; reason: string };

function stripActiveContent(html: string): string {
  if (typeof DOMParser === "undefined") return EMPTY_DOCUMENT;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    if (DROPPED_ELEMENTS.has(element.localName.toLowerCase())) { element.remove(); continue; }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = Array.from(attribute.value).filter((char) => char.charCodeAt(0) > 0x20).join("").toLowerCase();
      if (EVENT_HANDLER.test(name) || name === "srcdoc" || (URL_ATTRIBUTES.has(name) && value.startsWith("javascript:"))) element.removeAttribute(attribute.name);
    }
  }
  // Beyond views print.ts: a refresh/other http-equiv meta is useless in a print copy; only the CSP stays.
  doc.querySelectorAll("meta[http-equiv]").forEach((meta) => { if (meta.getAttribute("http-equiv")?.toLowerCase() !== "content-security-policy") meta.remove(); });
  return doc.documentElement.outerHTML;
}

/** The sanitized print copy of the CURRENT text; never the raw source for Markdown. */
export function buildDesktopPrintCopy(format: "md" | "html", text: string): string {
  const html = format === "md" ? buildMarkdownPreviewCopy({ source: text, document_path: "document.md" }) : text;
  const copy = buildHtmlPreviewCopy({ text: html, manifest: emptyAssetManifest(format === "md" ? "document.md" : "document.html"), assetUrl: () => null, scripts: false, csp: PRINT_COPY_CSP });
  return stripActiveContent(copy);
}

/** Print the sanitized copy from an off-screen sandboxed frame. Never throws. */
export async function printTextDocument(format: "md" | "html", text: string, title: string): Promise<DesktopPrintOutcome> {
  if (typeof document === "undefined" || typeof DOMParser === "undefined") return { outcome: "failed", reason: "print_unavailable" };
  let frame: HTMLIFrameElement | null = null;
  try {
    const srcdoc = buildDesktopPrintCopy(format, text);
    const created = document.createElement("iframe");
    frame = created;
    // allow-same-origin so the parent can reach contentWindow, allow-modals for the print dialog;
    // no allow-scripts, and the copy's CSP forbids script anyway.
    created.setAttribute("sandbox", "allow-same-origin allow-modals");
    created.setAttribute("aria-hidden", "true");
    created.setAttribute("title", title);
    created.tabIndex = -1;
    created.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("print_frame_timeout")), LOAD_TIMEOUT_MS);
      created.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    created.setAttribute("srcdoc", srcdoc);
    document.body.append(created);
    await loaded;
    const view = created.contentWindow;
    if (!view) return { outcome: "failed", reason: "print_frame_unavailable" };
    try { view.document.title = title; } catch { /* title is cosmetic */ }
    view.focus();
    view.print();
    return { outcome: "printed" };
  } catch (error) {
    return { outcome: "failed", reason: error instanceof Error ? error.message : String(error) };
  } finally {
    frame?.remove();
  }
}
