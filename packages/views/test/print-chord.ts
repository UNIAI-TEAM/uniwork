// Shared Ctrl/Cmd+P helper for Office print tests. The shortcut is Cmd+P on macOS and Ctrl+P
// elsewhere (office/print/shortcut.tsx reads navigator.userAgent), so a test that hard-codes one
// modifier passes on one OS and fails on another. Press the chord through this helper instead.
import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";

export type PrintPlatform = "mac" | "windows" | "linux";

export const PRINT_PLATFORMS: readonly PrintPlatform[] = ["mac", "windows", "linux"];

const USER_AGENTS: Record<PrintPlatform, string> = {
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  linux: "Mozilla/5.0 (X11; Linux x86_64)",
};

/** Makes the shortcut read `platform`; returns the function that puts the real user agent back. */
export function stubPrintPlatform(platform: PrintPlatform): () => void {
  const spy = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(USER_AGENTS[platform]);
  return () => spy.mockRestore();
}

function isMacUserAgent(): boolean {
  return /mac|iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/** Presses the current platform's print chord on `target`; returns fireEvent's result (false = default prevented). */
export function pressPrintChord(target: Element | Window | Document, init: KeyboardEventInit = {}): boolean {
  return fireEvent.keyDown(target, { key: "p", ...(isMacUserAgent() ? { metaKey: true } : { ctrlKey: true }), ...init });
}
