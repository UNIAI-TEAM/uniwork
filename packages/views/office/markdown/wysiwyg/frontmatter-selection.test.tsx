// @vitest-environment jsdom
/**
 * UNI-928 B-2 regression: the front-matter raw node is never selected on open,
 * and a keystroke never replaces it.
 *
 * The `markdownRaw` node carries the front matter verbatim. It used to be
 * `selectable: true`, so `Selection.atStart` - the selection TipTap creates
 * when no `autofocus` is given - landed a `NodeSelection` on it. The next
 * keystroke then replaced the whole block and the saved version lost its front
 * matter (data loss). This pins the fixed behaviour: the initial selection is a
 * caret in the first text block, and typing inserts into that block instead of
 * replacing the raw node.
 */
import { render, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import { MarkdownWysiwygEditor } from "./editor";
import { MARKDOWN_RAW_NODE_NAME } from "./raw-node";
import type { TextEditorHandle } from "../../source-editor-types";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const FRONTMATTER = "---\ntitle: Kitchen sink\ntags:\n  - alpha\n  - beta\n---\n";
const BODY = "# Heading one\n\nBody paragraph.\n";
const FIXTURE = FRONTMATTER + "\n" + BODY;

/** A stand-in for the host's text source (see editor.test.tsx). */
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

describe("front matter selection (B-2)", () => {
  it("opens with the caret in the first text block and typing never replaces the raw node", async () => {
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    let live: Editor | null = null;
    render(
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} onEditorReady={(editor) => { live = editor; }} />,
    );
    await waitFor(() => expect(live).not.toBeNull());

    // The first block is the opaque raw node carrying the front matter.
    const raw = live!.state.doc.nodeAt(0);
    expect(raw?.type.name).toBe(MARKDOWN_RAW_NODE_NAME);
    // The initial selection is the caret in the first text block, not the raw
    // node. Pre-fix `Selection.atStart` selected the atom instead.
    const selection = live!.state.selection;
    expect(selection).toBeInstanceOf(TextSelection);
    expect(selection.$from.parent.textContent).toBe("Heading one");
    // Non-selectable: neither `Selection.atStart` nor a click can select it.
    expect(NodeSelection.isSelectable(raw!)).toBe(false);

    // Type one character at the caret. Pre-fix the selection was a NodeSelection
    // over the raw node, so this replaced the front matter with the character.
    const { from, to } = live!.state.selection;
    await act(async () => {
      live!.commands.command(({ tr }) => {
        tr.insertText("x", from, to);
        return true;
      });
    });

    // The typed character landed in the paragraph ...
    await waitFor(() => expect(source.getText()).toContain("xHeading one"));
    // ... and the front matter is still there, byte-identical.
    expect(source.getText().startsWith(FRONTMATTER)).toBe(true);
    expect(source.getText().slice(0, FRONTMATTER.length)).toBe(FRONTMATTER);

    // A stray NodeSelection over the raw node (a stale selection or a command
    // that bypasses `isSelectable`) is repaired instead of left to swallow the
    // next keystroke.
    await act(async () => {
      live!.commands.setNodeSelection(0);
    });
    expect(live!.state.selection).toBeInstanceOf(TextSelection);
    expect(live!.state.selection.$from.parent.textContent).toBe("xHeading one");
  });

  it("keeps the caret in an appended empty paragraph for a front-matter-ONLY document", async () => {
    // A document whose blocks are ALL unrepresentable parses to `[markdownRaw]`
    // with no textblock, so `Selection.atStart` returned `AllSelection` and the
    // first keystroke replaced the WHOLE document - the front matter included.
    // `toEditorDocument` now appends an empty paragraph when there is no
    // textblock, which gives `atStart` a caret home; the empty paragraph
    // serialises to "" so byte-identity is preserved.
    const only = "---\ntitle: Only\n---\n";
    const source = createTextSource(only);
    const handle = createHandle(source);
    let live: Editor | null = null;
    render(
      <MarkdownWysiwygEditor documentKey="doc-only" editor={handle} onEditorReady={(editor) => { live = editor; }} />,
    );
    await waitFor(() => expect(live).not.toBeNull());

    // The only real block is the raw node; the caret sits in the appended
    // paragraph after it, not in an `AllSelection` over the document.
    const doc = live!.state.doc;
    expect(doc.child(0).type.name).toBe(MARKDOWN_RAW_NODE_NAME);
    expect(doc.lastChild?.type.name).toBe("paragraph");
    expect(live!.state.selection).toBeInstanceOf(TextSelection);
    expect(live!.state.selection.$from.parent.type.name).toBe("paragraph");

    // Type one character at the caret. Pre-fix the `AllSelection` replaced the
    // front matter with the character.
    const { from, to } = live!.state.selection;
    await act(async () => {
      live!.commands.command(({ tr }) => {
        tr.insertText("x", from, to);
        return true;
      });
    });

    await waitFor(() => expect(source.getText()).toContain("x"));
    // The front matter is still present, byte-identical, and the typed `x` is
    // NOT inside the raw block.
    expect(source.getText().startsWith(only)).toBe(true);
    expect(source.getText().slice(0, only.length)).toBe(only);
    const raw = live!.state.doc.child(0);
    expect(raw.textContent).toBe("");
  });
});
