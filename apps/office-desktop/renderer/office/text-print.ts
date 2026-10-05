import { emptyAssetManifest } from "@uniwork/office-engine/assets";
import { buildMarkdownPreviewCopy } from "@uniwork/office-engine/markdown";
import { PRINT_COPY_CSP, printMarkdownDocument, sanitizePrintCopy, type MarkdownPrintCopyOptions, type MarkdownPrintOutcome, type MarkdownPrintPort } from "@uniwork/views/office/markdown";

/**
 * Desktop Markdown/HTML print. The copy is built by the SHARED view building
 * blocks (`sanitizePrintCopy` + `PRINT_COPY_CSP` from
 * packages/views/office/markdown/wysiwyg/print.ts, re-exported by the markdown
 * and html barrels): the desktop no longer mirrors the sanitizer, so there is
 * exactly one source of truth for what a print payload may contain.
 *
 * The desktop supplies the host half: it renders the current text to HTML
 * (Markdown -> engine preview fragment, HTML -> the source itself) and prints
 * the sanitized copy from an off-screen sandboxed iframe, exactly as the web
 * `browserPrintPort` does. The render -> sanitize -> port flow is the shared
 * `printMarkdownDocument`; the raw source is never handed to a print surface
 * and no IPC is involved.
 */

const LOAD_TIMEOUT_MS = 10_000;

/** The desktop port keeps the shared `printed`/`failed` outcomes: a sandboxed
 * print frame cannot observe the OS dialog being dismissed, so there is no way
 * to report the shared `cancelled` outcome and it is never produced. */
export type DesktopPrintOutcome = MarkdownPrintOutcome;

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

/**
 * The desktop `MarkdownPrintPort`: print the sanitized copy from an off-screen
 * sandboxed frame. The frame receives the copy the SHARED flow produced. Never
 * throws - a failure is a typed outcome. A host that ever provides a
 * `HeaderActionsSlotProvider` mounts this through the shared
 * `MarkdownPrintMenuItems` entry; the desktop's own "..." menu uses
 * {@link printTextDocument}, which drives the same port.
 */
export function createDesktopPrintPort(): MarkdownPrintPort {
  return {
    async print({ html, title }): Promise<MarkdownPrintOutcome> {
      if (typeof document === "undefined" || typeof DOMParser === "undefined") return { outcome: "failed", reason: "print_unavailable" };
      let frame: HTMLIFrameElement | null = null;
      try {
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
        created.setAttribute("srcdoc", html);
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
    },
  };
}

/** Print the current text through the SHARED render -> sanitize -> port flow
 * (`printMarkdownDocument`); the desktop port adds the sandboxed frame. Never
 * throws; a port failure becomes a typed failure. */
export async function printTextDocument(format: "md" | "html", text: string, title: string): Promise<MarkdownPrintOutcome> {
  if (typeof DOMParser === "undefined") return { outcome: "failed", reason: "print_unavailable" };
  return printMarkdownDocument({ port: createDesktopPrintPort(), renderHtml: () => renderPrintHtml(format, text), title, ...printCopyOptions(format) });
}
