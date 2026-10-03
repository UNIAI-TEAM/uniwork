import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PdfCanvasPage, PdfPageRenderService, PdfRenderPageRequest } from "../canvas";
import { PdfExportButton } from "./pdf-export-button";

const pages: readonly PdfCanvasPage[] = [
  { pageNumber: 1, width: 595, height: 842 },
  { pageNumber: 2, width: 595, height: 842 },
];

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("PdfExportButton", () => {
  it("exports every page and shows progress until it finishes", async () => {
    const second = deferred();
    const renderer: PdfPageRenderService = {
      renderPage: vi.fn(async (request: PdfRenderPageRequest) => {
        if (request.pageNumber === 2) await second.promise;
        return { src: `data:image/png;base64,page-${request.pageNumber}`, width: request.width, height: request.height };
      }),
    };
    const savePage = vi.fn();
    const onExported = vi.fn();

    render(<PdfExportButton renderer={renderer} pages={pages} fileBaseName="report" savePage={savePage} onExported={onExported} />);
    fireEvent.click(screen.getByRole("button", { name: "Xuất các trang thành PNG" }));

    expect(await screen.findByText("Đang xuất trang 2 / 2…")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Xuất các trang thành PNG" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    second.resolve();
    await waitFor(() => expect(onExported).toHaveBeenCalledTimes(1));
    expect(savePage).toHaveBeenNthCalledWith(1, expect.objectContaining({ pageNumber: 1, filename: "report-page-1.png" }));
    expect(savePage).toHaveBeenNthCalledWith(2, expect.objectContaining({ pageNumber: 2, filename: "report-page-2.png" }));
    await waitFor(() => expect(screen.queryByText("Đang xuất trang 2 / 2…")).not.toBeInTheDocument());
  });

  it("reports a failed export as an alert", async () => {
    const renderer: PdfPageRenderService = {
      renderPage: vi.fn(async () => {
        throw new Error("engine down");
      }),
    };
    render(<PdfExportButton renderer={renderer} pages={pages} savePage={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Xuất các trang thành PNG" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Không thể xuất các trang.");
  });

  it("stays disabled without pages", () => {
    render(<PdfExportButton renderer={{ renderPage: vi.fn() }} pages={[]} />);
    expect(screen.getByRole("button", { name: "Xuất các trang thành PNG" })).toBeDisabled();
  });
});
