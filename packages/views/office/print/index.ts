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
import type { MarkdownPrintOutcome, MarkdownPrintPort, MarkdownPrintRequest } from "../markdown/wysiwyg/print";

/** What a print port receives: the sanitized copy and the document title. */
export type OfficePrintRequest = MarkdownPrintRequest;
/** `printed`, `cancelled` (dialog dismissed, silent) or a typed `failed`. */
export type OfficePrintOutcome = MarkdownPrintOutcome;
/** The host print path a view is given. */
export type OfficePrintPort = MarkdownPrintPort;

/** A host answers this reason while a print dialog is still open (one print
 * at a time); a view shows its neutral "already open" status for it instead of
 * the generic action error. */
export function isPrintBusy(outcome: OfficePrintOutcome): boolean {
  return outcome.outcome === "failed" && outcome.reason === "print_busy";
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
