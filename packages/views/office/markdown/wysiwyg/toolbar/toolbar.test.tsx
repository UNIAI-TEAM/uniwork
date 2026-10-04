// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import { MarkdownWysiwygEditor } from "../editor";
import type { TextEditorHandle } from "../../../source-editor-types";
import { MarkdownCommandRow } from "./command-row";
import { useMarkdownToolbarActions } from "./use-markdown-toolbar-state";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const FIXTURE = `# Title

Body paragraph.

Final line.
`;

/** One shared text source, exactly as the product shares one handle. */
function createTextSource(initial: string) {
  let text = initial;
  const listeners = new Set<(next: string) => void>();
  return {
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
  };
}

function createHandle(source: ReturnType<typeof createTextSource>): TextEditorHandle {
  return {
    format: "md",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 1,
    captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { text: source.getText() } })),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    source,
  };
}

let live: Editor | null = null;

/** Editor + command row over one shared text source, wired as the product does. */
function Harness({ editable = true, ...row }: Partial<Parameters<typeof MarkdownCommandRow>[0]>) {
  const [handle] = useState(() => createHandle(createTextSource(FIXTURE)));
  const [instance, setInstance] = useState<Editor | null>(null);
  useEffect(() => {
    live = instance;
  }, [instance]);
  return (
    <div>
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} editable={editable} onEditorReady={setInstance} showRibbon={false} />
      <MarkdownCommandRow editor={instance} editable={editable} {...row} />
    </div>
  );
}

function renderRow(props: Partial<Parameters<typeof MarkdownCommandRow>[0]> = {}) {
  return render(<Harness {...props} />);
}

/**
 * Calls the actions directly, bypassing every disabled surface. The read-only
 * contract has to hold here too: a ribbon custom item, a menu entry or a future
 * host can reach an action without going through a disabled button.
 */
function ActionsProbe({ editor }: { editor: Editor | null }) {
  const actions = useMarkdownToolbarActions(editor);
  return (
    <>
      <button type="button" onClick={() => actions.setBlockStyle("heading2")}>
        probe block style
      </button>
      <button type="button" onClick={() => actions.toggleMark("bold")}>
        probe bold
      </button>
    </>
  );
}

const GROUP_ORDER = ["blockStyle", "inline", "link", "lists", "insert", "view"];

async function waitForRow() {
  await waitFor(() => expect(live).not.toBeNull());
  await waitFor(() => expect(screen.getByTestId("md-toolbar")).toBeInTheDocument());
}

