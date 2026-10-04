// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import { MarkdownWysiwygEditor } from "./editor";
import { MARKDOWN_RIBBON_KEYS, MarkdownRibbon, useMarkdownRibbonTabs } from "./ribbon";
import type { TextEditorHandle } from "../../source-editor-types";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const FIXTURE = "# Title\n\nBody paragraph.\n";

function createHandle(): TextEditorHandle {
  let text = FIXTURE;
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
function Harness({ editable = true, ...ribbon }: Partial<Parameters<typeof MarkdownRibbon>[0]>) {
  const [handle] = useState(createHandle);
  const [instance, setInstance] = useState<Editor | null>(null);
  useEffect(() => {
    live = instance;
  }, [instance]);
  return (
    <div>
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} editable={editable} onEditorReady={setInstance} />
      <MarkdownRibbon editor={instance} editable={editable} {...ribbon} />
    </div>
  );
}

async function waitForRibbon() {
  await waitFor(() => expect(live).not.toBeNull());
  await waitFor(() => expect(screen.getByRole("region", { name: MARKDOWN_RIBBON_KEYS.label })).toBeInTheDocument());
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
    // Home carries the C6/C7 order: clipboard, block style, inline, link, lists, view.
    expect(byId.home!.groups.map((group) => group.id)).toEqual(["clipboard", "blockStyle", "inline", "link", "lists", "view"]);
    expect(byId.insert!.groups.map((group) => group.id)).toEqual(["insert"]);
    // Every group declares a numeric priority (the ribbon's collapse order).
    for (const tab of tabs) for (const group of tab.groups) expect(typeof group.priority).toBe("number");
    // Home/Insert are fixed; the Table and Code tabs are contextual and hidden
    // until their object is selected.
    expect(byId.home!.contextual).toBeUndefined();
    expect(byId.insert!.contextual).toBeUndefined();
    expect(byId.table!.contextual).toEqual({ when: false, accent: "info" });
    expect(byId.code!.contextual).toEqual({ when: false, accent: "warning" });
    // R2: one large primary button per group (undo in Clipboard; the rest icon).
    const clipboard = byId.home!.groups[0]!;
    expect(clipboard.items.find((item) => item.id === "undo")?.size).toBe("large");
    expect(clipboard.items.find((item) => item.id === "redo")?.size).toBe("icon");
  });
});

describe("MarkdownRibbon", () => {
  it("renders the Home groups and executes a command from the ribbon", async () => {
    render(<Harness />);
    await waitForRibbon();
    // New ribbon.* keys are still pending in the locale files, so i18next
    // echoes the key; the labels that already exist read in English.
    for (const caption of [
      MARKDOWN_RIBBON_KEYS.clipboard,
      MARKDOWN_RIBBON_KEYS.paragraph,
      "Inline",
      "Link",
      "Lists",
      "View",
    ]) {
      expect(screen.getByRole("group", { name: caption })).toBeInTheDocument();
    }
    await act(async () => {
      live!.chain().selectAll().run();
    });
    const inlineGroup = () => screen.getByRole("group", { name: "Inline" });
    const bold = within(inlineGroup()).getByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(bold);
    await waitFor(() => expect(live!.isActive("bold")).toBe(true));
    await waitFor(() => expect(within(inlineGroup()).getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("switches to the Insert tab and shows its group", async () => {
    render(<Harness />);
    await waitForRibbon();
    fireEvent.click(screen.getByRole("tab", { name: MARKDOWN_RIBBON_KEYS.insert }));
    expect(screen.getByRole("group", { name: "Insert" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Lists" })).not.toBeInTheDocument();
  });

  it("keeps undo/redo in the quick access and Find in the trailing slot", async () => {
    const onFind = vi.fn();
    render(<Harness onFind={onFind} />);
    await waitForRibbon();
    const quick = screen.getByRole("toolbar", { name: "Quick access" });
    expect(within(quick).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(within(quick).getByRole("button", { name: "Redo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(onFind).toHaveBeenCalledTimes(1);
  });

  it("disables every control when the editor is read-only", async () => {
    render(<Harness editable={false} />);
    await waitForRibbon();
    expect(within(screen.getByRole("toolbar", { name: "Quick access" })).getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(within(screen.getByRole("group", { name: "Inline" })).getByRole("button", { name: "Bold" })).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the contextual Table tab only while the cursor is inside a table", async () => {
    render(<Harness />);
    await waitForRibbon();
    expect(screen.queryByRole("tab", { name: MARKDOWN_RIBBON_KEYS.table })).not.toBeInTheDocument();
    await act(async () => {
      live!.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    });
    const tableTab = await screen.findByRole("tab", { name: MARKDOWN_RIBBON_KEYS.table });
    expect(tableTab).toHaveAttribute("data-ribbon-contextual", "info");
    fireEvent.click(tableTab);
    expect(within(screen.getByRole("group", { name: MARKDOWN_RIBBON_KEYS.tableGroup })).getByRole("button", { name: MARKDOWN_RIBBON_KEYS.tableDelete })).toBeInTheDocument();
  });
});
