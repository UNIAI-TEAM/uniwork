import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { useOfficeRibbonPreferencesStore } from "@uniwork/core/office/ribbon-preferences";
import { XLSX_TOOLBAR_GROUPS } from "./toolbar/registry";
import { XLSX_TOOLBAR_TABS } from "./toolbar/tabs";
import { xlsxGroupPriority, xlsxRibbonTabs, XLSX_RIBBON_SCOPE } from "./toolbar/ribbon-data";
import type { XlsxToolbarGroupProps } from "./toolbar/types";
import type { XlsxSaveCoordinator } from "./types";
import { XlsxToolbar, type XlsxToolbarProps } from "./xlsx-toolbar";

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

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    permissions: {},
    selection: { sheet: "Data", address: "C1" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCut: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    ...overrides,
  };
}

function renderProps(overrides: Partial<XlsxToolbarProps> = {}): XlsxToolbarProps {
  return {
    coordinator: coordinator(),
    dirty: true,
    saving: false,
    onSave: vi.fn(),
    onCancelSave: vi.fn(),
    showSave: true,
    ...groupProps(),
    ...overrides,
  };
}

function renderToolbar(overrides: Partial<XlsxToolbarProps> = {}): XlsxToolbarProps {
  const props = renderProps(overrides);
  render(<XlsxToolbar {...props} />);
  return props;
}

/** The ribbon region of the XLSX chrome (R7/R8). */
function ribbon(): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-office-ribbon="${XLSX_RIBBON_SCOPE}"]`)!;
}

/** A typed ribbon item by id, so assertions do not depend on the locale. */
function ribbonItem(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-ribbon-item='${id}']`)!;
}

