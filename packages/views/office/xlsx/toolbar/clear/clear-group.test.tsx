import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XLSX_TOOLBAR_GROUPS } from "../registry";
import type { XlsxToolbarGroupProps } from "../types";
import { XlsxClearGroup } from "./clear-group";

const CLEAR_COMMANDS = [
  { key: "content", command: "sheet.command.clear-selection-content" },
  { key: "format", command: "sheet.command.clear-selection-format" },
  { key: "all", command: "sheet.command.clear-selection-all" },
] as const;

const OWNED_GROUPS = [
  { id: "clear", order: 85, keyPrefix: "clear" },
  { id: "painter", order: 90, keyPrefix: "painter" },
] as const;

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

function text(key: string): string {
  const value = lookup(viLocale, key);
  if (typeof value !== "string") throw new Error(`missing vi locale key ${key}`);
  return value;
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

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    selection: { sheet: "Data", address: "A1" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
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
}

function renderGroup(overrides: Partial<XlsxToolbarGroupProps> = {}) {
  const execute = vi.fn(() => true);
  render(<XlsxClearGroup {...groupProps({ commands: { execute }, ...overrides })} />);
  return { execute };
}

describe("XlsxClearGroup", () => {
  it("fires each clear variant from the dropdown and closes it", async () => {
    const { execute } = renderGroup();
    const trigger = screen.getByTestId("xlsx-clear-trigger");
    expect(trigger).toHaveAccessibleName(text("office.xlsx.toolbar.groups.clear.label"));

    for (const { key, command } of CLEAR_COMMANDS) {
      fireEvent.click(trigger);
      const item = await screen.findByTestId(`xlsx-clear-${key}`);
      expect(item).toHaveTextContent(text(`office.xlsx.toolbar.groups.clear.${key}`));
      fireEvent.click(item);
      expect(execute).toHaveBeenLastCalledWith(command);
      expect(screen.queryByTestId("xlsx-clear-menu")).not.toBeInTheDocument();
    }
    expect(execute).toHaveBeenCalledTimes(CLEAR_COMMANDS.length);
  });

  it("stays closed and inert while read-only", () => {
    const { execute } = renderGroup({ readOnly: true });
    const trigger = screen.getByTestId("xlsx-clear-trigger");
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(trigger);
    expect(screen.queryByTestId("xlsx-clear-menu")).not.toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
  });

  it("stays inert without a selection", () => {
    const { execute } = renderGroup({ canFormat: false, selection: null });
    fireEvent.click(screen.getByTestId("xlsx-clear-trigger"));
    expect(execute).not.toHaveBeenCalled();
    expect(screen.queryByTestId("xlsx-clear-menu")).not.toBeInTheDocument();
  });

  it("stays inert without a command port", () => {
    renderGroup({ commands: undefined });
    fireEvent.click(screen.getByTestId("xlsx-clear-trigger"));
    expect(screen.queryByTestId("xlsx-clear-menu")).not.toBeInTheDocument();
  });
});

describe("xlsx clear + painter registry entries", () => {
  it("registers both groups on the Home tab with labels in both locales", () => {
    for (const expected of OWNED_GROUPS) {
      const group = XLSX_TOOLBAR_GROUPS.find((candidate) => candidate.id === expected.id);
      if (!group) throw new Error(`missing registry group ${expected.id}`);
      expect(group.tab).toBe("home");
      expect(group.order).toBe(expected.order);
      expect(group.labelKey).toBe(`office.xlsx.toolbar.groups.${expected.keyPrefix}.label`);
      for (const locale of [en, viLocale]) {
        expect(typeof lookup(locale, group.labelKey), `${expected.id} ${group.labelKey}`).toBe("string");
      }
    }
  });

  it("keeps the clear and painter subtrees in vi/en key parity", () => {
    for (const id of OWNED_GROUPS.map((group) => group.id)) {
      const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, `office.xlsx.toolbar.groups.${id}`));
      expect(subtree(viLocale).length).toBeGreaterThan(0);
      expect(subtree(viLocale)).toEqual(subtree(en));
    }
  });
});
