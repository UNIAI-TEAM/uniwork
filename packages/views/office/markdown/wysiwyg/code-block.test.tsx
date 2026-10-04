// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import { MarkdownWysiwygEditor } from "./editor";
import { CodeBlockToolbar, useCodeBlockToolbar } from "./code-block";
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

/** The contextual code-block controls, mounted exactly as the surface does. */
function Harness() {
  const [handle] = useState(() => createHandle(FIXTURE));
  const [instance, setInstance] = useState<Editor | null>(null);
  useEffect(() => {
    live = instance;
  }, [instance]);
  const props = useCodeBlockToolbar(instance);
  return (
    <div>
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} onEditorReady={setInstance} />
      <CodeBlockToolbar {...props} />
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

describe("CodeBlockToolbar", () => {
  it("hides outside a code block and appears when the cursor is inside one", async () => {
    render(<Harness />);
    await waitFor(() => expect(live).not.toBeNull());
    // Cursor starts in the heading: nothing to control.
    expect(document.querySelector("[data-code-block-toolbar]")).toBeNull();
    selectCodeBlock();
    await waitFor(() => expect(document.querySelector("[data-code-block-toolbar]")).toBeTruthy());
    expect(document.querySelector("[data-code-block-toolbar]")?.getAttribute("data-code-block-language")).toBe("javascript");
  });

  it("changes the current block's language through updateAttributes", async () => {
    render(<Harness />);
    await waitFor(() => expect(live).not.toBeNull());
    selectCodeBlock();
    await waitFor(() => expect(document.querySelector("[data-code-block-toolbar]")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "python" }));
    await waitFor(() => expect(live!.getAttributes("codeBlock").language).toBe("python"));
    // The document really carries the new fence info string.
    expect(live!.getJSON().content?.some((node) => node.type === "codeBlock" && node.attrs?.language === "python")).toBe(true);
  });

  it("copies the block's exact text to the clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Harness />);
    await waitFor(() => expect(live).not.toBeNull());
    selectCodeBlock();
    await waitFor(() => expect(document.querySelector("[data-code-block-toolbar]")).toBeTruthy());
    // The node view has its own copy button; scope to this contextual toolbar.
    const toolbar = document.querySelector("[data-code-block-toolbar]") as HTMLElement;
    fireEvent.click(within(toolbar).getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODE));
  });
});
