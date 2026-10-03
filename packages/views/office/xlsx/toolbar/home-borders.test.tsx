import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { XlsxToolbarGroupProps } from "./types";
import { XlsxBordersGroup } from "./home-borders";

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
  render(<XlsxBordersGroup {...props} />);
  return { execute };
}

const lastCall = (execute: ReturnType<typeof vi.fn>) => execute.mock.calls.at(-1);
const BORDER = { style: 1, color: "#000000" };

describe("XlsxBordersGroup", () => {
  it("applies every preset and edge through set-border-basic", async () => {
    const { execute } = renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Đường viền" }));
    const dialog = await screen.findByRole("dialog", { name: "Đường viền" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tất cả" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-border-basic", { value: { type: "all", ...BORDER } }]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Viền ngoài" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-border-basic", { value: { type: "outside", ...BORDER } }]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Không viền" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-border-basic", { value: { type: "none", ...BORDER } }]);
    for (const [label, type] of [["Trên", "top"], ["Phải", "right"], ["Dưới", "bottom"], ["Trái", "left"]] as const) {
      fireEvent.click(within(dialog).getByRole("button", { name: label }));
      expect(lastCall(execute)).toEqual(["sheet.command.set-border-basic", { value: { type, ...BORDER } }]);
    }
    expect(execute).toHaveBeenCalledTimes(7);
  });

  it("keeps the picker closed and inert while blocked", () => {
    const { execute } = renderGroup({ readOnly: true });
    const trigger = screen.getByRole("button", { name: "Đường viền" });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog", { name: "Đường viền" })).not.toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
  });

  it("stays inert while the grid cannot format yet", () => {
    const { execute } = renderGroup({ canFormat: false });
    fireEvent.click(screen.getByRole("button", { name: "Đường viền" }));
    expect(execute).not.toHaveBeenCalled();
  });
});
