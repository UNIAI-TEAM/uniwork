import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxSaveCoordinator } from "./types";
import { XlsxToolbar, type XlsxToolbarProps } from "./xlsx-toolbar";
import { selectVisibleGroupCount } from "./toolbar/overflow-model";

/** jsdom has no layout, so the overflow tests own the measurement the real
 *  `useToolbarOverflow` hook reads: the strip's `clientWidth` and every
 *  group's `offsetWidth`. */
const clientWidthDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

function stubStripWidths(available: number, group: number) {
  Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get: () => available });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => group });
}

function restoreStripWidths() {
  if (clientWidthDescriptor) Object.defineProperty(Element.prototype, "clientWidth", clientWidthDescriptor);
  if (offsetWidthDescriptor) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidthDescriptor);
}

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

function renderToolbar(overrides: Partial<XlsxToolbarProps> = {}): XlsxToolbarProps {
  const props: XlsxToolbarProps = {
    coordinator: coordinator(),
    dirty: true,
    saving: false,
    readOnly: false,
    permissions: {},
    selection: { sheet: "Data", address: "C1" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    onNumberFormat: vi.fn(),
    recalculating: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onRecalculate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    onSave: vi.fn(),
    onCancelSave: vi.fn(),
    showSave: true,
    ...overrides,
  };
  render(<XlsxToolbar {...props} />);
  return props;
}

const activateTab = (tab: string) => fireEvent.click(screen.getByTestId(`xlsx-toolbar-tab-${tab}`));

describe("XlsxToolbar tabbed shell", () => {
  it("renders an ARIA tablist with Home selected and panels wired to their tabs", () => {
    renderToolbar();
    expect(screen.getByRole("tablist")).toHaveAccessibleName();
    expect(screen.getAllByRole("tab")).toHaveLength(6);
    const home = screen.getByTestId("xlsx-toolbar-tab-home");
    expect(home).toHaveAttribute("aria-selected", "true");
    expect(home).toHaveAttribute("tabindex", "0");
    expect(home).toHaveAttribute("aria-controls", "xlsx-toolbar-panel-home");
    expect(screen.getByTestId("xlsx-toolbar-tab-view")).toHaveAttribute("tabindex", "-1");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", "xlsx-toolbar-panel-home");
    expect(panel).toHaveAttribute("aria-labelledby", "xlsx-toolbar-tab-home");
    expect(screen.getByTestId("xlsx-toolbar-panel-view")).toHaveAttribute("hidden");
  });

  it("switches the visible panel on click and keeps aria-selected in sync", () => {
    renderToolbar();
    activateTab("insert");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "xlsx-toolbar-panel-insert");
    expect(screen.getByTestId("xlsx-toolbar-tab-insert")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("xlsx-toolbar-tab-home")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("xlsx-toolbar-panel-home")).toHaveAttribute("hidden");
  });

  it("moves focus with arrows/Home/End and activates only on Enter/Space", () => {
    renderToolbar();
    const home = screen.getByTestId("xlsx-toolbar-tab-home");
    const insert = screen.getByTestId("xlsx-toolbar-tab-insert");
    home.focus();
    fireEvent.keyDown(home, { key: "ArrowRight" });
    expect(insert).toHaveFocus();
    expect(home).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "xlsx-toolbar-panel-home");
    fireEvent.keyDown(insert, { key: "Enter" });
    expect(insert).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "xlsx-toolbar-panel-insert");
    fireEvent.keyDown(insert, { key: "ArrowLeft" });
    expect(home).toHaveFocus();
    fireEvent.keyDown(home, { key: "End" });
    const view = screen.getByTestId("xlsx-toolbar-tab-view");
    expect(view).toHaveFocus();
    fireEvent.keyDown(view, { key: " " });
    expect(view).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(view, { key: "Home" });
    expect(home).toHaveFocus();
    expect(view).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the selection label and Save cluster visible on every tab", () => {
    renderToolbar();
    for (const tab of ["home", "insert", "formulas", "data", "review", "view"]) {
      activateTab(tab);
      expect(screen.getByTestId("xlsx-selection")).toBeVisible();
      expect(screen.getByTestId("xlsx-selection")).toHaveTextContent("Data!C1");
      expect(screen.getByTestId("xlsx-save")).toBeVisible();
    }
  });

  it("fires every migrated command from its tab", () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    fireEvent.click(screen.getByRole("button", { name: "Làm lại" }));
    fireEvent.click(screen.getByRole("button", { name: "Trang tính" }));
    fireEvent.click(screen.getByRole("button", { name: "Sao chép ô đã chọn" }));
    fireEvent.click(screen.getByRole("button", { name: "Dán vào ô đã chọn" }));
    expect(props.onUndo).toHaveBeenCalledOnce();
    expect(props.onRedo).toHaveBeenCalledOnce();
    expect(props.onShowSheets).toHaveBeenCalledOnce();
    expect(props.onCopy).toHaveBeenCalledOnce();
    expect(props.onPaste).toHaveBeenCalledOnce();
    // The number-format group drives renderer commands through the toolbar
    // port (it no longer calls onNumberFormat); this shell harness mounts no
    // port, so its trigger renders disabled and inert — its own suite covers
    // the gallery and the decimal steppers.
    expect(screen.getByRole("button", { name: "Định dạng số" })).toHaveAttribute("aria-disabled", "true");

    activateTab("formulas");
    fireEvent.click(screen.getByRole("button", { name: "Tính lại công thức" }));
    expect(props.onRecalculate).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId("xlsx-save"));
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.coordinator).not.toHaveProperty("writeBytes");
  });

  it("names every group and keeps the chart placeholder capability-gated on Insert", () => {
    renderToolbar();
    expect(screen.queryByRole("button", { name: "Biểu đồ" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Lịch sử" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Bảng tạm" })).toBeInTheDocument();
    activateTab("insert");
    const chart = screen.getByRole("button", { name: "Biểu đồ" });
    expect(chart).toHaveAttribute("aria-disabled", "true");
    expect(chart).toHaveAttribute("title", "Tính năng này chưa được hỗ trợ.");
    expect(screen.getByRole("group", { name: "Biểu đồ" })).toBeInTheDocument();
  });

  it("keeps an honest empty state on tabs without registered groups", () => {
    renderToolbar();
    activateTab("data");
    expect(screen.getByTestId("xlsx-toolbar-empty-data")).toHaveTextContent("Thẻ này chưa có lệnh nào.");
  });

  it("keeps read-only and no-selection semantics without dropping controls from the tab order", () => {
    const props = renderToolbar({ readOnly: true });
    const undo = screen.getByRole("button", { name: "Hoàn tác" });
    expect(undo).toHaveAttribute("aria-disabled", "true");
    expect(undo).not.toBeDisabled();
    fireEvent.click(undo);
    expect(props.onUndo).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sao chép ô đã chọn" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("button", { name: "Dán vào ô đã chọn" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Định dạng số" })).toHaveAttribute("aria-disabled", "true");
    activateTab("formulas");
    expect(screen.getByRole("button", { name: "Tính lại công thức" })).toHaveAttribute("aria-disabled", "true");
  });

  it("blocks selection commands with no selection and hides recalculate the host lacks", () => {
    renderToolbar({ canRecalculate: false, selection: null });
    const copy = screen.getByRole("button", { name: "Sao chép ô đã chọn" });
    expect(copy).toHaveAttribute("aria-disabled", "true");
    expect(copy).toHaveAttribute("title", "Chưa chọn ô");
    expect(screen.getByTestId("xlsx-selection")).toHaveTextContent("Chưa chọn ô");
    activateTab("formulas");
    expect(screen.queryByRole("button", { name: "Tính lại công thức" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Tính toán" })).not.toBeInTheDocument();
  });

  it("keeps permission-blocked clipboard controls inert with the permission reason", () => {
    const props = renderToolbar({ permissions: { canCopy: false, canPaste: false } });
    const copy = screen.getByRole("button", { name: "Sao chép ô đã chọn" });
    expect(copy).toHaveAttribute("aria-disabled", "true");
    expect(copy).toHaveAttribute("title", "Trình duyệt này chưa cho phép truy cập bảng nhớ tạm.");
    fireEvent.click(copy);
    expect(props.onCopy).not.toHaveBeenCalled();
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
});

describe("XlsxToolbar overflow", () => {
  afterEach(restoreStripWidths);

  it("collapses the groups that do not fit into the overflow panel", async () => {
    stubStripWidths(100, 44);
    const props = renderToolbar();
    const panel = screen.getByRole("tabpanel");
    const trigger = screen.getByTestId("xlsx-toolbar-overflow-home");
    expect(trigger).toHaveAccessibleName("Thêm lệnh");
    expect(within(panel).getByRole("button", { name: "Hoàn tác" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Sao chép ô đã chọn" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Định dạng số" })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    const overflowPanel = await screen.findByTestId("xlsx-toolbar-overflow-panel");
    expect(within(overflowPanel).getByRole("button", { name: "Định dạng số" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(within(overflowPanel).getByRole("button", { name: "Trang tính" }));
    expect(props.onShowSheets).toHaveBeenCalledOnce();
  });

  it("keeps the overflow trigger reachable when nothing fits", async () => {
    stubStripWidths(40, 44);
    const props = renderToolbar();
    expect(screen.queryByRole("button", { name: "Hoàn tác" })).not.toBeInTheDocument();
    expect(screen.getByTestId("xlsx-toolbar-overflow-formulas")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("xlsx-toolbar-overflow-home"));
    const overflowPanel = await screen.findByTestId("xlsx-toolbar-overflow-panel");
    fireEvent.click(within(overflowPanel).getByRole("button", { name: "Hoàn tác" }));
    expect(props.onUndo).toHaveBeenCalledOnce();
  });

  it("keeps every group inline while the measured width fits", () => {
    stubStripWidths(600, 44);
    renderToolbar();
    expect(screen.queryByTestId("xlsx-toolbar-overflow-home")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Định dạng số" })).toBeInTheDocument();
  });
});

describe("selectVisibleGroupCount", () => {
  it("keeps every group while the total fits the strip", () => {
    expect(selectVisibleGroupCount([44, 44, 44], 140, 36)).toBe(3);
  });

  it("reserves the overflow trigger width when groups must collapse", () => {
    expect(selectVisibleGroupCount([44, 44, 44], 120, 36)).toBe(1);
    expect(selectVisibleGroupCount([44, 44, 44], 80, 36)).toBe(1);
  });

  it("collapses everything but the trigger when not even one group fits", () => {
    expect(selectVisibleGroupCount([44, 44], 40, 36)).toBe(0);
    expect(selectVisibleGroupCount([], 100, 36)).toBe(0);
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

describe("toolbar i18n", () => {
  it("carries the same toolbar keys in vi and en", () => {
    const keys = toolbarKeyPaths(viLocale);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toEqual(toolbarKeyPaths(en));
  });
});
