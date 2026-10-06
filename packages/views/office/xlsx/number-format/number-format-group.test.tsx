import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OfficeRibbon } from "../../ribbon";
import { XLSX_TOOLBAR_GROUPS } from "../toolbar/registry";
import type { XlsxToolbarGroupProps } from "../toolbar/types";
import { XLSX_NUMBER_FORMAT_CATEGORIES, XLSX_NUMBER_FORMAT_COMMANDS } from "./catalog";
import { xlsxNumberRibbonItems } from "./number-format-group";

/** Mounts the Home number items in the shared ribbon, as the XLSX toolbar does. */
function XlsxNumberFormatGroup(props: XlsxToolbarGroupProps) {
  return (
    <OfficeRibbon
      scope="xlsx-number-test"
      activeTabId="home"
      tabs={[{ id: "home", labelKey: "Home", groups: [{ id: "number", labelKey: "Number", priority: 0, items: xlsxNumberRibbonItems(props) }] }]}
    />
  );
}

function ribbonItem(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-ribbon-item='${id}']`)!;
}

const ASYNC_HANDLER_ERROR = "[CommandService]: Command handler should not return a promise.";

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    permissions: {},
    selection: { sheet: "Data", address: "B2" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute: vi.fn(() => true) },
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    ...overrides,
  };
}

async function openGallery() {
  fireEvent.click(screen.getByTestId("xlsx-number-format-trigger"));
  return screen.findByTestId("xlsx-number-format-gallery");
}

const ALL_PRESETS = XLSX_NUMBER_FORMAT_CATEGORIES.flatMap((category) => category.presets);

describe("XlsxNumberFormatGroup", () => {
  it("renders every category and preset and closes the gallery after applying one", async () => {
    const props = groupProps();
    render(<XlsxNumberFormatGroup {...props} />);
    expect(screen.getByRole("button", { name: "Định dạng số" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tăng số chữ số thập phân" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Giảm số chữ số thập phân" })).toBeInTheDocument();

    const gallery = await openGallery();
    for (const category of XLSX_NUMBER_FORMAT_CATEGORIES) {
      const section = within(gallery).getByTestId(`xlsx-number-format-category-${category.id}`);
      for (const preset of category.presets) {
        expect(within(section).getByTestId(`xlsx-number-format-preset-${preset.id}`)).toBeInTheDocument();
      }
    }

    fireEvent.click(within(gallery).getByTestId("xlsx-number-format-preset-number-decimal2"));
    expect(props.commands?.execute).toHaveBeenCalledWith(XLSX_NUMBER_FORMAT_COMMANDS.set, {
      values: [{ row: 1, col: 1, pattern: "0.00" }],
    });
    expect(screen.queryByTestId("xlsx-number-format-gallery")).not.toBeInTheDocument();
  });

  it("applies every preset to the whole selection through the pinned set command", async () => {
    const execute = vi.fn(() => true);
    render(
      <XlsxNumberFormatGroup
        {...groupProps({
          selection: { sheet: "Data", address: "C1", endAddress: "D2" },
          commands: { execute },
        })}
      />,
    );
    for (const preset of ALL_PRESETS) {
      const gallery = await openGallery();
      fireEvent.click(within(gallery).getByTestId(`xlsx-number-format-preset-${preset.id}`));
    }
    const valuesFor = (pattern: string) => ({
      values: [
        { row: 0, col: 2, pattern },
        { row: 0, col: 3, pattern },
        { row: 1, col: 2, pattern },
        { row: 1, col: 3, pattern },
      ],
    });
    expect(execute).toHaveBeenCalledTimes(ALL_PRESETS.length);
    ALL_PRESETS.forEach((preset, index) => {
      expect(execute).toHaveBeenNthCalledWith(index + 1, XLSX_NUMBER_FORMAT_COMMANDS.set, valuesFor(preset.pattern));
    });
  });

  it("fires the pinned increase/decrease-decimal commands", () => {
    const execute = vi.fn(() => true);
    render(<XlsxNumberFormatGroup {...groupProps({ commands: { execute } })} />);
    fireEvent.click(ribbonItem("number-decrease-decimals"));
    fireEvent.click(ribbonItem("number-increase-decimals"));
    expect(execute).toHaveBeenNthCalledWith(1, XLSX_NUMBER_FORMAT_COMMANDS.decreaseDecimals);
    expect(execute).toHaveBeenNthCalledWith(2, XLSX_NUMBER_FORMAT_COMMANDS.increaseDecimals);
  });

  it("keeps both decimal steppers inert when the port raises the pinned async-handler TypeError", () => {
    const execute = vi.fn(() => {
      throw new TypeError(ASYNC_HANDLER_ERROR);
    });
    render(<XlsxNumberFormatGroup {...groupProps({ commands: { execute } })} />);
    fireEvent.click(ribbonItem("number-increase-decimals"));
    fireEvent.click(ribbonItem("number-decrease-decimals"));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("applies a valid custom code, and refuses empty or over-long entries", async () => {
    const execute = vi.fn(() => true);
    render(<XlsxNumberFormatGroup {...groupProps({ commands: { execute } })} />);

    let gallery = await openGallery();
    fireEvent.change(within(gallery).getByTestId("xlsx-number-format-custom-input"), {
      target: { value: "  #,##0.000  " },
    });
    fireEvent.click(within(gallery).getByTestId("xlsx-number-format-custom-apply"));
    expect(execute).toHaveBeenCalledWith(XLSX_NUMBER_FORMAT_COMMANDS.set, {
      values: [{ row: 1, col: 1, pattern: "#,##0.000" }],
    });
    expect(screen.queryByTestId("xlsx-number-format-gallery")).not.toBeInTheDocument();

    gallery = await openGallery();
    // The applied draft stays in the field, so clear it to exercise the empty refusal.
    fireEvent.change(within(gallery).getByTestId("xlsx-number-format-custom-input"), { target: { value: "   " } });
    fireEvent.click(within(gallery).getByTestId("xlsx-number-format-custom-apply"));
    expect(within(gallery).getByTestId("xlsx-number-format-custom-error")).toHaveTextContent("Nhập mã định dạng.");
    expect(within(gallery).getByTestId("xlsx-number-format-custom-input")).toHaveAttribute("aria-invalid", "true");
    expect(execute).toHaveBeenCalledTimes(1);

    fireEvent.change(within(gallery).getByTestId("xlsx-number-format-custom-input"), {
      target: { value: "0".repeat(256) },
    });
    fireEvent.click(within(gallery).getByTestId("xlsx-number-format-custom-apply"));
    expect(within(gallery).getByTestId("xlsx-number-format-custom-error")).toHaveTextContent(
      "Mã định dạng tối đa 255 ký tự.",
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("submits the custom code with Enter", async () => {
    const execute = vi.fn(() => true);
    render(<XlsxNumberFormatGroup {...groupProps({ commands: { execute } })} />);
    const gallery = await openGallery();
    const input = within(gallery).getByTestId("xlsx-number-format-custom-input");
    fireEvent.change(input, { target: { value: "0.0000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(execute).toHaveBeenCalledWith(XLSX_NUMBER_FORMAT_COMMANDS.set, {
      values: [{ row: 1, col: 1, pattern: "0.0000" }],
    });
    expect(screen.queryByTestId("xlsx-number-format-gallery")).not.toBeInTheDocument();
  });

  it("keeps every control rendered, aria-disabled and inert when blocked", () => {
    const execute = vi.fn(() => true);
    const cases: Array<Partial<XlsxToolbarGroupProps>> = [
      { readOnly: true },
      { selection: null },
      { commands: undefined },
      { canFormat: false },
      { selection: { sheet: "Data", address: "nope" } },
      { selection: { sheet: "Data", address: "A1", endAddress: "CV1001" } },
    ];
    for (const overrides of cases) {
      const { unmount } = render(<XlsxNumberFormatGroup {...groupProps({ commands: { execute }, ...overrides })} />);
      const trigger = screen.getByTestId("xlsx-number-format-trigger");
      expect(trigger).toHaveAttribute("aria-disabled", "true");
      expect(trigger).not.toBeDisabled();
      for (const id of ["number-decrease-decimals", "number-increase-decimals", "number-currency", "number-percent", "number-comma"]) {
        expect(ribbonItem(id)).toHaveAttribute("aria-disabled", "true");
        expect(ribbonItem(id)).not.toBeDisabled();
        fireEvent.click(ribbonItem(id));
      }
      fireEvent.click(trigger);
      expect(screen.queryByTestId("xlsx-number-format-gallery")).not.toBeInTheDocument();
      expect(execute).not.toHaveBeenCalled();
      unmount();
    }
  });
});

describe("number quick formats", () => {
  it("applies the Currency, Percent and Comma catalog presets to the whole selection", () => {
    const execute = vi.fn(() => true);
    render(<XlsxNumberFormatGroup {...groupProps({ selection: { sheet: "Data", address: "C1", endAddress: "C2" }, commands: { execute } })} />);
    fireEvent.click(ribbonItem("number-currency"));
    fireEvent.click(ribbonItem("number-percent"));
    fireEvent.click(ribbonItem("number-comma"));
    const valuesFor = (pattern: string) => ({
      values: [
        { row: 0, col: 2, pattern },
        { row: 1, col: 2, pattern },
      ],
    });
    expect(execute).toHaveBeenNthCalledWith(1, XLSX_NUMBER_FORMAT_COMMANDS.set, valuesFor('"$"#,##0.00'));
    expect(execute).toHaveBeenNthCalledWith(2, XLSX_NUMBER_FORMAT_COMMANDS.set, valuesFor("0%"));
    expect(execute).toHaveBeenNthCalledWith(3, XLSX_NUMBER_FORMAT_COMMANDS.set, valuesFor("#,##0.00"));
  });

  it("shows General, then the last applied format name while the same cell stays selected", async () => {
    render(<XlsxNumberFormatGroup {...groupProps({ unitId: "file-name-test", selection: { sheet: "Data", address: "F6" } })} />);
    const trigger = screen.getByTestId("xlsx-number-format-trigger");
    expect(trigger).toHaveTextContent("Chung");
    fireEvent.click(ribbonItem("number-percent"));
    await waitFor(() => expect(trigger).toHaveTextContent("Phần trăm"));
  });

  it("reads the opened file's own format for the selected cell (reopen after save)", async () => {
    const host = {
      file: { sessionId: "s1", sheets: [{ id: "sh1", name: "Data" }], styles: [{ numberFormat: undefined }, { numberFormat: "0%" }] },
      readRange: vi.fn(async () => ({ cells: [{ row: 1, column: 1, value: 0.5, styleIndex: 1 }] })),
    } as unknown as NonNullable<XlsxToolbarGroupProps["host"]>;
    render(<XlsxNumberFormatGroup {...groupProps({ host, unitId: "file-reopen", selection: { sheet: "Data", address: "B2" } })} />);
    await waitFor(() => expect(screen.getByTestId("xlsx-number-format-trigger")).toHaveTextContent("Phần trăm"));
    expect(host.readRange).toHaveBeenCalledWith({ sessionId: "s1", sheetId: "sh1", range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 } });
  });

  it("keeps General for a file cell without a number format", async () => {
    const host = {
      file: { sessionId: "s1", sheets: [{ id: "sh1", name: "Data" }], styles: [{ numberFormat: "General" }] },
      readRange: vi.fn(async () => ({ cells: [{ row: 1, column: 1, value: 1, styleIndex: 0 }] })),
    } as unknown as NonNullable<XlsxToolbarGroupProps["host"]>;
    render(<XlsxNumberFormatGroup {...groupProps({ host, unitId: "file-reopen-2", selection: { sheet: "Data", address: "B2" } })} />);
    await waitFor(() => expect(host.readRange).toHaveBeenCalled());
    expect(screen.getByTestId("xlsx-number-format-trigger")).toHaveTextContent("Chung");
  });

  it("reads General again for a different selection", () => {
    render(<XlsxNumberFormatGroup {...groupProps({ unitId: "file-name-test-2", selection: { sheet: "Data", address: "G7" } })} />);
    fireEvent.click(ribbonItem("number-currency"));
    cleanup();
    render(<XlsxNumberFormatGroup {...groupProps({ unitId: "file-name-test-2", selection: { sheet: "Data", address: "H8" } })} />);
    expect(screen.getByTestId("xlsx-number-format-trigger")).toHaveTextContent("Chung");
  });
});

describe("number format picker width", () => {
  it("spells the picker width on the spacing scale, not an arbitrary pixel value", () => {
    render(<XlsxNumberFormatGroup {...groupProps()} />);
    // w-29 = 29 * 0.25rem = 116px, the width the picker opened with.
    const trigger = screen.getByTestId("xlsx-number-format-trigger");
    expect(trigger.className).toContain("w-29");
    expect(trigger.className).not.toContain("w-[116px]");
  });
});

describe("number group registry seam", () => {
  it("keeps the Home number entry on typed ribbon items", () => {
    const entry = XLSX_TOOLBAR_GROUPS.find((group) => group.id === "number");
    expect(entry).toBeDefined();
    expect(entry?.tab).toBe("home");
    expect(entry?.order).toBe(70);
    expect(entry?.labelKey).toBe("office.xlsx.toolbar.groups.number");
    expect(entry?.ribbonItems).toBe(xlsxNumberRibbonItems);
  });
});
