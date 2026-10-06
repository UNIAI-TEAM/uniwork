import { officePrintRequestedEventSchema } from "../shared/ipc";

/**
 * Cmd+P (macOS) / Ctrl+P (elsewhere) for the app window, decided in main (UNI-952 fix-G-ctrlp).
 *
 * A sandboxed preview iframe (Markdown / HTML) is script-free and has an opaque
 * origin, so a key pressed inside it never reaches the renderer's window. The
 * main process sees every key event of the window's webContents first, frames
 * included (`before-input-event`), so it claims the chord there and tells the
 * renderer, whose Office shell runs the open document's Print - or does nothing
 * when no document registered one. Electron has no native Ctrl+P, so claiming
 * it never removes a platform behaviour and the app window is never printed.
 */

/** The slice of Electron's `Input` this module reads. */
export interface PrintShortcutInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  isAutoRepeat?: boolean;
}

/** The slice of the app window's `webContents` the shortcut needs. */
export interface PrintShortcutWebContents {
  on(event: "before-input-event", listener: (event: { preventDefault(): void }, input: PrintShortcutInput) => void): void;
  send(channel: "desktop:office-print-requested", payload: unknown): void;
}

/**
 * The platform's print chord: Cmd+P on macOS, Ctrl+P elsewhere. Ctrl+P is a
 * text-field edit on macOS (cursor up), so it is never claimed there, and Win+P
 * on Windows is the OS projection switch, so Meta is never claimed there.
 */
function isPrintShortcutInput(input: PrintShortcutInput, platform: string): boolean {
  const primary = platform === "darwin" ? input.meta && !input.control : input.control && !input.meta;
  return input.type === "keyDown" && primary && !input.alt && !input.shift && input.key.toLowerCase() === "p";
}

/** Claim the platform's print chord on `webContents` and forward it as `desktop:office-print-requested`. */
export function installPrintShortcut(webContents: PrintShortcutWebContents, platform: string = process.platform): void {
  webContents.on("before-input-event", (event, input) => {
    if (!isPrintShortcutInput(input, platform)) return;
    // Claimed even when held down, so no repeat reaches the page; only the first press is forwarded.
    event.preventDefault();
    if (!input.isAutoRepeat) webContents.send("desktop:office-print-requested", officePrintRequestedEventSchema.parse({}));
  });
}
