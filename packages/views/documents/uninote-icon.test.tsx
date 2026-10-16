import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UniNoteIcon } from "./uninote-icon";

describe("UniNoteIcon", () => {
  it("draws the board's U and pen on a 100 box in the current colour", () => {
    const { container } = render(<UniNoteIcon className="size-4" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 100 100");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    const [u, pen] = Array.from(container.querySelectorAll("path"));
    expect(u).toHaveAttribute("d", "M22 14 V56 A28 28 0 0 0 78 56");
    expect(u).toHaveAttribute("stroke", "currentColor");
    expect(u).toHaveAttribute("stroke-width", "20");
    expect(u).toHaveAttribute("stroke-linecap", "round");
    expect(pen).toHaveAttribute("d", "M68 2 H88 V26 H68 Z M68 30 H88 L78 50 Z M77 33 H79 V43 H77 Z");
    expect(pen).toHaveAttribute("fill-rule", "evenodd");
    expect(pen).toHaveAttribute("fill", "currentColor");
  });
});
