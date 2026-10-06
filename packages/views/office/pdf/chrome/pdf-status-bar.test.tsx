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

  it("shows the rail toggle only when a host wires it and reflects the open state", () => {
    const onRailToggle = vi.fn();
    const { rerender } = render(<PdfStatusBar page={1} pageCount={3} zoom={1} />);
    expect(screen.queryByTestId("pdf-rail-toggle")).not.toBeInTheDocument();
    rerender(<PdfStatusBar page={1} pageCount={3} zoom={1} onRailToggle={onRailToggle} />);
    const toggle = screen.getByTestId("pdf-rail-toggle");
    // Only below sm: from sm up the rail is always visible.
    expect(toggle).toHaveClass("sm:hidden");
    // The flipping Show/Hide name carries the state; no aria-pressed repeats it (r3 F6).
    const closedName = toggle.getAttribute("aria-label");
    expect(closedName).toBeTruthy();
    expect(toggle).not.toHaveAttribute("aria-pressed");
    fireEvent.click(toggle);
    expect(onRailToggle).toHaveBeenCalledOnce();
    rerender(<PdfStatusBar page={1} pageCount={3} zoom={1} railOpen onRailToggle={onRailToggle} />);
    expect(screen.getByTestId("pdf-rail-toggle").getAttribute("aria-label")).not.toBe(closedName);
    expect(screen.getByTestId("pdf-rail-toggle")).not.toHaveAttribute("aria-pressed");
  });

  it("offers fit-width and fit-page buttons that call the host, and none without a host (T12)", () => {
    const onFitWidth = vi.fn();
    const onFitPage = vi.fn();
    const { unmount } = render(<PdfStatusBar page={1} pageCount={2} zoom={1} />);
    expect(screen.queryByRole("group", { name: "View" })).toBeNull();
    unmount();
    render(<PdfStatusBar page={1} pageCount={2} zoom={1} onFitWidth={onFitWidth} onFitPage={onFitPage} />);
    fireEvent.click(screen.getByRole("button", { name: "Fit to width" }));
    fireEvent.click(screen.getByRole("button", { name: "Fit to page" }));
    expect(onFitWidth).toHaveBeenCalledTimes(1);
    expect(onFitPage).toHaveBeenCalledTimes(1);
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
