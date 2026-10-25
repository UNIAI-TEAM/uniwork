import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusIcon } from "./status-icon";

// Every stroked shape draws 1.5px on screen whatever the icon's size, the weight base.css gives the Lucide icons.
function strokedShapes(svg: SVGSVGElement) {
  return [...svg.querySelectorAll("path, line, circle, rect")].filter((el) => {
    const stroke = el.getAttribute("stroke");
    return stroke !== null && stroke !== "none";
  });
}

describe("StatusIcon", () => {
  it.each(["todo", "in_progress", "in_review", "done", "blocked", "cancelled"])(
    "strokes %s at 1.5px on screen",
    (status) => {
      const { container } = render(<StatusIcon status={status} className="size-3" />);
      const svg = container.querySelector("svg") as SVGSVGElement;
      const shapes = strokedShapes(svg);
      expect(shapes.length).toBeGreaterThan(0);
      for (const shape of shapes) {
        expect(shape.getAttribute("stroke-width")).toBe("1.5");
        expect(shape.getAttribute("vector-effect")).toBe("non-scaling-stroke");
      }
    },
  );
});
