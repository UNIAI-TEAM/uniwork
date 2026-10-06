// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import { MarkdownWysiwygEditor } from "./editor";
import { MarkdownRibbon, useMarkdownRibbonTabs } from "./ribbon";
import type { TextEditorHandle } from "../../source-editor-types";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});
afterEach(() => {
  window.innerWidth = 1024;
});

const FIXTURE = "# Title\n\nBody paragraph.\n";
// A document whose first block is a fenced code block, so the cursor can be
// parked inside a fence without editing (the CHDEL port of code-block.test.tsx).
const CODE_FENCE = "```";
const CODE_TEXT = "const answer = 42;";
const CODE_FIXTURE = ["# Title", "", CODE_FENCE + "javascript", CODE_TEXT, CODE_FENCE, ""].join("\n");

function createHandle(initial: string = FIXTURE): TextEditorHandle {
  let text = initial;
  const listeners = new Set<(next: string) => void>();
  return {
    format: "md",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 1,
    captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { text } })),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    source: {
      getText: () => text,
      setText: (next: string) => {
        if (next === text) return;
        text = next;
        listeners.forEach((listener) => listener(next));
      },
      subscribe: (listener: (next: string) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

let live: Editor | null = null;

/** Editor + ribbon over one shared text source, wired as the product does. */
function Harness({ editable = true, text = FIXTURE, ...ribbon }: { text?: string } & Partial<Parameters<typeof MarkdownRibbon>[0]>) {
  const [handle] = useState(() => createHandle(text));
  const [instance, setInstance] = useState<Editor | null>(null);
  useEffect(() => {
    live = instance;
  }, [instance]);
  return (
    <div>
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} editable={editable} onEditorReady={setInstance} showRibbon={false} />
      <MarkdownRibbon editor={instance} editable={editable} {...ribbon} />
    </div>
  );
}

async function waitForRibbon() {
  await waitFor(() => expect(live).not.toBeNull());
  await waitFor(() => expect(document.querySelector('[data-office-ribbon="markdown"]')).not.toBeNull());
}

/**
 * The tests select by the ribbon's stable hooks (`data-office-ribbon`,
 * `data-ribbon-item`, `data-ribbon-group`, `data-ribbon-tab`), never by a
 * translated label or a raw i18n key: the keys landed after the ribbon did, so
 * a key-based selector would have broken the day the locale writer committed
 * (RB-4).
 */
function ribbonRegion(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-office-ribbon="markdown"]');
  if (!found) throw new Error("markdown ribbon region not found");
  return found;
}

function ribbonGroup(root: HTMLElement, id: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`[data-ribbon-group="${id}"]`);
  if (!found) throw new Error(`ribbon group ${id} not found`);
  return found;
}

function ribbonItem(scope: HTMLElement, id: string): HTMLElement {
  const found = scope.querySelector<HTMLElement>(`[data-ribbon-item="${id}"]`);
  if (!found) throw new Error(`ribbon item ${id} not found`);
  return found;
}

/** Park the cursor inside the document's first code fence. */
function selectCodeBlock(): void {
  let inside = -1;
  live!.state.doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") {
      inside = pos + 2;
      return false;
    }
    return true;
  });
  expect(inside).toBeGreaterThan(0);
  act(() => {
    live!.commands.setTextSelection(inside);
  });
}

/**
 * The live mount of `CodeBlockToolbar`: the contextual Code tab appears only
 * while the cursor is inside a fence, and clicking it renders the group's
 * `custom` item. Returns the toolbar element the ribbon mounted.
 */
async function openCodeTab(): Promise<HTMLElement> {
  selectCodeBlock();
  const tab = await waitFor(() => {
    const found = ribbonRegion().querySelector<HTMLElement>('[data-ribbon-tab="code"]');
    expect(found).not.toBeNull();
    return found!;
  });
  expect(tab).toHaveAttribute("data-ribbon-contextual", "warning");
  fireEvent.click(tab);
  return await waitFor(() => {
    const toolbar = document.querySelector<HTMLElement>("[data-code-block-toolbar]");
    expect(toolbar).not.toBeNull();
    return toolbar!;
  });
}

