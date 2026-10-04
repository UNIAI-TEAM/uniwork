import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HtmlVisualShell } from "../shell";
import { HTML_SELECTION_FLAG, type HtmlSelection } from "./model";
import type { IsolatedPreviewPort, PreviewSession } from "../../../source-editor-types";

/** A mutable flag mock, the pattern document-file-view.test.tsx uses: the
 * suite flips the key and the shell re-reads it on the next render. */
const flagMock = vi.hoisted(() => ({ value: false }));
vi.mock("@uniwork/core/feature-flags", () => ({
  useFlag: (key: string, fallback: boolean) => (key === "office_html_visual_selection" ? flagMock.value : fallback),
}));

initI18n();
beforeEach(async () => {
  flagMock.value = false;
  await setLocale("en");
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A preview port that captures the shell's forwarded events and hands back a
 * session whose inspector records any command the bridge might send. */
function previewPort() {
  const forwarded: ((event: { type: string }) => void)[] = [];
  const command = vi.fn();
  const mount = vi.fn(async (options: { onEvent?: (event: { type: string }) => void }): Promise<PreviewSession> => {
    if (options.onEvent) forwarded.push(options.onEvent);
    return { dispose: vi.fn(), update: vi.fn(), inspector: { command, close: vi.fn() } } as unknown as PreviewSession;
  });
  return {
    port: { mount } as IsolatedPreviewPort,
    command,
    // The bridge forwards untrusted frame payloads: the helper accepts a raw
    // record, exactly as the preview port would hand one over.
    emit: (event: Record<string, unknown>) => forwarded.forEach((send) => send(event as { type: string })),
  };
}

type Box = { left: number; top: number; width: number; height: number };

const CANVAS_BOX: Box = { left: 0, top: 0, width: 800, height: 600 };
const ZERO_BOX: Box = { left: 0, top: 0, width: 0, height: 0 };

function domRect({ left, top, width, height }: Box): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * jsdom has no layout: every `getBoundingClientRect` is zero, so the
 * canvas-space math is dead unless it is stubbed. The two rects the bridge
 * reads - the canvas and the preview frame - are answered with real numbers;
 * the reader is a function so a re-probe test can move the frame between
 * events. The frame is matched by its dedicated hook OR its testid, so the
 * pre-fix selector also gets a non-zero offset and the failures below isolate
 * the zoom / re-probe gaps rather than a missing attribute.
 */
function stubLayout(read: () => { frame: Box; canvas?: Box }) {
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    const { frame, canvas } = read();
    const isFrame = el.hasAttribute("data-html-preview-frame") || el.dataset.testid === "html-preview";
    if (isFrame) return domRect(frame);
    if (el.dataset.testid === "html-canvas") return domRect(canvas ?? CANVAS_BOX);
    return domRect(ZERO_BOX);
  });
}

interface ShellOptions {
  viewMode?: "split" | "preview";
  zoom?: number;
  onPreviewSelection?: (selection: HtmlSelection | null) => void;
}

function shellElement(preview: IsolatedPreviewPort, options: ShellOptions = {}) {
  return (
    <HtmlVisualShell
      documentKey="doc"
      text="<p>hi</p>"
      viewMode={options.viewMode ?? "preview"}
      onViewModeChange={() => undefined}
      preview={preview}
      zoom={options.zoom ?? 100}
      onZoomChange={() => undefined}
      onPreviewSelection={options.onPreviewSelection}
    />
  );
}

function renderShell(preview: IsolatedPreviewPort, onPreviewSelection?: (selection: HtmlSelection | null) => void, options: ShellOptions = {}) {
  return render(shellElement(preview, { ...options, onPreviewSelection }));
}

/** Wait for the port to be mounted, so the captured onEvent is wired. */
async function ready() {
  await waitFor(() => expect(screen.getByTestId("html-preview")).toBeInTheDocument());
}

const SELECT = { type: "select", sid: 7 };
const RECT = { type: "rect", sid: 7, rect: { x: 10, y: 20, width: 30, height: 40 } };

