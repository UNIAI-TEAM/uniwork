import { render } from "@testing-library/react";
import { MARK_COMPACT } from "@uniwork/ui/brand/mark.generated";
import { describe, expect, it } from "vitest";
import { UniNoteIcon } from "./uninote-icon";

describe("UniNoteIcon", () => {
  it("draws the gradient tile, the folded page and the UniWork mark on the Office marks' grid", () => {
    const { container } = render(<UniNoteIcon className="size-4" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 240 240");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveClass("size-4");
    const tile = svg?.querySelector("rect");
    expect(tile).toHaveAttribute("rx", "48");
    expect(tile?.getAttribute("fill")).toMatch(/^url\(#.+-tile\)$/);
    expect(svg?.querySelector('path[fill="#fff"]')).not.toBeNull();
  });

  it("sets the compact mark, whatever the size, in its own light ramp", () => {
    const { container } = render(<UniNoteIcon />);
    const mark = container.querySelector("g[transform]");
    expect(mark?.getAttribute("fill")).toMatch(/^url\(#.+-mark\)$/);
    expect(mark?.querySelectorAll("circle")).toHaveLength(MARK_COMPACT.heads.length);
    const bodies = Array.from(mark?.querySelectorAll("rect") ?? []);
    expect(bodies.map((b) => b.getAttribute("height"))).toEqual(MARK_COMPACT.bodies.map((b) => String(b.height)));
    expect(mark?.querySelector("path")).toHaveAttribute("d", MARK_COMPACT.ribbon);
  });

  it("gives each instance its own gradient ids", () => {
    const { container } = render(
      <>
        <UniNoteIcon />
        <UniNoteIcon />
      </>,
    );
    const ids = Array.from(container.querySelectorAll("linearGradient")).map((g) => g.id);
    expect(new Set(ids).size).toBe(4);
  });
});
