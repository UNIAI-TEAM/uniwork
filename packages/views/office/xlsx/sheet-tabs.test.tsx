import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { uniqueSheetName, validSheetName, XlsxSheetTabs, type XlsxSheetTab } from "./sheet-tabs";
import { sheetActionOperation, type XlsxSheetTabAction } from "./sheet-commands";

const tabs: XlsxSheetTab[] = [
  { name: "Data", hidden: false, tabColor: null },
  { name: "Budget", hidden: false, tabColor: "#FF0000" },
  { name: "Archive", hidden: true, tabColor: null },
];

function renderTabs(overrides: Partial<Parameters<typeof XlsxSheetTabs>[0]> = {}) {
  const onSelect = vi.fn();
  const onAction = vi.fn<(action: XlsxSheetTabAction) => void>();
  const view = render(
    <XlsxSheetTabs tabs={tabs} activeSheet="Data" canEdit onSelect={onSelect} onAction={onAction} {...overrides} />,
  );
  return { view, onSelect, onAction };
}

describe("XlsxSheetTabs", () => {
  it("switches the active tab and lists hidden sheets with an unhide control", () => {
    const { onSelect, onAction } = renderTabs();
    expect(screen.getByRole("tab", { name: "Data" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Budget" }));
    expect(onSelect).toHaveBeenCalledWith("Budget");
    // The read-only tab colour is shown and announced as pending.
    expect(screen.getByTestId("xlsx-sheet-color-Budget")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Budget" })).toHaveAttribute("title", "Tab colour (read-only — pending gateway)");
    expect(screen.getByTestId("xlsx-sheet-hidden-Archive")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show sheet: Archive" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "set-hidden", sheet: "Archive", hidden: false });
  });

  it("adds a sheet with a unique default name", () => {
    const first = renderTabs();
    fireEvent.click(first.view.getByRole("button", { name: "Add sheet" }));
    expect(first.onAction).toHaveBeenCalledWith({ kind: "add", name: "Sheet" });
    first.view.unmount();
    const taken = renderTabs({ tabs: [...tabs, { name: "Sheet", hidden: false, tabColor: null }] });
    fireEvent.click(taken.view.getByRole("button", { name: "Add sheet" }));
    expect(taken.onAction).toHaveBeenCalledWith({ kind: "add", name: "Sheet 2" });
  });

  it("renames the active sheet through an inline input and abandons invalid or unchanged names", () => {
    const { onAction } = renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Rename sheet" }));
    const input = screen.getByRole("textbox", { name: "Sheet name" });
    expect(input).toHaveValue("Data");
    fireEvent.change(input, { target: { value: "Ngân sách" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAction).toHaveBeenCalledWith({ kind: "rename", sheet: "Data", newName: "Ngân sách" });
    // Escape cancels, and an untouched name never emits.
    fireEvent.click(screen.getByRole("button", { name: "Rename sheet" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Sheet name" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Sheet name" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rename sheet" }));
    const reopen = screen.getByRole("textbox", { name: "Sheet name" });
    fireEvent.change(reopen, { target: { value: "a/b" } });
    fireEvent.keyDown(reopen, { key: "Enter" });
    expect(onAction).toHaveBeenCalledTimes(1);
    // The input stays open on an invalid name so the user can fix it.
    expect(screen.getByRole("textbox", { name: "Sheet name" })).toHaveAttribute("aria-invalid", "true");
  });

  it("requires a confirming second click before deleting", () => {
    const { onAction } = renderTabs();
    const remove = screen.getByRole("button", { name: "Delete sheet" });
    fireEvent.click(remove);
    expect(onAction).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Confirm delete sheet?" });
    expect(confirm).toHaveAttribute("data-confirming", "true");
    fireEvent.click(confirm);
    expect(onAction).toHaveBeenCalledWith({ kind: "remove", sheet: "Data" });
    expect(screen.getByRole("button", { name: "Delete sheet" })).toBeInTheDocument();
  });

  it("duplicates and moves the active sheet with absolute tab indices", () => {
    const first = renderTabs();
    fireEvent.click(first.view.getByRole("button", { name: "Duplicate sheet" }));
    expect(first.onAction).toHaveBeenCalledWith({ kind: "duplicate", sheet: "Data", name: "Data copy" });
    fireEvent.click(first.view.getByRole("button", { name: "Move right" }));
    expect(first.onAction).toHaveBeenCalledWith({ kind: "move", sheet: "Data", index: 1 });
    // Left is disabled on the first tab; right on the last.
    expect(first.view.getByRole("button", { name: "Move left" })).toHaveAttribute("aria-disabled", "true");
    first.view.unmount();
    const last = renderTabs({ activeSheet: "Budget" });
    expect(last.view.getByRole("button", { name: "Move right" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(last.view.getByRole("button", { name: "Move right" }));
    expect(last.onAction).not.toHaveBeenCalled();
    fireEvent.click(last.view.getByRole("button", { name: "Move left" }));
    expect(last.onAction).toHaveBeenCalledWith({ kind: "move", sheet: "Budget", index: 0 });
  });

  it("hides the active sheet and refuses to hide the last visible one", () => {
    const first = renderTabs();
    fireEvent.click(first.view.getByRole("button", { name: "Hide sheet" }));
    expect(first.onAction).toHaveBeenCalledWith({ kind: "set-hidden", sheet: "Data", hidden: true });
    first.view.unmount();
    const single = renderTabs({ tabs: [{ name: "Data", hidden: false, tabColor: null }] });
    expect(single.view.getByRole("button", { name: "Hide sheet" })).toHaveAttribute("aria-disabled", "true");
    expect(single.view.getByRole("button", { name: "Delete sheet" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(single.view.getByRole("button", { name: "Hide sheet" }));
    expect(single.onAction).not.toHaveBeenCalled();
  });

  it("keeps every control aria-disabled without edit rights and never emits", () => {
    const { view, onAction, onSelect } = renderTabs({ canEdit: false });
    for (const name of ["Add sheet", "Rename sheet", "Duplicate sheet", "Move left", "Move right", "Hide sheet", "Delete sheet", "Show sheet: Archive"]) {
      expect(view.getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
    }
    fireEvent.click(view.getByRole("button", { name: "Add sheet" }));
    fireEvent.click(view.getByRole("button", { name: "Duplicate sheet" }));
    fireEvent.click(view.getByRole("button", { name: "Delete sheet" }));
    fireEvent.click(view.getByRole("button", { name: "Show sheet: Archive" }));
    expect(onAction).not.toHaveBeenCalled();
    // Selecting a tab is a view action and still works.
    fireEvent.click(view.getByRole("tab", { name: "Budget" }));
    expect(onSelect).toHaveBeenCalledWith("Budget");
  });

  it("pins the fallback wire ops for hosts without a mounted grid", () => {
    expect(sheetActionOperation({ kind: "add", name: "Scratch" })).toEqual({ op: "add_sheet", attributes: { name: "Scratch" } });
    expect(sheetActionOperation({ kind: "duplicate", sheet: "Data", name: "Copy" }))
      .toEqual({ op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "Copy" } });
    expect(sheetActionOperation({ kind: "rename", sheet: "Data", newName: "Budget" }))
      .toEqual({ op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Budget" } });
    expect(sheetActionOperation({ kind: "remove", sheet: "Data" })).toEqual({ op: "remove_sheet", target: { sheet: "Data" } });
    expect(sheetActionOperation({ kind: "move", sheet: "Data", index: 2 }))
      .toEqual({ op: "reorder_sheet", target: { sheet: "Data" }, attributes: { index: 2 } });
    expect(sheetActionOperation({ kind: "set-hidden", sheet: "Data", hidden: true }))
      .toEqual({ op: "set_sheet_hidden", target: { sheet: "Data" }, attributes: { hidden: true } });
  });

  it("validates names with the upstream rules and uniquifies defaults", () => {
    expect(validSheetName("Ngân sách")).toBe(true);
    expect(validSheetName("")).toBe(false);
    expect(validSheetName("a/b")).toBe(false);
    expect(validSheetName("x".repeat(32))).toBe(false);
    expect(validSheetName("'quoted'")).toBe(false);
    expect(uniqueSheetName("Sheet", ["Data"])).toBe("Sheet");
    expect(uniqueSheetName("Sheet", ["sheet"])).toBe("Sheet 2");
    expect(uniqueSheetName("Sheet", ["Sheet", "Sheet 2"])).toBe("Sheet 3");
  });
});
