// UNI-952 fix-C-pptx F4 - a print run whose text commit fails reports the print message.
import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { PptxDeckRenderer } from "../canvas/deck-renderer";
import { OfficePrintShortcutScope } from "../../print/shortcut";
import { usePptxPrint } from "./use-pptx-print";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const renderer: PptxDeckRenderer = {
  slideCount: 1,
  aspect: 9 / 16,
  viewport: () => ({ widthPx: 1280, heightPx: 720, scale: 1 }),
  buildSlide: () => null,
  buildSlideMarkup: () => ({ markup: "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", widthPx: 1280, heightPx: 720 }),
  buildThumbnail: () => null,
};

/** Stands in for the Office shell, which owns the Ctrl/Cmd+P listener. */
function ShellScope({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return <div ref={ref}><OfficePrintShortcutScope rootRef={ref}>{children}</OfficePrintShortcutScope></div>;
}

describe("usePptxPrint", () => {
  it("runs the same print on Ctrl/Cmd+P and blocks the app window's print", async () => {
    const print = vi.fn(async () => ({ outcome: "printed" as const }));
    renderHook(() => usePptxPrint({ port: { print }, renderer, slides: [{}], flush: () => null, onFailed: vi.fn(), rasterize: null }), { wrapper: ShellScope });
    expect(fireEvent.keyDown(document.body, { key: "p", ctrlKey: true })).toBe(false);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });

  it("names the print job after the document title, and the generic text only without one", async () => {
    const print = vi.fn(async (_request: { html: string; title: string }) => ({ outcome: "printed" as const }));
    const { result, rerender } = renderHook(({ title }: { title?: string }) => usePptxPrint({ port: { print }, renderer, slides: [{}], flush: () => null, onFailed: vi.fn(), rasterize: null, ...(title !== undefined ? { title } : {}) }), { initialProps: { title: "Quarterly deck.pptx" } as { title?: string } });
    act(() => result.current.run());
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(print.mock.calls[0]![0]).toEqual(expect.objectContaining({ title: "Quarterly deck.pptx" }));
    await waitFor(() => expect(result.current.pending).toBe(false));
    rerender({});
    act(() => result.current.run());
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
    expect(print.mock.calls[1]![0]).toEqual(expect.objectContaining({ title: "Print presentation" }));
  });

  it("reports a copy past the print cap with the shared too-large message", async () => {
    const onFailed = vi.fn();
    const { result } = renderHook(() => usePptxPrint({
      port: { print: async () => ({ outcome: "failed" as const, reason: "print_too_large" }) },
      renderer, slides: [{}], flush: () => null, onFailed, rasterize: null,
    }));
    act(() => result.current.run());
    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));
    expect(onFailed.mock.calls[0]![0]).toEqual(expect.objectContaining({ message: "This document is too large to print." }));
  });

  it("leaves Ctrl/Cmd+P to the platform without a port", () => {
    renderHook(() => usePptxPrint({ port: null, renderer, slides: [{}], flush: () => null, onFailed: vi.fn(), rasterize: null }), { wrapper: ShellScope });
    expect(fireEvent.keyDown(document.body, { key: "p", ctrlKey: true })).toBe(true);
  });

  it("registers only once the renderer is ready: the key stays with the platform before that", () => {
    const print = vi.fn(async () => ({ outcome: "printed" as const }));
    const { rerender } = renderHook(({ ready }) => usePptxPrint({ port: { print }, renderer: ready ? renderer : null, slides: [{}], flush: () => null, onFailed: vi.fn(), rasterize: null }), { wrapper: ShellScope, initialProps: { ready: false } });
    expect(fireEvent.keyDown(document.body, { key: "p", ctrlKey: true })).toBe(true);
    expect(print).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(fireEvent.keyDown(document.body, { key: "p", ctrlKey: true })).toBe(false);
  });

  it("reports a failed text commit as the print failure, not the raw commit error, and never prints", async () => {
    const print = vi.fn(async () => ({ outcome: "printed" as const }));
    const onFailed = vi.fn();
    const { result } = renderHook(() => usePptxPrint({
      port: { print },
      renderer,
      slides: [{}],
      flush: () => Promise.reject(new Error("text_commit_conflict")),
      onFailed,
      rasterize: null,
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    act(() => result.current.run());
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));
    expect(onFailed.mock.calls[0]![0]).toEqual(expect.objectContaining({ message: "The presentation could not be printed." }));
    // The cause is not shown to the user, but it is not swallowed either.
    expect(warn).toHaveBeenCalledWith("[pptx-print]", expect.objectContaining({ message: "text_commit_conflict" }));
    warn.mockRestore();
    expect(print).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.pending).toBe(false));
  });
});
