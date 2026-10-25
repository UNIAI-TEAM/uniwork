import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { ScribeGlyph, ScribeMark } from "./scribe-mark";

afterEach(cleanup);

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

describe("ScribeGlyph", () => {
  it("draws the bars and lines in the text colour, with no tile", () => {
    const { container } = render(<ScribeGlyph />);
    expect(container.querySelector("svg")?.getAttribute("stroke")).toBe("currentColor");
    expect(container.querySelector("rect")).toBeNull();
    expect(container.querySelectorAll("path")).toHaveLength(6);
  });
});