describe("useMarkdownRibbonTabs", () => {
  it("declares Home, Insert and the contextual Table/Code tabs as pure data", () => {
    let tabs: ReturnType<typeof useMarkdownRibbonTabs> = [];
    function Probe() {
      tabs = useMarkdownRibbonTabs(null);
      return null;
    }
    render(<Probe />);
    const byId = Object.fromEntries(tabs.map((tab) => [tab.id, tab]));
    expect(Object.keys(byId)).toEqual(["home", "insert", "table", "code"]);
    // Home carries the C6/C7 order. There is no `clipboard` group: undo/redo
    // are the tab row's quick access, and a group holding only them repeated
    // that pair (M-3/F4).
    expect(byId.home!.groups.map((group) => group.id)).toEqual(["blockStyle", "inline", "link", "lists", "view"]);
    expect(byId.insert!.groups.map((group) => group.id)).toEqual(["insert"]);
    // Every group declares a numeric priority (the ribbon's collapse order).
    for (const tab of tabs) for (const group of tab.groups) expect(typeof group.priority).toBe("number");
    // Home/Insert are fixed; the Table and Code tabs are contextual and hidden
    // until their object is selected.
    expect(byId.home!.contextual).toBeUndefined();
    expect(byId.insert!.contextual).toBeUndefined();
    expect(byId.table!.contextual).toEqual({ when: false, accent: "info" });
    expect(byId.code!.contextual).toEqual({ when: false, accent: "warning" });
  });

  it("keeps at most one large primary per group, and none where Office shows icons (M-3/F4)", () => {
    let tabs: ReturnType<typeof useMarkdownRibbonTabs> = [];
    function Probe() {
      tabs = useMarkdownRibbonTabs(null);
      return null;
    }
    render(<Probe />);
    const byId = Object.fromEntries(tabs.map((tab) => [tab.id, tab]));
    const home = byId.home!;
    // The RibbonItem data model carries the size; assert it on every group.
    for (const group of home.groups) {
      const large = group.items.filter((item) => item.size === "large");
      expect(large.length, `group ${group.id}`).toBeLessThanOrEqual(1);
    }
    expect(ribbonItemId(home, "blockStyle", "large")).toBe("blockStyle");
    expect(ribbonItemId(home, "link", "large")).toBe("link");
    expect(ribbonItemId(byId.insert!, "insert", "large")).toBe("insertTable");
    // M-3/F4: no lone large Bold beside small italic/strike/code, no large
    // bullet-list or outline toggle. Those groups are all icons.
    for (const [groupId, ids] of [
      ["inline", ["bold", "italic", "strike", "inlineCode"]],
      ["lists", ["bulletList", "orderedList", "taskList"]],
      ["view", ["viewOutline", "viewFrontmatter"]],
    ] as const) {
      const group = home.groups.find((candidate) => candidate.id === groupId)!;
      for (const id of ids) {
        const item = group.items.find((candidate) => candidate.id === id)!;
        expect(item.size, `${groupId}/${id}`).not.toBe("large");
      }
    }
    // The contextual Table tab's group carries one too (RB-3/RBF-1); the Code
    // tab's single item is a `custom` control, which owns its own sizing.
    expect(ribbonItemId(byId.table!, "table", "large")).toBe("table-delete");
  });

  it("packs the inline icon strip 2 + 2 with a row break (F4)", () => {
    let tabs: ReturnType<typeof useMarkdownRibbonTabs> = [];
    function Probe() {
      tabs = useMarkdownRibbonTabs(null);
      return null;
    }
    render(<Probe />);
    const byId = Object.fromEntries(tabs.map((tab) => [tab.id, tab]));
    const inline = byId.home!.groups.find((group) => group.id === "inline")!;
    // Office draws B I U S as equal icons; four in one run would make the
    // group a wide line, so the strip breaks before the third.
    expect(inline.items.filter((item) => item.rowBreak).map((item) => item.id)).toEqual(["strike"]);
  });
});

/** The id of the single item at `size` in one tab's group, or a failure. */
function ribbonItemId(tab: { groups: readonly { id: string; items: readonly { id: string; size?: string }[] }[] }, groupId: string, size: string): string {
  const group = tab.groups.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error(`no group ${groupId}`);
  const items = group.items.filter((item) => item.size === size);
  if (items.length !== 1) throw new Error(`group ${groupId} has ${items.length} ${size} items`);
  return items[0]!.id;
}

