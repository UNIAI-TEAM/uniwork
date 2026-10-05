import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { PdfStatusBar } from "./pdf-status-bar";

beforeEach(async () => {
  await setLocale("en");
});

describe("PdfStatusBar", () => {
  it("shows page position, counts and language on the left", () => {
    render(
      <PdfStatusBar page={2} pageCount={5} counts={{ words: 245, annotations: 3 }} language="Tiếng Việt" zoom={1} />,
    );
    expect(screen.getByTestId("pdf-status-page")).toHaveTextContent("Page 2 / 5");
    expect(screen.getByTestId("pdf-status-count-words")).toHaveTextContent("245");
    expect(screen.getByTestId("pdf-status-language")).toHaveTextContent("Tiếng Việt");
  });

  it("shows selection info and reports zoom in, out and reset", () => {
    const onZoomChange = vi.fn();
    render(<PdfStatusBar page={1} pageCount={3} selection="12 characters selected" zoom={1.25} onZoomChange={onZoomChange} />);
    expect(screen.getByTestId("pdf-status-selection")).toHaveTextContent("12 characters selected");
    expect(screen.getByTestId("pdf-status-zoom")).toHaveTextContent("125%");
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(onZoomChange).toHaveBeenLastCalledWith(1.15);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoomChange).toHaveBeenLastCalledWith(1.35);
    fireEvent.click(screen.getByTestId("pdf-status-zoom").querySelector("button:not([aria-label='Zoom in']):not([aria-label='Zoom out'])")!);
    expect(onZoomChange).toHaveBeenLastCalledWith(1);
  });

  it("does not step past the zoom limits", () => {
    const onZoomChange = vi.fn();
    render(<PdfStatusBar page={1} pageCount={1} zoom={4} onZoomChange={onZoomChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoomChange).not.toHaveBeenCalled();
  });

  it("renders the help slot last and never leaks raw keys", () => {
    render(
      <PdfStatusBar page={1} pageCount={2} counts={{ words: 1, characters: 2, annotations: 3 }} language="vi" zoom={1} help={<button type="button">Help</button>} />,
    );
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByTestId("pdf-status-bar").textContent).not.toContain("office.");
    expect(screen.getByRole("group", { name: "PDF status bar" })).toBeInTheDocument();
  });

  it("clamps an out-of-range page to the document", () => {
    render(<PdfStatusBar page={9} pageCount={3} zoom={1} />);
    expect(screen.getByTestId("pdf-status-page")).toHaveTextContent("Page 3 / 3");
  });
});
