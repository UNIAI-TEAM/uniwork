// @vitest-environment jsdom
/**
 * UNI-965 visual-r1 F1: in the stacked split layout (source above, preview
 * below) the canvas is the scroll container, so the selection outline and the
 * float toolbar - absolute children of that canvas - live in its scrolled
 * content space. The frame offset must include the canvas's own scroll.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HtmlVisualShell } from "./shell";
import type { IsolatedPreviewPort, PreviewSession } from "../../source-editor-types";

const flagMock = vi.hoisted(() => ({ value: true }));
vi.mock("@uniwork/core/feature-flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@uniwork/core/feature-flags")>()),
  useFlag: (key: string, fallback: boolean) => (key === "office_html_visual_edit" ? flagMock.value : fallback),
}));

initI18n();
beforeEach(async () => {
  flagMock.value = true;
  await setLocale("en");
});
afterEach(() => vi.restoreAllMocks());

const CANVAS_VIEWPORT_TOP = 100;
/** Where the preview frame sits inside the canvas content (below the source pane). */
const FRAME_CONTENT_TOP = 400;

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

function previewPort() {
  const forwarded: ((event: { type: string }) => void)[] = [];
  const mount = vi.fn(async (options: { onEvent?: (event: { type: string }) => void }): Promise<PreviewSession> => {
    if (options.onEvent) forwarded.push(options.onEvent);
    return { dispose: vi.fn(), update: vi.fn() } as unknown as PreviewSession;
  });
  return {
    port: { mount } as IsolatedPreviewPort,
    emit: (event: Record<string, unknown>) => forwarded.forEach((send) => send(event as { type: string })),
  };
}

describe("overlay position in the stacked split layout", () => {
  it("adds the canvas scroll to the frame offset, for the outline and the toolbar alike", async () => {
    const { port, emit } = previewPort();
    render(
      <HtmlVisualShell documentKey="doc" text="<p>hi</p>" viewMode="split" onViewModeChange={() => undefined} preview={port} zoom={100} />,
    );
    await waitFor(() => expect(screen.getByTestId("html-preview")).toBeInTheDocument());
    const canvas = screen.getByTestId("html-canvas");
    const frame = screen.getByTestId("html-preview");

    let scrollTop = 350;
    Object.defineProperty(canvas, "scrollTop", { configurable: true, get: () => scrollTop });
    vi.spyOn(canvas, "getBoundingClientRect").mockImplementation(() => box(0, CANVAS_VIEWPORT_TOP, 390, 700));
    // The frame is a viewport rect: its content position minus the canvas scroll.
    vi.spyOn(frame, "getBoundingClientRect").mockImplementation(() => box(12, CANVAS_VIEWPORT_TOP + FRAME_CONTENT_TOP - scrollTop, 366, 400));

    act(() => emit({ type: "select", sid: 7 }));
    act(() => emit({ type: "rect", sid: 7, rect: { x: 10, y: 282, width: 100, height: 20 } }));

    // Element content-space top = 400 + 282 = 682 (the report's element y).
    expect(screen.getByTestId("html-selection-outline")).toHaveStyle({ left: "22px", top: "682px" });
    const toolbar = screen.getByTestId("html-float-toolbar");
    expect(toolbar).toHaveAttribute("data-float-placement", "above");
    expect(toolbar).toHaveStyle({ top: `${682 - 8 - 36}px` });

    // Scrolling the canvas moves the frame without an inspector event: the
    // overlays are re-probed and stay on the same content-space spot.
    scrollTop = 0;
    act(() => {
      fireEvent.scroll(canvas);
    });
    expect(screen.getByTestId("html-selection-outline")).toHaveStyle({ top: "682px" });
    expect(screen.getByTestId("html-float-toolbar")).toHaveStyle({ top: `${682 - 8 - 36}px` });
  });
});
