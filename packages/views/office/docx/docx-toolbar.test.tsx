import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOfficeRibbonPreferencesStore } from "@uniwork/core/office/ribbon-preferences";
import { createDocxCommandRuntime } from "./commands";
import { DOCX_GROUP_PRIORITY_DEFAULT, buildDocxRibbonTabs, docxGroupPriority } from "./toolbar/ribbon-tabs";
import { DOCX_TOOLBAR_TABS } from "./toolbar/tabs/tabs";
import { DocxToolbarShell } from "./toolbar/toolbar";
import type { DocxToolbarGroupContext } from "./toolbar/types";

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

/** The ribbon region of the DOCX chrome (R7/R8). */
function ribbon(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-office-ribbon="docx"]')!;
}

/** A tab button by id, so the assertions do not depend on the locale. */
function tab(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-ribbon-tab="${id}"]`)!;
}

/** jsdom has no ResizeObserver: report a fixed ribbon body width instead. */
function stubBodyWidth(width: number) {
  class FixedResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: { width } as DOMRectReadOnly } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", FixedResizeObserver);
}

beforeEach(() => {
  useOfficeRibbonPreferencesStore.setState({ collapsed: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildDocxRibbonTabs", () => {
  it("re-mounts every registry tab and group 1:1, each with a collapse priority", () => {
    const tabs = buildDocxRibbonTabs(context());

    expect(tabs.map((entry) => entry.id)).toEqual(DOCX_TOOLBAR_TABS.map((entry) => entry.id));
    for (const [index, entry] of tabs.entries()) {
      const registry = DOCX_TOOLBAR_TABS[index]!;
      expect(entry.labelKey).toBe(registry.labelKey);
      expect(entry.groups.map((group) => group.id)).toEqual(registry.groups.map((group) => group.id));
      expect(entry.groups.map((group) => group.labelKey)).toEqual(registry.groups.map((group) => group.labelKey));
      for (const [groupIndex, group] of entry.groups.entries()) {
        const source = registry.groups[groupIndex]!;
        expect(group.priority).toBe(docxGroupPriority(source.collapseAt));
        expect(Number.isFinite(group.priority)).toBe(true);
        // Every group renders as exactly one custom item: no command lost.
        expect(group.items).toHaveLength(1);
        expect(group.items[0]).toMatchObject({ kind: "custom", id: source.id, labelKey: source.labelKey });
      }
    }
  });

  it("gives every Insert group a finite priority so the tab can collapse (M-6)", () => {
    const insert = buildDocxRibbonTabs(context()).find((entry) => entry.id === "insert")!;
    expect(insert.groups.length).toBeGreaterThan(0);
    expect(insert.groups.every((group) => Number.isFinite(group.priority))).toBe(true);
  });
});

describe("docxGroupPriority", () => {
  it("flips collapseAt into the ribbon's ascending priority order", () => {
    expect(docxGroupPriority(560)).toBe(-560);
    expect(docxGroupPriority(0)).toBe(-0);
    expect(docxGroupPriority(undefined)).toBe(DOCX_GROUP_PRIORITY_DEFAULT);
    // Unmeasured groups collapse last, after every group that declares a width.
    expect(DOCX_GROUP_PRIORITY_DEFAULT).toBeGreaterThan(0);
    expect(docxGroupPriority(undefined)).toBeGreaterThan(docxGroupPriority(0));
  });
});

describe("DocxToolbarShell", () => {
  it("renders the shared DOCX ribbon with its five tabs", () => {
    render(<DocxToolbarShell {...context()} />);

    const region = ribbon();
    expect(region).toHaveAttribute("data-ribbon-layout", "full");
    expect(region).toHaveAttribute("data-ribbon-collapsed", "false");
    expect(region.getAttribute("aria-label")).toBeTruthy();
    expect(within(region).getByRole("tablist")).toBeInTheDocument();

    expect(screen.getAllByRole("tab").map((entry) => entry.getAttribute("data-ribbon-tab"))).toEqual([
      "home",
      "insert",
      "layout",
      "review",
      "view",
    ]);
    expect(tab("home")).toHaveAttribute("aria-selected", "true");
    for (const entry of screen.getAllByRole("tab")) expect(entry.textContent).not.toBe("");
    expect(within(region).getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tab("home").id);
  });

  it("switches tabs and mounts that tab's group components", async () => {
    render(<DocxToolbarShell {...context()} />);
    expect(document.querySelector('[data-ribbon-item="home-font"]')).toBeInTheDocument();

    fireEvent.click(tab("insert"));
    await waitFor(() => expect(document.querySelector('[data-ribbon-item="insert-links"]')).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector('[data-ribbon-item="home-font"]')).not.toBeInTheDocument());
    expect(tab("insert")).toHaveAttribute("aria-selected", "true");
    // A real command of the Insert tab is reachable through the ribbon item.
    expect(screen.getByTestId("docx-note-insert-footnote")).toBeInTheDocument();
  });

  it("mounts every group of every tab as a ribbon item (no command lost)", async () => {
    render(<DocxToolbarShell {...context()} />);

    for (const entry of DOCX_TOOLBAR_TABS) {
      fireEvent.click(tab(entry.id));
      for (const group of entry.groups) {
        await waitFor(() => expect(document.querySelector(`[data-ribbon-item="${group.id}"]`)).toBeInTheDocument());
      }
    }
  });

  it("keeps one roving tab stop in the ribbon body and navigates it with the arrow keys", async () => {
    render(<DocxToolbarShell {...context()} />);
    const body = screen.getByRole("tabpanel");
    const bold = screen.getByTestId("docx-bold");

    await waitFor(() => expect(body.querySelectorAll('[data-ribbon-current="true"]').length).toBe(1));
    const first = body.querySelector<HTMLElement>('[data-ribbon-current="true"]')!;

    bold.focus();
    fireEvent.keyDown(bold, { key: "ArrowRight" });
    expect(document.activeElement).not.toBe(bold);
    expect(body.contains(document.activeElement)).toBe(true);
    expect(body.querySelectorAll('[data-ribbon-current="true"]').length).toBe(1);

    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(document.activeElement).toBe(first);
  });

  it("collapses groups into one button and keeps their commands in the panel", async () => {
    stubBodyWidth(120);
    render(<DocxToolbarShell {...context()} />);

    await waitFor(() => expect(document.querySelector('[data-ribbon-group="home-font"]')).toHaveAttribute("data-ribbon-stage", "3"));
    fireEvent.click(document.querySelector<HTMLElement>('[data-ribbon-group-button="home-font"]')!);

    const panel = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-ribbon-panel="home-font"]');
      expect(node).not.toBeNull();
      return node!;
    });
    // The collapsed group still exposes its whole command area.
    expect(within(panel).getByTestId("docx-bold")).toBeInTheDocument();
    expect(within(panel).getByTestId("docx-font-family")).toBeInTheDocument();
  });

  it("collapses to tabs only and peeks the body again (Ctrl+F1)", () => {
    render(<DocxToolbarShell {...context()} />);
    const region = ribbon();
    fireEvent.keyDown(window, { key: "F1", ctrlKey: true });
    expect(region).toHaveAttribute("data-ribbon-collapsed", "true");
    fireEvent.keyDown(window, { key: "F1", ctrlKey: true });
    expect(region).toHaveAttribute("data-ribbon-collapsed", "false");
  });

  it("disables formatting, undo/redo and Save while read-only", () => {
    render(<DocxToolbarShell {...context({ dirty: true, readOnly: true })} />);
    expect(screen.getByTestId("docx-bold")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ho\u00e0n t\u00e1c" })).toBeDisabled();
    expect(screen.getByTestId("docx-save")).toBeDisabled();
  });

  it("routes Save through onSave and reports the save state in the live region", () => {
    const onSave = vi.fn();
    const runtime = createDocxCommandRuntime(() => null);
    const toggleBold = vi.spyOn(runtime, "toggleBold");
    const { unmount } = render(<DocxToolbarShell {...context({ commands: runtime, dirty: true, onSave })} />);

    fireEvent.click(screen.getByTestId("docx-bold"));
    expect(toggleBold).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("docx-save"));
    expect(onSave).toHaveBeenCalledTimes(1);

    // The save-state announcement the old shell carried is still there.
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status.textContent).not.toBe("");
    // The Save label switches to the saving copy while a save is in flight.
    const label = screen.getByTestId("docx-save").textContent;
    unmount();

    render(<DocxToolbarShell {...context({ dirty: true, saving: true, onSave })} />);
    expect(screen.getByTestId("docx-save").textContent).not.toBe(label);
    expect(screen.getByTestId("docx-save")).toBeDisabled();
  });

  it("leaves the Save button and its live region out when the host owns the controls", () => {
    render(<DocxToolbarShell {...context({ onSave: undefined })} />);
    expect(screen.queryByTestId("docx-save")).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="docx-toolbar"] [role="status"]')).not.toBeInTheDocument();
  });

  it("puts undo/redo far left in the ribbon and Find far right, with no selection text (C6)", () => {
    render(<DocxToolbarShell {...context({ selection: { blockId: "p1", from: 2, to: 7 } })} />);
    const quickAccess = document.querySelector<HTMLElement>("[data-ribbon-quick-access]")!;
    expect(quickAccess).toContainElement(screen.getByRole("button", { name: "Ho\u00e0n t\u00e1c" }));
    expect(quickAccess).toContainElement(screen.getByRole("button", { name: "L\u00e0m l\u1ea1i" }));

    const trailing = document.querySelector<HTMLElement>("[data-ribbon-trailing]")!;
    expect(trailing).toContainElement(screen.getByTestId("docx-find-toggle"));
    expect(trailing).toContainElement(screen.getByTestId("docx-save"));
    // The selection text moved to the status bar (C10), so the ribbon no longer
    // carries it.
    expect(screen.queryByTestId("docx-selection")).not.toBeInTheDocument();
  });

  it("routes undo and redo through their callbacks", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(<DocxToolbarShell {...context({ onUndo, onRedo })} />);
    fireEvent.click(screen.getByRole("button", { name: "Ho\u00e0n t\u00e1c" }));
    fireEvent.click(screen.getByRole("button", { name: "L\u00e0m l\u1ea1i" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });
});