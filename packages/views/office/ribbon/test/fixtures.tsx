import { Bold, ClipboardPaste, Copy, Italic, List, Scissors, Search, Table2, Underline } from "lucide-react";
import { vi } from "vitest";
import type { RibbonGroup, RibbonTab } from "../types";

/** Labels are raw keys: i18next echoes a missing key, so tests read them as text. */
export function ribbonFixture(options: { tableSelected?: boolean } = {}) {
  const actions = {
    paste: vi.fn(),
    pasteSpecial: vi.fn(),
    cut: vi.fn(),
    copy: vi.fn(),
    bold: vi.fn(),
    italic: vi.fn(),
    underline: vi.fn(),
    bullets: vi.fn(),
    font: vi.fn(),
    fontDialog: vi.fn(),
    style: vi.fn(),
    find: vi.fn(),
    table: vi.fn(),
  };
  const clipboard: RibbonGroup = {
    id: "clipboard",
    labelKey: "Clipboard",
    priority: 30,
    items: [
      {
        kind: "split",
        id: "paste",
        labelKey: "Paste",
        icon: ClipboardPaste,
        size: "large",
        onExecute: actions.paste,
        menu: [{ id: "paste-special", labelKey: "Paste special", onSelect: actions.pasteSpecial }],
      },
      { kind: "button", id: "cut", labelKey: "Cut", icon: Scissors, onExecute: actions.cut, shortcut: "Ctrl+X" },
      { kind: "button", id: "copy", labelKey: "Copy", icon: Copy, onExecute: actions.copy, disabled: true },
    ],
  };
  const font: RibbonGroup = {
    id: "font",
    labelKey: "Font",
    priority: 50,
    launcher: { labelKey: "Font settings", onOpen: actions.fontDialog },
    items: [
      {
        kind: "combo",
        id: "font-family",
        labelKey: "Font family",
        value: "Calibri",
        options: [{ value: "Calibri", label: "Calibri" }, { value: "Arial", label: "Arial" }],
        onChange: actions.font,
      },
      { kind: "toggle", id: "bold", labelKey: "Bold", icon: Bold, size: "icon", pressed: true, onExecute: actions.bold, rowBreak: true },
      { kind: "toggle", id: "italic", labelKey: "Italic", icon: Italic, size: "icon", pressed: false, onExecute: actions.italic },
      { kind: "toggle", id: "underline", labelKey: "Underline", icon: Underline, size: "icon", pressed: false, onExecute: actions.underline },
    ],
  };
  const paragraph: RibbonGroup = {
    id: "paragraph",
    labelKey: "Paragraph",
    priority: 20,
    items: [
      {
        kind: "dropdown",
        id: "bullets",
        labelKey: "Bullets",
        icon: List,
        menu: [{ id: "disc", labelKey: "Disc", checked: true, onSelect: actions.bullets }],
      },
    ],
  };
  const styles: RibbonGroup = {
    id: "styles",
    labelKey: "Styles",
    priority: 10,
    items: [
      {
        kind: "gallery",
        id: "style-gallery",
        labelKey: "Styles",
        maxVisible: 4,
        selectedId: "normal",
        onSelect: actions.style,
        options: ["normal", "h1", "h2", "h3", "title"].map((id) => ({ id, label: id })),
      },
    ],
  };
  const editing: RibbonGroup = {
    id: "editing",
    labelKey: "Editing",
    priority: 0,
    items: [{ kind: "button", id: "find", labelKey: "Find", icon: Search, onExecute: actions.find }],
  };
  const tabs: RibbonTab[] = [
    { id: "home", labelKey: "Home", groups: [clipboard, font, paragraph, styles, editing] },
    {
      id: "insert",
      labelKey: "Insert",
      groups: [{ id: "tables", labelKey: "Tables", priority: 0, items: [{ kind: "button", id: "table", labelKey: "Table", icon: Table2, size: "large", onExecute: actions.table }] }],
    },
    {
      id: "table-design",
      labelKey: "Table Design",
      contextual: { when: options.tableSelected === true, accent: "info" },
      groups: [{ id: "table-styles", labelKey: "Table Styles", priority: 0, items: [{ kind: "custom", id: "table-custom", labelKey: "Table custom", render: ({ size }) => <span data-testid="custom-size">{size}</span> }] }],
    },
  ];
  return { tabs, actions };
}

/** jsdom has no ResizeObserver: report a fixed body width instead. */
export function stubRibbonWidth(width: number) {
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
