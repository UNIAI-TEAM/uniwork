// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import { MarkdownWysiwygEditor } from "./editor";
import { CodeBlockToolbar } from "./code-block";
import { MarkdownCommandRow } from "./toolbar/command-row";
import type { TextEditorHandle } from "../../source-editor-types";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const FENCE = "```";
const CODE = "const answer = 42;";
const FIXTURE = ["# Title", "", FENCE + "javascript", CODE, FENCE, ""].join("\n");

function createHandle(initial: string): TextEditorHandle {
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

/** The code-block controls mounted the way the product mounts them: through
 * the toolbar group data, so the command row (and the ribbon) carry them. */
function Harness({ editable = true }: { editable?: boolean } = {}) {
  const [handle] = useState(() => createHandle(FIXTURE));
  const [instance, setInstance] = useState<Editor | null>(null);
  useEffect(() => {
    live = instance;
  }, [instance]);
  return (
    <div>
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} editable={editable} onEditorReady={setInstance} showRibbon={false} />
      <MarkdownCommandRow editor={instance} editable={editable} />
    </div>
  );
}

/** Put the cursor inside the document's first code block. */
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

async function waitForRow() {
  await waitFor(() => expect(live).not.toBeNull());
  await waitFor(() => expect(screen.getByTestId("md-toolbar")).toBeInTheDocument());
}

describe("CodeBlockToolbar", () => {
  it("is unmounted outside a code block and appears from the group data inside one", async () => {
    render(<Harness />);
    await waitForRow();
    // Cursor starts in the heading: the contextual control renders nothing.
    expect(document.querySelector("[data-code-block-toolbar]")).toBeNull();
    selectCodeBlock();
    await waitFor(() => expect(document.querySelector("[data-code-block-toolbar]")).toBeTruthy());
    expect(document.querySelector("[data-code-block-toolbar]")?.getAttribute("data-code-block-language")).toBe("javascript");
  });

  it("changes the current block's language through updateAttributes", async () => {
    render(<Harness />);
    await waitForRow();
    selectCodeBlock();
    await waitFor(() => expect(document.querySelector("[data-code-block-toolbar]")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "python" }));
    await waitFor(() => expect(live!.getAttributes("codeBlock").language).toBe("python"));
    // The document really carries the new fence info string.
    expect(live!.getJSON().content?.some((node) => node.type === "codeBlock" && node.attrs?.language === "python")).toBe(true);
  });

  it("clears the info string when Plain text is chosen (a bare fence)", async () => {
    render(<Harness />);
    await waitForRow();
    selectCodeBlock();
    await waitFor(() => expect(document.querySelector("[data-code-block-toolbar]")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Plain text" }));
    await waitFor(() => expect(live!.getAttributes("codeBlock").language).toBe(""));
    // It serialises as a bare fence, not ```plaintext.
    await waitFor(() => expect(document.querySelector("[data-code-block-toolbar]")?.getAttribute("data-code-block-language")).toBe("plaintext"));
  });

  it("copies the block's exact text to the clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Harness />);
    await waitForRow();
    selectCodeBlock();
    await waitFor(() => expect(document.querySelector("[data-code-block-toolbar]")).toBeTruthy());
    // The node view has its own copy button; scope to this contextual toolbar.
    const toolbar = document.querySelector("[data-code-block-toolbar]") as HTMLElement;
    fireEvent.click(within(toolbar).getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODE));
  });

  it("keeps the language menu closed while the editor is read-only", async () => {
    render(<Harness editable={false} />);
    await waitForRow();
    // The control is still present (disabled, not hidden) and does not mutate.
    selectCodeBlock();
    await waitFor(() => expect(document.querySelector("[data-code-block-toolbar]")).toBeTruthy());
    const trigger = screen.getByRole("button", { name: "Language" });
    expect(trigger).toBeDisabled();
    const before = JSON.stringify(live!.getJSON());
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(document.querySelector('[data-toolbar-menu="codeBlockLanguage"]')).toBeNull();
    expect(JSON.stringify(live!.getJSON())).toBe(before);
  });

});
