import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XLSX_TOOLBAR_GROUPS } from "../toolbar/registry";
import { XLSX_SHORTCUTS } from "./catalog";
import { XlsxShortcutsDialog } from "./shortcuts-dialog";

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

function viText(key: string): string {
  const value = lookup(viLocale, key);
  if (typeof value !== "string") throw new Error(`missing vi locale key ${key}`);
  return value;
}

describe("XlsxShortcutsDialog", () => {
  it("lists every catalog entry grouped by category", () => {
    render(<XlsxShortcutsDialog onClose={vi.fn()} />);
    expect(screen.getByTestId("xlsx-shortcuts")).toBeInTheDocument();
    for (const entry of XLSX_SHORTCUTS) {
      expect(screen.getByTestId(`xlsx-shortcut-${entry.id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("xlsx-shortcuts-general")).toBeInTheDocument();
    expect(screen.getByTestId("xlsx-shortcuts-navigation")).toBeInTheDocument();
  });

  it("filters the list as the user types and shows an empty state", () => {
    render(<XlsxShortcutsDialog onClose={vi.fn()} />);
    const search = screen.getByTestId("xlsx-shortcuts-search");
    fireEvent.change(search, { target: { value: viText("office.xlsx.shortcuts.items.paste") } });
    expect(screen.getByTestId("xlsx-shortcut-paste")).toBeInTheDocument();
    expect(screen.queryByTestId("xlsx-shortcut-bold")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "zzzzz" } });
    expect(screen.getByTestId("xlsx-shortcuts-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("xlsx-shortcut-paste")).not.toBeInTheDocument();
  });

  it("closes on Escape through the dialog's onOpenChange", () => {
    const onClose = vi.fn();
    render(<XlsxShortcutsDialog onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId("xlsx-shortcuts"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("xlsx view shortcuts registry entry", () => {
  it("registers the group on the View tab with a label in both locales", () => {
    const group = XLSX_TOOLBAR_GROUPS.find((candidate) => candidate.id === "view-shortcuts");
    if (!group) throw new Error("missing registry group view-shortcuts");
    expect(group.tab).toBe("view");
    expect(group.order).toBe(50);
    expect(group.labelKey).toBe("office.xlsx.toolbar.groups.view.shortcuts.label");
    for (const locale of [en, viLocale]) {
      expect(typeof lookup(locale, group.labelKey)).toBe("string");
    }
  });
});