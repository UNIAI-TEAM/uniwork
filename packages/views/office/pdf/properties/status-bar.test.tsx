import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { PdfStatusBar } from "../status-bar";

describe("PdfStatusBar", () => {
  beforeEach(async () => { await setLocale("en"); });
  it("shows page position and zoom and reports zoom changes", () => {
    const onZoomChange = vi.fn();
    render(<PdfStatusBar currentPage={2} totalPages={8} zoom={1.25} onZoomChange={onZoomChange} />);
    expect(screen.getByTestId("pdf-status-bar")).toHaveTextContent("2 / 8");
    expect(screen.getByTestId("pdf-zoom")).toHaveTextContent("125%");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoomChange).toHaveBeenCalledWith(1.35);
  });

  it("clamps page input changes to the reported page range", () => {
    const onPageChange = vi.fn();
    render(<PdfStatusBar currentPage={2} totalPages={8} zoom={1} onPageChange={onPageChange} />);
    const input = screen.getByLabelText("Current page");

    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.change(input, { target: { value: "0" } });

    expect(onPageChange).toHaveBeenNthCalledWith(1, 8);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 1);
  });

  it("announces zoom changes through the live readout", () => {
    render(<PdfStatusBar currentPage={1} totalPages={1} zoom={1} onZoomChange={vi.fn()} />);
    expect(screen.getByTestId("pdf-zoom").querySelector("[aria-live='polite']")).toHaveTextContent("100%");
  });
});
