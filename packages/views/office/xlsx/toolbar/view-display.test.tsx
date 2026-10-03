import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { XlsxToolbarGroupProps } from "./types";
import { XlsxViewDisplayGroup } from "./view-display";

function renderGroup(overrides: Partial<XlsxToolbarGroupProps> = {}) {
  const execute = vi.fn<(id: string, params?: unknown) => boolean>(() => true);
  const props: XlsxToolbarGroupProps = {
    readOnly: false,
    selection: { sheet: "Data", address: "A1" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute },
    formatState: null,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    ...overrides,
  };
  render(<XlsxViewDisplayGroup {...props} />);
  return { execute };
}

const lastCall = (execute: ReturnType<typeof vi.fn>) => execute.mock.calls.at(-1);

describe("XlsxViewDisplayGroup", () => {
  it("toggles gridlines through the view command and mirrors the pressed state", () => {
    const { execute } = renderGroup();
    const gridlines = screen.getByRole("button", { name: "Đường lưới" });
    expect(gridlines).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(gridlines);
    expect(lastCall(execute)).toEqual(["sheet.command.toggle-gridlines", { showGridlines: 0 }]);
    expect(gridlines).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(gridlines);
    expect(lastCall(execute)).toEqual(["sheet.command.toggle-gridlines", { showGridlines: 1 }]);
    expect(gridlines).toHaveAttribute("aria-pressed", "true");
  });

  it("hides and restores both header strips through the size view commands", () => {
    const { execute } = renderGroup();
    const headers = screen.getByRole("button", { name: "Tiêu đề hàng và cột" });
    expect(headers).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(headers);
    expect(execute.mock.calls).toEqual([
      ["sheet.command.set-row-header-width", { size: 0 }],
      ["sheet.command.set-col-header-height", { size: 0 }],
    ]);
    expect(headers).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(headers);
    expect(execute.mock.calls.slice(-2)).toEqual([
      ["sheet.command.set-row-header-width", { size: 46 }],
      ["sheet.command.set-col-header-height", { size: 20 }],
    ]);
    expect(headers).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps both toggles enabled on a read-only mount", () => {
    const { execute } = renderGroup({ readOnly: true });
    const gridlines = screen.getByRole("button", { name: "Đường lưới" });
    expect(gridlines).not.toHaveAttribute("aria-disabled");
    fireEvent.click(gridlines);
    expect(lastCall(execute)).toEqual(["sheet.command.toggle-gridlines", { showGridlines: 0 }]);
  });

  it("stays enabled but inert without a renderer port", () => {
    renderGroup({ commands: undefined });
    const headers = screen.getByRole("button", { name: "Tiêu đề hàng và cột" });
    expect(headers).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(headers);
    expect(headers).toHaveAttribute("aria-pressed", "true");
  });
});
