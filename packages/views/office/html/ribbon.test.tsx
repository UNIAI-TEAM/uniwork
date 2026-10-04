// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HTML_RIBBON_KEYS, HtmlRibbon, htmlImageUrlAllowed, useHtmlRibbonTabs } from "./ribbon";
import type { HtmlRibbonCommands } from "./ribbon";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

function commands(): Required<HtmlRibbonCommands> {
  return {
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onInlineMark: vi.fn(),
    onSetBlock: vi.fn(),
    onInsertList: vi.fn(),
    onInsertImageFile: vi.fn(),
    onInsertImageUrl: vi.fn(),
    onInsertTable: vi.fn(),
    onInsertButton: vi.fn(),
    onInsertSection: vi.fn(),
    onInsertHorizontalRule: vi.fn(),
  };
}

/**
 * The tests select by the ribbon's stable hooks (`data-office-ribbon`,
 * `data-ribbon-item`, `data-ribbon-group`, `data-ribbon-tab`), never by a
 * translated label or a raw i18n key. The keys landed after the ribbon did, so
 * a key-based selector would have broken the day the locale writer committed
 * (RB-4).
 */
function region(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>('[data-office-ribbon="html"]');
  if (!found) throw new Error("html ribbon region not found");
  return found;
}

function item(scope: HTMLElement, id: string): HTMLElement {
  const found = scope.querySelector<HTMLElement>(`[data-ribbon-item="${id}"]`);
  if (!found) throw new Error(`ribbon item ${id} not found`);
  return found;
}

function group(scope: HTMLElement, id: string): HTMLElement {
  const found = scope.querySelector<HTMLElement>(`[data-ribbon-group="${id}"]`);
  if (!found) throw new Error(`ribbon group ${id} not found`);
  return found;
}

