// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import { MarkdownWysiwygEditor } from "./editor";
import type { TextEditorHandle } from "../../source-editor-types";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const FIXTURE = `# Title

Body paragraph.

<!-- comment -->

Final line.
`;

/**
 * A stand-in for the host's text source: one string, plus the subscribe/notify
 * pair a `SourceTextPort` exposes. Both editors in a toggle share ONE of these,
 * exactly as they share one handle in the product.
 */
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

/** A source <-> visual toggle over one shared text source. */
function ToggleHarness({
  handle,
  onEditorReady,
  onCheckpoint,
}: {
  handle: TextEditorHandle;
  onEditorReady: (editor: Editor | null) => void;
  onCheckpoint: () => void;
}) {
  const [visual, setVisual] = useState(true);
  const [text, setText] = useState(() => handle.source!.getText());
  useEffect(() => handle.source!.subscribe!((next: string) => setText(next)), [handle]);
  return (
    <div>
      <button type="button" onClick={() => setVisual((value) => !value)}>
        toggle
      </button>
      {visual ? (
        <MarkdownWysiwygEditor
          documentKey="doc"
          editor={handle}
          onEditorReady={onEditorReady}
          onCheckpoint={onCheckpoint}
        />
      ) : (
        <textarea aria-label="source" value={text} onChange={(event) => handle.source!.setText(event.target.value)} />
      )}
    </div>
  );
}

describe("MarkdownWysiwygEditor", () => {
  it("mounts a ProseMirror surface driven by the shared text source", async () => {
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    const onEditorReady = vi.fn();
    const { container } = render(
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} onEditorReady={onEditorReady} />,
    );
    const surface = await waitFor(() => {
      const element = container.querySelector(".ProseMirror[contenteditable='true']");
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    expect(surface).toHaveAttribute("role", "textbox");
    expect(surface.textContent).toContain("Body paragraph.");
    // The raw comment survives as a preserved block, visible but not editable.
    expect(container.querySelector("[data-markdown-raw]")).toBeTruthy();
    await waitFor(() => expect(onEditorReady).toHaveBeenCalledWith(expect.objectContaining({ getJSON: expect.any(Function) })));
  });

  it("writes an edit back to the shared text source", async () => {
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    let live: Editor | null = null;
    const onChange = vi.fn();
    render(
      <MarkdownWysiwygEditor
        documentKey="doc"
        editor={handle}
        onEditorReady={(editor) => { live = editor; }}
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(live).not.toBeNull());
    await act(async () => {
      live!.commands.insertContentAt(live!.state.doc.content.size, { type: "paragraph", content: [{ type: "text", text: "Appended." }] });
    });
    await waitFor(() => expect(source.getText()).toContain("Appended."));
    // Everything before the edit is untouched, byte for byte.
    expect(source.getText().startsWith(FIXTURE.slice(0, FIXTURE.indexOf("Final line.")))).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });

  it("parses an external source change back into the visual editor", async () => {
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    let live: Editor | null = null;
    render(<MarkdownWysiwygEditor documentKey="doc" editor={handle} onEditorReady={(editor) => { live = editor; }} />);
    await waitFor(() => expect(live).not.toBeNull());
    await act(async () => {
      source.setText("# Replaced\n\nNew body.\n");
    });
    await waitFor(() => expect(live!.getJSON().content?.[0]?.type).toBe("heading"));
    expect(JSON.stringify(live!.getJSON())).toContain("New body.");
  });

  it("round-trips source <-> visual through the same text source", async () => {
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    let live: Editor | null = null;
    render(<ToggleHarness handle={handle} onEditorReady={(editor) => { live = editor; }} onCheckpoint={() => undefined} />);
    await waitFor(() => expect(live).not.toBeNull());

    // Visual -> source: the textarea shows the same bytes.
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    const textarea = await screen.findByLabelText("source");
    expect((textarea as HTMLTextAreaElement).value).toBe(FIXTURE);

    // Edit in source, then toggle back: the visual editor shows the edit and
    // serialises it back to the same source.
    fireEvent.change(textarea, { target: { value: FIXTURE.replace("Body paragraph.", "Body edited in source.") } });
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    const surface = await waitFor(() => {
      const element = document.querySelector(".ProseMirror[contenteditable='true']");
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    expect(surface.textContent).toContain("Body edited in source.");
    await waitFor(() => expect(live!.getJSON().content?.length).toBeGreaterThan(0));
    // The bytes outside the edit are still the original ones.
    expect(source.getText().startsWith("# Title\n\nBody edited in source.")).toBe(true);
    expect(source.getText().endsWith("Final line.\n")).toBe(true);
  });


  it("mounts the new document when documentKey changes in place", async () => {
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    let live: Editor | null = null;
    const { container, rerender } = render(
      <MarkdownWysiwygEditor documentKey="doc-a" editor={handle} onEditorReady={(editor) => { live = editor; }} />,
    );
    await waitFor(() => expect(live).not.toBeNull());
    expect(container.querySelector(".ProseMirror")!.textContent).toContain("Body paragraph.");

    source.setText("# Second document\n\nDifferent body.\n");
    rerender(<MarkdownWysiwygEditor documentKey="doc-b" editor={handle} onEditorReady={(editor) => { live = editor; }} />);
    await waitFor(() => {
      const surface = container.querySelector(".ProseMirror");
      expect(surface?.textContent).toContain("Different body.");
    });
    expect(container.querySelector(".ProseMirror")!.textContent).not.toContain("Body paragraph.");
  });

  it("does not checkpoint mid-IME composition, and checkpoints on composition end", async () => {
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    let live: Editor | null = null;
    const onCheckpoint = vi.fn();
    const { container } = render(
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} onEditorReady={(editor) => { live = editor; }} onCheckpoint={onCheckpoint} />,
    );
    await waitFor(() => expect(live).not.toBeNull());
    const surface = container.querySelector(".ProseMirror") as HTMLElement;

    fireEvent.compositionStart(surface);
    await act(async () => {
      live!.commands.insertContent("dang g");
    });
    // Mid-composition: the partial word is not written and not checkpointed.
    expect(source.getText()).toBe(FIXTURE);
    expect(onCheckpoint).not.toHaveBeenCalled();

    fireEvent.compositionEnd(surface);
    await waitFor(() => expect(onCheckpoint).toHaveBeenCalledTimes(1));
    expect(source.getText()).toContain("dang g");
  });
});
