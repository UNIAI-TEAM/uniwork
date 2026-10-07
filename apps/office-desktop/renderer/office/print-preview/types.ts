import type { DesktopIpcRequest, DesktopPrintGeometry, DesktopPrintOptions } from "../../../shared/ipc";

/**
 * The contract between the desktop print port (text-print.ts) and the in-app
 * print dialog (UNI-961). The port stamps the title on the view's script-free
 * copy and hands the dialog that exact copy plus the document's geometry; the
 * dialog lays it out through `desktop:print-preview` and answers what the
 * user chose. The port alone talks to `desktop:print-document`.
 */
export interface PrintPreviewJob {
  /** The job name (document title, never blank). */
  readonly title: string;
  /** The titled, sanitized, script-free copy the port will print. */
  readonly html: string;
  /** The document's own orientation and paper: the dialog's defaults. */
  readonly geometry: DesktopPrintGeometry;
}

/** `print`: send the copy silently with these options (always `silent: true`
 * plus the chosen `deviceName`). `system`: open the OS dialog as before the
 * preview existed. `cancel`: the user closed the dialog; nothing is sent. */
export type PrintPreviewChoice =
  | { readonly kind: "print"; readonly options: DesktopPrintOptions }
  | { readonly kind: "system" }
  | { readonly kind: "cancel" };

export type PrintPreviewHook = (job: PrintPreviewJob) => Promise<PrintPreviewChoice>;

/** The bridge calls the dialog makes: the preview PDF, the printer list and
 * the engine's PDF lane for thumbnails. */
export type PrintPreviewChannel = "desktop:print-preview" | "desktop:print-printers" | "desktop:engine-call";
export type PrintPreviewBridge = Readonly<{ call<C extends PrintPreviewChannel>(channel: C, payload: DesktopIpcRequest<C>): Promise<unknown> }>;