describe("htmlImageUrlAllowed", () => {
  it("accepts only relative or root-absolute asset paths", () => {
    expect(htmlImageUrlAllowed("assets/photo.png")).toBe(true);
    expect(htmlImageUrlAllowed("/assets/photo.png")).toBe(true);
    expect(htmlImageUrlAllowed("./photo.png")).toBe(true);
  });

  it("refuses every URL the preview gate would drop", () => {
    for (const url of ["https://evil.example/x.png", "http://evil.example/x.png", "//evil.example/x.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "<img src=x>", "assets/a b.png", ""]) {
      expect(htmlImageUrlAllowed(url), url).toBe(false);
    }
  });
});

describe("useHtmlRibbonTabs", () => {
  it("declares Home (clipboard, paragraph, inline) and Insert as pure data", () => {
    let tabs: ReturnType<typeof useHtmlRibbonTabs> = [];
    function Probe() {
      tabs = useHtmlRibbonTabs();
      return null;
    }
    render(<Probe />);
    const byId = Object.fromEntries(tabs.map((tab) => [tab.id, tab]));
    expect(Object.keys(byId)).toEqual(["home", "insert"]);
    expect(byId.home!.groups.map((group) => group.id)).toEqual(["clipboard", "paragraph", "inline"]);
    expect(byId.insert!.groups.map((group) => group.id)).toEqual(["insert"]);
    for (const tab of tabs) for (const group of tab.groups) expect(typeof group.priority).toBe("number");
    // R2: one large primary per group (undo in Clipboard, bold in Inline).
    expect(byId.home!.groups[0]!.items.find((item) => item.id === "undo")?.size).toBe("large");
    expect(byId.home!.groups[2]!.items.find((item) => item.id === "bold")?.size).toBe("large");
    // RB-6: the dead groups.image entry is gone. `image` was never a group
    // property, so pin the value instead: the key itself must not return.
    expect("image" in HTML_RIBBON_KEYS).toBe(false);
  });
});

describe("HtmlRibbon", () => {
  it("renders the Home groups and executes the inline, block and quick-access commands", () => {
    const c = commands();
    const { container } = render(<HtmlRibbon commands={c} state={{ block: "paragraph" }} />);
    const root = region(container);
    for (const id of ["clipboard", "paragraph", "inline"]) expect(group(root, id)).toBeInTheDocument();
    fireEvent.click(item(group(root, "inline"), "bold"));
    expect(c.onInlineMark).toHaveBeenCalledWith("bold");
    fireEvent.click(item(group(root, "paragraph"), "block-blockquote"));
    expect(c.onSetBlock).toHaveBeenCalledWith("blockquote");
    fireEvent.click(within(root.querySelector<HTMLElement>("[data-ribbon-quick-access]")!).getAllByRole("button")[0]!);
    expect(c.onUndo).toHaveBeenCalledOnce();
  });

  it("switches to the Insert tab and runs an image-from-file and a table size", () => {
    const c = commands();
    const { container } = render(<HtmlRibbon commands={c} />);
    const root = region(container);
    fireEvent.click(root.querySelector<HTMLElement>('[data-ribbon-tab="insert"]')!);
    const insertGroup = group(root, "insert");
    fireEvent.click(item(insertGroup, "image-file"));
    expect(c.onInsertImageFile).toHaveBeenCalledOnce();
    // The grid picker picks rows x columns on click.
    fireEvent.click(insertGroup.querySelector<HTMLElement>('[data-html-table-cell="3x2"]')!);
    expect(c.onInsertTable).toHaveBeenCalledWith(3, 2);
  });

  it("refuses an image URL the gate would drop and accepts an asset path", () => {
    const c = commands();
    const { container } = render(<HtmlRibbon commands={c} />);
    const root = region(container);
    fireEvent.click(root.querySelector<HTMLElement>('[data-ribbon-tab="insert"]')!);
    fireEvent.click(item(root, "image-url").querySelector<HTMLElement>("button")!);
    const input = document.querySelector<HTMLInputElement>("[data-html-image-url-input]")!;
    const insert = document.querySelector<HTMLButtonElement>("[data-html-image-url-insert]")!;
    fireEvent.change(input, { target: { value: "https://evil.example/x.png" } });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(insert).toBeDisabled();
    fireEvent.change(input, { target: { value: "assets/photo.png" } });
    expect(insert).not.toBeDisabled();
    fireEvent.click(insert);
    expect(c.onInsertImageUrl).toHaveBeenCalledWith("assets/photo.png");
  });

  it("disables every control in read-only mode", () => {
    const c = commands();
    const { container } = render(<HtmlRibbon commands={c} state={{ readOnly: true }} />);
    const root = region(container);
    expect(item(group(root, "inline"), "bold")).toHaveAttribute("aria-disabled", "true");
    expect(within(root.querySelector<HTMLElement>("[data-ribbon-quick-access]")!).getAllByRole("button")[0]!).toBeDisabled();
  });

  it("moves the table size grid with the arrow keys instead of 36 tab stops (RB-7)", () => {
    const c = commands();
    const { container } = render(<HtmlRibbon commands={c} />);
    const root = region(container);
    fireEvent.click(root.querySelector<HTMLElement>('[data-ribbon-tab="insert"]')!);
    const cells = Array.from(root.querySelectorAll<HTMLElement>("[data-html-table-cell]"));
    expect(cells).toHaveLength(36);
    // The shared ribbon keeps its body ONE tab stop, so the grid is not 36 of
    // them; within the grid the arrow keys move in 2D instead.
    const cell = (id: string) => root.querySelector<HTMLElement>(`[data-html-table-cell="${id}"]`)!;
    cell("1x1").focus();
    fireEvent.keyDown(cell("1x1"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(cell("1x2"));
    fireEvent.keyDown(cell("1x2"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell("2x2"));
    fireEvent.keyDown(cell("2x2"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(cell("1x2"));
    fireEvent.keyDown(cell("1x2"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cell("1x1"));
  });

  it("lets a boundary arrow leave the grid to the ribbon's roving focus (RBF-4)", () => {
    const c = commands();
    // A document-level listener stands in for the ribbon's bubble-phase roving
    // handler: it only sees the arrow when the grid does not consume it.
    const bubbled = vi.fn();
    document.addEventListener("keydown", bubbled);
    try {
      const { container } = render(<HtmlRibbon commands={c} />);
      const root = region(container);
      fireEvent.click(root.querySelector<HTMLElement>('[data-ribbon-tab="insert"]')!);
      const cell = (id: string) => root.querySelector<HTMLElement>(`[data-html-table-cell="${id}"]`)!;
      cell("1x1").focus();
      // An in-grid move is consumed: the event never reaches the ribbon.
      fireEvent.keyDown(cell("1x1"), { key: "ArrowRight" });
      expect(document.activeElement).toBe(cell("1x2"));
      expect(bubbled).not.toHaveBeenCalled();
      // A boundary arrow clamps to the same cell and is left to bubble out to
      // the ribbon's roving focus, so the keyboard user can leave the grid.
      fireEvent.keyDown(cell("1x1"), { key: "ArrowLeft" });
      expect(bubbled).toHaveBeenCalledTimes(1);
      expect((document.activeElement as HTMLElement | null)?.hasAttribute("data-html-table-cell")).toBe(false);
    } finally {
      document.removeEventListener("keydown", bubbled);
    }
  });

  it("gives the button, section and present affordances distinct icons (RB-8)", () => {
    const c = commands();
    const { container } = render(<HtmlRibbon commands={c} onTogglePresent={() => undefined} />);
    const root = region(container);
    fireEvent.click(root.querySelector<HTMLElement>('[data-ribbon-tab="insert"]')!);
    const svgPath = (id: string) => item(root, id).querySelector("svg")?.innerHTML ?? "";
    const paths = ["button-preset", "section-preset"].map(svgPath);
    expect(new Set(paths).size).toBe(2);
    // The present toggle in the trailing slot is a third, different glyph.
    const present = root.querySelector<HTMLElement>("[data-ribbon-trailing] button[aria-pressed]")!;
    expect(present.querySelector("svg")).not.toBeNull();
    expect(new Set([...paths, present.querySelector("svg")!.innerHTML]).size).toBe(3);
  });
});
