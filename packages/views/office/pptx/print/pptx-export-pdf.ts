/**
 * PPTX print/PDF export port (UNI-927 C1).
 *
 * `createPptxPrintPort` turns the pure print document into an actual print run:
 *
 *   - the BROWSER path mounts the document in a hidden iframe and calls
 *     `contentWindow.print()`, which is what Chromium's "Save as PDF" and the
 *     desktop `printToPDF` both consume;
 *   - the HOST path hands the same HTML to a `pdfSave` function the host bound
 *     explicitly (the genoffice slides desktop export is `webContents.printToPDF`
 *     over an app-owned HTML file). A port is either one or the other: it never
 *     tries a channel nobody bound and then falls back (X4fix F2), so `mode` is
 *     the path that runs. No host binds `pdfSave` yet: the web host binds the
 *     browser path, the desktop host binds nothing and the commands are hidden.
 *
 * The port is a seam, not a policy: it never decides whether the command exists.
 * `pptxPrintCapability` answers the command map from what the port can actually
 * do, so the ribbon shows a real reason instead of a dead enabled control.
 *
 * The frame and the document are injectable so a jsdom test drives the whole
 * path without a real window or a real print dialog.
 */
import type { PptxCommandCapability } from "../command-map";
import { buildPptxPrintHtml, type PptxPrintSlide } from "./pptx-print";

export interface PptxPrintRequest {
  slides: readonly PptxPrintSlide[];
  /** Print document title; the browser uses it as the default file name. */
  title?: string;
  /** Suggested file name for a host that writes to disk. */
  fileName?: string;
}

export type PptxPrintMode = "browser" | "host";

export type PptxPrintOutcome =
  | { outcome: "printed"; mode: PptxPrintMode; path?: string }
  | { outcome: "failed"; reason: string };

/** The hidden frame the browser path prints from. */
export interface PptxPrintFrame {
  /** Hand the frame the print document. */
  write(html: string): void;
  print(): void;
  remove(): void;
}

/** A host-owned PDF write (main-process printToPDF + save dialog). */
export type PptxPdfSave = (request: { html: string; title?: string; fileName?: string }) => Promise<{ ok?: boolean; path?: string } | undefined>;

export interface PptxPrintPortOptions {
  /** The host's PDF write. Bound: every run takes the host path, never the browser. */
  pdfSave?: PptxPdfSave;
  /** Document seam; defaults to the ambient `document` when there is one. */
  document?: Document | null;
  /** Frame factory seam; defaults to a hidden iframe appended to `document.body`. */
  createFrame?: (document: Document, html: string) => PptxPrintFrame | null;
  /** Delay after writing before `print()`, so the frame can lay out. */
  readyDelayMs?: number;
}

export interface PptxPrintPort {
  /** True when the port can print: a frame to print from, or a host channel. */
  readonly available: boolean;
  /** The path a print run takes. `host` only when the host bound `pdfSave`. */
  readonly mode: PptxPrintMode;
  print(request: PptxPrintRequest): Promise<PptxPrintOutcome>;
}

function defaultDocument(): Document | null {
  return typeof document === "undefined" ? null : document;
}

/** A hidden, same-origin iframe: the print document never touches the app's DOM. */
export function createHiddenPrintFrame(doc: Document, html: string): PptxPrintFrame | null {
  const frame = doc.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.visibility = "hidden";
  doc.body.appendChild(frame);
  const win = frame.contentWindow;
  const inner = frame.contentDocument;
  if (!win || !inner) {
    frame.remove();
    return null;
  }
  const remove = (): void => frame.remove();
  return {
    write: (markup: string) => {
      inner.open();
      inner.write(markup);
      inner.close();
    },
    print: () => win.print(),
    remove,
  };
}

function wait(ms: number): Promise<void> {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the port. Availability is honest: a port with no frame seam and no host
 * channel reports `available: false`, so the export-pdf command stays disabled
 * with a reason instead of failing after the click.
 */
export function createPptxPrintPort(options: PptxPrintPortOptions = {}): PptxPrintPort {
  const frameFactory = options.createFrame ?? createHiddenPrintFrame;
  const readyDelayMs = options.readyDelayMs ?? 0;
  const pdfSave = options.pdfSave;
  /** An explicitly supplied `document` wins (including an explicit null); otherwise the
   *  ambient one. Distinguishing null from undefined keeps "no DOM at all" testable. */
  const resolveDocument = (): Document | null => (options.document !== undefined ? options.document : defaultDocument());
  const canUseBrowser = (): boolean => {
    const doc = resolveDocument();
    return doc != null && doc.body != null;
  };
  const mode: PptxPrintMode = pdfSave ? "host" : "browser";
  const available = pdfSave !== undefined || canUseBrowser();

  const printInBrowser = async (html: string): Promise<PptxPrintOutcome> => {
    const doc = resolveDocument();
    if (!doc) return { outcome: "failed", reason: "No document is available to print from." };
    const frame = frameFactory(doc, html);
    if (!frame) return { outcome: "failed", reason: "The print frame could not be created." };
    try {
      frame.write(html);
      await wait(readyDelayMs);
      frame.print();
      return { outcome: "printed", mode: "browser" };
    } catch (error) {
      return { outcome: "failed", reason: error instanceof Error ? error.message : String(error) };
    } finally {
      frame.remove();
    }
  };

  return {
    available,
    mode,
    async print(request: PptxPrintRequest): Promise<PptxPrintOutcome> {
      const html = buildPptxPrintHtml({
        slides: request.slides,
        ...(request.title !== undefined ? { title: request.title } : {}),
      });
      if (pdfSave) {
        try {
          const result = await pdfSave({
            html,
            ...(request.title !== undefined ? { title: request.title } : {}),
            ...(request.fileName !== undefined ? { fileName: request.fileName } : {}),
          });
          if (result?.ok === false) return { outcome: "failed", reason: "The host did not write the PDF." };
          return { outcome: "printed", mode: "host", ...(result?.path ? { path: result.path } : {}) };
        } catch (error) {
          return { outcome: "failed", reason: error instanceof Error ? error.message : String(error) };
        }
      }
      if (!canUseBrowser()) {
        return { outcome: "failed", reason: "No print frame is available." };
      }
      return printInBrowser(html);
    },
  };
}

/** The export-pdf capability for a supplied port. No port -> the honest reason. */
export function pptxPrintCapability(port: PptxPrintPort | null | undefined): PptxCommandCapability {
  if (!port) return { status: "unavailable", reason: "PPTX PDF export is not bound in the browser build" };
  if (!port.available) return { status: "unavailable", reason: "No print surface is bound to this editor" };
  return { status: "available" };
}

