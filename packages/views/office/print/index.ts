/**
 * The format-neutral print contract (UNI-952). Every Office format prints the
 * same way: the view builds a self-contained, script-free, printable HTML copy
 * of the document (`{ html, title }`) and hands it to an INJECTED port. The
 * view never calls `window.print()` on the app window.
 *
 * The shapes are the Markdown print port's (M8), which every format now shares
 * under neutral names. Web injects {@link createBrowserPrintPort}; the desktop
 * injects its host port (apps/office-desktop/renderer/office/text-print.ts),
 * which prints the copy from main's own hidden window.
 */
import type { MarkdownPrintOutcome, MarkdownPrintRequest } from "../markdown/wysiwyg/print";

/**
 * The document's page geometry, for hosts whose print API takes it as options
 * instead of reading the copy's `@page` rule (Electron's `webContents.print`
 * opens the system dialog in portrait otherwise). One value per run: the first
 * DOCX section, the active sheet's setup, the deck's slide size, the PDF's
 * first page. Width and height are the page AS PRINTED (a landscape page is
 * wider than tall) and agree with the copy's `@page size`.
 */
export interface OfficePrintPage {
  widthMm: number;
  heightMm: number;
  landscape: boolean;
}

/** Markdown and HTML print on A4 portrait (their copy's `@page`); also what
 * the desktop port assumes for a request that carries no page. */
export const A4_PORTRAIT_PAGE: OfficePrintPage = Object.freeze({ widthMm: 210, heightMm: 297, landscape: false });

/** What a print port receives: the sanitized copy, the document title and,
 * when the view knows it, the page geometry ({@link OfficePrintPage}). */
export interface OfficePrintRequest extends MarkdownPrintRequest {
  page?: OfficePrintPage | undefined;
}
/** `printed`, `cancelled` (dialog dismissed, silent) or a typed `failed`. */
export type OfficePrintOutcome = MarkdownPrintOutcome;
/** The host print path a view is given. Every Office port is also a Markdown
 * port: a Markdown request is an Office request without a page. */
export interface OfficePrintPort {
  print(request: OfficePrintRequest): OfficePrintOutcome | Promise<OfficePrintOutcome>;
}

/** Reasons that mean "a print dialog may still be open": `print_busy` (one
 * print at a time) and `print_timeout` (the desktop host got no answer from
 * the dialog in time, and keeps the job open rather than closing it). */
const BUSY_REASONS: ReadonlySet<string> = new Set(["print_busy", "print_timeout"]);

/** A view shows its neutral "already open" status for these outcomes instead
 * of the generic action error: neither is a failure the user caused. */
export function isPrintBusy(outcome: OfficePrintOutcome): boolean {
  return outcome.outcome === "failed" && BUSY_REASONS.has(outcome.reason);
}

/**
 * The web host's print path. The copy goes into an off-screen frame and only
 * that frame prints, so app chrome never reaches the job. `print()` blocks for
 * the dialog in every supported browser, so the frame comes down right after.
 */
export function createBrowserPrintPort(): OfficePrintPort {
  return {
    print({ html, title }) {
      if (typeof document === "undefined") return { outcome: "failed", reason: "no_dom" };
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
      document.body.append(frame);
      const view = frame.contentWindow;
      if (!view?.document) {
        frame.remove();
        return { outcome: "failed", reason: "no_print_frame" };
      }
      view.document.open();
      view.document.write(html);
      view.document.close();
      view.document.title = title;
      try {
        view.focus();
        view.print();
      } catch {
        frame.remove();
        return { outcome: "failed", reason: "print_blocked" };
      }
      window.setTimeout(() => frame.remove(), 0);
      return { outcome: "printed" };
    },
  };
}

export { printPageFromCopy } from "./page";
