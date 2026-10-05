import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PdfCanvas } from "./pdf-canvas";
import type { PdfCanvasPage, PdfPageRenderService } from "./types";

initI18n();
beforeEach(async () => { await setLocale("en"); });

const pages: PdfCanvasPage[] = [
  { pageNumber: 1, width: 100, height: 120, boxes: [{ id: "headline", kind: "text", x: 10, y: 10, width: 30, height: 20 }] },
  { pageNumber: 2, width: 100, height: 120 },
];

function service() : PdfPageRenderService {
  return { renderPage: vi.fn(async ({ pageNumber }) => ({ src: `data:image/png;base64,page-${pageNumber}`, width: 100, height: 120 })) };
}

describe("PdfCanvas", () => {
  it("renders a full page through the injected service and selects boxes", async () => {
    const renderer = service();
    const onSelectionChange = vi.fn();
    render(<PdfCanvas pages={pages} renderer={renderer} onSelectionChange={onSelectionChange} />);
    await waitFor(() => expect(renderer.renderPage).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 1 })));
    fireEvent.click(screen.getByRole("button", { name: "Page 1" }));
    expect(onSelectionChange).toHaveBeenCalledWith({ page: 1, objectId: "headline", kind: "text" });
  });

  it("uses tile rendering when a tile size is supplied", async () => {
    const renderTile = vi.fn(async ({ pageNumber, x, y }: { pageNumber: number; x: number; y: number }) => ({ src: `${pageNumber}:${x}:${y}`, width: 50, height: 50 }));
    const renderer: PdfPageRenderService = { renderPage: vi.fn(), renderTile };
    render(<PdfCanvas pages={[pages[0]!]} renderer={renderer} tileSize={50} />);
    await waitFor(() => expect(renderTile).toHaveBeenCalled());
    const initialRenderCount = renderTile.mock.calls.length;
    fireEvent.scroll(screen.getByTestId("pdf-canvas-scroll"), { target: { scrollTop: 40 } });
    await waitFor(() => expect(renderTile).toHaveBeenCalledTimes(initialRenderCount));
    expect(renderer.renderPage).not.toHaveBeenCalled();
  });

  it("selects the page background from the keyboard", async () => {
    const renderer = service();
    const onSelectionChange = vi.fn();
    render(<PdfCanvas pages={[pages[0]!]} renderer={renderer} onSelectionChange={onSelectionChange} />);
    const background = screen.getByRole("button", { name: "Page 1 background" });
    fireEvent.keyDown(background, { key: "Enter" });
    expect(onSelectionChange).toHaveBeenCalledWith({ page: 1, objectId: null, kind: "page" });
  });

  it("handles renderer failures without an unhandled rejection", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const renderer: PdfPageRenderService = { renderPage: vi.fn(() => Promise.reject(new Error("render failed"))) };
    render(<PdfCanvas pages={[pages[0]!]} renderer={renderer} />);
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith("PDF page render failed", expect.any(Error)));
    consoleError.mockRestore();
  });

  it("handles tile renderer failures without an unhandled rejection", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const renderer: PdfPageRenderService = { renderPage: vi.fn(), renderTile: vi.fn(() => Promise.reject(new Error("tile failed"))) };
    render(<PdfCanvas pages={[pages[0]!]} renderer={renderer} tileSize={50} />);
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith("PDF tile render failed", expect.any(Error)));
    consoleError.mockRestore();
  });
  it("emits a dragged region in page points and ignores a stray click", () => {
    const onPageRegion = vi.fn();
    const onSelectionChange = vi.fn();
    render(<PdfCanvas pages={[pages[0]!]} renderer={service()} zoom={2} tool="region" onPageRegion={onPageRegion} onSelectionChange={onSelectionChange} />);
    const background = screen.getByRole("button", { name: "Page 1 background" });
    fireEvent.pointerDown(background, { clientX: 20, clientY: 40, pointerId: 1 });
    fireEvent.pointerMove(background, { clientX: 100, clientY: 80, pointerId: 1 });
    expect(screen.getByTestId("pdf-region-draft")).toBeInTheDocument();
    fireEvent.pointerUp(background, { clientX: 100, clientY: 80, pointerId: 1 });
    // Client pixels divide by the zoom to give page points.
    expect(onPageRegion).toHaveBeenCalledWith(1, { x: 10, y: 20, width: 40, height: 20 });
    expect(screen.queryByTestId("pdf-region-draft")).not.toBeInTheDocument();
    fireEvent.pointerDown(background, { clientX: 20, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(background, { clientX: 21, clientY: 41, pointerId: 1 });
    fireEvent.click(background);
    expect(onPageRegion).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("maps a click through a 90-degree page rotation before hit-testing", async () => {
    const rotated: PdfCanvasPage = { pageNumber: 1, width: 100, height: 120, rotation: 90, boxes: [{ id: "headline", kind: "text", x: 10, y: 10, width: 30, height: 20 }] };
    const onSelectionChange = vi.fn();
    render(<PdfCanvas pages={[rotated]} renderer={service()} onSelectionChange={onSelectionChange} />);
    const background = screen.getByRole("button", { name: "Page 1 background" });
    // Display (100, 20) on a 90-degree page is page point (20, 20), inside the box.
    fireEvent.click(background, { clientX: 100, clientY: 20 });
    expect(onSelectionChange).toHaveBeenCalledWith({ page: 1, objectId: "headline", kind: "text" });
    fireEvent.click(background, { clientX: 20, clientY: 20 });
    expect(onSelectionChange).toHaveBeenLastCalledWith({ page: 1, objectId: null, kind: "page" });
  });

  it("paints find-hit overlays and marks the active hit", () => {
    const highlights = [
      { id: "a", page: 1, quad: [10, 80, 40, 100] as const, active: true },
      { id: "b", page: 1, quad: [10, 40, 40, 60] as const },
    ];
    render(<PdfCanvas pages={pages} renderer={service()} highlights={highlights} />);
    const active = screen.getByTestId("pdf-find-highlight-a");
    const other = screen.getByTestId("pdf-find-highlight-b");
    expect(active).toHaveAttribute("data-active", "true");
    expect(other).toHaveAttribute("data-active", "false");
    expect(active.className).not.toBe(other.className);
  });

  it("converts a bottom-left user-space quad to top-left display points", () => {
    // Page is 100x120: top = 120 - y2 = 20, height = y2 - y1 = 20, left = 10, width = 30.
    render(<PdfCanvas pages={[pages[0]!]} renderer={service()} highlights={[{ id: "a", page: 1, quad: [10, 80, 40, 100] }]} />);
    expect(screen.getByTestId("pdf-find-highlight-a")).toHaveStyle({ left: "10px", top: "20px", width: "30px", height: "20px" });
  });

  it("paints a display-space quad on a rotated page without rotating it twice", () => {
    // Quads already carry the /Rotate transform (the host maps char boxes into
    // display space), so a 90-degree page paints the quad as given: the overlay
    // must NOT turn it a second time.
    const rotated: PdfCanvasPage = { pageNumber: 1, width: 200, height: 100, rotation: 90 };
    render(<PdfCanvas pages={[rotated]} renderer={service()} highlights={[{ id: "a", page: 1, quad: [80, 80, 100, 100] }]} />);
    expect(screen.getByTestId("pdf-find-highlight-a")).toHaveStyle({ left: "80px", top: "0px", width: "20px", height: "20px" });
  });

  it("paints no overlay when a page has no find hits", () => {
    render(<PdfCanvas pages={[pages[0]!]} renderer={service()} />);
    expect(screen.getByTestId("pdf-find-highlights-1")).toBeEmptyDOMElement();
  });

  it("emits a zero-size point for a click in point mode and a centred region from the keyboard", () => {
    const onPageRegion = vi.fn();
    render(<PdfCanvas pages={[pages[0]!]} renderer={service()} tool="point" onPageRegion={onPageRegion} />);
    const background = screen.getByRole("button", { name: "Page 1 background" });
    fireEvent.click(background, { clientX: 30, clientY: 50 });
    expect(onPageRegion).toHaveBeenCalledWith(1, { x: 30, y: 50, width: 0, height: 0 });
    fireEvent.keyDown(background, { key: "Enter" });
    expect(onPageRegion).toHaveBeenLastCalledWith(1, { x: 50, y: 60, width: 0, height: 0 });
  });
});