describe("MarkdownRibbon", () => {
  it("renders the Home groups and executes a command from the ribbon", async () => {
    render(<Harness />);
    await waitForRibbon();
    const root = ribbonRegion();
    for (const id of ["blockStyle", "inline", "link", "lists", "view"]) {
      expect(ribbonGroup(root, id)).toBeInTheDocument();
    }
    // The Undo-only Clipboard group is gone (M-3/F4): undo/redo are the tab
    // row's quick access, never a duplicated ribbon group.
    expect(ribbonRegion().querySelector('[data-ribbon-group="clipboard"]')).toBeNull();
    await act(async () => {
      live!.chain().selectAll().run();
    });
    const bold = ribbonItem(ribbonGroup(root, "inline"), "bold");
    expect(bold).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(bold);
    await waitFor(() => expect(live!.isActive("bold")).toBe(true));
    await waitFor(() => expect(ribbonItem(ribbonGroup(ribbonRegion(), "inline"), "bold")).toHaveAttribute("aria-pressed", "true"));
  });

  it("is mounted by the WYSIWYG editor by default", async () => {
    const [handle] = [createHandle()];
    render(<MarkdownWysiwygEditor documentKey="doc" editor={handle} />);
    await waitFor(() => expect(document.querySelector('[data-office-ribbon="markdown"]')).not.toBeNull());
  });

  it("switches to the Insert tab and shows its group", async () => {
    render(<Harness />);
    await waitForRibbon();
    fireEvent.click(ribbonRegion().querySelector<HTMLElement>('[data-ribbon-tab="insert"]')!);
    expect(ribbonGroup(ribbonRegion(), "insert")).toBeInTheDocument();
    expect(ribbonRegion().querySelector('[data-ribbon-group="lists"]')).toBeNull();
  });

  it("keeps undo/redo in the quick access and Find in the trailing slot", async () => {
    const onFind = vi.fn();
    render(<Harness onFind={onFind} />);
    await waitForRibbon();
    const root = ribbonRegion();
    const quick = root.querySelector<HTMLElement>("[data-ribbon-quick-access]")!;
    expect(quick.querySelectorAll("button")).toHaveLength(2);
    const trailing = root.querySelector<HTMLElement>("[data-ribbon-trailing]")!;
    fireEvent.click(trailing.querySelector("button")!);
    expect(onFind).toHaveBeenCalledTimes(1);
  });

  it("marks the active Source | Visual segment and keeps the 44px coarse-pointer target", async () => {
    const onViewModeChange = vi.fn();
    render(<Harness viewMode="visual" onViewModeChange={onViewModeChange} />);
    await waitForRibbon();
    const trailing = ribbonRegion().querySelector<HTMLElement>("[data-ribbon-trailing]")!;
    const group = trailing.querySelector<HTMLElement>('[data-slot="toggle-group"]')!;
    // The toolbar variant is what paints the selected segment; the default
    // variant's bg-muted is near-invisible on the light band (M-5).
    expect(group).toHaveAttribute("data-variant", "toolbar");
    const [source, visual] = Array.from(group.querySelectorAll<HTMLElement>('[data-slot="toggle-group-item"]'));
    // The active segment exposes a selected state, which the toolbar variant
    // renders as bg-surface-selected in both themes.
    expect(visual).toHaveAttribute("aria-pressed", "true");
    expect(source).toHaveAttribute("aria-pressed", "false");
    for (const segment of [source, visual]) {
      expect(segment!.className).toContain("aria-pressed:bg-surface-selected");
      // 44px on coarse pointers without enlarging the desktop row.
      expect(segment!.className).toContain("pointer-coarse:min-h-11");
      expect(segment!.className).toContain("pointer-coarse:min-w-11");
      expect(segment!.className).toContain("h-7");
    }
    fireEvent.click(source!);
    expect(onViewModeChange).toHaveBeenCalledWith("source");
  });

  /**
   * M-4: the tab row cannot carry the fixed-width trailing cluster (Find + the
   * Source | Visual switch) plus the collapse toggle at phone width without
   * covering the tabs, so at 390 the ribbon must leave the trailing slot EMPTY
   * and let the host draw the same two controls on the frame's subbar. jsdom has
   * no layout, so the assertion is structural.
   */
  it("drops the trailing controls at 390 so the tab row is tabs-only", async () => {
    window.innerWidth = 390;
    render(<Harness onFind={vi.fn()} viewMode="visual" onViewModeChange={vi.fn()} />);
    await waitForRibbon();
    const root = ribbonRegion();
    expect(root).toHaveAttribute("data-ribbon-layout", "simplified");
    // No trailing slot at all, and no mode switch anywhere inside the ribbon.
    expect(root.querySelector("[data-ribbon-trailing]")).toBeNull();
    expect(root.querySelector('[data-slot="toggle-group"]')).toBeNull();
    // The tabs stay reachable: the row still draws the tablist and the toggle.
    expect(root.querySelector('[role="tablist"]')).not.toBeNull();
    expect(root.querySelector('[data-ribbon-collapse-toggle]')).not.toBeNull();
  });

  it("keeps Find and the mode switch in the trailing slot at 1440", async () => {
    window.innerWidth = 1440;
    const onFind = vi.fn();
    render(<Harness onFind={onFind} viewMode="visual" onViewModeChange={vi.fn()} />);
    await waitForRibbon();
    const root = ribbonRegion();
    expect(root).toHaveAttribute("data-ribbon-layout", "full");
    const trailing = root.querySelector<HTMLElement>("[data-ribbon-trailing]");
    expect(trailing).not.toBeNull();
    fireEvent.click(within(trailing!).getByRole("button", { name: "Find" }));
    expect(onFind).toHaveBeenCalledTimes(1);
    expect(trailing!.querySelector('[data-slot="toggle-group"]')).not.toBeNull();
  });

  it("disables every control when the editor is read-only", async () => {
    render(<Harness editable={false} />);
    await waitForRibbon();
    const root = ribbonRegion();
    const quick = root.querySelector<HTMLElement>("[data-ribbon-quick-access]")!;
    for (const button of Array.from(quick.querySelectorAll("button"))) expect(button).toHaveAttribute("aria-disabled", "true");
    expect(ribbonItem(ribbonGroup(root, "inline"), "bold")).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps Undo aria-disabled until there is an edit to undo (UNI-954)", async () => {
    render(<Harness />);
    await waitForRibbon();
    const quick = () => Array.from(ribbonRegion().querySelector<HTMLElement>("[data-ribbon-quick-access]")!.querySelectorAll("button"));
    const before = live!.getText();
    expect(quick()[0]).toHaveAttribute("aria-disabled", "true");
    expect(quick()[1]).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(quick()[0]!);
    expect(live!.getText()).toBe(before);
    await act(async () => { live!.chain().focus().insertContent("x").run(); });
    await waitFor(() => expect(quick()[0]).not.toHaveAttribute("aria-disabled"));
  });

  it("shows the contextual Table tab only while the cursor is inside a table", async () => {
    render(<Harness />);
    await waitForRibbon();
    expect(ribbonRegion().querySelector('[data-ribbon-tab="table"]')).toBeNull();
    await act(async () => {
      live!.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    });
    const tableTab = await waitFor(() => {
      const found = ribbonRegion().querySelector<HTMLElement>('[data-ribbon-tab="table"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(tableTab).toHaveAttribute("data-ribbon-contextual", "info");
    fireEvent.click(tableTab);
    expect(ribbonItem(ribbonGroup(ribbonRegion(), "table"), "table-delete")).toBeInTheDocument();
  });

  /**
   * The CHDEL port: `code-block.test.tsx` was the only test that mounted and
   * exercised `CodeBlockToolbar`; it was deleted with the superseded command
   * row. These cases drive the SAME component through its live mount — the
   * ribbon's contextual Code tab — so a break in `readCodeBlock`,
   * `setCodeBlockLanguage`, `copyCodeBlock` or the `inCodeBlock` gate fails here.
   */
  it("mounts the CodeBlockToolbar from the contextual Code tab only inside a fence", async () => {
    render(<Harness text={CODE_FIXTURE} />);
    await waitForRibbon();
    // Cursor starts in the heading: no Code tab, no toolbar.
    expect(ribbonRegion().querySelector('[data-ribbon-tab="code"]')).toBeNull();
    expect(document.querySelector("[data-code-block-toolbar]")).toBeNull();
    const toolbar = await openCodeTab();
    expect(toolbar.getAttribute("data-code-block-language")).toBe("javascript");
  });

  it("changes the current block's language through the ribbon's toolbar", async () => {
    render(<Harness text={CODE_FIXTURE} />);
    await waitForRibbon();
    const toolbar = await openCodeTab();
    fireEvent.click(within(toolbar).getByRole("button", { name: "Language" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "python" }));
    await waitFor(() => expect(live!.getAttributes("codeBlock").language).toBe("python"));
    // The document really carries the new fence info string.
    expect(live!.getJSON().content?.some((node) => node.type === "codeBlock" && node.attrs?.language === "python")).toBe(true);
  });

  it("clears the info string when Plain text is chosen (a bare fence)", async () => {
    render(<Harness text={CODE_FIXTURE} />);
    await waitForRibbon();
    const toolbar = await openCodeTab();
    fireEvent.click(within(toolbar).getByRole("button", { name: "Language" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Plain text" }));
    await waitFor(() => expect(live!.getAttributes("codeBlock").language).toBe(""));
    // It serialises as a bare fence, not ```plaintext.
    await waitFor(() => expect(document.querySelector("[data-code-block-toolbar]")?.getAttribute("data-code-block-language")).toBe("plaintext"));
  });

  it("copies the block's exact text to the clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Harness text={CODE_FIXTURE} />);
    await waitForRibbon();
    const toolbar = await openCodeTab();
    // The node view has its own copy button; scope to this contextual toolbar.
    fireEvent.click(within(toolbar).getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODE_TEXT));
  });

  it("keeps the language menu closed while the editor is read-only", async () => {
    render(<Harness text={CODE_FIXTURE} editable={false} />);
    await waitForRibbon();
    // The control is still present (disabled, not hidden) and does not mutate.
    const toolbar = await openCodeTab();
    const trigger = within(toolbar).getByRole("button", { name: "Language" });
    expect(trigger).toBeDisabled();
    const before = JSON.stringify(live!.getJSON());
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(document.querySelector('[data-toolbar-menu="codeBlockLanguage"]')).toBeNull();
    expect(JSON.stringify(live!.getJSON())).toBe(before);
  });
});
