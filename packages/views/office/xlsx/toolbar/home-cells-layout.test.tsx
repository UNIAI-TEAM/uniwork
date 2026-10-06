import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { xlsxCellsRibbonItems } from "./home-cells";
import type { XlsxToolbarGroupProps } from "./types";

const noop = () => undefined;
const props: XlsxToolbarGroupProps = {
  selection: { sheet: "Data", address: "A1" },
  canUndo: true, canRedo: true, canRecalculate: true, canFormat: true, recalculating: false,
  onUndo: noop, onRedo: noop, onNumberFormat: noop, onRecalculate: noop,
  onCut: noop, onCopy: noop, onPaste: noop, onShowSheets: noop,
  commands: { execute: () => true },
};

describe("Home > Cells layout (visual r4 R4B-6)", () => {
  it("keeps the three stacked menu rows short enough to leave the group caption room", () => {
    const items = xlsxCellsRibbonItems(props);
    expect(items.map((item) => item.id)).toEqual(["cells-insert", "cells-delete", "cells-format"]);
    render(<>{items.map((item) => (item.kind === "custom" ? <div key={item.id}>{item.render({ size: "icon", inPanel: false })}</div> : null))}</>);
    for (const id of ["cells-insert", "cells-delete", "cells-format"]) {
      const trigger = screen.getByTestId(`xlsx-${id}-trigger`);
      expect(trigger.className).toContain("h-5");
      expect(trigger.className).not.toMatch(/(^|\s)h-6(\s|$)/);
    }
  });

  it("inserts below/right through the multi-after commands with the selection counts", () => {
    const execute = vi.fn(() => true);
    const items = xlsxCellsRibbonItems({ ...props, selection: { sheet: "Data", address: "A1", endAddress: "C2" }, commands: { execute } });
    const insert = items[0]!;
    if (insert.kind !== "custom") throw new Error("expected a custom item");
    render(<div>{insert.render({ size: "icon", inPanel: false })}</div>);
    fireEvent.click(screen.getByTestId("xlsx-cells-insert-trigger"));
    fireEvent.click(screen.getByTestId("xlsx-cells-insert-rows-below"));
    expect(execute).toHaveBeenCalledWith("sheet.command.insert-multi-rows-after", { value: 2 });
    fireEvent.click(screen.getByTestId("xlsx-cells-insert-trigger"));
    fireEvent.click(screen.getByTestId("xlsx-cells-insert-cols-right"));
    expect(execute).toHaveBeenCalledWith("sheet.command.insert-multi-cols-right", { value: 3 });
  });
});
