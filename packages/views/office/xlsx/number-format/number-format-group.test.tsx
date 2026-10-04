import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XlsxNumberGroup } from "../toolbar/groups/number-group";
import { XLSX_TOOLBAR_GROUPS } from "../toolbar/registry";
import type { XlsxToolbarGroupProps } from "../toolbar/types";
import { XLSX_NUMBER_FORMAT_CATEGORIES, XLSX_NUMBER_FORMAT_COMMANDS } from "./catalog";
import { XlsxNumberFormatGroup } from "./number-format-group";

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
    fireEvent.click(screen.getByTestId("xlsx-number-format-decrease-decimals"));
    fireEvent.click(screen.getByTestId("xlsx-number-format-increase-decimals"));
    expect(execute).toHaveBeenNthCalledWith(1, XLSX_NUMBER_FORMAT_COMMANDS.decreaseDecimals, undefined);
    expect(execute).toHaveBeenNthCalledWith(2, XLSX_NUMBER_FORMAT_COMMANDS.increaseDecimals, undefined);
  });

  it("keeps both decimal steppers inert when the port raises the pinned async-handler TypeError", () => {
    const execute = vi.fn(() => {
      throw new TypeError(ASYNC_HANDLER_ERROR);
    });
    render(<XlsxNumberFormatGroup {...groupProps({ commands: { execute } })} />);
    fireEvent.click(screen.getByTestId("xlsx-number-format-increase-decimals"));
    fireEvent.click(screen.getByTestId("xlsx-number-format-decrease-decimals"));
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
      for (const testId of ["xlsx-number-format-decrease-decimals", "xlsx-number-format-increase-decimals"]) {
        expect(screen.getByTestId(testId)).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByTestId(testId)).not.toBeDisabled();
        fireEvent.click(screen.getByTestId(testId));
      }
      fireEvent.click(trigger);
      expect(screen.queryByTestId("xlsx-number-format-gallery")).not.toBeInTheDocument();
      expect(execute).not.toHaveBeenCalled();
      unmount();
    }
  });
});

describe("number group registry seam", () => {
  it("keeps the Home number entry pointing at the gallery group", () => {
    const entry = XLSX_TOOLBAR_GROUPS.find((group) => group.id === "number");
    expect(entry).toBeDefined();
    expect(entry?.tab).toBe("home");
    expect(entry?.order).toBe(40);
    expect(entry?.labelKey).toBe("office.xlsx.toolbar.groups.number");
    expect(entry?.Component).toBe(XlsxNumberGroup);
  });
});
