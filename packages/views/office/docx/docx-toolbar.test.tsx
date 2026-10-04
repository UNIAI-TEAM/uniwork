import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDocxCommandRuntime } from "./commands";
import { partitionToolbarGroups } from "./toolbar/overflow";
import { DocxToolbarShell } from "./toolbar/toolbar";
import type { DocxToolbarGroup, DocxToolbarGroupContext } from "./toolbar/types";

function coordinator(): DocxToolbarGroupContext["coordinator"] {
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
  };
}

function context(overrides: Partial<DocxToolbarGroupContext> = {}): DocxToolbarGroupContext {
  const runtime = createDocxCommandRuntime(() => null);
  return {
    editor: {
      format: "docx",
      open: vi.fn(async () => undefined),
      getDirtyGeneration: () => 0,
      captureSnapshot: vi.fn(async () => ({ generation: 0, fingerprint: "fp", value: {} })),
      dispose: vi.fn(),
    },
    coordinator: coordinator(),
    format: runtime.getState(),
    commands: runtime,
    selection: null,
    readOnly: false,
    saving: false,
    dirty: false,
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

const TAB_GROUPS: Array<[string, string[]]> = [
  ["Trang chủ", ["home-base", "home-font", "home-paragraph", "home-styles", "home-find"]],
  ["Chèn", ["insert-links", "insert-table", "insert-symbols", "insert-header-footer"]],
  ["Bố cục", ["layout-page-setup"]],
  ["Xem lại", ["review-track-changes", "review-comments"]],
  ["Xem", ["view-zoom", "view-navigation"]],
];

describe("DocxToolbarShell", () => {
  it("renders the five tabs and switches the active group strip", async () => {
    render(<DocxToolbarShell {...context()} />);

    expect(screen.getByRole("tab", { name: "Trang chủ" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector('[data-toolbar-group="home-font"]')).toBeInTheDocument();
    expect(document.querySelector('[data-toolbar-group="insert-links"]')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Chèn" }));
    await waitFor(() => expect(document.querySelector('[data-toolbar-group="insert-links"]')).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector('[data-toolbar-group="home-font"]')).not.toBeInTheDocument());
  });

  it("mounts every wave-A placeholder group in its own tab", async () => {
    render(<DocxToolbarShell {...context()} />);

    for (const [tab, groups] of TAB_GROUPS) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      for (const id of groups) {
        await waitFor(() => expect(document.querySelector(`[data-toolbar-group="${id}"]`)).toBeInTheDocument());
      }
    }
  });

  it("moves the tab selection with the arrow keys", async () => {
    render(<DocxToolbarShell {...context()} />);
    const home = screen.getByRole("tab", { name: "Trang chủ" });
    home.focus();
    fireEvent.keyDown(home, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Chèn" })).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Chèn" }), { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Bố cục" })).toHaveAttribute("aria-selected", "true"));
  });

  it("keeps one roving tab stop and navigates the strip with the arrow keys", () => {
    render(<DocxToolbarShell {...context()} />);
    const bold = screen.getByRole("button", { name: "Đậm" });
    const italic = screen.getByRole("button", { name: "Nghiêng" });
    expect(bold.tabIndex).toBe(0);
    expect(italic.tabIndex).toBe(-1);

    bold.focus();
    fireEvent.keyDown(bold, { key: "ArrowRight" });
    expect(document.activeElement).toBe(italic);
    expect(italic.tabIndex).toBe(0);
    expect(bold.tabIndex).toBe(-1);

    fireEvent.keyDown(italic, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Danh sách đánh số" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(document.activeElement).toBe(bold);
  });

  it("collapses low-priority groups into the overflow popover at narrow widths", async () => {
    const originalWidth = window.innerWidth;
    window.innerWidth = 500;
    try {
      render(<DocxToolbarShell {...context()} />);

      expect(document.querySelector('[data-toolbar-group="home-base"]')).toBeInTheDocument();
      expect(document.querySelector('[data-toolbar-group="home-font"]')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("docx-toolbar-overflow"));
      const overflow = await screen.findByTestId("docx-toolbar-overflow-content");
      expect(overflow.querySelector('[data-toolbar-group="home-font"]')).toBeInTheDocument();
      expect(overflow.querySelector('[data-toolbar-group="home-find"]')).toBeInTheDocument();
      expect(overflow.querySelector('[data-toolbar-group="home-base"]')).toBeNull();
      expect(document.querySelector('[data-toolbar-group="home-base"]')).toBeInTheDocument();
    } finally {
      window.innerWidth = originalWidth;
    }
  });

  it("keeps every group inline at a wide width", () => {
    render(<DocxToolbarShell {...context()} />);
    expect(screen.queryByTestId("docx-toolbar-overflow")).not.toBeInTheDocument();
    expect(document.querySelector('[data-toolbar-group="home-find"]')).toBeInTheDocument();
  });

  it("disables formatting and Save while read-only, and routes Save through onSave", () => {
    const onSave = vi.fn();
    const runtime = createDocxCommandRuntime(() => null);
    const toggleBold = vi.spyOn(runtime, "toggleBold");
    const { unmount } = render(<DocxToolbarShell {...context({ commands: runtime, dirty: true, onSave })} />);

    fireEvent.click(screen.getByRole("button", { name: "Đậm" }));
    expect(toggleBold).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("docx-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
    unmount();

    render(<DocxToolbarShell {...context({ dirty: true, onSave, readOnly: true })} />);
    expect(screen.getByRole("button", { name: "Đậm" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hoàn tác" })).toBeDisabled();
    expect(screen.getByTestId("docx-save")).toBeDisabled();
  });

  it("leaves the Save button and its live region out when the host owns the controls", () => {
    render(<DocxToolbarShell {...context({ onSave: undefined })} />);
    expect(screen.queryByTestId("docx-save")).not.toBeInTheDocument();
  });

  it("shows the selection range in the quick-access row", () => {
    render(<DocxToolbarShell {...context({ selection: { blockId: "p1", from: 2, to: 7 } })} />);
    expect(screen.getByTestId("docx-selection")).toHaveTextContent("Vùng chọn 2–7");
  });

  it("routes undo and redo through their callbacks", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(<DocxToolbarShell {...context({ onUndo, onRedo })} />);
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    fireEvent.click(screen.getByRole("button", { name: "Làm lại" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });
});

describe("partitionToolbarGroups", () => {
  const group = (id: string, collapseAt?: number): DocxToolbarGroup => ({ id, labelKey: `label.${id}`, component: () => null, collapseAt });

  it("never collapses a group without a collapseAt width", () => {
    const { inline, collapsed } = partitionToolbarGroups([group("base", 0), group("font")], 320);
    expect(inline.map((entry) => entry.id)).toEqual(["base", "font"]);
    expect(collapsed).toEqual([]);
  });

  it("collapses a group strictly below its width and keeps it at or above", () => {
    const groups = [group("font", 560), group("styles", 900)];
    expect(partitionToolbarGroups(groups, 559).collapsed.map((entry) => entry.id)).toEqual(["font", "styles"]);
    expect(partitionToolbarGroups(groups, 560).collapsed.map((entry) => entry.id)).toEqual(["styles"]);
    expect(partitionToolbarGroups(groups, 1024).collapsed).toEqual([]);
  });
});
