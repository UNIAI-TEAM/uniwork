// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import { EditorChrome } from "../../../common/chrome";
import { MarkdownWysiwygEditor } from "../editor";
import type { TextEditorHandle } from "../../../source-editor-types";
import { useMarkdownToolbarChromeTab } from "./chrome-tab";

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
let renderedTab: ReturnType<typeof useMarkdownToolbarChromeTab> | null = null;

/** jsdom lays nothing out: report the widths the chrome's overflow decision reads. */
function stubWidths(widths: Record<string, number>, rowWidth: number): () => void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const group = this.getAttribute("data-chrome-group");
    const width = group ? widths[group] : undefined;
    if (width !== undefined) {
      return { x: 0, y: 0, width, height: 28, top: 0, left: 0, right: width, bottom: 28, toJSON: () => ({}) } as DOMRect;
    }
    if (this.getAttribute("data-testid") === "editor-chrome-commands") {
      return { x: 0, y: 0, width: rowWidth, height: 44, top: 0, left: 0, right: rowWidth, bottom: 44, toJSON: () => ({}) } as DOMRect;
    }
    return original.call(this);
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

/** The Markdown groups mounted in the SHARED chrome, exactly as a host would. */
function Harness() {
  const [handle] = useState(createHandle);
  const [instance, setInstance] = useState<Editor | null>(null);
  useEffect(() => {
    live = instance;
  }, [instance]);
  const tab = useMarkdownToolbarChromeTab(instance);
  renderedTab = tab;
  return (
    <div>
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} onEditorReady={setInstance} showRibbon={false} />
      <EditorChrome tabs={[tab]} viewModes={[{ id: "wysiwyg", label: "Visual" }, { id: "source", label: "Source" }]} activeViewMode="wysiwyg" />
    </div>
  );
}

async function waitForChrome() {
  await waitFor(() => expect(live).not.toBeNull());
  await waitFor(() => expect(screen.getByTestId("editor-chrome-commands")).toBeInTheDocument());
}

describe("useMarkdownToolbarChromeTab", () => {
  it("mounts the six C7 groups into the shared chrome's single command row", async () => {
    render(<Harness />);
    await waitForChrome();
    const row = screen.getByTestId("editor-chrome-commands");
    const ids = within(row)
      .getAllByRole("group")
      .map((group) => group.getAttribute("data-chrome-group"))
      .filter(Boolean);
    expect(ids).toEqual(["blockStyle", "inline", "link", "lists", "insert", "view"]);
    // Exactly one command row: the toolbar is chrome content, never a second bar.
    expect(screen.getAllByTestId("editor-chrome-commands")).toHaveLength(1);
    expect(screen.queryByTestId("md-toolbar")).not.toBeInTheDocument();
  });

  it("drives the M1 editor from a chrome control and reports active state", async () => {
    render(<Harness />);
    await waitForChrome();
    await act(async () => {
      live!.chain().selectAll().run();
    });
    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(bold);
    await waitFor(() => expect(live!.isActive("bold")).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("leaves the link and block-style menu fallbacks inert (no silent command)", async () => {
    render(<Harness />);
    await waitForChrome();
    // A menu entry cannot host a popover or a dropdown, so the chrome's
    // fallback must not run a destructive command from the "»" menu.
    const tab = renderedTab!;
    const link = tab.groups.flatMap((group) => group.items).find((item) => item.id === "link");
    const blockStyle = tab.groups.flatMap((group) => group.items).find((item) => item.id === "blockStyle");
    expect(link?.onSelect).toBeUndefined();
    expect(blockStyle?.onSelect).toBeUndefined();
    // A plain control still carries its command for the menu.
    const bold = tab.groups.flatMap((group) => group.items).find((item) => item.id === "bold");
    expect(typeof bold?.onSelect).toBe("function");
  });

  it("drives the editor from the » overflow menu and keeps the two custom entries inert", async () => {
    // Every group is too wide for the row, so all six move into "»".
    const restore = stubWidths(
      { blockStyle: 400, inline: 400, link: 400, lists: 400, insert: 400, view: 400 },
      300,
    );
    try {
      render(<Harness />);
      await waitForChrome();
      await act(async () => {
        live!.chain().selectAll().run();
      });
      // A plain control still runs its command from the menu.
      fireEvent.click(await screen.findByTestId("editor-chrome-overflow"));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Bold" }));
      await waitFor(() => expect(live!.isActive("bold")).toBe(true));
      // The block-style dropdown and the link popover cannot be rebuilt inside a
      // menu, so their entries are inert labels - a menu click must not silently
      // apply a style or drop a link. The menu closes on each item click, so
      // re-open it for the second entry.
      const before = JSON.stringify(live!.getJSON());
      fireEvent.click(screen.getByTestId("editor-chrome-overflow"));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Block style" }));
      expect(JSON.stringify(live!.getJSON())).toBe(before);
      fireEvent.click(screen.getByTestId("editor-chrome-overflow"));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Link" }));
      expect(JSON.stringify(live!.getJSON())).toBe(before);
    } finally {
      restore();
    }
  });

  it("does not add undo/redo or Save to the Markdown groups", async () => {
    render(<Harness />);
    await waitForChrome();
    const row = screen.getByTestId("editor-chrome-commands");
    expect(within(row).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Redo" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Save to UniWork" })).not.toBeInTheDocument();
  });
});
