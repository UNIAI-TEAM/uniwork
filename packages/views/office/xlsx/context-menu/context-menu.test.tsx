import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { XlsxToolbarCommands } from "../toolbar/types";
import { XlsxContextMenu } from "./context-menu";
import type { XlsxContextMenuState } from "./menu-items";

function makeState(overrides: Partial<XlsxContextMenuState> = {}): XlsxContextMenuState {
  const commands: XlsxToolbarCommands = { execute: vi.fn(() => true) };
  return {
    readOnly: false,
    selection: { sheet: "Data", address: "B2", endAddress: "C3" },
    canFormat: true,
    commands,
    permissions: { canCopy: true, canPaste: true },
    canCut: true,
    canFind: true,
    sort: { unitId: "file-x", sheetId: "sh1", range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 } },
    ...overrides,
  };
}

function renderMenu(state = makeState(), onClose = vi.fn(), onRunCallback = vi.fn(), focusTarget?: HTMLElement) {
  render(
    <XlsxContextMenu
      point={{ x: 40, y: 60 }}
      state={state}
      focusTarget={focusTarget ?? null}
      onClose={onClose}
      onRunCallback={onRunCallback}
    />,
  );
  return { onClose, onRunCallback, state };
}

/** Moves the menu's highlight with ArrowDown until `testId` holds focus. */
async function highlight(testId: string) {
  const menu = await screen.findByTestId("xlsx-context-menu");
  const item = within(menu).getByTestId(testId);
  for (let i = 0; i < 40; i += 1) {
    if (document.activeElement === item) break;
    fireEvent.keyDown(menu, { key: "ArrowDown" });
  }
  expect(document.activeElement).toBe(item);
}

describe("XlsxContextMenu", () => {
  it("renders an ARIA menu with the mapped items", async () => {
    renderMenu();
    const menu = await screen.findByTestId("xlsx-context-menu");
    expect(menu).toHaveAttribute("role", "menu");
    expect(within(menu).getByTestId("xlsx-context-clear-content")).toBeInTheDocument();
    expect(within(menu).getByTestId("xlsx-context-merge")).toBeInTheDocument();
    expect(within(menu).getByTestId("xlsx-context-sort-ascending")).toBeInTheDocument();
  });

  it("runs the item's command through the port and closes on click", async () => {
    const { onClose, state } = renderMenu();
    fireEvent.click(await screen.findByTestId("xlsx-context-clear-content"));
    expect(state.commands?.execute).toHaveBeenCalledWith("sheet.command.clear-selection-content", undefined);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("invokes an editor callback for cut/copy/paste/find instead of a command", async () => {
    const { onClose, onRunCallback, state } = renderMenu();
    fireEvent.click(await screen.findByTestId("xlsx-context-find"));
    expect(onRunCallback).toHaveBeenCalledWith("find");
    expect(state.commands?.execute).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens the number-format submenu and applies a preset", async () => {
    const { state } = renderMenu();
    const menu = await screen.findByTestId("xlsx-context-menu");
    fireEvent.click(within(menu).getByTestId("xlsx-context-number-format"));
    const preset = await screen.findByTestId("xlsx-context-number-format-number-integer");
    fireEvent.click(preset);
    expect(state.commands?.execute).toHaveBeenCalledWith(
      "sheet.command.numfmt.set.numfmt",
      expect.objectContaining({ values: expect.any(Array) }),
    );
  });

  it("navigates with the arrow keys and activates with Enter", async () => {
    const { onClose, state } = renderMenu();
    await highlight("xlsx-context-insert-row-above");
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    expect(state.commands?.execute).toHaveBeenCalledWith("sheet.command.insert-row-before", { value: 2 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape and returns focus to the grid", async () => {
    const target = document.createElement("div");
    target.tabIndex = -1;
    document.body.appendChild(target);
    const focusSpy = vi.spyOn(target, "focus");
    const { onClose } = renderMenu(makeState(), vi.fn(), vi.fn(), target);
    const menu = await screen.findByTestId("xlsx-context-menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(focusSpy).toHaveBeenCalled();
    target.remove();
  });

  it("keeps disabled items rendered with aria-disabled and inert", async () => {
    // A single cell: merge and unmerge are disabled, structure stays enabled.
    const { state } = renderMenu(makeState({ selection: { sheet: "Data", address: "A1" } }));
    const menu = await screen.findByTestId("xlsx-context-menu");
    const merge = within(menu).getByTestId("xlsx-context-merge");
    expect(merge).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(merge);
    expect(state.commands?.execute).not.toHaveBeenCalled();
    const insert = within(menu).getByTestId("xlsx-context-insert-row-above");
    expect(insert).not.toHaveAttribute("aria-disabled", "true");
  });

  it("keeps every item rendered when read-only, disabling all but copy", async () => {
    renderMenu(makeState({ readOnly: true }));
    const menu = await screen.findByTestId("xlsx-context-menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const isCopy = item.getAttribute("data-testid") === "xlsx-context-copy";
      if (isCopy) expect(item).not.toHaveAttribute("aria-disabled", "true");
      else expect(item).toHaveAttribute("aria-disabled", "true");
    }
  });
});