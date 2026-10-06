import type { OfficePrintOutcome, OfficePrintPort } from "@uniwork/views/office/print";
import { desktopPrintResponseSchema, PRINT_HTML_MAX_BYTES, type DesktopIpcRequest } from "../../shared/ipc";

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

/** UTF-8 size of the copy: main refuses a payload over the cap, so a copy that
 * big fails here with a typed reason instead of an opaque refused call. */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * The desktop `OfficePrintPort`: stamp the document title on the sanitized
 * copy a view produced and send it to main, which prints it. Never throws - a
 * refused call, a malformed answer, an oversized copy or a missing bridge is a
 * typed failure, never a silent success.
 */
export function createDesktopPrintPort(bridge: DesktopPrintBridge | undefined): OfficePrintPort {
  return {
    async print({ html, title }): Promise<OfficePrintOutcome> {
      if (!bridge) return { outcome: "failed", reason: "print_unavailable" };
      // Checked before the title is stamped (no reparse of a copy that cannot
      // be sent) and after (the title adds a few bytes).
      const tooLarge: OfficePrintOutcome = { outcome: "failed", reason: "print_too_large" };
      if (utf8Bytes(html) > PRINT_HTML_MAX_BYTES) return tooLarge;
      const copy = withDocumentTitle(html, title);
      if (utf8Bytes(copy) > PRINT_HTML_MAX_BYTES) return tooLarge;
      try {
        const parsed = desktopPrintResponseSchema.safeParse(await bridge.call("desktop:print-document", { sessionGeneration: SESSION_GENERATION, title: title.slice(0, 255), html: copy }));
        return parsed.success ? parsed.data : { outcome: "failed", reason: "print_response_invalid" };
      } catch {
        // A refused call (sender check, closed bridge): a code, never the raw Electron message.
        return { outcome: "failed", reason: "print_call_failed" };
      }
    },
  };
}

/** Wrap a port so the host learns when a print is in flight (the shell
 * shows its Windows preview hint while the dialog is up). The outcome passes
 * through untouched: every view shows its own busy/failed notice. */
export function observePrintPort(port: OfficePrintPort, observer: { onStart(): void; onSettled(): void }): OfficePrintPort {
  return {
    async print(request) {
      observer.onStart();
      try {
        return await port.print(request);
      } finally {
        observer.onSettled();
      }
    },
  };
}
