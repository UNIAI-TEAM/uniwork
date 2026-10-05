// Typed Home items (UNI-926 RIBBON-POLISH): the Font and Alignment groups as
// ribbon items laid out in Excel's two icon rows, firing the same renderer
// commands the pre-ribbon groups fired.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficeRibbon, type RibbonItem } from "../../ribbon";
import { groupBlocks } from "../../ribbon/layout";
import { stubRibbonWidth } from "../../ribbon/test/fixtures";
import type { XlsxGridFormatState } from "../xlsx-grid-surface";
import { xlsxAlignmentRibbonItems } from "./home-alignment";
import { xlsxFontRibbonItems } from "./home-font";
import type { XlsxToolbarGroupProps } from "./types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function formatState(overrides: Partial<XlsxGridFormatState> = {}): XlsxGridFormatState {
  return {
    fontFamily: null,
    fontSize: null,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    textColor: null,
    fillColor: null,
    horizontalAlign: null,
    verticalAlign: null,
    wrap: false,
    textRotation: null,
    ...overrides,
  };
}

function contextProps(overrides: Partial<XlsxToolbarGroupProps> = {}) {
  const execute = vi.fn(() => true);
  const props: XlsxToolbarGroupProps = {
    readOnly: false,
    selection: { sheet: "Data", address: "B2", endAddress: "C4" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute },
    formatState: formatState(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    ...overrides,
  };
  return { props, execute };
}

const FONT_LABEL = "office.xlsx.toolbar.groups.font.label";
const ALIGN_LABEL = "office.xlsx.toolbar.groups.alignment.label";

function mount(items: readonly RibbonItem[], caption: string) {
  stubRibbonWidth(2400);
  render(
    <OfficeRibbon
      scope="xlsx-test"
      tabs={[{ id: "home", labelKey: "office.xlsx.toolbar.tabs.home", groups: [{ id: "g", labelKey: caption, priority: 0, items }] }]}
    />,
  );
}

function rowIds(items: readonly RibbonItem[]): string[][] {
  return groupBlocks(items, 0).flatMap((block) => (block.kind === "strip" ? block.rows.map((row) => row.map((item) => item.id)) : []));
}

const lastCall = (execute: ReturnType<typeof vi.fn>) => execute.mock.calls.at(-1);
const byItem = (id: string) => document.querySelector<HTMLElement>(`[data-ribbon-item="${id}"]`)!;

describe("xlsxFontRibbonItems", () => {
  it("packs into Excel's two icon rows", () => {
    const { props } = contextProps();
    const items = xlsxFontRibbonItems(props);
    expect(rowIds(items)).toEqual([
      ["font-family", "font-size", "font-size-increase", "font-size-decrease"],
      ["font-bold", "font-italic", "font-underline", "font-strike", "font-borders", "font-fill-color", "font-text-color"],
    ]);
    expect(groupBlocks(items, 0)).toHaveLength(1);
    for (const item of items) expect(item.size).toBe("icon");
    expect(items.find((item) => item.id === "font-bold")).toMatchObject({ kind: "toggle", rowBreak: true, shortcut: "Ctrl+B" });
    expect(items.find((item) => item.id === "font-borders")?.kind).toBe("split");
  });

  it("fires the same commands and mirrors the toggles", () => {
    const { props, execute } = contextProps({ formatState: formatState({ bold: true, fontSize: 14 }) });
    mount(xlsxFontRibbonItems(props), FONT_LABEL);
    expect(screen.getByRole("button", { name: "In đậm" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "In nghiêng" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "In nghiêng" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-italic"]);
    fireEvent.click(screen.getByRole("button", { name: "Gạch chân" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-underline"]);
    fireEvent.click(screen.getByRole("button", { name: "Gạch ngang" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-stroke"]);
    fireEvent.click(screen.getByRole("button", { name: "Tăng cỡ chữ" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-font-size", { value: 15 }]);
    fireEvent.click(screen.getByRole("button", { name: "Giảm cỡ chữ" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-font-size", { value: 13 }]);
  });

  it("commits a typed size clamped and restores an invalid draft", () => {
    const { props, execute } = contextProps({ formatState: formatState({ fontSize: 14 }) });
    mount(xlsxFontRibbonItems(props), FONT_LABEL);
    const input = screen.getByRole("textbox", { name: "Cỡ chữ" });
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(lastCall(execute)).toEqual(["sheet.command.set-font-size", { value: 409 }]);
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("14");
  });

  it("sets the font family from the picker", async () => {
    const { props, execute } = contextProps({ formatState: formatState({ fontFamily: "Calibri" }) });
    mount(xlsxFontRibbonItems(props), FONT_LABEL);
    fireEvent.click(screen.getByRole("combobox", { name: "Phông chữ" }));
    const verdana = await screen.findByRole("option", { name: "Verdana" });
    fireEvent.pointerDown(verdana);
    fireEvent.pointerUp(verdana);
    fireEvent.click(verdana);
    expect(lastCall(execute)).toEqual(["sheet.command.set-font-family", { value: "Verdana" }]);
  });

  it("applies text and fill colours from the palette and resets them", async () => {
    const { props, execute } = contextProps({ formatState: formatState({ textColor: "#c00000" }) });
    mount(xlsxFontRibbonItems(props), FONT_LABEL);
    fireEvent.click(screen.getByRole("button", { name: "Màu chữ" }));
    const textDialog = await screen.findByRole("dialog", { name: "Màu chữ" });
    expect(within(textDialog).getByRole("button", { name: "Màu #C00000" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(textDialog).getByRole("button", { name: "Màu #FF0000" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-text-color", { value: "#FF0000" }]);
    fireEvent.click(within(textDialog).getByRole("button", { name: "Tự động" }));
    expect(lastCall(execute)).toEqual(["sheet.command.reset-text-color"]);
    fireEvent.keyDown(textDialog, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Màu tô" }));
    const fillDialog = await screen.findByRole("dialog", { name: "Màu tô" });
    fireEvent.click(within(fillDialog).getByRole("button", { name: "Màu #FFFF00" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-background-color", { value: "#FFFF00" }]);
    fireEvent.click(within(fillDialog).getByRole("button", { name: "Không tô" }));
    expect(lastCall(execute)).toEqual(["sheet.command.reset-background-color"]);
  });

  it("applies the bottom border from the primary and every preset or edge from the menu", async () => {
    const { props, execute } = contextProps();
    mount(xlsxFontRibbonItems(props), FONT_LABEL);
    const border = { style: 1, color: "#000000" };
    fireEvent.click(byItem("font-borders"));
    expect(lastCall(execute)).toEqual(["sheet.command.set-border-basic", { value: { type: "bottom", ...border } }]);
    const expected: [string, string][] = [
      ["Tất cả", "all"], ["Viền ngoài", "outside"], ["Không viền", "none"],
      ["Trên", "top"], ["Phải", "right"], ["Dưới", "bottom"], ["Trái", "left"],
    ];
    for (const [name, type] of expected) {
      fireEvent.click(document.querySelector<HTMLElement>('[data-ribbon-split-menu="font-borders"]')!);
      fireEvent.click(await screen.findByRole("menuitem", { name }));
      expect(lastCall(execute)).toEqual(["sheet.command.set-border-basic", { value: { type, ...border } }]);
    }
  });

  it("stays inert but reachable while blocked", () => {
    for (const overrides of [{ readOnly: true }, { canFormat: false }, { commands: undefined }]) {
      const { props, execute } = contextProps(overrides);
      mount(xlsxFontRibbonItems(props), FONT_LABEL);
      for (const name of ["In đậm", "Tăng cỡ chữ", "Màu chữ", "Màu tô"]) {
        const button = screen.getByRole("button", { name });
        expect(button).toHaveAttribute("aria-disabled", "true");
        fireEvent.click(button);
      }
      fireEvent.click(byItem("font-borders"));
      expect(execute).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Phông chữ" })).toBeDisabled();
      cleanup();
    }
  });
});

describe("xlsxAlignmentRibbonItems", () => {
  it("packs into two icon rows with Merge & center last", () => {
    const { props } = contextProps();
    const items = xlsxAlignmentRibbonItems(props);
    expect(rowIds(items)).toEqual([
      ["align-top", "align-middle", "align-bottom", "align-wrap", "align-rotation"],
      ["align-left", "align-center", "align-right", "align-merge"],
    ]);
    expect(items.find((item) => item.id === "align-left")).toMatchObject({ kind: "toggle", rowBreak: true });
    expect(items.find((item) => item.id === "align-merge")?.kind).toBe("split");
  });

  it("applies alignment and wrap and mirrors the active ones", () => {
    const { props, execute } = contextProps({ formatState: formatState({ horizontalAlign: 2, verticalAlign: 3, wrap: true }) });
    mount(xlsxAlignmentRibbonItems(props), ALIGN_LABEL);
    expect(screen.getByRole("button", { name: "Căn giữa" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Căn dưới" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Căn trái" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Căn phải" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-horizontal-text-align", { value: 3 }]);
    fireEvent.click(screen.getByRole("button", { name: "Căn trên" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-vertical-text-align", { value: 1 }]);
    fireEvent.click(screen.getByRole("button", { name: "Ngắt dòng" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-text-wrap", { value: 1 }]);
  });

  it("turns wrap on when the mirrored cell does not wrap", () => {
    const { props, execute } = contextProps();
    mount(xlsxAlignmentRibbonItems(props), ALIGN_LABEL);
    fireEvent.click(screen.getByRole("button", { name: "Ngắt dòng" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-text-wrap", { value: 3 }]);
  });

  it("merges and centres from the primary and runs each merge command from the menu", async () => {
    const { props, execute } = contextProps();
    mount(xlsxAlignmentRibbonItems(props), ALIGN_LABEL);
    const range = [{ startRow: 1, endRow: 3, startColumn: 1, endColumn: 2 }];
    fireEvent.click(byItem("align-merge"));
    expect(execute.mock.calls).toEqual([
      ["sheet.command.add-worksheet-merge-all", { selections: range }],
      ["sheet.command.set-horizontal-text-align", { value: 2 }],
    ]);
    const menu = () => fireEvent.click(document.querySelector<HTMLElement>('[data-ribbon-split-menu="align-merge"]')!);
    menu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Gộp theo hàng" }));
    expect(lastCall(execute)).toEqual(["sheet.command.add-worksheet-merge-horizontal", { selections: range }]);
    menu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Bỏ gộp ô" }));
    expect(lastCall(execute)).toEqual(["sheet.command.remove-worksheet-merge", { ranges: range }]);
    menu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Gộp ô" }));
    expect(lastCall(execute)).toEqual(["sheet.command.add-worksheet-merge-all", { selections: range }]);
  });

  it("disables merge on a single cell and merge across on a single column", async () => {
    const single = contextProps({ selection: { sheet: "Data", address: "B2" } });
    mount(xlsxAlignmentRibbonItems(single.props), ALIGN_LABEL);
    fireEvent.click(byItem("align-merge"));
    expect(byItem("align-merge")).toHaveAttribute("aria-disabled", "true");
    expect(single.execute).not.toHaveBeenCalled();
    cleanup();

    const column = contextProps({ selection: { sheet: "Data", address: "B2", endAddress: "B4" } });
    mount(xlsxAlignmentRibbonItems(column.props), ALIGN_LABEL);
    fireEvent.click(document.querySelector<HTMLElement>('[data-ribbon-split-menu="align-merge"]')!);
    const across = await screen.findByRole("menuitem", { name: "Gộp theo hàng" });
    expect(across).toHaveAttribute("aria-disabled", "true");
  });

  it("sets a rotation angle from the picker", async () => {
    const { props, execute } = contextProps({ formatState: formatState({ textRotation: 0 }) });
    mount(xlsxAlignmentRibbonItems(props), ALIGN_LABEL);
    fireEvent.click(screen.getByRole("combobox", { name: "Xoay chữ" }));
    const angle = await screen.findByRole("option", { name: "45°" });
    fireEvent.pointerDown(angle);
    fireEvent.pointerUp(angle);
    fireEvent.click(angle);
    expect(lastCall(execute)).toEqual(["sheet.command.set-text-rotation", { value: 45 }]);
  });

  it("keeps blocked controls inert but reachable", () => {
    const { props, execute } = contextProps({ readOnly: true });
    mount(xlsxAlignmentRibbonItems(props), ALIGN_LABEL);
    const left = screen.getByRole("button", { name: "Căn trái" });
    expect(left).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(left);
    fireEvent.click(byItem("align-merge"));
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Xoay chữ" })).toBeDisabled();
  });
});
