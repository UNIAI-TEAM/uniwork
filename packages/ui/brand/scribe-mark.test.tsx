import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { followVoice, ScribeGlyph, ScribeMark, ScribeVoiceLine } from "./scribe-mark";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ScribeMark", () => {
  it("is decoration by default and names its state for the motion rules", () => {
    const { container } = render(<ScribeMark state="live" className="size-4" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("data-scribe-state")).toBe("live");
    expect(svg.getAttribute("class")).toContain("size-4");
  });

  it("gives every instance its own gradient id", () => {
    const { container } = render(
      <>
        <ScribeMark />
        <ScribeMark />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("greys the tile and adds the alert dot when it failed, and keeps only the outline when off", () => {
    const { container, rerender } = render(<ScribeMark state="failed" />);
    expect(container.querySelector("rect")?.getAttribute("class")).toContain("fill-faint-foreground");
    expect(container.querySelector("circle")).not.toBeNull();
    rerender(<ScribeMark state="off" />);
    expect(container.querySelector("rect")?.getAttribute("fill")).toBeNull();
    expect(container.querySelector("rect")?.getAttribute("class")).toContain("stroke-border");
    expect(container.querySelector("circle")).toBeNull();
  });
});

describe("followVoice", () => {
  it("rises fast and falls slowly, slower still for reduced motion, and clamps the level", () => {
    expect(followVoice(0, 1, false)).toBeCloseTo(0.32);
    expect(followVoice(0.32, 0, false)).toBeCloseTo(0.2976);
    expect(followVoice(0, 1, true)).toBeCloseTo(0.1);
    expect(followVoice(0, 5, false)).toBeCloseTo(0.32);
    expect(followVoice(0.5, Number.NaN, false)).toBeCloseTo(0.465);
  });
});

describe("ScribeVoiceLine", () => {
  /** A 2D context that only counts what the line draws. */
  function fakeContext() {
    const ctx = {
      fills: 0,
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      createRadialGradient: () => ({ addColorStop: vi.fn() }),
      fillRect: () => {
        ctx.fills += 1;
      },
      globalCompositeOperation: "",
      fillStyle: null as unknown,
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    return ctx;
  }
  function frames() {
    const queue: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => queue.push(cb));
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    return { step: (ts: number) => queue.shift()?.(ts), cancel };
  }

  it("draws five lobes and their core on the bottom edge every frame, and stops with the line", () => {
    const ctx = fakeContext();
    const f = frames();
    const level = vi.fn(() => 0.5);
    const { container, unmount } = render(<ScribeVoiceLine level={level} />);
    const canvas = container.querySelector("canvas")!;
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 600 });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 12 });
    f.step(16);
    expect(level).toHaveBeenCalledTimes(1);
    expect(ctx.fills).toBe(10);
    f.step(32);
    expect(ctx.fills).toBe(20);
    unmount();
    expect(f.cancel).toHaveBeenCalled();
  });

  it("marks the busy state it gathers into a travelling beam for", () => {
    fakeContext();
    frames();
    const { container, rerender } = render(<ScribeVoiceLine level={() => 0} processing />);
    expect(container.querySelector("canvas")?.hasAttribute("data-processing")).toBe(true);
    rerender(<ScribeVoiceLine level={() => 0} />);
    expect(container.querySelector("canvas")?.hasAttribute("data-processing")).toBe(false);
  });
});

describe("ScribeGlyph", () => {
  it("strokes 1.5px on screen at every size, like the Lucide icons beside it", () => {
    const { container } = render(<ScribeGlyph className="size-4" />);
    expect(container.querySelector("svg")?.getAttribute("stroke-width")).toBe("1.5");
    const paths = [...container.querySelectorAll("path")];
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path.getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });

  it("draws the bars and lines in the text colour, with no tile", () => {
    const { container } = render(<ScribeGlyph />);
    expect(container.querySelector("svg")?.getAttribute("stroke")).toBe("currentColor");
    expect(container.querySelector("rect")).toBeNull();
    expect(container.querySelectorAll("path")).toHaveLength(6);
  });
});
