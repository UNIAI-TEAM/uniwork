// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import { MarkdownWysiwygEditor } from "./editor";
import { MarkdownFind } from "./find";
import type { TextEditorHandle } from "../../source-editor-types";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const FIXTURE = "# Title\n\none two one\n";

/** One shared text source, with the setText calls recorded for routing asserts. */
function createTextSource(initial: string) {
  let text = initial;
  const listeners = new Set<(next: string) => void>();
  const writes: string[] = [];
  return {
    getText: () => text,
    writes,
    setText: (next: string) => {
      writes.push(next);
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

/** The visual surface: M1's editor plus the M7 find integration over one handle. */
function VisualHarness({ handle }: { handle: TextEditorHandle }) {
  const [instance, setInstance] = useState<Editor | null>(null);
  return (
    <div className="relative">
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} onEditorReady={setInstance} showRibbon={false} />
      <MarkdownFind editor={instance} handle={handle} mode="visual" />
    </div>
  );
}

/** The source surface: a plain textarea, as `SourceEditor` still renders for md. */
function SourceHarness({ handle }: { handle: TextEditorHandle }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState(() => handle.source!.getText());
  // Mirror `SourceEditor`: the textarea follows the shared text port, so a
  // write from the find panel (or anywhere else) shows up in the field.
  useEffect(() => handle.source!.subscribe!((next: string) => setText(next)), [handle]);
  const onChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      handle.source!.setText(event.target.value);
      setText(event.target.value);
    },
    [handle],
  );
  return (
    <div ref={wrapperRef} className="relative">
      <textarea ref={textareaRef} aria-label="md source" value={text} onChange={onChange} />
      <MarkdownFind handle={handle} mode="source" sourceTextarea={textareaRef} sourceOverlayTarget={wrapperRef} />
    </div>
  );
}

function pressCtrl(key: string) {
  fireEvent.keyDown(document, { key, ctrlKey: true });
}

async function waitForVisualEditor() {
  await waitFor(() => expect(document.querySelector(".ProseMirror[contenteditable='true']")).not.toBeNull());
}

function query(value: string) {
  fireEvent.change(screen.getByTestId("find-replace-query"), { target: { value } });
}

