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
    const renderer: PdfPageRenderService = { renderPage: vi.fn(), renderTile: vi.fn(async ({ pageNumber, x, y }) => ({ src: `${pageNumber}:${x}:${y}`, width: 50, height: 50 })) };
    render(<PdfCanvas pages={[pages[0]!]} renderer={renderer} tileSize={50} />);
    await waitFor(() => expect(renderer.renderTile).toHaveBeenCalled());
    expect(renderer.renderPage).not.toHaveBeenCalled();
  });
});
