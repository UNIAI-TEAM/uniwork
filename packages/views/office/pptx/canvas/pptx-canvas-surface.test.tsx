import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { buildSlideSvg } from "./build-slide-svg";
import type { PptxCanvasPalette } from "./paint";
import { PptxCanvasSurface, type PptxCanvasContent } from "./pptx-canvas-surface";
import { PptxCanvasZoom } from "./pptx-canvas-zoom";
import { run, shapeNode, slide, textLayout } from "./pptx-render-fixtures";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const palette: PptxCanvasPalette = { pageFill: "#ffffff", chipFill: "#f4f4f5", chipStroke: "#e4e4e7", chipText: "#646464" };

function content(): PptxCanvasContent {
  const doc = buildSlideSvg(
    slide([shapeNode({ text: textLayout({ lines: [{ runs: [run({ text: "Rendered title" })], top: 0, height: 24 }] }) })], { hidden: true }),
    { idPrefix: "surface", palette },
  );
  return { root: doc.root, widthPx: doc.widthPx, heightPx: doc.heightPx, hidden: true };
}

describe("PptxCanvasSurface", () => {
  it("keeps the canvas a11y and selector contract and renders the SVG rendition", () => {
    render(<PptxCanvasSurface content={content()} slideIndex={1} slideCount={3} zoom={1} />);
    const canvas = screen.getByRole("application", { name: "PowerPoint slide canvas" });
    expect(canvas).toHaveAttribute("data-pptx-canvas");
    expect(canvas).toHaveAttribute("tabindex", "0");
    const slideBox = canvas.querySelector("[data-slide-canvas]");
    expect(slideBox).toHaveAttribute("data-slide-index", "1");
    const svg = canvas.querySelector("svg[data-pptx-slide-svg]");
    expect(svg).toHaveAttribute("viewBox", "0 0 960 540");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Rendered title")).toBeInTheDocument();
    expect(screen.getByText("Hidden slide")).toBeInTheDocument();
  });

  it("reports the measured fit width (container fallback in a layout-less DOM)", () => {
    const onFitWidthChange = vi.fn();
    render(<PptxCanvasSurface content={content()} slideIndex={0} slideCount={1} zoom={1} fallbackFitWidthPx={720} onFitWidthChange={onFitWidthChange} />);
    expect(onFitWidthChange).toHaveBeenCalledWith(720);
    expect(screen.getByRole("application").querySelector("[data-slide-canvas]")).toHaveStyle({ width: "720px" });
  });

  it("scales the on-screen box with the zoom factor", () => {
    render(<PptxCanvasSurface content={content()} slideIndex={0} slideCount={1} zoom={2} fallbackFitWidthPx={400} />);
    expect(screen.getByRole("application").querySelector("[data-slide-canvas]")).toHaveStyle({ width: "800px", height: "450px" });
  });

  it("forwards keyboard events to the editor's slide navigation", () => {
    const onKeyDown = vi.fn();
    render(<PptxCanvasSurface content={content()} slideIndex={0} slideCount={2} zoom={1} onKeyDown={onKeyDown} />);
    fireEvent.keyDown(screen.getByRole("application"), { key: "ArrowDown" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("shows the empty and pending states instead of fake content", () => {
    const view = render(<PptxCanvasSurface content={null} slideIndex={0} slideCount={0} zoom={1} />);
    expect(screen.getByText("No slides are available")).toBeInTheDocument();
    view.rerender(<PptxCanvasSurface content={null} slideIndex={0} slideCount={2} zoom={1} />);
    expect(screen.getByTestId("pptx-render-pending")).toHaveTextContent("Slide rendering is not connected");
    expect(screen.queryByRole("application")?.querySelector("[data-slide-canvas]")).toBeNull();
  });
});

describe("PptxCanvasZoom", () => {
  it("steps, fits and announces the level", () => {
    const onZoomChange = vi.fn();
    render(<PptxCanvasZoom zoom={1} onZoomChange={onZoomChange} />);
    expect(screen.getByText("Zoom 100%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoomChange).toHaveBeenLastCalledWith(1.25);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(onZoomChange).toHaveBeenLastCalledWith(0.75);
    fireEvent.click(screen.getByRole("button", { name: "Fit to width" }));
    expect(onZoomChange).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole("group", { name: "Zoom and fit" })).toHaveAttribute("data-pptx-zoom");
  });
});