describe("MarkdownCommandRow", () => {
  it("renders every control exactly once, groups in the C7 order", async () => {
    renderRow();
    await waitForRow();
    const groups = within(screen.getByTestId("md-toolbar")).getAllByRole("group");
    const ids = groups.map((group) => group.getAttribute("data-ribbon-group"));
    expect(ids.slice(0, GROUP_ORDER.length)).toEqual(GROUP_ORDER);
    for (const name of ["Bold", "Italic", "Strikethrough", "Inline code", "Link", "Bullet list", "Numbered list", "Task list", "Insert table", "Insert image", "Insert divider"]) {
      expect(screen.getAllByRole("button", { name })).toHaveLength(1);
    }
    // Undo/redo (chrome tab row) and Save (shared cluster) are not duplicated here.
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save to UniWork" })).not.toBeInTheDocument();
  });

  it("reflects the editor's active marks on the toggles", async () => {
    renderRow();
    await waitForRow();
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "false");
    await act(async () => {
      live!.chain().selectAll().toggleBold().run();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true"));
    await act(async () => {
      live!.chain().selectAll().toggleItalic().run();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Italic" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("disables every control when the editor is read-only", async () => {
    renderRow({ editable: false });
    await waitForRow();
    for (const name of ["Bold", "Italic", "Strikethrough", "Inline code", "Link", "Bullet list", "Insert table"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("applies the block style chosen in the one compact dropdown", async () => {
    renderRow();
    await waitForRow();
    fireEvent.click(screen.getByRole("button", { name: "Block style" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Heading 2" }));
    await waitFor(() => expect(live!.isActive("heading", { level: 2 })).toBe(true));
  });

  it("toggles lists and inserts a table through the editor", async () => {
    renderRow();
    await waitForRow();
    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));
    await waitFor(() => expect(live!.isActive("bulletList")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Insert table" }));
    await waitFor(() => expect(JSON.stringify(live!.getJSON())).toContain("table"));
  });

  it("keeps the image control reachable but disabled until upload exists", async () => {
    renderRow();
    await waitForRow();
    expect(screen.getByRole("button", { name: "Insert image" })).toHaveAttribute("aria-disabled", "true");
  });

  it("enables the image control once the caller supplies an insert", async () => {
    const onInsertImage = vi.fn();
    renderRow({ onInsertImage });
    await waitForRow();
    const image = screen.getByRole("button", { name: "Insert image" });
    expect(image).not.toHaveAttribute("aria-disabled");
    fireEvent.click(image);
    expect(onInsertImage).toHaveBeenCalledTimes(1);
  });

  it("reports the outline and front-matter toggles to the caller", async () => {
    const onOutlineChange = vi.fn();
    const onFrontmatterChange = vi.fn();
    renderRow({ onOutlineChange, onFrontmatterChange });
    await waitForRow();
    fireEvent.click(screen.getByRole("button", { name: "Show outline" }));
    expect(onOutlineChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Show front matter" }));
    expect(onFrontmatterChange).toHaveBeenCalledWith(true);
  });

  it("adds a link through the popover and normalises the URL", async () => {
    renderRow();
    await waitForRow();
    await act(async () => {
      live!.chain().selectAll().run();
    });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    const url = await screen.findByLabelText("Paste a URL");
    fireEvent.change(url, { target: { value: "example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply link" }));
    await waitFor(() => expect(live!.isActive("link")).toBe(true));
    expect(live!.getAttributes("link").href).toBe("https://example.com");
  });

  it("keeps the block-style menu closed while the editor is read-only", async () => {
    renderRow({ editable: false });
    await waitForRow();
    const trigger = screen.getByRole("button", { name: "Block style" });
    // Base UI opens a menu on mousedown and on keyboard, not on `onClick`, so
    // the guard has to be the trigger's own `disabled` - the button's
    // `aria-disabled` alone never sees these paths.
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toBeDisabled();
    const before = JSON.stringify(live!.getJSON());
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(document.querySelector('[data-toolbar-menu="blockStyle"]')).toBeNull();
    expect(JSON.stringify(live!.getJSON())).toBe(before);
  });

  it("keeps the link popover closed while the editor is read-only", async () => {
    renderRow({ editable: false });
    await waitForRow();
    const trigger = screen.getByRole("button", { name: "Link" });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(document.querySelector('[data-toolbar-popover="link"]')).toBeNull();
  });

  it("makes every command inert on a non-editable editor, even when called directly", async () => {
    renderRow({ editable: false });
    await waitForRow();
    await act(async () => {
      live!.chain().selectAll().run();
    });
    const before = JSON.stringify(live!.getJSON());
    render(<ActionsProbe editor={live} />);
    fireEvent.click(screen.getByRole("button", { name: "probe block style" }));
    fireEvent.click(screen.getByRole("button", { name: "probe bold" }));
    expect(JSON.stringify(live!.getJSON())).toBe(before);
  });

  it("edits an existing link from the popover, seeded with its current target", async () => {
    renderRow();
    await waitForRow();
    await act(async () => {
      live!.chain().selectAll().setLink({ href: "https://example.com", title: "Example" }).run();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Link" })).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    const url = await screen.findByLabelText("Paste a URL");
    expect(url).toHaveValue("https://example.com");
    expect(screen.getByLabelText("Link title (optional)")).toHaveValue("Example");
    fireEvent.change(url, { target: { value: "docs.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply link" }));
    await waitFor(() => expect(live!.getAttributes("link").href).toBe("https://docs.example.com"));
  });

  it("removes a link from the popover", async () => {
    renderRow();
    await waitForRow();
    await act(async () => {
      live!.chain().selectAll().setLink({ href: "https://example.com" }).run();
    });
    await waitFor(() => expect(live!.isActive("link")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove link" }));
    await waitFor(() => expect(live!.isActive("link")).toBe(false));
  });

  it("applies the link when Enter is pressed in the URL field", async () => {
    renderRow();
    await waitForRow();
    await act(async () => {
      live!.chain().selectAll().run();
    });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    const url = await screen.findByLabelText("Paste a URL");
    fireEvent.change(url, { target: { value: "example.com" } });
    fireEvent.keyDown(url, { key: "Enter" });
    await waitFor(() => expect(live!.isActive("link")).toBe(true));
    expect(live!.getAttributes("link").href).toBe("https://example.com");
  });

  it("is keyboard reachable: the control takes focus and Enter runs it", async () => {
    renderRow();
    await waitForRow();
    await act(async () => {
      live!.chain().selectAll().run();
    });
    const bold = screen.getByRole("button", { name: "Bold" });
    bold.focus();
    expect(bold).toHaveFocus();
    fireEvent.keyDown(bold, { key: "Enter" });
    fireEvent.click(bold);
    await waitFor(() => expect(live!.isActive("bold")).toBe(true));
  });
});
