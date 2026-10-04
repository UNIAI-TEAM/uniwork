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

  it("shows selection info and reports zoom changes", () => {
    const onZoomChange = vi.fn();
    render(<PdfStatusBar page={1} pageCount={3} selection="12 characters selected" zoom={1.25} onZoomChange={onZoomChange} />);
    expect(screen.getByTestId("pdf-status-selection")).toHaveTextContent("12 characters selected");
    expect(screen.getByTestId("pdf-status-zoom-value")).toHaveTextContent("125%");
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(onZoomChange).toHaveBeenCalledWith(1.15);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoomChange).toHaveBeenCalledWith(1.35);
  });

  it("clamps an out-of-range page to the document", () => {
    render(<PdfStatusBar page={9} pageCount={3} zoom={1} />);
    expect(screen.getByTestId("pdf-status-page")).toHaveTextContent("Page 3 / 3");
  });
});
