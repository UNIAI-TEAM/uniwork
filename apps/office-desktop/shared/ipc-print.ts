import { z } from "zod";
import { bytesSchema } from "./ipc-bytes";

/**
 * The print slice of the desktop wire surface (UNI-928, UNI-952), split out of
 * ipc.ts, which re-exports it. Like ipc.ts it stays free of Electron and main
 * imports so preload and renderer consume only contracts.
 */

/** Desktop print of an already-sanitized copy of any Office format. The renderer
 * sends only a sanitized, script-free copy; main prints it from a separate
 * hidden window with JavaScript off, so the cap only bounds memory. */
export const PRINT_HTML_MAX_BYTES = 16 * 1024 * 1024;

export const desktopPrintResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("printed") }).strict(),
  z.object({ outcome: z.literal("cancelled") }).strict(),
  z.object({ outcome: z.literal("failed"), reason: z.string().regex(/^[a-z0-9_]{1,64}$/) }).strict(),
]);
export type DesktopPrintResponse = z.infer<typeof desktopPrintResponseSchema>;

/** Paper side in microns (Electron's unit): 10 mm .. 2 m, enough for any
 * office sheet, card or banner and far below anything that could hurt. */
const micronsSchema = z.number().int().min(10_000).max(2_000_000);

/** The document's orientation and paper (its first page / section / active
 * sheet, or the slide size). The sheet is given portrait (short side first)
 * and `landscape` turns it. Shared by print and the print preview. */
const printGeometryShape = {
  landscape: z.boolean(),
  pageSize: z.object({ width: micronsSchema, height: micronsSchema }).strict(),
};
export const desktopPrintGeometrySchema = z.object(printGeometryShape).strict();
export type DesktopPrintGeometry = z.infer<typeof desktopPrintGeometrySchema>;

/** One 0-based, inclusive page span of the in-app print dialog (UNI-961). */
const pageRangeSchema = z.object({ from: z.number().int().min(0).max(99_999), to: z.number().int().min(0).max(99_999) }).strict().refine((range) => range.from <= range.to, "range runs backwards");

/**
 * What main hands to `webContents.print` besides its fixed defaults. Without
 * `silent` the system dialog opens on the document's geometry (Windows ignores
 * it there, which is why the in-app dialog exists). With `silent: true` (the
 * in-app dialog, UNI-961) the job goes straight to the chosen `deviceName`
 * with the chosen copies, pages, colour and duplex - the only path where
 * Chromium honours landscape and paper on Windows. A silent job always names
 * its printer, and the job settings exist only on a silent job. Unknown keys
 * are refused.
 */
export const desktopPrintOptionsSchema = z.object({
  ...printGeometryShape,
  silent: z.literal(true).optional(),
  deviceName: z.string().min(1).max(256).optional(),
  copies: z.number().int().min(1).max(999).optional(),
  pageRanges: z.array(pageRangeSchema).min(1).max(100).optional(),
  color: z.boolean().optional(),
  duplexMode: z.enum(["simplex", "shortEdge", "longEdge"]).optional(),
}).strict().refine((options) => {
  const jobKeys = [options.deviceName, options.copies, options.pageRanges, options.color, options.duplexMode].some((value) => value !== undefined);
  return options.silent ? options.deviceName !== undefined : !jobKeys;
}, "a silent print names its printer; job settings need a silent print");
export type DesktopPrintOptions = z.infer<typeof desktopPrintOptionsSchema>;

/** The largest preview PDF main hands back (UNI-961). Past it the preview
 * answers `print_preview_too_large` and the dialog still offers printing. */
export const PRINT_PREVIEW_MAX_BYTES = 64 * 1024 * 1024;

/** `desktop:print-preview`: the same script-free copy `desktop:print-document`
 * takes, laid out by `printToPDF` on the same hidden print-window path. */
export const desktopPrintPreviewRequestSchema = z.object({
  sessionGeneration: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, "invalid session generation"),
  title: z.string().max(255),
  html: z.string().min(1).max(PRINT_HTML_MAX_BYTES),
  options: desktopPrintGeometrySchema,
}).strict();
export type DesktopPrintPreviewRequest = z.infer<typeof desktopPrintPreviewRequestSchema>;

/** The preview PDF as bytes (never base64), or a typed failure:
 * `print_busy`, `print_timeout`, `print_preview_too_large`, `print_unavailable`. */
export const desktopPrintPreviewResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("ready"), pdf: bytesSchema }).strict(),
  z.object({ outcome: z.literal("failed"), reason: z.string().regex(/^[a-z0-9_]{1,64}$/) }).strict(),
]);
export type DesktopPrintPreviewResponse = z.infer<typeof desktopPrintPreviewResponseSchema>;

/** `desktop:print-printers`: the OS printers (`webContents.getPrintersAsync`),
 * names only - never driver options, ports or locations. */
export const desktopPrinterSchema = z.object({ name: z.string().min(1).max(256), displayName: z.string().max(256), isDefault: z.boolean() }).strict();
export type DesktopPrinter = z.infer<typeof desktopPrinterSchema>;
export const desktopPrintPrintersResponseSchema = z.object({ printers: z.array(desktopPrinterSchema).max(128) }).strict();
export type DesktopPrintPrintersResponse = z.infer<typeof desktopPrintPrintersResponseSchema>;
