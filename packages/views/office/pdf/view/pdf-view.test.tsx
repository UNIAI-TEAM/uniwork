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
  it("changes manual zoom and clamps at supported bounds", async () => {
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
    await waitFor(() => expect(service.renderPage).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 1, scale: expect.any(Number) })));
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
});
