import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { uniqueSheetName, validSheetName, XlsxSheetTabs, type XlsxSheetTab } from "./sheet-tabs";
import { sheetActionOperation, type XlsxSheetTabAction } from "./sheet-commands";

// The views suite runs in vi (test/setup.ts beforeAll), so the strip renders
// Vietnamese strings; read them from the locale object rather than hardcoding
// English (the pattern commit 530e465a established).
const sheets = viLocale.office.xlsx.sheets;
const unhideArchive = `${sheets.unhide}: Archive`;
const duplicateName = `Data ${sheets.copySuffix}`;

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
    expect(screen.getByRole("tab", { name: "Budget" })).toHaveAttribute("title", `Budget - ${sheets.tabColorReadOnly}`);
    expect(screen.getByTestId("xlsx-sheet-hidden-Archive")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: unhideArchive }));
    expect(onAction).toHaveBeenCalledWith({ kind: "set-hidden", sheet: "Archive", hidden: false });
  });

  it("adds a sheet with a unique default name", () => {
    const first = renderTabs();
    fireEvent.click(first.view.getByRole("button", { name: sheets.add }));
    expect(first.onAction).toHaveBeenCalledWith({ kind: "add", name: sheets.defaultName });
    first.view.unmount();
    const taken = renderTabs({ tabs: [...tabs, { name: sheets.defaultName, hidden: false, tabColor: null }] });
    fireEvent.click(taken.view.getByRole("button", { name: sheets.add }));
    expect(taken.onAction).toHaveBeenCalledWith({ kind: "add", name: `${sheets.defaultName} 2` });
  });

  it("renames the active sheet through an inline input and abandons invalid or unchanged names", () => {
    const { onAction } = renderTabs();
    fireEvent.click(screen.getByRole("button", { name: sheets.rename }));
    const input = screen.getByRole("textbox", { name: sheets.renameInput });
    expect(input).toHaveValue("Data");
    fireEvent.change(input, { target: { value: "Ngân sách" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAction).toHaveBeenCalledWith({ kind: "rename", sheet: "Data", newName: "Ngân sách" });
    // Escape cancels, and an untouched name never emits.
    fireEvent.click(screen.getByRole("button", { name: sheets.rename }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: sheets.renameInput }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: sheets.renameInput })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: sheets.rename }));
    const reopen = screen.getByRole("textbox", { name: sheets.renameInput });
    fireEvent.change(reopen, { target: { value: "a/b" } });
    fireEvent.keyDown(reopen, { key: "Enter" });
    expect(onAction).toHaveBeenCalledTimes(1);
    // The input stays open on an invalid name so the user can fix it.
    expect(screen.getByRole("textbox", { name: sheets.renameInput })).toHaveAttribute("aria-invalid", "true");
  });

  it("requires a confirming second click before deleting", () => {
    const { onAction } = renderTabs();
    const remove = screen.getByRole("button", { name: sheets.remove });
    fireEvent.click(remove);
    expect(onAction).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: sheets.confirmRemove });
    expect(confirm).toHaveAttribute("data-confirming", "true");
    fireEvent.click(confirm);
    expect(onAction).toHaveBeenCalledWith({ kind: "remove", sheet: "Data" });
    expect(screen.getByRole("button", { name: sheets.remove })).toBeInTheDocument();
  });

  it("duplicates and moves the active sheet with absolute tab indices", () => {
    const first = renderTabs();
    fireEvent.click(first.view.getByRole("button", { name: sheets.duplicate }));
    expect(first.onAction).toHaveBeenCalledWith({ kind: "duplicate", sheet: "Data", name: duplicateName });
    fireEvent.click(first.view.getByRole("button", { name: sheets.moveRight }));
    expect(first.onAction).toHaveBeenCalledWith({ kind: "move", sheet: "Data", index: 1 });
    // Left is disabled on the first tab; right on the last.
    expect(first.view.getByRole("button", { name: sheets.moveLeft })).toHaveAttribute("aria-disabled", "true");
    first.view.unmount();
    const last = renderTabs({ activeSheet: "Budget" });
    expect(last.view.getByRole("button", { name: sheets.moveRight })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(last.view.getByRole("button", { name: sheets.moveRight }));
    expect(last.onAction).not.toHaveBeenCalled();
    fireEvent.click(last.view.getByRole("button", { name: sheets.moveLeft }));
    expect(last.onAction).toHaveBeenCalledWith({ kind: "move", sheet: "Budget", index: 0 });
  });

  it("rejects renaming to another live sheet's name (case-insensitive)", () => {
    const { onAction } = renderTabs();
    fireEvent.click(screen.getByRole("button", { name: sheets.rename }));
    const input = screen.getByRole("textbox", { name: sheets.renameInput });
    fireEvent.change(input, { target: { value: "budget" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAction).not.toHaveBeenCalled();
    // "budget" is a valid NAME SHAPE, so the field is not flagged invalid; the
    // duplicate is refused by the commit handler, which is what the missing
    // onAction above pins. (Only a malformed name sets aria-invalid.)
    expect(screen.getByRole("textbox", { name: sheets.renameInput })).not.toHaveAttribute("aria-invalid");
    // A case-only rewrite of the active sheet itself is still legal.
    fireEvent.change(input, { target: { value: "data" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAction).toHaveBeenCalledWith({ kind: "rename", sheet: "Data", newName: "data" });
  });

  it("maps a visible move to the absolute tab index when a hidden sheet sits between", () => {
    const interleaved: XlsxSheetTab[] = [
      { name: "Data", hidden: false, tabColor: null },
      { name: "Archive", hidden: true, tabColor: null },
      { name: "Budget", hidden: false, tabColor: null },
    ];
    const { onAction } = renderTabs({ tabs: interleaved, activeSheet: "Data" });
    // The visible neighbour is Budget at absolute index 2, not index 1.
    fireEvent.click(screen.getByRole("button", { name: sheets.moveRight }));
    expect(onAction).toHaveBeenCalledWith({ kind: "move", sheet: "Data", index: 2 });
  });

  it("hides the active sheet and refuses to hide the last visible one", () => {
    const first = renderTabs();
    fireEvent.click(first.view.getByRole("button", { name: sheets.hide }));
    expect(first.onAction).toHaveBeenCalledWith({ kind: "set-hidden", sheet: "Data", hidden: true });
    first.view.unmount();
    const single = renderTabs({ tabs: [{ name: "Data", hidden: false, tabColor: null }] });
    expect(single.view.getByRole("button", { name: sheets.hide })).toHaveAttribute("aria-disabled", "true");
    expect(single.view.getByRole("button", { name: sheets.remove })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(single.view.getByRole("button", { name: sheets.hide }));
    expect(single.onAction).not.toHaveBeenCalled();
  });

  it("keeps every control aria-disabled without edit rights and never emits", () => {
    const { view, onAction, onSelect } = renderTabs({ canEdit: false });
    for (const name of [sheets.add, sheets.rename, sheets.duplicate, sheets.moveLeft, sheets.moveRight, sheets.hide, sheets.remove, unhideArchive]) {
      expect(view.getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
    }
    fireEvent.click(view.getByRole("button", { name: sheets.add }));
    fireEvent.click(view.getByRole("button", { name: sheets.duplicate }));
    fireEvent.click(view.getByRole("button", { name: sheets.remove }));
    fireEvent.click(view.getByRole("button", { name: unhideArchive }));
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

  describe("narrow screens", () => {
    const inlineNames = [sheets.rename, sheets.duplicate, sheets.moveLeft, sheets.moveRight, sheets.hide, sheets.remove];

    it("hides the six inline actions below sm and keeps Add visible", () => {
      renderTabs();
      for (const name of inlineNames) expect(screen.getByRole("button", { name })).toHaveClass("max-sm:hidden");
      expect(screen.getByRole("button", { name: sheets.add })).not.toHaveClass("max-sm:hidden");
      expect(screen.getByRole("button", { name: sheets.actions })).toHaveClass("sm:hidden");
    });

    it("folds the six actions into one menu that fires the same callbacks", async () => {
      const user = userEvent.setup();
      const { onAction } = renderTabs();
      const open = async () => user.click(screen.getByRole("button", { name: sheets.actions }));
      await open();
      expect(await screen.findAllByRole("menuitem")).toHaveLength(6);
      await user.click(await screen.findByRole("menuitem", { name: sheets.duplicate }));
      expect(onAction).toHaveBeenLastCalledWith({ kind: "duplicate", sheet: "Data", name: duplicateName });
      await open();
      await user.click(await screen.findByRole("menuitem", { name: sheets.moveRight }));
      expect(onAction).toHaveBeenLastCalledWith({ kind: "move", sheet: "Data", index: 1 });
      await open();
      await user.click(await screen.findByRole("menuitem", { name: sheets.hide }));
      expect(onAction).toHaveBeenLastCalledWith({ kind: "set-hidden", sheet: "Data", hidden: true });
      await open();
      expect(await screen.findByRole("menuitem", { name: sheets.moveLeft })).toHaveAttribute("aria-disabled", "true");
    });

    it("starts the inline rename from the menu", async () => {
      const user = userEvent.setup();
      const { onAction } = renderTabs();
      await user.click(screen.getByRole("button", { name: sheets.actions }));
      await user.click(await screen.findByRole("menuitem", { name: sheets.rename }));
      const input = screen.getByRole("textbox", { name: sheets.renameInput });
      expect(input).toHaveValue("Data");
      fireEvent.change(input, { target: { value: "Tổng hợp" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onAction).toHaveBeenCalledWith({ kind: "rename", sheet: "Data", newName: "Tổng hợp" });
    });

    it("keeps the delete confirm step inside the menu", async () => {
      const user = userEvent.setup();
      const { onAction } = renderTabs();
      await user.click(screen.getByRole("button", { name: sheets.actions }));
      await user.click(await screen.findByRole("menuitem", { name: sheets.remove }));
      expect(onAction).not.toHaveBeenCalled();
      await user.click(await screen.findByRole("menuitem", { name: sheets.confirmRemove }));
      expect(onAction).toHaveBeenCalledWith({ kind: "remove", sheet: "Data" });
    });
  });

  it("gives every icon-only action button an accessible name and a tooltip", () => {
    renderTabs({ tabs: [...tabs, { name: "Extra", hidden: false, tabColor: null }] });
    const ids = ["add", "rename", "duplicate", "move-left", "move-right", "hide", "remove", "actions-menu"];
    for (const id of ids) {
      const button = screen.getByTestId(`xlsx-sheet-${id === "actions-menu" ? id : id}`);
      expect(button.getAttribute("aria-label")).toBeTruthy();
      expect(button).toHaveAttribute("title", button.getAttribute("aria-label"));
    }
    const unhide = screen.getByRole("button", { name: unhideArchive });
    expect(unhide).toHaveAttribute("title", unhideArchive);
  });
});
