import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxCfPreset } from "./cf-commands";
import { XlsxConditionalFormatDialog } from "./conditional-format-dialog";

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

function stringPaths(dictionary: unknown): string[] {
  const paths: string[] = [];
  const walk = (node: unknown, prefix: string) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") paths.push(path);
      else walk(value, path);
    }
  };
  walk(dictionary, "");
  return paths.sort();
}

const range = { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 };
const STYLE = { bg: { rgb: "#FFC7CE" }, cl: { rgb: "#9C0006" } };

function renderDialog(preset: XlsxCfPreset, readOnly = false, result: boolean | Promise<boolean> = true) {
  const execute = vi.fn((_id: string, _params?: unknown) => result);
  const onClose = vi.fn();
  const view = render(
    <XlsxConditionalFormatDialog
      preset={preset}
      unitId="file-abc"
      subUnitId="sheet-1"
      range={range}
      commands={{ execute }}
      readOnly={readOnly}
      onClose={onClose}
    />,
  );
  return { execute, onClose, unmount: view.unmount };
}

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe("XlsxConditionalFormatDialog", () => {
  it("fires the greater-than rule and closes", async () => {
    const { execute, onClose } = renderDialog("greaterThan");
    expect(screen.getByRole("dialog")).toHaveAccessibleName(lookup(viLocale, "office.xlsx.conditionalFormat.titles.greaterThan") as string);
    type("xlsx-cf-first", "10");
    fireEvent.click(screen.getByTestId("xlsx-cf-ok"));
    expect(execute).toHaveBeenCalledWith("sheet.command.add-conditional-rule", {
      unitId: "file-abc",
      subUnitId: "sheet-1",
      rule: {
        cfId: expect.stringMatching(/^uw-cf-/),
        ranges: [range],
        stopIfTrue: false,
        rule: { type: "highlightCell", subType: "number", operator: "greaterThan", value: 10, style: STYLE },
      },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("fires less-than, between, text and duplicate rules", () => {
    for (const [preset, inputs, expected] of [
      ["lessThan", { "xlsx-cf-first": "2" }, { subType: "number", operator: "lessThan", value: 2 }],
      ["between", { "xlsx-cf-first": "1", "xlsx-cf-second": "5" }, { subType: "number", operator: "between", value: [1, 5] }],
      ["containsText", { "xlsx-cf-first": "abc" }, { subType: "text", operator: "containsText", value: "abc" }],
      ["duplicateValues", {}, { subType: "duplicateValues" }],
      ["uniqueValues", {}, { subType: "uniqueValues" }],
    ] as [XlsxCfPreset, Record<string, string>, Record<string, unknown>][]) {
      const { execute, unmount } = renderDialog(preset);
      for (const [id, value] of Object.entries(inputs)) type(id, value);
      fireEvent.click(screen.getByTestId("xlsx-cf-ok"));
      expect(execute).toHaveBeenCalledOnce();
      const params = execute.mock.calls[0]![1] as { rule: { rule: unknown } };
      expect(params.rule.rule).toEqual({ type: "highlightCell", ...expected, style: STYLE });
      unmount();
    }
  });

  it("shows an inline alert for bad input and fires nothing", () => {
    for (const [preset, inputs, message] of [
      ["greaterThan", { "xlsx-cf-first": "abc" }, "invalidNumber"],
      ["between", { "xlsx-cf-first": "9", "xlsx-cf-second": "1" }, "invalidRange"],
      ["containsText", { "xlsx-cf-first": "" }, "emptyText"],
      ["containsText", { "xlsx-cf-first": "x".repeat(256) }, "textTooLong"],
    ] as [XlsxCfPreset, Record<string, string>, string][]) {
      const { execute, onClose, unmount } = renderDialog(preset);
      for (const [id, value] of Object.entries(inputs)) type(id, value);
      fireEvent.click(screen.getByTestId("xlsx-cf-ok"));
      expect(screen.getByRole("alert")).toHaveTextContent(lookup(viLocale, `office.xlsx.conditionalFormat.errors.${message}`) as string);
      expect(execute).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("is inert when read-only and closes on cancel", () => {
    const { execute, onClose } = renderDialog("duplicateValues", true);
    const ok = screen.getByTestId("xlsx-cf-ok");
    expect(ok).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(ok);
    expect(execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("xlsx-cf-cancel"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the conditionalFormat locale subtree in vi/en parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.conditionalFormat"));
    expect(subtree(viLocale).length).toBeGreaterThan(0);
    expect(subtree(viLocale)).toEqual(subtree(en));
  });

  it.each([
    ["false", false],
    ["async false", Promise.resolve(false)],
  ])("stays open with a refused alert when the command returns %s, and retries", async (_name, result) => {
    const { execute, onClose } = renderDialog("greaterThan", false, result);
    type("xlsx-cf-first", "10");
    fireEvent.click(screen.getByTestId("xlsx-cf-ok"));
    expect(await screen.findByRole("alert")).toHaveTextContent(lookup(viLocale, "office.xlsx.conditionalFormat.errors.refused") as string);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("xlsx-cf-ok"));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(onClose).not.toHaveBeenCalled();
    type("xlsx-cf-first", "11");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes when the command resolves true asynchronously", async () => {
    const { onClose } = renderDialog("duplicateValues", false, Promise.resolve(true));
    fireEvent.click(screen.getByTestId("xlsx-cf-ok"));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("gives its fields unique DOM ids so two dialogs never collide", () => {
    const first = renderDialog("between");
    const ids = [screen.getByTestId("xlsx-cf-first").id, screen.getByTestId("xlsx-cf-second").id];
    expect(ids.every((id) => id.length > 0 && !id.startsWith("xlsx-cf-"))).toBe(true);
    expect(screen.getByLabelText(lookup(viLocale, "office.xlsx.conditionalFormat.dialog.minimum") as string)).toBe(screen.getByTestId("xlsx-cf-first"));
    first.unmount();
  });

  it("replaces the rule in place in edit mode, keeping its areas, flag and an unknown format", async () => {
    const execute = vi.fn((_id: string, _params?: unknown) => true);
    const onClose = vi.fn();
    const style = { bg: { rgb: "#123456" } };
    render(
      <XlsxConditionalFormatDialog
        preset="between"
        unitId="file-abc"
        subUnitId="sheet-1"
        range={range}
        commands={{ execute }}
        edit={{
          cfId: "cf-9",
          ranges: [range, { startRow: 7, endRow: 7, startColumn: 4, endColumn: 4 }],
          stopIfTrue: true,
          initial: { preset: "between", first: "1", second: "5", styleId: null, style },
        }}
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId("xlsx-cf-first")).toHaveValue("1");
    type("xlsx-cf-second", "8");
    fireEvent.click(screen.getByTestId("xlsx-cf-ok"));
    expect(execute).toHaveBeenCalledWith("sheet.command.set-conditional-rule", {
      unitId: "file-abc",
      subUnitId: "sheet-1",
      cfId: "cf-9",
      rule: {
        cfId: "cf-9",
        ranges: [range, { startRow: 7, endRow: 7, startColumn: 4, endColumn: 4 }],
        stopIfTrue: true,
        rule: { type: "highlightCell", subType: "number", operator: "between", value: [1, 8], style },
      },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("does not repeat the Unique Values title as a field label", () => {
    renderDialog("uniqueValues");
    const title = screen.getByRole("heading", { name: "Giá trị duy nhất" });
    expect(title).toBeInTheDocument();
    const kind = screen.getByTestId("xlsx-cf-duplicate-kind");
    expect(kind.textContent).not.toBe("Giá trị duy nhất");
    expect(kind.textContent).toBe(lookup(viLocale, "office.xlsx.conditionalFormat.dialog.uniqueHint"));
  });
});
