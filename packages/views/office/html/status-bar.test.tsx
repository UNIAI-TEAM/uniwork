import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HtmlStatusBar } from "./status-bar";

const i18n = initI18n();
beforeEach(async () => { await setLocale("en"); });

/** Every string this suite asserts, resolved through the real dictionary. */
const KEYS = [
  "office.html.shortcuts.title",
  "office.html.shortcuts.description",
  "office.html.status.figures",
  "office.html.status.selection",
  "office.html.status.selectionNone",
  "office.html.zoom.level",
  "office.html.actions.undo",
  "office.html.actions.redo",
  "office.html.actions.save",
  "office.html.view.label",
] as const;

function renderBar(over: Partial<Parameters<typeof HtmlStatusBar>[0]> = {}) {
  return render(
    <HtmlStatusBar
      text={"<p>hi</p>"}
      selection={null}
      zoom={100}
      onZoomChange={vi.fn()}
      zoomDisabled={false}
      {...over}
    />,
  );
}

describe("HtmlStatusBar", () => {
  it("every asserted key resolves in both locales (a missing key fails here)", () => {
    for (const lng of ["en", "vi"] as const) {
      for (const key of KEYS) {
        expect(i18n.exists(key, { lng }), `${lng} ${key}`).toBe(true);
      }
    }
  });

  it("spells the shortcuts sheet copy from the resolved keys, not the raw keys", async () => {
    renderBar();
    fireEvent.click(screen.getByTestId("html-shortcuts-help-trigger"));
    const dialog = await screen.findByTestId("html-shortcuts-dialog");
    // The resolved copy, literal: a missing key would render the key path here.
    expect(within(dialog).getByRole("heading", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Shortcuts available while editing this document.");
    expect(dialog).not.toHaveTextContent("office.html.shortcuts");
    // Each row's label is the resolved string, not its key.
    expect(within(dialog).getAllByRole("term").map((node) => node.textContent)).toEqual([
      "Undo",
      "Redo",
      "Save to UniWork",
      "View mode",
    ]);
    expect(within(dialog).getAllByRole("definition").map((node) => node.textContent)).toEqual([
      "Ctrl+Z",
      "Ctrl+Y",
      "Ctrl+S",
      "Ctrl+\\",
    ]);
  });

  it("names the trigger with the resolved shortcuts title", () => {
    renderBar();
    expect(screen.getByTestId("html-shortcuts-help-trigger")).toHaveAccessibleName("Keyboard shortcuts");
  });

  it("reads the figures, the selection and the zoom from the resolved keys", () => {
    renderBar({ text: "<p>hi</p>\n<section>", selection: { from: 3, to: 8 }, zoom: 110 });
    expect(screen.getByTestId("html-status-figures")).toHaveTextContent("19 chars · 2 lines · HTML");
    expect(screen.getByTestId("html-status-selection")).toHaveTextContent("3–8 selected");
    expect(screen.getByTestId("html-zoom")).toHaveTextContent("110%");
  });

  it("says 'no selection' from the resolved key when nothing is selected", () => {
    renderBar({ selection: { from: 4, to: 4 } });
    expect(screen.getByTestId("html-status-selection")).toHaveTextContent("No selection");
  });

  it("announces every zoom step through a polite live region (m2)", () => {
    const onZoomChange = vi.fn();
    const { rerender } = render(
      <HtmlStatusBar text="x" selection={null} zoom={100} onZoomChange={onZoomChange} zoomDisabled={false} />,
    );
    const live = screen.getByTestId("html-zoom-live");
    // A live region only announces a CHANGE, so it is mounted up front and
    // stays EMPTY at rest: the visible "100%" is not spelled a second time (T12).
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveAttribute("role", "status");
    expect(live.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoomChange).toHaveBeenCalledWith(110);
    rerender(<HtmlStatusBar text="x" selection={null} zoom={110} onZoomChange={onZoomChange} zoomDisabled={false} />);
    expect(screen.getByTestId("html-zoom-live")).toHaveTextContent("Zoom level 110%");
  });

  it("does not repeat the visible zoom in the status text at rest, and empties the announcement after a step (T12)", () => {
    vi.useFakeTimers();
    try {
      const props = { text: "x", selection: null, onZoomChange: vi.fn(), zoomDisabled: false } as const;
      const { container, rerender } = render(<HtmlStatusBar {...props} zoom={100} />);
      const row = container.querySelector("[data-office-status-bar]") as HTMLElement;
      expect(row.textContent!.match(/100%/g)).toHaveLength(1);
      expect(row.textContent).not.toContain("Zoom level");
      rerender(<HtmlStatusBar {...props} zoom={110} />);
      expect(screen.getByTestId("html-zoom-live")).toHaveTextContent("Zoom level 110%");
      act(() => { vi.advanceTimersByTime(2000); });
      expect(screen.getByTestId("html-zoom-live").textContent).toBe("");
      expect(row.textContent!.match(/110%/g)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the live region silent in source mode, where zoom is unavailable", () => {
    renderBar({ zoomDisabled: true });
    expect(screen.getByTestId("html-zoom-live").textContent).toBe("");
    expect(screen.getByTestId("html-zoom")).toHaveTextContent("–");
  });

  it("joins the assets strip band: drops its own separator only when asked (F9)", () => {
    // D-html: with assets above, the two rows share ONE band, so only the strip
    // keeps the top separator and the status row renders none.
    const { container, rerender } = render(
      <HtmlStatusBar text="x" selection={null} zoom={100} onZoomChange={vi.fn()} zoomDisabled={false} joinedBand />,
    );
    expect(container.querySelector("[data-office-status-bar]")!.className).toContain("border-t-0");
    rerender(<HtmlStatusBar text="x" selection={null} zoom={100} onZoomChange={vi.fn()} zoomDisabled={false} />);
    expect(container.querySelector("[data-office-status-bar]")!.className).not.toContain("border-t-0");
  });
});

describe("HtmlStatusBar caret position (T12)", () => {
  it("shows Ln/Col from the caret head beside the selection readout", () => {
    renderBar({ text: "ab\ncde", selection: { from: 5, to: 5, head: 5 } });
    expect(screen.getByTestId("html-status-position")).toHaveTextContent("Ln 2, Col 3");
  });

  it("renders no position slot without a caret", () => {
    renderBar({ selection: null });
    expect(screen.queryByTestId("html-status-position")).toBeNull();
  });
});