/** A tab button by id, so the assertions do not depend on the locale. */
function tab(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-ribbon-tab="${id}"]`)!;
}

beforeEach(() => {
  useOfficeRibbonPreferencesStore.setState({ collapsed: {} });
});

describe("xlsxRibbonTabs", () => {
  it("re-mounts every registry tab and group 1:1 (typed items, else one custom item)", () => {
    // The fixed tabs first; the contextual Table tabs (R4) ride after them and
    // are asserted separately below.
    const tabs = xlsxRibbonTabs(groupProps()).filter((entry) => entry.contextual === undefined);

    expect(tabs.map((entry) => entry.id)).toEqual(XLSX_TOOLBAR_TABS.map((entry) => entry.id));
    for (const [index, entry] of tabs.entries()) {
      const registryTab = XLSX_TOOLBAR_TABS[index]!;
      expect(entry.labelKey).toBe(registryTab.labelKey);

      const registryGroups = XLSX_TOOLBAR_GROUPS.filter((group) => group.tab === registryTab.id)
        .slice()
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
      expect(entry.groups.map((group) => group.id)).toEqual(registryGroups.map((group) => group.id));
      expect(entry.groups.map((group) => group.labelKey)).toEqual(registryGroups.map((group) => group.labelKey));

      for (const [groupIndex, group] of entry.groups.entries()) {
        const source = registryGroups[groupIndex]!;
        // Same id/labelKey and priority = -order (the registry's documented
        // "highest order collapses first" mapping).
        expect(group.priority).toBe(xlsxGroupPriority(source.order));
        expect(Number.isFinite(group.priority)).toBe(true);
        if (source.ribbonItems) {
          // A typed group renders exactly the items it declares: no command lost.
          expect(group.items.map((item) => item.id)).toEqual(source.ribbonItems(groupProps()).map((item) => item.id));
        } else {
          // An untyped group renders as exactly one custom item.
          expect(group.items).toHaveLength(1);
          expect(group.items[0]).toMatchObject({ kind: "custom", id: source.id, labelKey: source.labelKey });
        }
      }
    }
  });

  it("keeps every group exactly once with a monotonic priority per tab", () => {
    const tabs = xlsxRibbonTabs(groupProps()).filter((entry) => entry.contextual === undefined);
    const mapped = tabs.flatMap((entry) => entry.groups);

    expect(mapped).toHaveLength(XLSX_TOOLBAR_GROUPS.length);
    expect(new Set(mapped.map((group) => group.id)).size).toBe(mapped.length);

    for (const entry of tabs) {
      const priorities = entry.groups.map((group) => group.priority);
      // order ascends inside a tab, so -order strictly descends: the
      // least-used (highest order) group always collapses first.
      for (let index = 1; index < priorities.length; index += 1) {
        expect(priorities[index]!).toBeLessThan(priorities[index - 1]!);
      }
    }
  });

  it("omits a group whose isAvailable returns false (no empty labelled box)", () => {
    const withRecalc = xlsxRibbonTabs(groupProps({ canRecalculate: true }));
    const withoutRecalc = xlsxRibbonTabs(groupProps({ canRecalculate: false }));
    const formulas = (tabs: readonly { id: string; groups: readonly { id: string }[] }[]) =>
      tabs.find((entry) => entry.id === "formulas")!.groups.map((group) => group.id);

    expect(formulas(withRecalc)).toContain("calculation");
    expect(formulas(withoutRecalc)).not.toContain("calculation");
    expect(formulas(withoutRecalc)).toEqual(["formula"]);
  });

  it("keeps the six tabs in the lane's declared order", () => {
    expect(xlsxRibbonTabs(groupProps()).filter((entry) => entry.contextual === undefined).map((entry) => entry.id)).toEqual([
      "home",
      "insert",
      "formulas",
      "data",
      "review",
      "view",
    ]);
  });
});

describe("XlsxToolbar on the shared ribbon", () => {
  it("renders the shared ribbon region with the six tabs and Home selected", () => {
    renderToolbar();
    const region = ribbon();
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("data-ribbon-collapsed", "false");

    const tablist = within(region).getByRole("tablist");
    expect(within(tablist).getAllByRole("tab")).toHaveLength(6);
    expect(tab("home")).toHaveAttribute("aria-selected", "true");
    expect(tab("view")).toHaveAttribute("aria-selected", "false");
  });

  it("switches the visible groups when another tab is selected", () => {
    renderToolbar();
    expect(document.querySelector("[data-ribbon-group='number']")).toBeInTheDocument();

    fireEvent.click(tab("insert"));
    expect(document.querySelector("[data-ribbon-group='number']")).not.toBeInTheDocument();
    expect(document.querySelector("[data-ribbon-group='charts']")).toBeInTheDocument();
    expect(document.querySelector("[data-ribbon-group='table']")).toBeInTheDocument();
    // Design review X2: the row/column insert cluster lives on Home > Cells now.
    expect(document.querySelector("[data-ribbon-group='structure-insert']")).not.toBeInTheDocument();
  });

  it("mounts every Home group once, labelled and hosting its typed items", () => {
    renderToolbar();
    const body = within(ribbon()).getByRole("tabpanel");
    const homeGroups = XLSX_TOOLBAR_GROUPS.filter((group) => group.tab === "home");
    for (const group of homeGroups) {
      const node = document.querySelector<HTMLElement>(`[data-ribbon-group='${group.id}']`)!;
      expect(body).toContainElement(node);
      expect(node.getAttribute("aria-label")).toBeTruthy();
      expect(node.querySelector("[data-ribbon-item]")).toBeInTheDocument();
    }
  });

  it("keeps Undo/Redo at the far left, Find at the far right and Save visible on every tab (C6)", () => {
    renderToolbar();
    const quick = document.querySelector("[data-ribbon-quick-access]")!;
    expect(quick).toContainElement(screen.getByTestId("xlsx-undo"));
    expect(quick).toContainElement(screen.getByTestId("xlsx-redo"));
    expect(document.querySelector("[data-ribbon-trailing]")).toContainElement(screen.getByTestId("xlsx-find-open"));
    // The cell address is no longer shown in the tab row.
    expect(document.querySelector("[data-ribbon-tab-row]")).not.toHaveTextContent("Data!C1");
    for (const id of ["home", "insert", "formulas", "data", "review", "view"]) {
      fireEvent.click(tab(id));
      expect(screen.getByTestId("xlsx-save")).toBeVisible();
    }
  });

  it("dispatches the same command ids through the mocked commands port", () => {
    const execute = vi.fn(() => true);
    const props = renderToolbar({ commands: { execute } });

    // Home is the default tab; the Font group routes through the port.
    fireEvent.click(screen.getByRole("button", { name: "In đậm" }));
    expect(execute).toHaveBeenCalledWith("sheet.command.set-bold");

    // The non-port callbacks still fire from their groups (no path changed).
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    fireEvent.click(screen.getByRole("button", { name: "Làm lại" }));
    // The Sheets action lives in the Cells > Format menu now.
    fireEvent.click(screen.getByTestId("xlsx-cells-format-trigger"));
    fireEvent.click(screen.getByTestId("xlsx-cells-format-sheets"));
    fireEvent.click(ribbonItem("clipboard-copy"));
    fireEvent.click(ribbonItem("clipboard-cut"));
    fireEvent.click(ribbonItem("clipboard-paste"));
    expect(props.onUndo).toHaveBeenCalledOnce();
    expect(props.onRedo).toHaveBeenCalledOnce();
    expect(props.onShowSheets).toHaveBeenCalledOnce();
    expect(props.onCopy).toHaveBeenCalledOnce();
    expect(props.onCut).toHaveBeenCalledOnce();
    expect(props.onPaste).toHaveBeenCalledOnce();

    fireEvent.click(tab("formulas"));
    fireEvent.click(screen.getByRole("button", { name: "Tính lại công thức" }));
    expect(props.onRecalculate).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId("xlsx-save"));
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.coordinator).not.toHaveProperty("writeBytes");
  });

  it("spells the Cells menu width on the spacing scale, not an arbitrary pixel value", () => {
    renderToolbar({ commands: { execute: vi.fn(() => true) } });
    // min-w-22 = 22 * 0.25rem = 88px, the floor the menus opened with.
    const trigger = screen.getByTestId("xlsx-cells-insert-trigger");
    expect(trigger.className).toContain("min-w-22");
    expect(trigger.className).not.toContain("min-w-[88px]");
  });

  it("routes the View tab display toggles through the port with their command ids", () => {
    const execute = vi.fn(() => true);
    renderToolbar({ commands: { execute } });
    fireEvent.click(tab("view"));
    fireEvent.click(screen.getByRole("button", { name: "Đường lưới" }));
    expect(execute).toHaveBeenCalledWith("sheet.command.toggle-gridlines", { showGridlines: 0 });
  });

  it("keeps read-only and no-selection semantics without dropping controls", () => {
    const props = renderToolbar({ readOnly: true });
    const undo = screen.getByRole("button", { name: "Hoàn tác" });
    expect(undo).toHaveAttribute("aria-disabled", "true");
    expect(undo).not.toBeDisabled();
    fireEvent.click(undo);
    expect(props.onUndo).not.toHaveBeenCalled();
    expect(ribbonItem("clipboard-copy")).not.toHaveAttribute("aria-disabled");
    expect(ribbonItem("clipboard-cut")).toHaveAttribute("aria-disabled", "true");
    expect(ribbonItem("clipboard-paste")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("xlsx-number-format-trigger")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(tab("formulas"));
    expect(screen.getByRole("button", { name: "Tính lại công thức" })).toHaveAttribute("aria-disabled", "true");
  });

  it("blocks selection commands with no selection and hides recalculate the host lacks", () => {
    renderToolbar({ canRecalculate: false, selection: null });
    expect(ribbonItem("clipboard-copy")).toHaveAttribute("aria-disabled", "true");
    expect(ribbonItem("clipboard-paste")).toHaveAttribute("aria-disabled", "true");
    expect(xlsxRibbonTabs(groupProps({ selection: null })).find((entry) => entry.id === "home")!.groups[0]!.items[2]).toMatchObject({
      id: "clipboard-copy",
      tooltipKey: "office.xlsx.selection.none",
    });
    fireEvent.click(tab("formulas"));
    expect(screen.queryByRole("button", { name: "Tính lại công thức" })).not.toBeInTheDocument();
    expect(document.querySelector("[data-ribbon-group='calculation']")).not.toBeInTheDocument();
  });

  it("names every Home group and keeps the chart placeholder capability-gated on Insert", () => {
    renderToolbar();
    expect(screen.queryByRole("button", { name: "Biểu đồ" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Bảng tạm" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Định dạng số" })).toBeInTheDocument();
    fireEvent.click(tab("insert"));
    const chart = screen.getByRole("button", { name: "Biểu đồ" });
    expect(chart).toHaveAttribute("aria-disabled", "true");
    expect(chart).toHaveAttribute("title", "Tính năng này chưa được hỗ trợ.");
    expect(screen.getByRole("group", { name: "Biểu đồ" })).toBeInTheDocument();
  });

  it("keeps permission-blocked clipboard controls inert with the permission reason", () => {
    const props = renderToolbar({ permissions: { canCopy: false, canPaste: false } });
    const copy = ribbonItem("clipboard-copy");
    expect(copy).toHaveAttribute("aria-disabled", "true");
    expect(xlsxRibbonTabs(groupProps({ permissions: { canCopy: false, canPaste: false } })).find((entry) => entry.id === "home")!.groups[0]!.items[2]).toMatchObject({
      tooltipKey: "office.xlsx.clipboardUnavailable",
    });
    fireEvent.click(copy);
    fireEvent.click(ribbonItem("clipboard-paste"));
    expect(props.onCopy).not.toHaveBeenCalled();
    expect(props.onPaste).not.toHaveBeenCalled();
  });

  it("shows Save progress and cancels through the persistent cluster while saving", () => {
    const props = renderToolbar({ saving: true });
    expect(screen.getByTestId("xlsx-save-progress")).toBeInTheDocument();
    expect(screen.getByTestId("xlsx-save")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByTestId("xlsx-save"));
    expect(props.onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("xlsx-save-cancel"));
    expect(props.onCancelSave).toHaveBeenCalledOnce();
  });

  it("announces the save state and the recalculating state in a live region", () => {
    renderToolbar();
    expect(screen.getByRole("status")).toHaveTextContent("Có thay đổi chưa lưu");
    renderToolbar({ recalculating: true });
    expect(screen.getAllByRole("status")[1]).toHaveTextContent("Đang tính lại (0%)");
  });

  it("keeps the zoom echo across a tab switch and sends an absolute target", () => {
    const execute = vi.fn(() => true);
    renderToolbar({ commands: { execute } });

    fireEvent.click(tab("view"));
    const zoomIn = screen.getByRole("button", { name: "Phóng to" });
    for (let step = 0; step < 5; step += 1) fireEvent.click(zoomIn);
    expect(screen.getByTestId("xlsx-view-zoom-value")).toHaveTextContent("150%");

    // Away and back: only the active tab's groups are mounted, but the echo is
    // owned by the toolbar, so it must survive the round trip.
    fireEvent.click(tab("home"));
    fireEvent.click(tab("view"));
    expect(screen.getByTestId("xlsx-view-zoom-value")).toHaveTextContent("150%");

    // The 75% preset sends the ABSOLUTE target, not a drifted delta from a
    // reset echo (which would have landed the renderer on ~125%).
    fireEvent.click(screen.getByRole("button", { name: "Thu phóng 75%" }));
    expect(execute).toHaveBeenLastCalledWith("sheet.command.set-zoom-ratio", { zoomRatio: 0.75 });
  });

  it("keeps the gridline/header echoes across a tab switch", () => {
    const execute = vi.fn(() => true);
    renderToolbar({ commands: { execute } });

    fireEvent.click(tab("view"));
    fireEvent.click(screen.getByRole("button", { name: "Đường lưới" }));

    fireEvent.click(tab("home"));
    fireEvent.click(tab("view"));
    expect(screen.getByRole("button", { name: "Đường lưới" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Tiêu đề hàng và cột" })).toHaveAttribute("aria-pressed", "true");
  });
  it("keeps the format painter armed across a tab switch", async () => {
    const execute = vi.fn(() => true);
    renderToolbar({ commands: { execute } });

    const painter = screen.getByTestId("xlsx-format-painter");
    fireEvent.click(painter);
    await waitFor(() => expect(painter).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(tab("view"));
    fireEvent.click(tab("home"));
    // Excel keeps the painter armed across tab switches: the engine is never
    // told to turn off and the remounted button shows the armed state.
    expect(screen.getByTestId("xlsx-format-painter")).toHaveAttribute("aria-pressed", "true");
    expect(execute).toHaveBeenLastCalledWith("sheet.operation.set-format-painter", { status: 1 });
  });

  it("collapses to tabs only and peeks the body back on a tab click", () => {
    renderToolbar();
    const body = screen.getByRole("tabpanel");
    fireEvent.click(screen.getByRole("button", { name: "Thu gọn dải lệnh" }));
    expect(body).not.toBeVisible();
    expect(useOfficeRibbonPreferencesStore.getState().collapsed[XLSX_RIBBON_SCOPE]).toBe(true);

    fireEvent.click(tab("insert"));
    expect(body).toBeVisible();
    expect(body).toHaveAttribute("data-ribbon-peek", "true");
  });
});

function toolbarKeyPaths(dictionary: unknown): string[] {
  const toolbar = (dictionary as { office?: { xlsx?: { toolbar?: Record<string, unknown> } } })?.office?.xlsx?.toolbar ?? {};
  const paths: string[] = [];
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") paths.push(path);
      else if (value && typeof value === "object") walk(value as Record<string, unknown>, path);
    }
  };
  walk(toolbar, "");
  return paths.sort();
}

describe("contextual table tabs (R4)", () => {
  it("shows no contextual tab without a table under the selection", () => {
    renderToolbar({ selection: { sheet: "Data", address: "A1" } });
    expect(document.querySelector("[data-ribbon-tab='table-design']")).not.toBeInTheDocument();
    expect(document.querySelector("[data-ribbon-tab='table-layout']")).not.toBeInTheDocument();
  });

  it("shows Table Design and Table Layout, accent bordered, when the selection is inside a table", () => {
    renderToolbar({
      selection: { sheet: "Data", address: "B2" },
      tables: [{ sheet: "Data", name: "Table1", range: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 } }],
    });
    const design = tab("table-design");
    const layout = tab("table-layout");
    expect(design).toBeInTheDocument();
    expect(layout).toBeInTheDocument();
    // Contextual tabs render AFTER the six fixed tabs.
    expect(within(ribbon()).getAllByRole("tab").map((node) => node.getAttribute("data-ribbon-tab")).slice(-2)).toEqual(["table-design", "table-layout"]);
    // Accent label + top border per R4, and selecting the object never
    // force-switches: Home stays selected.
    expect(design).toHaveAttribute("data-ribbon-contextual", "brand");
    expect(design.className).toContain("border-t-brand");
    expect(tab("home")).toHaveAttribute("aria-selected", "true");
  });

  it("routes a contextual table command through the shared command port", () => {
    const execute = vi.fn(() => true);
    renderToolbar({
      commands: { execute },
      selection: { sheet: "Data", address: "B2" },
      tables: [{ sheet: "Data", name: "Table1", range: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 } }],
    });
    fireEvent.click(tab("table-layout"));
    fireEvent.click(document.querySelector("[data-ribbon-item='table-layout-merge']") as HTMLElement);
    expect(execute).toHaveBeenCalledWith("sheet.command.add-worksheet-merge-all", {
      selections: [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 }],
    });
  });

  it("hides the contextual tabs again when the selection leaves the table", () => {
    const { rerender } = render(<XlsxToolbar {...renderProps({ selection: { sheet: "Data", address: "B2" }, tables: [{ sheet: "Data", name: "Table1", range: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 } }] })} />);
    expect(tab("table-design")).toBeInTheDocument();
    rerender(<XlsxToolbar {...renderProps({ selection: { sheet: "Data", address: "A20" } })} />);
    expect(document.querySelector("[data-ribbon-tab='table-design']")).not.toBeInTheDocument();
  });
});

describe("toolbar i18n", () => {
  it("carries the same toolbar keys in vi and en", () => {
    const keys = toolbarKeyPaths(viLocale);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toEqual(toolbarKeyPaths(en));
  });
});

describe("applied number format lifetime (UNI-957)", () => {
  it("drops the document's applied format when its toolbar unmounts", async () => {
    const { appliedFormatKey, readAppliedPattern, recordAppliedFormat } = await import("./number-format/applied-format");
    const key = appliedFormatKey("doc-toolbar", { sheet: "Data", address: "B2" });
    const view = render(<XlsxToolbar {...renderProps({ documentKey: "doc-toolbar" })} />);
    recordAppliedFormat(key, "0.00%");
    expect(readAppliedPattern(key)).toBe("0.00%");
    view.unmount();
    expect(readAppliedPattern(key)).toBeNull();
  });
});
