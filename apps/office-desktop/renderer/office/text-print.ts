import { emptyAssetManifest } from "@uniwork/office-engine/assets";
import { buildMarkdownPreviewCopy } from "@uniwork/office-engine/markdown";
import { PRINT_COPY_CSP, printMarkdownDocument, sanitizePrintCopy, type MarkdownPrintCopyOptions, type MarkdownPrintOutcome, type MarkdownPrintPort } from "@uniwork/views/office/markdown";
import { desktopPrintResponseSchema, type DesktopIpcRequest } from "../../shared/ipc";

/**
 * Desktop Markdown/HTML print. The copy is built by the SHARED view building
 * blocks (`sanitizePrintCopy` + `PRINT_COPY_CSP` from
 * packages/views/office/markdown/wysiwyg/print.ts, re-exported by the markdown
 * and html barrels): the desktop no longer mirrors the sanitizer, so there is
 * exactly one source of truth for what a print payload may contain.
 *
 * The desktop supplies the host half: it renders the current text to HTML
 * (Markdown -> engine preview fragment, HTML -> the source itself) and hands
 * the sanitized copy to main over the one typed `desktop:print-document`
 * channel. An iframe print inside the sandboxed app window never reaches
 * Electron's print surface (a silent no-op), so main prints the copy from its
 * own hidden, script-free window (apps/office-desktop/main/print.ts). The raw
 * source never crosses IPC: the render -> sanitize -> port flow is the shared
 * `printMarkdownDocument`.
 */

const SESSION_GENERATION = "desktop-dev-session";

/** The one bridge call the print port needs. */
export type DesktopPrintBridge = Readonly<{ call(channel: "desktop:print-document", payload: DesktopIpcRequest<"desktop:print-document">): Promise<unknown> }>;

/** Main answers this reason while a print dialog is still open (one print at
 * a time); the screen shows its own "already open" copy instead of the generic
 * action error. */
export function isPrintBusy(outcome: MarkdownPrintOutcome): boolean {
  return outcome.outcome === "failed" && outcome.reason === "print_busy";
}

/** Main reports the shared outcomes: `printed`, `cancelled` (the OS dialog
 * was dismissed) or a typed `failed`. */
type DesktopPrintOutcome = MarkdownPrintOutcome;

/** Render the CURRENT text to the HTML the sanitizer receives: Markdown goes
 * through the engine preview fragment (never the raw source); HTML is already
 * markup and the sanitizer's `scripts: false` pass strips its active content. */
export function renderPrintHtml(format: "md" | "html", text: string): string {
  return format === "md" ? buildMarkdownPreviewCopy({ source: text, document_path: "document.md" }) : text;
}

/** The copy options the desktop passes to the shared sanitizer: no asset broker
 * (local mode denies by default) and the shared print CSP. */
function printCopyOptions(format: "md" | "html"): MarkdownPrintCopyOptions {
  return { manifest: emptyAssetManifest(format === "md" ? "document.md" : "document.html"), assetUrl: () => null, csp: PRINT_COPY_CSP };
}

/** The sanitized print copy of the CURRENT text, built by the shared sanitizer
 * (which now owns the former desktop gap-fill). */
export function buildDesktopPrintCopy(format: "md" | "html", text: string): string {
  return sanitizePrintCopy(renderPrintHtml(format, text), printCopyOptions(format));
}

/** Name the sanitized copy after the document. Chromium names the OS print job
 * (and the dialog title) after the page title; a copy with none made the dialog
 * read "Electron - Print". The title is set as text, never markup, and the CSP
 * meta stays the first head child. */
function withDocumentTitle(html: string, title: string): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const existing of Array.from(doc.querySelectorAll("title"))) existing.remove();
  const element = doc.createElement("title");
  element.textContent = title;
  doc.head.append(element);
  return doc.documentElement.outerHTML;
}

/**
 * The desktop `MarkdownPrintPort`: send the sanitized copy the SHARED flow
 * produced to main, which prints it. Never throws - a refused call, a
 * malformed answer or a missing bridge is a typed failure, never a silent
 * success. A host that ever provides a `HeaderActionsSlotProvider` mounts this
 * through the shared `MarkdownPrintMenuItems` entry; the desktop's own "..."
 * menu uses {@link printTextDocument}, which drives the same port.
 */
export function createDesktopPrintPort(bridge: DesktopPrintBridge | undefined): MarkdownPrintPort {
  return {
    async print({ html, title }): Promise<MarkdownPrintOutcome> {
      if (!bridge) return { outcome: "failed", reason: "print_unavailable" };
      try {
        const parsed = desktopPrintResponseSchema.safeParse(await bridge.call("desktop:print-document", { sessionGeneration: SESSION_GENERATION, title: title.slice(0, 255), html: withDocumentTitle(html, title) }));
        return parsed.success ? parsed.data : { outcome: "failed", reason: "print_response_invalid" };
      } catch {
        // A refused call (size cap, sender check, closed bridge): a code, never the raw Electron message.
        return { outcome: "failed", reason: "print_call_failed" };
      }
    },
  };
}

/** Print the current text through the SHARED render -> sanitize -> port flow
 * (`printMarkdownDocument`); the desktop port hands the copy to main. Never
 * throws; a port failure becomes a typed failure. */
export async function printTextDocument(bridge: DesktopPrintBridge | undefined, format: "md" | "html", text: string, title: string): Promise<MarkdownPrintOutcome> {
  if (typeof DOMParser === "undefined") return { outcome: "failed", reason: "print_unavailable" };
  return printMarkdownDocument({ port: createDesktopPrintPort(bridge), renderHtml: () => renderPrintHtml(format, text), title, ...printCopyOptions(format) });
}
