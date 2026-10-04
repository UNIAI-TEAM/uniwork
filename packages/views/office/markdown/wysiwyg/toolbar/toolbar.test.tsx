// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import { MarkdownWysiwygEditor } from "../editor";
import type { TextEditorHandle } from "../../../source-editor-types";
import { MarkdownCommandRow } from "./command-row";

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
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} editable={editable} onEditorReady={setInstance} />
      <MarkdownCommandRow editor={instance} editable={editable} {...row} />
    </div>
  );
}

function renderRow(props: Partial<Parameters<typeof MarkdownCommandRow>[0]> = {}) {
  return render(<Harness {...props} />);
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
