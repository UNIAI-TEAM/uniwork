import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FILE_MARK_FORMATS, FileTypeMark } from "./file-type-marks";

describe("FileTypeMark", () => {
  // A stroked glyph in a mark draws 1.5px on screen at every size, the weight base.css gives the Lucide icons.
  it.each(FILE_MARK_FORMATS)("strokes any line in the %s mark at 1.5px on screen", (format) => {
    const { container } = render(<FileTypeMark format={format} className="size-5" />);
    for (const el of container.querySelectorAll("[stroke]")) {
      if (el.getAttribute("stroke") === "none") continue;
      expect(el.getAttribute("stroke-width")).toBe("1.5");
      expect(el.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    }
  });
});