describe("HtmlSelectionOverlay behind the flag", () => {
  it("renders nothing extra and publishes nothing while the flag is off", async () => {
    const onSelection = vi.fn();
    const { port, emit } = previewPort();
    renderShell(port, onSelection);
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));

    expect(screen.queryByTestId("html-selection-outline")).toBeNull();
    expect(screen.queryByTestId("html-selection-status")).toBeNull();
    expect(onSelection).not.toHaveBeenCalled();
  });

  it("draws the outline from a forwarded event when the flag is on", async () => {
    flagMock.value = true;
    const onSelection = vi.fn();
    const { port, emit, command } = previewPort();
    renderShell(port, onSelection);
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));

    const outline = screen.getByTestId("html-selection-outline");
    expect(outline).toHaveAttribute("data-selection-sid", "7");
    expect(outline).toHaveStyle({ left: "10px", top: "20px", width: "30px", height: "40px" });
    // Inert: it can never take a click, a drag or a focus from the document.
    expect(outline).toHaveAttribute("aria-hidden");
    expect(outline.className).toContain("pointer-events-none");
    // Read-only: no command is ever sent back to the inspector.
    expect(command).not.toHaveBeenCalled();
    expect(onSelection).toHaveBeenLastCalledWith({ sid: 7, rect: { x: 10, y: 20, width: 30, height: 40 }, nodeName: null });
  });

  it("publishes the sid as soon as it is selected, before any geometry arrives", async () => {
    flagMock.value = true;
    const onSelection = vi.fn();
    const { port, emit } = previewPort();
    renderShell(port, onSelection);
    await ready();

    act(() => emit(SELECT));

    expect(screen.queryByTestId("html-selection-outline")).toBeNull();
    expect(onSelection).toHaveBeenLastCalledWith({ sid: 7, rect: null, nodeName: null });
  });

  it("does not let hover clobber the committed selection", async () => {
    flagMock.value = true;
    const { port, emit } = previewPort();
    renderShell(port);
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));
    act(() => emit({ type: "hover", sid: 9 }));
    act(() => emit({ type: "rect", sid: 9, rect: { x: 1, y: 2, width: 3, height: 4 } }));

    const outline = screen.getByTestId("html-selection-outline");
    expect(outline).toHaveAttribute("data-selection-sid", "7");
    expect(outline).toHaveStyle({ left: "10px", top: "20px", width: "30px", height: "40px" });
  });

  it("ignores a malformed payload instead of painting from it", async () => {
    flagMock.value = true;
    const onSelection = vi.fn();
    const { port, emit } = previewPort();
    renderShell(port, onSelection);
    await ready();

    act(() => emit({ type: "select", sid: "<img src=x onerror=alert(1)>" }));
    act(() => emit({ type: "rect", sid: 7, rect: { x: 0, y: 0, width: Number.NaN, height: 1 } }));
    act(() => emit({ type: "text-edit-commit", sid: 7, text: "edited" }));

    expect(screen.queryByTestId("html-selection-outline")).toBeNull();
    expect(onSelection).toHaveBeenLastCalledWith(null);
  });

  it("clears the outline and reports null when the selection is dropped", async () => {
    flagMock.value = true;
    const onSelection = vi.fn();
    const { port, emit } = previewPort();
    renderShell(port, onSelection);
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));
    expect(screen.getByTestId("html-selection-outline")).toBeInTheDocument();

    act(() => emit({ type: "select", sid: null }));

    expect(screen.queryByTestId("html-selection-outline")).toBeNull();
    expect(onSelection).toHaveBeenLastCalledWith(null);
  });

  it("announces the selection to assistive technology, translated", async () => {
    flagMock.value = true;
    const { port, emit } = previewPort();
    renderShell(port);
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));

    // The announcement text is a locale key H5 does not own (see the task's
    // MISSING KEY list); the a11y contract - a polite live region bound to the
    // selected element - is what this pins.
    const status = screen.getByTestId("html-selection-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("data-selection-sid", "7");
  });

  it("still forwards every event to the caller's own onPreviewEvent", async () => {
    flagMock.value = true;
    const onPreviewEvent = vi.fn();
    const { port, emit } = previewPort();
    render(
      <HtmlVisualShell
        documentKey="doc"
        text="<p>hi</p>"
        viewMode="preview"
        onViewModeChange={() => undefined}
        preview={port}
        zoom={100}
        onZoomChange={() => undefined}
        onPreviewEvent={onPreviewEvent}
      />,
    );
    await ready();

    act(() => emit(SELECT));

    expect(onPreviewEvent).toHaveBeenCalledWith(SELECT);
  });
});

/**
 * The frame's rect arrives in the frame's INTERNAL viewport px; the shell
 * renders the frame's content scaled by `clampedZoom/100` and, in split mode,
 * offset from the canvas origin. The outline must therefore paint at
 * `offset + zoom * rect` in canvas space. jsdom reports zero rects, so these
 * cases stub the canvas and frame boxes.
 */
