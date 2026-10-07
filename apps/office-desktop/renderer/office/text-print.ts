import { A4_PORTRAIT_PAGE, printPageFromCopy, type OfficePrintOutcome, type OfficePrintPage, type OfficePrintPort, type OfficePrintRequest } from "@uniwork/views/office/print";
import { desktopPrintResponseSchema, PRINT_HTML_MAX_BYTES, type DesktopIpcRequest, type DesktopPrintGeometry, type DesktopPrintOptions } from "../../shared/ipc";
import type { PrintPreviewBridge, PrintPreviewChoice, PrintPreviewHook } from "./print-preview/types";

/**
 * The desktop print port for every Office format (UNI-928, UNI-952).
 *
 * Each view builds its own self-contained, script-free print copy (DOCX
 * sections, XLSX page setup, PPTX slides, PDF pages, Markdown/HTML preview)
 * and hands it to the injected `OfficePrintPort`; this module is the host half.
 * An iframe print inside the sandboxed app window never reaches Electron's
 * print surface (a silent no-op), so the copy crosses the one typed
 * `desktop:print-document` channel and main prints it from its own hidden,
 * script-free window (apps/office-desktop/main/print.ts).
 */

const SESSION_GENERATION = "desktop-dev-session";

/** The one bridge call the print port needs. */
export type DesktopPrintBridge = Readonly<{ call(channel: "desktop:print-document", payload: DesktopIpcRequest<"desktop:print-document">): Promise<unknown> }>;

/** The bridge the host hands `useDesktopPrint`: the print channel plus the
 * channels of the in-app print dialog (UNI-961). The port itself still sees
 * only `DesktopPrintBridge`, so its payload type stays exact. */
export type DesktopPrintHostBridge = DesktopPrintBridge & PrintPreviewBridge;

/** Name the copy after the document. Chromium names the OS print job (and
 * the dialog title) after the page title; a copy with none made the dialog
 * read "Electron - Print". The title is set as text, never markup, and the CSP
 * meta stays the first head child. */
function withDocumentTitle(html: string, title: string): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const existing of Array.from(doc.querySelectorAll("title"))) existing.remove();
  const element = doc.createElement("title");
  element.textContent = title;
  doc.head.append(element);
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}

/** The schema's paper-side bounds (10 mm .. 2 m), in microns. */
const MIN_MICRONS = 10_000;
const MAX_MICRONS = 2_000_000;

function microns(mm: number): number {
  return Math.min(MAX_MICRONS, Math.max(MIN_MICRONS, Math.round(mm * 1000)));
}

/**
 * The print options for a document page (A4 portrait when the view gave
 * none). Chromium reads `pageSize` as the physical sheet and turns it with
 * `landscape`, so the sheet goes over portrait (short side first) and the
 * orientation rides on the flag: a 13.33 x 7.5 in slide becomes a 7.5 x 13.33
 * in sheet printed landscape, which is what the copy's `@page size` lays out.
 */
export function desktopPrintOptions(page: OfficePrintPage | undefined): DesktopPrintGeometry {
  // A size that is not a number would fail the schema and print nothing.
  const usable = page && Number.isFinite(page.widthMm) && Number.isFinite(page.heightMm) ? page : A4_PORTRAIT_PAGE;
  const { widthMm, heightMm, landscape } = usable;
  const short = Math.min(widthMm, heightMm);
  const long = Math.max(widthMm, heightMm);
  return { landscape, pageSize: { width: microns(short), height: microns(long) } };
}

/** The page a print run lays out: the one the view gave, else the copy's own
 * first `@page` size (Markdown, HTML), else undefined (A4 portrait). */
function printRequestPage(request: OfficePrintRequest): OfficePrintPage | undefined {
  return request.page ?? printPageFromCopy(request.html);
}

/** A blank title would leave the copy untitled and Chromium would name the job
 * after the app ("Electron"); fall back to the generic document name. */
function jobTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, 255) || "document";
}

/** UTF-8 size of the copy: main refuses a payload over the cap, so a copy that
 * big fails here with a typed reason instead of an opaque refused call. */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * The desktop `OfficePrintPort`: stamp the document title on the sanitized
 * copy a view produced and send it to main with the page geometry as print
 * options (the system dialog opens in the document's orientation and paper,
 * not portrait), and main prints it. A request without a page (Markdown,
 * HTML) takes the copy's own first `@page` size, else A4 portrait. Never throws - a
 * refused call, a malformed answer, an oversized copy or a missing bridge is a
 * typed failure, never a silent success.
 *
 * With a `preview` (the in-app print dialog, UNI-961) the stamped copy and its
 * geometry go to the dialog first and the user's choice decides what is sent:
 * `print` sends the dialog's silent options, `system` the geometry alone (the
 * OS dialog, as without a preview), `cancel` sends nothing. A preview that
 * throws is `print_preview_failed`.
 */
export function createDesktopPrintPort(bridge: DesktopPrintBridge | undefined, { preview }: { preview?: PrintPreviewHook } = {}): OfficePrintPort {
  return {
    async print(request): Promise<OfficePrintOutcome> {
      const { html, title } = request;
      if (!bridge) return { outcome: "failed", reason: "print_unavailable" };
      // Checked before the title is stamped (no reparse of a copy that cannot
      // be sent) and after (the title adds a few bytes).
      const tooLarge: OfficePrintOutcome = { outcome: "failed", reason: "print_too_large" };
      if (utf8Bytes(html) > PRINT_HTML_MAX_BYTES) return tooLarge;
      const jobName = jobTitle(title);
      const copy = withDocumentTitle(html, jobName);
      if (utf8Bytes(copy) > PRINT_HTML_MAX_BYTES) return tooLarge;
      const geometry = desktopPrintOptions(printRequestPage(request));
      let options: DesktopPrintOptions = geometry;
      if (preview) {
        let choice: PrintPreviewChoice;
        try {
          choice = await preview({ title: jobName, html: copy, geometry });
        } catch {
          return { outcome: "failed", reason: "print_preview_failed" };
        }
        if (choice.kind === "cancel") return { outcome: "cancelled" };
        if (choice.kind === "print") options = choice.options;
      }
      try {
        const parsed = desktopPrintResponseSchema.safeParse(await bridge.call("desktop:print-document", { sessionGeneration: SESSION_GENERATION, title: jobName, html: copy, options }));
        return parsed.success ? parsed.data : { outcome: "failed", reason: "print_response_invalid" };
      } catch {
        // A refused call (sender check, closed bridge): a code, never the raw Electron message.
        return { outcome: "failed", reason: "print_call_failed" };
      }
    },
  };
}
