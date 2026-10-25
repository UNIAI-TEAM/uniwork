import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { ScribeGlyph, ScribeMark, ScribeVoiceLine } from "./scribe-mark";

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

describe("ScribeVoiceLine", () => {
  /** Runs the animation frames by hand. */
  function frames() {
    const queue: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => queue.push(cb));
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    return { step: () => queue.shift()?.(0), queue, cancel };
  }

  it("follows the level every frame, rising fast and falling slowly, and stops with the line", () => {
    const f = frames();
    let level = 1;
    const { container, unmount } = render(<ScribeVoiceLine level={() => level} />);
    const line = container.querySelector<HTMLElement>("[data-scribe-voice]")!;
    expect(line.getAttribute("aria-hidden")).toBe("true");
    f.step();
    expect(line.style.getPropertyValue("--voice")).toBe("0.300");
    level = 0;
    f.step();
    expect(line.style.getPropertyValue("--voice")).toBe("0.279");
    unmount();
    expect(f.cancel).toHaveBeenCalled();
  });

  it("marks translating for the travelling stretch, and rests under reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const f = frames();
    const { container } = render(<ScribeVoiceLine level={() => 1} processing />);
    const line = container.querySelector<HTMLElement>("[data-scribe-voice]")!;
    expect(line.hasAttribute("data-processing")).toBe(true);
    expect(f.queue).toHaveLength(0);
    expect(line.style.getPropertyValue("--voice")).toBe("");
  });
});

describe("ScribeGlyph", () => {
  it("draws the bars and lines in the text colour, with no tile", () => {
    const { container } = render(<ScribeGlyph />);
    expect(container.querySelector("svg")?.getAttribute("stroke")).toBe("currentColor");
    expect(container.querySelector("rect")).toBeNull();
    expect(container.querySelectorAll("path")).toHaveLength(6);
  });
});
