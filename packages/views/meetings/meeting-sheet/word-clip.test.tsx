import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WordClip } from "./word-clip";

describe("WordClip", () => {
  it("keeps the text whole and gives each later word its own box with its space", () => {
    const { container } = render(<WordClip text="Họp giao ban hằng tuần" />);
    const root = container.firstElementChild!;
    expect(root.textContent).toBe("Họp giao ban hằng tuần");
    expect([...root.children].map((c) => c.textContent)).toEqual([" giao", " ban", " hằng", " tuần"]);
  });
});
