import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PriorityIcon } from "./priority-icon";

describe("PriorityIcon", () => {
  // The dash and the exclamation are the only lines; they draw 1.5px on screen, as base.css strokes the Lucide icons.
  it.each(["none", "urgent"])("strokes the %s mark at 1.5px on screen", (priority) => {
    const { container } = render(<PriorityIcon priority={priority} className="size-3" />);
    const line = container.querySelector("line");
    expect(line?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    const width = line?.getAttribute("stroke-width") ?? container.querySelector("svg")?.getAttribute("stroke-width");
    expect(width).toBe("1.5");
  });

  it("draws the bars as fills, with no stroke to weigh", () => {
    const { container } = render(<PriorityIcon priority="high" />);
    expect(container.querySelector("line")).toBeNull();
    expect(container.querySelectorAll("rect")).toHaveLength(3);
  });
});