describe("HtmlSelectionOverlay canvas-space geometry", () => {
  it("scales the rect by the shell zoom at 100% (the unchanged baseline)", async () => {
    flagMock.value = true;
    stubLayout(() => ({ frame: { left: 0, top: 0, width: 200, height: 400 } }));
    const { port, emit } = previewPort();
    renderShell(port);
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));

    expect(screen.getByTestId("html-selection-outline")).toHaveStyle({ left: "10px", top: "20px", width: "30px", height: "40px" });
  });

  it("scales the rect by the shell zoom at 200% in preview mode", async () => {
    flagMock.value = true;
    stubLayout(() => ({ frame: { left: 0, top: 0, width: 200, height: 400 } }));
    const { port, emit } = previewPort();
    renderShell(port, undefined, { zoom: 200 });
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));

    // 2 x (10,20,30,40) -> (20,40) 60x80; no frame offset in preview mode.
    expect(screen.getByTestId("html-selection-outline")).toHaveStyle({ left: "20px", top: "40px", width: "60px", height: "80px" });
  });

  it("adds the frame offset and applies the zoom scale in split mode at 150%", async () => {
    flagMock.value = true;
    stubLayout(() => ({ frame: { left: 300, top: 40, width: 200, height: 400 } }));
    const { port, emit } = previewPort();
    renderShell(port, undefined, { viewMode: "split", zoom: 150 });
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));

    // offset (300,40) + 1.5 x (10,20,30,40) -> (315,70) 45x60.
    expect(screen.getByTestId("html-selection-outline")).toHaveStyle({ left: "315px", top: "70px", width: "45px", height: "60px" });
  });

  it("re-probes the offset when the preview scroll container scrolls", async () => {
    flagMock.value = true;
    let frame: Box = { left: 300, top: 40, width: 200, height: 400 };
    stubLayout(() => ({ frame }));
    const { port, emit } = previewPort();
    renderShell(port, undefined, { viewMode: "split", zoom: 100 });
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));
    expect(screen.getByTestId("html-selection-outline")).toHaveStyle({ left: "310px", top: "60px" });

    // Scrolling the parent container (which happens exactly when zoom>100%
    // makes the preview overflow) moves the frame and emits no inspector event.
    frame = { left: 120, top: 5, width: 200, height: 400 };
    act(() => {
      fireEvent.scroll(screen.getByTestId("html-preview-scroll"));
    });

    expect(screen.getByTestId("html-selection-outline")).toHaveStyle({ left: "130px", top: "25px" });
  });

  it("re-probes the offset when the frame resizes", async () => {
    flagMock.value = true;
    let frame: Box = { left: 300, top: 40, width: 200, height: 400 };
    stubLayout(() => ({ frame }));

    const callbacks: (() => void)[] = [];
    class RecordingResizeObserver {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = RecordingResizeObserver as unknown as typeof ResizeObserver;
    try {
      const { port, emit } = previewPort();
      renderShell(port, undefined, { viewMode: "split", zoom: 100 });
      await ready();

      act(() => emit(SELECT));
      act(() => emit(RECT));
      expect(screen.getByTestId("html-selection-outline")).toHaveStyle({ left: "310px", top: "60px" });
      expect(callbacks.length).toBeGreaterThan(0);

      // A window / split-pane resize re-lays-out the frame; no inspector event.
      frame = { left: 50, top: 10, width: 200, height: 400 };
      act(() => callbacks.forEach((callback) => callback()));

      expect(screen.getByTestId("html-selection-outline")).toHaveStyle({ left: "60px", top: "30px" });
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it("re-probes the offset when the zoom changes", async () => {
    flagMock.value = true;
    let frame: Box = { left: 300, top: 40, width: 200, height: 400 };
    stubLayout(() => ({ frame }));
    const { port, emit } = previewPort();
    const view = renderShell(port, undefined, { viewMode: "split", zoom: 100 });
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));
    expect(screen.getByTestId("html-selection-outline")).toHaveStyle({ left: "310px", top: "60px" });

    // A zoom change re-lays-out the frame; the offset must be re-measured, and
    // the rect must be scaled by the new factor.
    frame = { left: 150, top: 20, width: 200, height: 400 };
    view.rerender(shellElement(port, { viewMode: "split", zoom: 50 }));

    // 0.5 x (10,20) + (150,20) -> (155,30); 0.5 x (30,40) -> 15x20.
    expect(screen.getByTestId("html-selection-outline")).toHaveStyle({ left: "155px", top: "30px", width: "15px", height: "20px" });
  });
});

describe("HtmlSelectionOverlay when the flag turns off", () => {
  it("clears the last published selection so the caller cannot act on it", async () => {
    flagMock.value = true;
    const onSelection = vi.fn();
    const { port, emit } = previewPort();
    const view = renderShell(port, onSelection);
    await ready();

    act(() => emit(SELECT));
    act(() => emit(RECT));
    expect(onSelection).toHaveBeenLastCalledWith(expect.objectContaining({ sid: 7 }));

    flagMock.value = false;
    view.rerender(shellElement(port, { onPreviewSelection: onSelection }));

    expect(screen.queryByTestId("html-selection-outline")).toBeNull();
    expect(onSelection).toHaveBeenLastCalledWith(null);
  });
});

describe("the flag key", () => {
  it("is the key the lead must register", () => {
    expect(HTML_SELECTION_FLAG).toBe("office_html_visual_selection");
  });
});
