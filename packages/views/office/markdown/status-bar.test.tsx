import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { MarkdownStatusBar } from "./status-bar";

const i18n = initI18n();
beforeEach(async () => { await setLocale("en"); });

/** Every string this suite asserts, resolved through the real dictionary. */
const KEYS = [
  "office.markdown.shortcuts.title",
  "office.markdown.shortcuts.description",
  "office.markdown.actions.undo",
  "office.markdown.actions.redo",
  "office.markdown.actions.save",
  "office.markdown.view.label",
  "office.markdown.view.source",
  "office.markdown.view.wysiwyg",
  "office.markdown.saveState.dirty",
  "office.markdown.saveState.saved",
  "office.markdown.saveState.readonly",
  "office.common.chrome.find",
  "office.common.find.title",
  "office.status.label",
] as const;

function renderBar(over: Partial<Parameters<typeof MarkdownStatusBar>[0]> = {}) {
  return render(<MarkdownStatusBar state="dirty" mode="visual" {...over} />);
}

describe("MarkdownStatusBar", () => {
  it("every asserted key resolves in both locales (a missing key fails here)", () => {
    for (const lng of ["en", "vi"] as const) {
      for (const key of KEYS) {
        expect(i18n.exists(key, { lng }), `${lng} ${key}`).toBe(true);
      }
    }
  });

  it("spells the shortcuts sheet copy from the resolved keys, not the raw keys", async () => {
    renderBar();
    fireEvent.click(screen.getByTestId("md-shortcuts-help-trigger"));
    const dialog = await screen.findByTestId("md-shortcuts-dialog");
    expect(within(dialog).getByRole("heading", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Shortcuts available while editing this document.");
    expect(dialog).not.toHaveTextContent("office.markdown.shortcuts");
    // The six rows carry the resolved labels and their literal chords.
    expect(within(dialog).getAllByRole("term").map((node) => node.textContent)).toEqual([
      "Undo",
      "Redo",
      "Save to UniWork",
      "Find",
      "Find and replace",
      "View mode",
    ]);
    expect(within(dialog).getAllByRole("definition").map((node) => node.textContent)).toEqual([
      "Ctrl+Z",
      "Ctrl+Y",
      "Ctrl+S",
      "Ctrl+F",
      "Ctrl+H",
      "Ctrl+\\",
    ]);
  });

  it("names the trigger with the resolved shortcuts title", () => {
    renderBar();
    expect(screen.getByTestId("md-shortcuts-help-trigger")).toHaveAccessibleName("Keyboard shortcuts");
    expect(screen.getByRole("group", { name: "Status bar" })).toBeInTheDocument();
  });

  it("reads the save state and the active canvas from the resolved keys", () => {
    const { rerender } = renderBar({ state: "dirty", mode: "visual" });
    expect(screen.getByTestId("md-open-state")).toHaveTextContent("Unsaved changes");
    expect(screen.getByTestId("md-view-label")).toHaveTextContent("Visual");
    rerender(<MarkdownStatusBar state="saved" mode="source" />);
    expect(screen.getByTestId("md-open-state")).toHaveTextContent("Saved to UniWork");
    expect(screen.getByTestId("md-view-label")).toHaveTextContent("Source");
    // A read-only canvas carries the third readout, also resolved copy.
    rerender(<MarkdownStatusBar state="saved" mode="source" readOnly />);
    expect(screen.getByTestId("md-readonly")).toHaveTextContent("Read-only");
  });

  it("hides the read-only readout when the canvas is editable", () => {
    renderBar();
    expect(screen.queryByTestId("md-readonly")).toBeNull();
  });
});
