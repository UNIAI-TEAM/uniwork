import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XLSX_TOOLBAR_GROUPS } from "../registry";
import type { XlsxToolbarGroupProps } from "../types";
import { OfficeRibbon } from "../../../ribbon";
import { xlsxEditingRibbonItems } from "./clear-group";

const CLEAR_COMMANDS = [
  { key: "content", command: "sheet.command.clear-selection-content" },
  { key: "format", command: "sheet.command.clear-selection-format" },
  { key: "all", command: "sheet.command.clear-selection-all" },
] as const;

const OWNED_SUBTREES = ["clear", "painter"] as const;

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
  const props = groupProps({ commands: { execute }, ...overrides });
  render(
    <OfficeRibbon
      scope="xlsx-editing-test"
      activeTabId="home"
      tabs={[{ id: "home", labelKey: "Home", groups: [{ id: "editing", labelKey: "Editing", priority: 0, items: xlsxEditingRibbonItems(props) }] }]}
    />,
  );
  return { execute };
}

function trigger(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-ribbon-item='editing-clear']")!;
}

describe("xlsxEditingRibbonItems", () => {
  it("fires each clear variant from the dropdown", async () => {
    const { execute } = renderGroup();
    expect(trigger()).toHaveTextContent(text("office.xlsx.toolbar.groups.clear.label"));

    for (const { key, command } of CLEAR_COMMANDS) {
      fireEvent.click(trigger());
      const item = await waitFor(() => {
        const found = document.querySelector<HTMLElement>(`[data-ribbon-menu-entry='editing-clear-${key}']`);
        expect(found).not.toBeNull();
        return found!;
      });
      expect(item).toHaveTextContent(text(`office.xlsx.toolbar.groups.clear.${key}`));
      fireEvent.click(item);
      expect(execute).toHaveBeenLastCalledWith(command);
    }
    expect(execute).toHaveBeenCalledTimes(CLEAR_COMMANDS.length);
  });

  it("stays inert while read-only, without a selection format and without a port", () => {
    for (const overrides of [{ readOnly: true }, { canFormat: false, selection: null }, { commands: undefined }]) {
      const { execute } = renderGroup(overrides);
      expect(trigger()).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(trigger());
      expect(document.querySelector("[data-ribbon-menu-entry]")).toBeNull();
      expect(execute).not.toHaveBeenCalled();
      cleanup();
    }
  });
});

describe("xlsx clear + painter registry entries", () => {
  it("registers Editing on the Home tab and keeps the Clipboard group that hosts the painter", () => {
    for (const id of ["editing", "clipboard"]) {
      const group = XLSX_TOOLBAR_GROUPS.find((candidate) => candidate.id === id);
      if (!group) throw new Error(`missing registry group ${id}`);
      expect(group.tab).toBe("home");
      expect(typeof group.ribbonItems).toBe("function");
    }
    expect(XLSX_TOOLBAR_GROUPS.some((candidate) => candidate.id === "painter" || candidate.id === "clear")).toBe(false);
  });

  it("keeps the clear and painter label subtrees in both locales and in key parity", () => {
    for (const id of OWNED_SUBTREES) {
      const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, `office.xlsx.toolbar.groups.${id}`));
      expect(subtree(viLocale).length).toBeGreaterThan(0);
      expect(subtree(viLocale)).toEqual(subtree(en));
    }
  });
});
