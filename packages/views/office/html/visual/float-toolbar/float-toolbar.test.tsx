// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HtmlFloatToolbar, type HtmlFloatToolbarCommands, type HtmlFloatToolbarState } from "./float-toolbar";
import { OFFICE_HTML_VISUAL_EDIT_FLAG, type HtmlSelection } from "../selection/model";

/** A mutable flag mock, the pattern bridge.test.tsx uses: the suite flips the
 * key and the toolbar re-reads it on the next render. */
const flagMock = vi.hoisted(() => ({ value: false }));
vi.mock("@uniwork/core/feature-flags", () => ({
  useFlag: (key: string, fallback: boolean) => (key === "office_html_visual_edit" ? flagMock.value : fallback),
}));

initI18n();
beforeEach(async () => {
  flagMock.value = false;
  await setLocale("en");
});
afterEach(() => {
  vi.restoreAllMocks();
});

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

/** jsdom has no layout: every `getBoundingClientRect` is zero, so the
 * canvas-space math is dead unless it is stubbed. The two rects the toolbar
 * reads - the canvas and the preview frame - are answered with real numbers. */
function stubLayout(read: () => { frame: Box; canvas?: Box }) {
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.hasAttribute("data-html-preview-frame")) return domRect(read().frame);
    if (el.dataset.testid === "html-canvas") return domRect(read().canvas ?? CANVAS_BOX);
    return domRect(ZERO_BOX);
  });
}

interface HarnessProps {
  selection: HtmlSelection | null;
  commands?: HtmlFloatToolbarCommands;
  state?: HtmlFloatToolbarState;
  zoom?: number;
}

function Harness({ selection, commands, state, zoom = 100 }: HarnessProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={canvasRef} data-testid="html-canvas">
      <div data-html-preview-frame data-testid="html-preview" />
      <HtmlFloatToolbar selection={selection} canvasRef={canvasRef} zoom={zoom} commands={commands} state={state} />
    </div>
  );
}

const SELECT: HtmlSelection = { sid: 7, rect: { x: 10, y: 100, width: 30, height: 40 }, nodeName: null };

function commands(): Required<HtmlFloatToolbarCommands> {
  return {
    onBold: vi.fn(),
    onItalic: vi.fn(),
    onFontSizeIncrease: vi.fn(),
    onFontSizeDecrease: vi.fn(),
    onColour: vi.fn(),
    onEditText: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onOpenStylePanel: vi.fn(),
  };
}

