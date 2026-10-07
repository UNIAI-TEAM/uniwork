import { desktopPrintPreviewResponseSchema, desktopPrintPrintersResponseSchema, type DesktopIpcRequest, type DesktopPrinter, type DesktopPrintGeometry } from "../../../shared/ipc";
import { createPdfEngineSession } from "../pdf-engine-session";
import { withChosenSheet } from "./page-override";
import type { PrintPreviewBridge, PrintPreviewJob } from "./types";

/**
 * Where the print dialog gets its data (UNI-961): the OS printers, and a
 * laid-out copy of the document as a PDF the engine's PDF lane renders page by
 * page. The dialog never reads the document itself; it asks main for the PDF
 * (`desktop:print-preview`) and then asks the engine for pixels.
 */

// Same constant text-print.ts sends; the host's session fence, not a secret.
const SESSION_GENERATION = "desktop-dev-session";
/** The engine-call handle of the preview document; the surface id keeps two
 * dialogs (or a dialog and an open PDF tab) from replacing each other's PDF. */
const ENGINE_HANDLE = "print-preview";
/** Thumbnails are small: the engine scale of a point-sized page. */
export const THUMBNAIL_SCALE = 0.6;

export interface PreviewImage {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/** One laid-out preview: its page count and a memoised page renderer. */
export interface PreviewDocument {
  /** Unique per document; the dialog keys its thumbnails by it. */
  readonly id: string;
  readonly pageCount: number;
  /** Render page `pageIndex` (0-based); the same page is rendered once. */
  render(pageIndex: number): Promise<PreviewImage>;
  /** Free the engine's copy. Idempotent; later renders reject. */
  close(): void;
}

/** `reason` is main's typed failure (`print_preview_too_large`, `print_busy`,
 * `print_timeout`, `print_unavailable`) or one the dialog adds for a reply it
 * could not use. */
export type PreviewOutcome =
  | { readonly kind: "ready"; readonly document: PreviewDocument }
  | { readonly kind: "failed"; readonly reason: string };

interface EngineAnswer {
  ok: boolean;
  probe?: { pageCount?: number };
  pdfHandle?: string;
  pngBase64?: string;
  width?: number;
  height?: number;
  error?: { kind?: string };
}

function newSurfaceId(): string {
  const random = crypto.getRandomValues(new Uint8Array(12));
  return `pp_${Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** The OS printers, default first. Rejects when the list cannot be read. */
export async function loadPrinters(bridge: PrintPreviewBridge): Promise<DesktopPrinter[]> {
  const raw = await bridge.call("desktop:print-printers", { sessionGeneration: SESSION_GENERATION });
  const parsed = desktopPrintPrintersResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("print_printers_invalid");
  return [...parsed.data.printers].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** Lay the copy out at `geometry` and open the resulting PDF in the engine. */
export async function loadPreviewDocument(bridge: PrintPreviewBridge, job: PrintPreviewJob, geometry: DesktopPrintGeometry): Promise<PreviewOutcome> {
  let pdf: Uint8Array | ArrayBuffer;
  try {
    const raw = await bridge.call("desktop:print-preview", { sessionGeneration: SESSION_GENERATION, title: job.title, html: withChosenSheet(job.html, geometry, job.geometry), options: geometry });
    const parsed = desktopPrintPreviewResponseSchema.safeParse(raw);
    if (!parsed.success) return { kind: "failed", reason: "print_unavailable" };
    if (parsed.data.outcome === "failed") return { kind: "failed", reason: parsed.data.reason };
    pdf = parsed.data.pdf;
  } catch {
    return { kind: "failed", reason: "print_unavailable" };
  }
  return await openInEngine(bridge, pdf);
}

async function openInEngine(bridge: PrintPreviewBridge, pdf: Uint8Array | ArrayBuffer): Promise<PreviewOutcome> {
  const surface = newSurfaceId();
  // The bytes came through the preload bridge (another realm), so `instanceof` would lie.
  const data = ArrayBuffer.isView(pdf) ? (pdf as Uint8Array) : new Uint8Array(pdf);
  const callEngine = async (operation: "open" | "render" | "close", args: Record<string, unknown>): Promise<EngineAnswer> => {
    const payload: DesktopIpcRequest<"desktop:engine-call"> = { sessionGeneration: SESSION_GENERATION, operation, handle: ENGINE_HANDLE, args: { ...args, surface } };
    return await bridge.call("desktop:engine-call", payload) as EngineAnswer;
  };
  const retainedOpen = (): Record<string, unknown> => ({ data, retain: true });
  const free = (pdfHandle: string): void => { void callEngine("close", { pdfHandle }).catch(() => undefined); };

  let opened: EngineAnswer;
  try { opened = await callEngine("open", retainedOpen()); }
  catch { return { kind: "failed", reason: "print_unavailable" }; }
  const pageCount = opened.probe?.pageCount;
  if (!opened.ok || !opened.pdfHandle || typeof pageCount !== "number" || pageCount < 1) {
    if (opened.pdfHandle) free(opened.pdfHandle);
    return { kind: "failed", reason: "print_unavailable" };
  }

  // A stale handle (the engine evicted it) re-sends the PDF once; the session owns that retry.
  const session = createPdfEngineSession({
    reopen: async () => {
      const again = await callEngine("open", retainedOpen());
      if (!again.ok || !again.pdfHandle) throw new Error("print_preview_reopen_failed");
      return again.pdfHandle;
    },
    close: (pdfHandle) => callEngine("close", { pdfHandle }),
  });
  session.adopt(opened.pdfHandle);

  const rendered = new Map<number, Promise<PreviewImage>>();
  let closed = false;
  return {
    kind: "ready",
    document: {
      id: surface,
      pageCount,
      render(pageIndex) {
        if (closed) return Promise.reject(new Error("print_preview_closed"));
        let pending = rendered.get(pageIndex);
        if (!pending) {
          pending = (async () => {
            const answer = await session.run((pdfHandle) => callEngine("render", { pdfHandle, pageIndex, scale: THUMBNAIL_SCALE }));
            if (!answer.ok || !answer.pngBase64) throw new Error("print_preview_render_failed");
            return { src: `data:image/png;base64,${answer.pngBase64}`, width: answer.width ?? 0, height: answer.height ?? 0 };
          })();
          rendered.set(pageIndex, pending);
          // A failed page may be asked for again; nobody awaiting it must not reject unhandled.
          pending.catch(() => { if (rendered.get(pageIndex) === pending) rendered.delete(pageIndex); });
        }
        return pending;
      },
      close() {
        if (closed) return;
        closed = true;
        session.close();
      },
    },
  };
}
