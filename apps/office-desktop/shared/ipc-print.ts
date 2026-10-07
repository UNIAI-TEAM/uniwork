import { z } from "zod";

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

/**
 * What main hands to `webContents.print` besides its fixed defaults: the
 * document's orientation and paper (its first page / section / active sheet,
 * or the slide size), so the system dialog does not open in portrait. The
 * sheet is given portrait (short side first) and `landscape` turns it.
 * Unknown keys are refused.
 */
export const desktopPrintOptionsSchema = z.object({
  landscape: z.boolean(),
  pageSize: z.object({ width: micronsSchema, height: micronsSchema }).strict(),
}).strict();
export type DesktopPrintOptions = z.infer<typeof desktopPrintOptionsSchema>;
