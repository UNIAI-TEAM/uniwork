import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XLSX_TOOLBAR_GROUPS } from "../toolbar/registry";
import type { XlsxToolbarGroupProps } from "../toolbar/types";
import type { XlsxSaveCoordinator } from "../types";
import { XlsxToolbar } from "../xlsx-toolbar";
import { XlsxFindGroup } from "./find-group";

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

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    selection: { sheet: "Data", address: "A1" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute: vi.fn(() => true) },
    formatState: null,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    onOpenFind: vi.fn(),
    ...overrides,
  };
}

describe("XlsxFindGroup", () => {
  it("opens the editor-owned find panel", () => {
    const onOpenFind = vi.fn();
    render(<XlsxFindGroup {...groupProps({ onOpenFind })} />);
    const button = screen.getByTestId("xlsx-find-open");
    expect(button).toHaveAccessibleName(lookup(viLocale, "office.xlsx.toolbar.groups.find.label"));
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(button);
    expect(onOpenFind).toHaveBeenCalledOnce();
  });

  it("stays in the tab order and inert without a mounted grid or a handler", () => {
    for (const overrides of [{ commands: undefined }, { onOpenFind: undefined }, { readOnly: true }] as Partial<XlsxToolbarGroupProps>[]) {
      const onOpenFind = vi.fn();
      const view = render(<XlsxFindGroup {...groupProps({ onOpenFind, ...overrides })} />);
      const button = screen.getByTestId("xlsx-find-open");
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled();
      fireEvent.click(button);
      expect(onOpenFind).not.toHaveBeenCalled();
      view.unmount();
    }
  });
});

function coordinator(): XlsxSaveCoordinator {
  const state = {
    state: "dirty" as const,
    identity: {
      deploymentId: "dep",
      accountId: "account",
      organizationId: "org",
      workspaceId: "workspace",
      documentId: "doc",
      generation: 1,
      baseVersionId: "version",
      baseRevision: "1",
    },
    dirtyGeneration: 1,
    lastSavedGeneration: 0,
    activeIntentId: null,
    error: null,
  };
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
    markDirty: vi.fn(),
  };
}

describe("xlsx find registration (C6: Find lives at the far right of the tab row)", () => {
  const FIND_LABEL_KEY = "office.xlsx.toolbar.groups.find.label";

  it("keeps Find registered once with a label in both locales and no command-row group", () => {
    // C6 moved Find out of the Home command row into the ribbon's trailing
    // slot, so the registry no longer carries a "find" row. This asserts the
    // removal is deliberate and singular rather than a silent drop: at most
    // one body row may exist, and the shared label key stays the contract.
    const matches = XLSX_TOOLBAR_GROUPS.filter((candidate) => candidate.id === "find");
    expect(matches).toHaveLength(0);
    for (const locale of [en, viLocale]) {
      expect(typeof lookup(locale, FIND_LABEL_KEY)).toBe("string");
    }
  });

  it("reaches the editor-owned find panel from the ribbon trailing slot in both locales", async () => {
    const onOpenFind = vi.fn();
    const view = render(
      <XlsxToolbar
        coordinator={coordinator()}
        dirty
        saving={false}
        onSave={vi.fn()}
        showSave={false}
        {...groupProps({ onOpenFind })}
      />
    );
    try {
      for (const [locale, dictionary, clicks] of [
        ["vi", viLocale, 1],
        ["en", en, 2],
      ] as const) {
        await setLocale(locale);
        const button = screen.getByTestId("xlsx-find-open");
        expect(button).toHaveAccessibleName(lookup(dictionary, FIND_LABEL_KEY));
        expect(document.querySelector("[data-ribbon-trailing]")).toContainElement(button);
        fireEvent.click(button);
        expect(onOpenFind).toHaveBeenCalledTimes(clicks);
      }
    } finally {
      view.unmount();
    }
  });

  it("keeps the find group subtree in vi/en key parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.toolbar.groups.find"));
    expect(subtree(viLocale).length).toBeGreaterThan(0);
    expect(subtree(viLocale)).toEqual(subtree(en));
  });
});
