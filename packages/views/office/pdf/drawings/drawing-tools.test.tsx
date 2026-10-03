import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfDrawingTools } from "./drawing-tools";

describe("PdfDrawingTools", () => {
  it("emits the selected shape with the host geometry", () => {
    const onDrawing = vi.fn();
    render(<PdfDrawingTools page={2} rect={[1, 2, 30, 40]} onDrawing={onDrawing} />);
    fireEvent.click(screen.getByRole("button", { name: /rect|rectangle/i }));
    expect(onDrawing).toHaveBeenCalledWith({ op: "add_drawing", target: { page: 2, geometry: { rect: { x: 1, y: 2, width: 29, height: 38 } } }, kind: "rect", color: [0, 0, 0], width: 1 });
  });

  it("blocks tools when no geometry is selected", () => {
    render(<PdfDrawingTools page={1} rect={null} onDrawing={vi.fn()} />);
    expect(screen.getByTestId("pdf-drawing-tools").querySelectorAll("button:not([disabled])")).toHaveLength(0);
  });
});
