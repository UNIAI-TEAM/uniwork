import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfInkTools } from "./ink-tools";

describe("PdfInkTools", () => {
  it("emits captured paths through the callback-only surface", () => {
    const onInk = vi.fn();
    render(<PdfInkTools page={3} points={[{ x: 1, y: 2 }, { x: 3, y: 4 }]} onInk={onInk} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onInk).toHaveBeenCalledWith({ op: "add_drawing", target: { page: 3, geometry: { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] } }, kind: "ink", color: [0, 0, 0], width: 2 });
  });
});
