// UNI-933 (F4/F5/C8): the rendered Home tab matches Word - every Font command
// is an icon, the Paragraph group holds the list controls, Styles is a real
// gallery and the family box does not truncate the default font name.
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOfficeRibbonPreferencesStore } from "@uniwork/core/office/ribbon-preferences";
import { createDocxCommandRuntime } from "../../commands";
import { DocxToolbarShell } from "../toolbar";
import type { DocxToolbarGroupContext } from "../types";
import { createDocxDocumentScope } from "../../editor-store";

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

function context(): DocxToolbarGroupContext {
  const runtime = createDocxCommandRuntime(() => null);
  return {
    docScope: createDocxDocumentScope(),
    editor: { format: "docx" } as unknown as DocxToolbarGroupContext["editor"],
    coordinator: { getState: vi.fn(), subscribe: () => () => undefined, save: vi.fn() } as unknown as DocxToolbarGroupContext["coordinator"],
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
  };
}

function group(id: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-ribbon-group="${id}"]`);
  if (!node) throw new Error(`missing group ${id}`);
  return node;
}

function sizeOf(id: string): string | null {
  return document.querySelector(`[data-ribbon-item="${id}"]`)?.getAttribute("data-ribbon-size") ?? null;
}

beforeEach(() => {
  useOfficeRibbonPreferencesStore.setState({ collapsed: {} });
  stubBodyWidth(1440);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Home tab layout at 1440px", () => {
  it("renders every group at full size, with no separate Lists group", () => {
    render(<DocxToolbarShell {...context()} />);
    for (const id of ["home-clipboard", "home-font", "home-paragraph", "home-styles"]) {
      expect(group(id)).toHaveAttribute("data-ribbon-stage", "0");
    }
    expect(document.querySelector('[data-ribbon-group="home-lists"]')).toBeNull();
  });

  it("shows Bold, Italic and Underline as icons, not large or labelled buttons", () => {
    render(<DocxToolbarShell {...context()} />);
    for (const id of ["docx-bold", "docx-italic", "docx-underline", "docx-strike", "docx-change-case", "docx-clear-formatting"]) {
      expect(sizeOf(id)).toBe("icon");
    }
    expect(group("home-font").querySelectorAll('[data-ribbon-size="large"]')).toHaveLength(0);
  });

  it("keeps Cut, Copy and Format painter in the Clipboard group as icons beside a large Paste", () => {
    render(<DocxToolbarShell {...context()} />);
    expect(sizeOf("docx-clipboard-paste")).toBe("large");
    for (const id of ["docx-clipboard-cut", "docx-clipboard-copy", "docx-format-painter"]) {
      expect(group("home-clipboard").querySelector(`[data-ribbon-item="${id}"]`)).not.toBeNull();
      expect(sizeOf(id)).toBe("icon");
    }
  });

  it("gives the font family box at least 140px", () => {
    render(<DocxToolbarShell {...context()} />);
    const family = group("home-font").querySelector<HTMLElement>('[data-ribbon-item="docx-font-family"] > div');
    expect(family).not.toBeNull();
    expect(Number.parseInt(family!.style.width, 10)).toBeGreaterThanOrEqual(140);
  });

  it("holds the list controls, indents, alignments and spacing in the Paragraph group", () => {
    render(<DocxToolbarShell {...context()} />);
    const paragraph = group("home-paragraph");
    for (const id of [
      "docx-list-gallery",
      "docx-list-multilevel",
      "docx-indent-decrease",
      "docx-indent-increase",
      "docx-align-left",
      "docx-align-justify",
      "docx-paragraph-spacing",
    ]) {
      expect(paragraph.querySelector(`[data-ribbon-item="${id}"]`)).not.toBeNull();
    }
    expect(paragraph.querySelectorAll('[data-ribbon-block="strip"] > div')).toHaveLength(2);
  });

  it("renders the Styles group as a gallery of at least three cards", () => {
    render(<DocxToolbarShell {...context()} />);
    const gallery = group("home-styles").querySelector('[data-ribbon-item="docx-styles-gallery"]');
    expect(gallery).not.toBeNull();
    expect(Number(gallery!.getAttribute("data-ribbon-gallery-visible"))).toBeGreaterThanOrEqual(3);
  });
});
