import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { XlsxGridFormatState } from "../xlsx-grid-surface";
import type { XlsxToolbarGroupProps } from "./types";
import { XlsxFontGroup } from "./home-font";

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

function renderGroup(overrides: Partial<XlsxToolbarGroupProps> = {}) {
  const execute = vi.fn(() => true);
  const props: XlsxToolbarGroupProps = {
    readOnly: false,
    selection: { sheet: "Data", address: "A1" },
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
  render(<XlsxFontGroup {...props} />);
  return { execute };
}

const lastCall = (execute: ReturnType<typeof vi.fn>) => execute.mock.calls.at(-1);

describe("XlsxFontGroup", () => {
  it("fires the four style toggles and mirrors the active style", () => {
    const { execute } = renderGroup({ formatState: formatState({ bold: true }) });
    expect(screen.getByRole("button", { name: "In đậm" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "In nghiêng" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "In nghiêng" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-italic", undefined]);
    fireEvent.click(screen.getByRole("button", { name: "Gạch chân" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-underline", undefined]);
    fireEvent.click(screen.getByRole("button", { name: "Gạch ngang" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-stroke", undefined]);
  });

  it("steps and clamps the font size from the mirrored value", () => {
    const { execute } = renderGroup({ formatState: formatState({ fontSize: 14 }) });
    fireEvent.click(screen.getByRole("button", { name: "Tăng cỡ chữ" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-font-size", { value: 15 }]);
    fireEvent.click(screen.getByRole("button", { name: "Giảm cỡ chữ" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-font-size", { value: 13 }]);
  });

  it("commits a typed size once, clamped, and restores an invalid draft", () => {
    const { execute } = renderGroup({ formatState: formatState({ fontSize: 14 }) });
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
    const { execute } = renderGroup({ formatState: formatState({ fontFamily: "Calibri" }) });
    fireEvent.click(screen.getByRole("combobox", { name: "Phông chữ" }));
    fireEvent.click(await screen.findByRole("option", { name: "Verdana" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-font-family", { value: "Verdana" }]);
  });

  it("applies text and fill colours from the palette and resets them", async () => {
    const { execute } = renderGroup({ formatState: formatState({ textColor: "#C00000" }) });
    fireEvent.click(screen.getByRole("button", { name: "Màu chữ" }));
    const textDialog = await screen.findByRole("dialog", { name: "Màu chữ" });
    expect(within(textDialog).getByRole("button", { name: "Màu #C00000" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(textDialog).getByRole("button", { name: "Màu #FF0000" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-text-color", { value: "#FF0000" }]);
    fireEvent.click(within(textDialog).getByRole("button", { name: "Tự động" }));
    expect(lastCall(execute)).toEqual(["sheet.command.reset-text-color", undefined]);

    fireEvent.click(screen.getByRole("button", { name: "Màu tô" }));
    const fillDialog = await screen.findByRole("dialog", { name: "Màu tô" });
    fireEvent.click(within(fillDialog).getByRole("button", { name: "Màu #FFFF00" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-background-color", { value: "#FFFF00" }]);
    fireEvent.click(within(fillDialog).getByRole("button", { name: "Không tô" }));
    expect(lastCall(execute)).toEqual(["sheet.command.reset-background-color", undefined]);
  });

  it("keeps read-only controls inert but reachable", () => {
    const { execute } = renderGroup({ readOnly: true });
    const bold = screen.getByRole("button", { name: "In đậm" });
    expect(bold).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(bold);
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Phông chữ" })).toBeDisabled();
  });

  it("disables the controls while the grid cannot format yet", () => {
    const { execute } = renderGroup({ canFormat: false });
    const italic = screen.getByRole("button", { name: "In nghiêng" });
    expect(italic).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(italic);
    expect(execute).not.toHaveBeenCalled();
  });

  it("stays inert when the host does not supply the commands port", () => {
    const { execute } = renderGroup({ commands: undefined });
    const bold = screen.getByRole("button", { name: "In đậm" });
    expect(bold).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(bold);
    expect(execute).not.toHaveBeenCalled();
  });
});