function action(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-float-action="${id}"]`);
  if (!found) throw new Error(`float action ${id} not found`);
  return found;
}

describe("HtmlFloatToolbar behind the H5 flag", () => {
  it("renders nothing when the flag is off, even with a selection", () => {
    stubLayout(() => ({ frame: { left: 0, top: 0, width: 200, height: 400 } }));
    render(<Harness selection={SELECT} commands={commands()} />);
    expect(screen.queryByTestId("html-float-toolbar")).toBeNull();
  });

  it("renders nothing when there is no selection", () => {
    flagMock.value = true;
    stubLayout(() => ({ frame: { left: 0, top: 0, width: 200, height: 400 } }));
    render(<Harness selection={null} commands={commands()} />);
    expect(screen.queryByTestId("html-float-toolbar")).toBeNull();
  });

  it("renders nothing for a selection with no rect yet, or a zero-size / malformed rect", () => {
    flagMock.value = true;
    stubLayout(() => ({ frame: { left: 0, top: 0, width: 200, height: 400 } }));
    const { rerender } = render(<Harness selection={{ sid: 7, rect: null, nodeName: null }} commands={commands()} />);
    expect(screen.queryByTestId("html-float-toolbar")).toBeNull();

    rerender(<Harness selection={{ sid: 7, rect: { x: 10, y: 100, width: 0, height: 40 }, nodeName: null }} commands={commands()} />);
    expect(screen.queryByTestId("html-float-toolbar")).toBeNull();

    rerender(<Harness selection={{ sid: 7, rect: { x: Number.NaN, y: 100, width: 30, height: 40 }, nodeName: null }} commands={commands()} />);
    expect(screen.queryByTestId("html-float-toolbar")).toBeNull();
  });

  it("anchors at the selection box, centred and lifted above it", () => {
    flagMock.value = true;
    stubLayout(() => ({ frame: { left: 0, top: 0, width: 200, height: 400 } }));
    render(<Harness selection={SELECT} commands={commands()} />);

    const toolbar = screen.getByTestId("html-float-toolbar");
    // box (10,100) 30x40 at zoom 100, no frame offset -> centre 25; the
    // toolbar's TOP edge is 100 - 8 - 36 = 56, so its BOTTOM edge clears the
    // box by the gap instead of painting over the element's top ~28px.
    expect(toolbar).toHaveStyle({ left: "25px", top: "56px" });
    expect(toolbar).toHaveAttribute("data-float-placement", "above");
    expect(toolbar).toHaveAttribute("data-selection-sid", "7");
    expect(toolbar).toHaveAttribute("role", "toolbar");
  });

  it("tracks the shell zoom and the split-mode frame offset, like the H5 outline", () => {
    flagMock.value = true;
    stubLayout(() => ({ frame: { left: 300, top: 40, width: 200, height: 400 } }));
    render(<Harness selection={SELECT} zoom={150} commands={commands()} />);

    // offset (300,40) + 1.5 x (10,100) -> box (315,190); centre 337.5, top 146.
    expect(screen.getByTestId("html-float-toolbar")).toHaveStyle({ left: "337.5px", top: "146px" });
  });

  it("re-probes the offset when the canvas resizes (no inspector event)", () => {
    flagMock.value = true;
    let frame: Box = { left: 0, top: 0, width: 200, height: 400 };
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
      render(<Harness selection={SELECT} commands={commands()} />);
      expect(screen.getByTestId("html-float-toolbar")).toHaveStyle({ left: "25px", top: "56px" });
      expect(callbacks.length).toBeGreaterThan(0);

      frame = { left: 120, top: 5, width: 200, height: 400 };
      act(() => callbacks.forEach((callback) => callback()));

      expect(screen.getByTestId("html-float-toolbar")).toHaveStyle({ left: "145px", top: "61px" });
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it("flips below the box when there is no room above", () => {
    flagMock.value = true;
    stubLayout(() => ({ frame: { left: 0, top: 0, width: 200, height: 400 } }));
    render(<Harness selection={{ sid: 7, rect: { x: 10, y: 10, width: 30, height: 40 }, nodeName: null }} commands={commands()} />);
    const toolbar = screen.getByTestId("html-float-toolbar");
    expect(toolbar).toHaveAttribute("data-float-placement", "below");
    expect(toolbar).toHaveStyle({ top: "58px" });
  });
});

describe("HtmlFloatToolbar callbacks", () => {
  beforeEach(() => {
    flagMock.value = true;
    stubLayout(() => ({ frame: { left: 0, top: 0, width: 200, height: 400 } }));
  });

  it("raises the inline marks and the element actions on click", () => {
    const c = commands();
    render(<Harness selection={SELECT} commands={c} />);

    fireEvent.click(action("bold"));
    expect(c.onBold).toHaveBeenCalledOnce();
    fireEvent.click(action("italic"));
    expect(c.onItalic).toHaveBeenCalledOnce();
    fireEvent.click(action("edit-text"));
    expect(c.onEditText).toHaveBeenCalledOnce();
    fireEvent.click(action("move-up"));
    expect(c.onMoveUp).toHaveBeenCalledOnce();
    fireEvent.click(action("move-down"));
    expect(c.onMoveDown).toHaveBeenCalledOnce();
    fireEvent.click(action("duplicate"));
    expect(c.onDuplicate).toHaveBeenCalledOnce();
    fireEvent.click(action("delete"));
    expect(c.onDelete).toHaveBeenCalledOnce();
    fireEvent.click(action("open-style-panel"));
    expect(c.onOpenStylePanel).toHaveBeenCalledOnce();
  });

  it("raises the font-size stepper and shows the current size", () => {
    const c = commands();
    render(<Harness selection={SELECT} commands={c} state={{ fontSize: 14 }} />);

    expect(action("font-size-value")).toHaveAttribute("data-float-size", "14");
    fireEvent.click(action("font-size-increase"));
    expect(c.onFontSizeIncrease).toHaveBeenCalledOnce();
    fireEvent.click(action("font-size-decrease"));
    expect(c.onFontSizeDecrease).toHaveBeenCalledOnce();
  });

  it("shows a mixed-size placeholder instead of a wrong number", () => {
    render(<Harness selection={SELECT} commands={commands()} state={{ fontSize: null }} />);
    // The placeholder copy is a locale key H6 does not own (see the MISSING KEY
    // list), so the contract pinned here is the "mixed" state, not its wording.
    expect(action("font-size-value")).toHaveAttribute("data-float-size", "mixed");
  });

  it("raises the chosen text colour from the palette", () => {
    const c = commands();
    render(<Harness selection={SELECT} commands={c} />);

    fireEvent.click(action("colour"));
    const swatch = document.querySelector<HTMLElement>('[data-float-colour="red"]');
    expect(swatch).not.toBeNull();
    fireEvent.click(swatch!);
    expect(c.onColour).toHaveBeenCalledWith("red");
  });

  it("disables the actions the caller has not wired", () => {
    render(<Harness selection={SELECT} />);
    expect(action("font-size-increase")).toBeDisabled();
    expect(action("font-size-decrease")).toBeDisabled();
    expect(action("edit-text")).toBeDisabled();
    expect(action("move-up")).toBeDisabled();
    expect(action("open-style-panel")).toBeDisabled();
    // Bold/italic are toggles with no handler: pressing them is a no-op, not a
    // crash - they stay enabled so a half-wired host still reads correctly.
    fireEvent.click(action("bold"));
  });

  it("reflects the pressed state of the marks", () => {
    render(<Harness selection={SELECT} commands={commands()} state={{ bold: true, italic: false }} />);
    expect(action("bold")).toHaveAttribute("aria-pressed", "true");
    expect(action("italic")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("the flag key", () => {
  it("is the same key H5 uses (one hidden surface, not two)", () => {
    expect(OFFICE_HTML_VISUAL_EDIT_FLAG).toBe("office_html_visual_edit");
  });
});