describe("MarkdownFind", () => {
  it("opens on Ctrl+F with the find field only", async () => {
    const handle = createHandle(createTextSource(FIXTURE));
    render(<VisualHarness handle={handle} />);
    await waitForVisualEditor();

    expect(screen.queryByTestId("find-replace-panel")).not.toBeInTheDocument();
    pressCtrl("f");
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());
    expect(screen.getByTestId("find-replace-query")).toBeInTheDocument();
    // Find-only: the replace row is not there.
    expect(screen.queryByTestId("find-replace-value")).not.toBeInTheDocument();
    expect(screen.queryByTestId("find-replace-all")).not.toBeInTheDocument();
  });

  it("opens on Ctrl+H with the replace row, and Ctrl+F closes the difference", async () => {
    const handle = createHandle(createTextSource(FIXTURE));
    render(<VisualHarness handle={handle} />);
    await waitForVisualEditor();

    pressCtrl("h");
    await waitFor(() => expect(screen.getByTestId("find-replace-value")).toBeInTheDocument());
    expect(screen.getByTestId("find-replace-one")).toBeInTheDocument();
    expect(screen.getByTestId("find-replace-all")).toBeInTheDocument();

    // Escape closes the whole panel (the panel reports it through onClose).
    fireEvent.keyDown(screen.getByTestId("find-replace-query"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("find-replace-panel")).not.toBeInTheDocument());

    // Ctrl+F opens the SAME panel without the replace row.
    pressCtrl("f");
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());
    expect(screen.queryByTestId("find-replace-value")).not.toBeInTheDocument();
  });

  it("marks every match in the document, the active one distinguishable", async () => {
    const handle = createHandle(createTextSource(FIXTURE));
    render(<VisualHarness handle={handle} />);
    await waitForVisualEditor();
    pressCtrl("f");
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());

    query("one");
    await waitFor(() => expect(document.querySelectorAll("[data-find-match]")).toHaveLength(2));
    const active = document.querySelectorAll("[data-find-active]");
    expect(active).toHaveLength(1);
    expect(active[0]!.textContent).toBe("one");
    // The first match is the active one, in document order.
    expect(document.querySelectorAll("[data-find-match]")[0]!.hasAttribute("data-find-active")).toBe(true);

    // Clearing the query clears the paint.
    query("");
    await waitFor(() => expect(document.querySelectorAll("[data-find-match]")).toHaveLength(0));
  });

  it("moves the active match with next and previous", async () => {
    const handle = createHandle(createTextSource(FIXTURE));
    render(<VisualHarness handle={handle} />);
    await waitForVisualEditor();
    pressCtrl("f");
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());
    query("one");
    await waitFor(() => expect(document.querySelectorAll("[data-find-match]")).toHaveLength(2));

    const activeIndex = () =>
      Array.from(document.querySelectorAll("[data-find-match]")).findIndex((node) => node.hasAttribute("data-find-active"));
    expect(activeIndex()).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    await waitFor(() => expect(activeIndex()).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
    await waitFor(() => expect(activeIndex()).toBe(0));
  });

  it("applies a replace through the editor handle, not a direct DOM write", async () => {
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    render(<VisualHarness handle={handle} />);
    await waitForVisualEditor();
    pressCtrl("h");
    await waitFor(() => expect(screen.getByTestId("find-replace-value")).toBeInTheDocument());

    query("one");
    fireEvent.change(screen.getByTestId("find-replace-value"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    // The edit reached the ONE shared text source through the handle.
    await waitFor(() => expect(source.getText()).toContain("1 two one"));
    expect(source.writes.length).toBeGreaterThan(0);
    expect(source.writes.at(-1)).toContain("1 two one");
    // The document itself was re-parsed from that write.
    await waitFor(() => expect(document.querySelector(".ProseMirror")!.textContent).toContain("1 two one"));
  });

  it("applies replace-all through the editor handle", async () => {
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    render(<VisualHarness handle={handle} />);
    await waitForVisualEditor();
    pressCtrl("h");
    await waitFor(() => expect(screen.getByTestId("find-replace-value")).toBeInTheDocument());

    query("one");
    fireEvent.change(screen.getByTestId("find-replace-value"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));

    await waitFor(() => expect(source.getText()).toContain("1 two 1"));
    expect(source.getText()).not.toContain("one");
  });

  it("highlights and replaces in source mode through the same handle", async () => {
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    render(<SourceHarness handle={handle} />);

    pressCtrl("h");
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());
    query("one");

    // The overlay paints every match; the active one is distinct.
    await waitFor(() => expect(document.querySelectorAll("[data-testid='md-find-source-highlight'] mark")).toHaveLength(2));
    expect(document.querySelectorAll("[data-testid='md-find-source-highlight'] mark[data-find-active]")).toHaveLength(1);

    // The active match is selected in the textarea (scroll-to + selection).
    const textarea = screen.getByLabelText("md source") as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.selectionStart).toBe(FIXTURE.indexOf("one")));
    expect(textarea.selectionEnd).toBe(FIXTURE.indexOf("one") + 3);

    // Next moves the selection to the second match; previous brings it back.
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    await waitFor(() => expect(textarea.selectionStart).toBe(FIXTURE.lastIndexOf("one")));
    fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
    await waitFor(() => expect(textarea.selectionStart).toBe(FIXTURE.indexOf("one")));

    // Replace applies through the handle's text port (only the active match).
    fireEvent.change(screen.getByTestId("find-replace-value"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(source.getText()).toBe("# Title\n\n1 two one\n"));
    expect(textarea.value).toBe("# Title\n\n1 two one\n");
  });

  it("closes with Escape and repaints nothing while closed", async () => {
    const handle = createHandle(createTextSource(FIXTURE));
    render(<VisualHarness handle={handle} />);
    await waitForVisualEditor();
    pressCtrl("f");
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());
    query("one");
    await waitFor(() => expect(document.querySelectorAll("[data-find-match]")).toHaveLength(2));

    fireEvent.keyDown(screen.getByTestId("find-replace-query"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("find-replace-panel")).not.toBeInTheDocument());
    expect(document.querySelectorAll("[data-find-match]")).toHaveLength(0);
  });
});
