import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PdfView } from "./pdf-view";
import type { PdfCanvasPage, PdfPageRenderService } from "../canvas";

initI18n();
beforeEach(async () => { await setLocale("en"); });

const pages: readonly PdfCanvasPage[] = [
  { pageNumber: 1, width: 600, height: 800 },
  { pageNumber: 2, width: 600, height: 800 },
];

function renderer(): PdfPageRenderService {
  return { renderPage: vi.fn(async ({ pageNumber, width, height }) => ({ src: `data:image/png;base64,p${pageNumber}`, width, height })) };
}

describe("PdfView", () => {
  it("changes manual zoom and applies fit-width", async () => {
    const onZoomChange = vi.fn();
    render(<PdfView pages={pages} renderer={renderer()} initialZoom={1} onZoomChange={onZoomChange} viewportWidth={1000} viewportHeight={800} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoomChange).toHaveBeenCalledWith(1.1, "manual");
    fireEvent.click(screen.getByRole("button", { name: "Fit width" }));
    expect(onZoomChange).toHaveBeenLastCalledWith(1.61, "fit-width");
  });

  it("renders thumbnails through the page render service and navigates pages", async () => {
    const service = renderer();
    const onPageChange = vi.fn();
    render(<PdfView pages={pages} renderer={service} onPageChange={onPageChange} />);
    await waitFor(() => expect(service.renderPage).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 1, width: 600, height: 800, scale: 112 / 600 })));
    expect(screen.getByTestId("pdf-thumbnail-rail")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("supports outline selection and go-to-page input", () => {
    const onOutlineSelect = vi.fn();
    const onPageChange = vi.fn();
    render(<PdfView pages={pages} renderer={renderer()} outline={[{ id: "intro", title: "Introduction", page: 2 }]} onOutlineSelect={onOutlineSelect} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Introduction" }));
    expect(onOutlineSelect).toHaveBeenCalledWith({ id: "intro", title: "Introduction", page: 2 });
    fireEvent.change(screen.getByLabelText("Current page"), { target: { value: "2" } });
    fireEvent.keyDown(screen.getByLabelText("Current page"), { key: "Enter" });
    expect(onPageChange).toHaveBeenLastCalledWith(2);
  });

  it("resets an empty go-to-page input without navigating", () => {
    const onPageChange = vi.fn();
    render(<PdfView pages={pages} renderer={renderer()} currentPage={2} onPageChange={onPageChange} />);
    const input = screen.getByLabelText("Current page");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input).toHaveValue(2);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("fits a rotated page by its displayed box (F-12)", () => {
    const onZoomChange = vi.fn();
    const rotated: readonly PdfCanvasPage[] = [{ pageNumber: 1, width: 600, height: 800, rotation: 90 }];
    render(<PdfView pages={rotated} renderer={renderer()} onZoomChange={onZoomChange} viewportWidth={1000} viewportHeight={800} />);
    // A quarter-turn page displays 800 x 600: (1000 - 32) / 800 = 1.21.
    fireEvent.click(screen.getByRole("button", { name: "Fit width" }));
    expect(onZoomChange).toHaveBeenLastCalledWith(1.21, "fit-width");
  });

  it("keeps the current zoom when the viewport is not measured yet (F-12)", () => {
    const onZoomChange = vi.fn();
    render(<PdfView pages={pages} renderer={renderer()} onZoomChange={onZoomChange} viewportWidth={0} viewportHeight={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Fit page" }));
    expect(onZoomChange).not.toHaveBeenCalled();
  });
});
