/**
 * PPTX print/PDF export port (UNI-927 C1).
 *
 * `createPptxPrintPort` turns the pure print document into an actual print run:
 *
 *   - the BROWSER path mounts the document in a hidden iframe and calls
 *     `contentWindow.print()`, which is what Chromium's "Save as PDF" and the
 *     desktop `printToPDF` both consume;
 *   - the HOST path forwards the same HTML to the host's typed `host:pdf-save`
 *     channel when the caller bound one (the genoffice slides desktop export is
 *     `webContents.printToPDF` over an app-owned HTML file), and falls back to
 *     the browser path when the host refuses.
 *
 * The port is a seam, not a policy: it never decides whether the command exists.
 * `pptxPrintCapability` answers the command map from what the port can actually
 * do, so the ribbon shows a real reason instead of a dead enabled control.
 *
 * The frame and the document are injectable so a jsdom test drives the whole
 * path without a real window or a real print dialog.
 */
import type { OfficeHost } from "@uniwork/core/office";
import type { PptxCommandCapability } from "../command-map";
import { buildPptxPrintHtml, type PptxPrintSlide } from "./pptx-print";

/** The host channel the contract already declares for a PDF write. */
export const PPTX_PRINT_HOST_CHANNEL = "host:pdf-save";

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

export interface PptxPrintPortOptions {
  /** Host IPC, when the host exposes a printToPDF channel. */
  host?: OfficeHost | null;
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
  /** The path a print run would take. `host` only when the host channel is bound. */
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

function hasHostChannel(host: OfficeHost | null | undefined): boolean {
  return typeof host?.ipc?.call === "function";
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
  const hostBound = hasHostChannel(options.host);
  /** An explicitly supplied `document` wins (including an explicit null); otherwise the
   *  ambient one. Distinguishing null from undefined keeps "no DOM at all" testable. */
  const resolveDocument = (): Document | null => (options.document !== undefined ? options.document : defaultDocument());
  const canUseBrowser = (): boolean => {
    const doc = resolveDocument();
    return doc != null && doc.body != null;
  };
  const mode: PptxPrintMode = hostBound ? "host" : "browser";
  const available = hostBound || canUseBrowser();

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
      if (hostBound) {
        const host = options.host;
        try {
          const result = (await host?.ipc.call(PPTX_PRINT_HOST_CHANNEL, {
            html,
            ...(request.title !== undefined ? { title: request.title } : {}),
            ...(request.fileName !== undefined ? { fileName: request.fileName } : {}),
          })) as { ok?: boolean; path?: string } | undefined;
          if (result?.ok !== false) {
            return { outcome: "printed", mode: "host", ...(result?.path ? { path: result.path } : {}) };
          }
        } catch {
          // The host refused the channel (the desktop host refuses every `host:`
          // channel today). Fall through to the browser path, which still prints.
        }
      }
      if (!canUseBrowser()) {
        return { outcome: "failed", reason: "Neither a print frame nor a host print channel is bound." };
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

