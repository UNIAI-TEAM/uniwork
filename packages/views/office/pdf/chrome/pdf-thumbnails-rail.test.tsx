import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { PdfThumbnailsRail, type PdfThumbnailPage } from "./pdf-thumbnails-rail";

const pages: readonly PdfThumbnailPage[] = [
  { pageNumber: 1 },
  { pageNumber: 2 },
  { pageNumber: 3, label: "Cover" },
];

beforeEach(async () => {
  await setLocale("en");
});

describe("PdfThumbnailsRail", () => {
  it("renders a numbered placeholder per page when no renderer is available", () => {
    render(<PdfThumbnailsRail pages={pages} />);
    expect(screen.getByTestId("pdf-thumbnails-rail")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-thumbnail-placeholder-1")).toHaveTextContent("1");
    expect(screen.getByTestId("pdf-thumbnail-placeholder-3")).toHaveTextContent("3");
    expect(screen.getByTestId("pdf-thumbnail-2")).toBeInTheDocument();
  });

  it("reports the selected page and highlights the active one", () => {
    const onSelect = vi.fn();
    render(<PdfThumbnailsRail pages={pages} activePage={2} onSelect={onSelect} />);
    expect(screen.getByTestId("pdf-thumbnail-2")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("pdf-thumbnail-1")).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getByTestId("pdf-thumbnail-3"));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("prefers a host-supplied thumbnail over the placeholder", () => {
    render(<PdfThumbnailsRail pages={[{ pageNumber: 1 }]} renderThumbnail={() => <span data-testid="real-thumb" />} />);
    expect(screen.getByTestId("real-thumb")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-thumbnail-placeholder-1")).not.toBeInTheDocument();
  });
});
