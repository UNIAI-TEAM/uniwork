import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { configureShortcutPlatform } from "@uniwork/core/shortcuts";
import { PptxShortcutsHelp } from "./pptx-shortcuts-help";

initI18n();
beforeEach(async () => {
  await setLocale("en");
  configureShortcutPlatform("windows");
});

describe("PptxShortcutsHelp", () => {
  it("lists every help binding, grouped, with its translated label", () => {
    render(<PptxShortcutsHelp open onOpenChange={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Keyboard shortcuts");
    for (const label of [
      "Undo",
      "Redo",
      "Save",
      "Find",
      "Edit the selected text",
      "Select every element",
      "Delete the selection",
      "Next slide",
      "Previous slide",
      "Clear the selection",
      "Show this help",
    ]) {
      expect(dialog).toHaveTextContent(label);
    }
    for (const heading of ["Editing", "View", "Navigation"]) {
      expect(within(dialog).getAllByText(heading).length).toBeGreaterThan(0);
    }
    // Secondary chords are not listed: Redo appears once (Ctrl+Y), not twice.
    expect(within(dialog).getAllByText("Redo")).toHaveLength(1);
  });

  it("renders Ctrl keycaps on Windows and Cmd on macOS", () => {
    const view = render(<PptxShortcutsHelp open onOpenChange={vi.fn()} />);
    expect(within(screen.getByRole("dialog")).getAllByText("Ctrl").length).toBeGreaterThan(0);
    view.unmount();
    configureShortcutPlatform("macos");
    render(<PptxShortcutsHelp open onOpenChange={vi.fn()} />);
    const mac = screen.getByRole("dialog");
    expect(within(mac).getAllByText("Cmd").length).toBeGreaterThan(0);
    expect(within(mac).queryByText("Ctrl")).toBeNull();
  });

  it("renders nothing when closed", () => {
    render(<PptxShortcutsHelp open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});