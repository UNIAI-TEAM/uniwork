// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import { MarkdownWysiwygEditor } from "./editor";
import { MarkdownFind } from "./find";
import { matchToPmRange, type FlattenedDoc } from "./find-decoration";
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
function VisualHarness({ handle, editable = true }: { handle: TextEditorHandle; editable?: boolean }) {
  const [instance, setInstance] = useState<Editor | null>(null);
  return (
    <div className="relative">
      <MarkdownWysiwygEditor documentKey="doc" editor={handle} onEditorReady={setInstance} showRibbon={false} />
      <MarkdownFind editor={instance} handle={handle} mode="visual" editable={editable} />
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
      {/* A third element outside both the field and the panel: focus here must
          survive a result change (F-07). */}
      <button type="button" data-testid="md-find-outside">
        outside
      </button>
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

  it("maps no document range across a block separator (F-02)", () => {
    // "Title\none": the `\n` at index 5 is a synthetic separator (positions[5]
    // is null). `e\no` (indices 4..6) spans it, so the whole match is dropped.
    const flat: FlattenedDoc = { text: "Title\none", positions: [1, 2, 3, 4, 5, null, 7, 8, 9] };
    expect(matchToPmRange(flat, { start: 4, end: 7 })).toBeNull();
    // An endpoint-on-separator match is rejected the same way.
    expect(matchToPmRange(flat, { start: 5, end: 8 })).toBeNull();
    // A match that stays inside one block still maps.
    expect(matchToPmRange(flat, { start: 0, end: 5 })).toEqual({ from: 1, to: 6 });
  });

  it("does not merge blocks when a regex match spans a separator (F-02)", async () => {
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    render(<VisualHarness handle={handle} />);
    await waitForVisualEditor();
    pressCtrl("h");
    await waitFor(() => expect(screen.getByTestId("find-replace-value")).toBeInTheDocument());

    // `e\no` runs from the heading's last letter, across the block separator,
    // into the paragraph's first letter.
    query("e\\no");
    fireEvent.click(screen.getByRole("checkbox", { name: "Regular expression" }));
    await waitFor(() => expect(screen.getByTestId("find-replace-count")).toHaveTextContent("1 match"));

    fireEvent.change(screen.getByTestId("find-replace-value"), { target: { value: "X" } });
    const writesBefore = source.writes.length;
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));

    // The unmappable range is dropped, so nothing is written and the heading
    // and paragraph stay two blocks (pre-fix this spliced them into one).
    expect(source.writes).toHaveLength(writesBefore);
    const editorDom = document.querySelector(".ProseMirror")!;
    expect(editorDom.querySelector("h1")?.textContent).toBe("Title");
    expect(editorDom.querySelector("p")?.textContent).toContain("one two one");
    await waitFor(() => expect(screen.getByTestId("find-replace-count")).toHaveTextContent("1 match"));
  });

  it("keeps the query focused while typing in source mode (F-01)", async () => {
    const handle = createHandle(createTextSource(FIXTURE));
    render(<SourceHarness handle={handle} />);
    pressCtrl("f");
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());

    const queryField = screen.getByTestId("find-replace-query");
    queryField.focus();
    expect(queryField).toHaveFocus();

    query("one");
    await waitFor(() => expect(document.querySelectorAll("[data-testid='md-find-source-highlight'] mark")).toHaveLength(2));

    // The result-driven selection must not steal focus into the textarea: the
    // next characters would land in the document, and Escape (which only the
    // panel handles) would stop closing the panel.
    expect(queryField).toHaveFocus();
    expect(document.activeElement).not.toBe(screen.getByLabelText("md source"));
  });

  it("does not corrupt the document when typing in the focused textarea (F-06)", async () => {
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    const user = userEvent.setup();
    render(<SourceHarness handle={handle} />);

    pressCtrl("f");
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());
    // Flush the panel's deferred focus so the click below is the last word.
    await waitFor(() => expect(screen.getByTestId("find-replace-query")).toHaveFocus());
    query("one");
    await waitFor(() => expect(document.querySelectorAll("[data-testid='md-find-source-highlight'] mark")).toHaveLength(2));

    // The user clicks into the document and types at the end. Every keystroke
    // re-runs the matcher; if the selection effect re-imposed the active match
    // over the caret, the second and later characters would replace that match
    // (pre-fix: "# Title\n\ny two z\nx", both "one"s silently deleted).
    const textarea = screen.getByLabelText("md source") as HTMLTextAreaElement;
    await user.click(textarea);
    textarea.setSelectionRange(FIXTURE.length, FIXTURE.length);
    await user.keyboard("xyz");

    const expected = `${FIXTURE}xyz`;
    expect(textarea.value).toBe(expected);
    expect(source.getText()).toBe(expected);
    expect(source.getText().match(/one/g)).toHaveLength(2);
  });

  it("leaves focus on an unrelated element when the result changes (F-07)", async () => {
    const handle = createHandle(createTextSource(FIXTURE));
    render(<SourceHarness handle={handle} />);
    pressCtrl("f");
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());
    // Flush the panel's deferred focus before moving focus to the third element.
    await waitFor(() => expect(screen.getByTestId("find-replace-query")).toHaveFocus());
    query("one");
    await waitFor(() => expect(document.querySelectorAll("[data-testid='md-find-source-highlight'] mark")).toHaveLength(2));

    const outside = screen.getByTestId("md-find-outside");
    outside.focus();
    expect(outside).toHaveFocus();

    // A result change while focus is outside both the field and the panel (a
    // collab/external edit, a controlled reopen) must not yank the caret into
    // the textarea.
    query("two");
    await waitFor(() => expect(document.querySelectorAll("[data-testid='md-find-source-highlight'] mark")).toHaveLength(1));
    expect(outside).toHaveFocus();
    expect(document.activeElement).not.toBe(screen.getByLabelText("md source"));
  });

  it("re-imposes the selection and scroll on a different match at the same index (F-08)", async () => {
    // The first query matches near the top of the document; the second query
    // matches far enough down that imposing it also scrolls the field. The
    // active index is 0 in both, so the old (open, index) key treated the change
    // as a no-op and left the stale range selected.
    const filler = Array.from({ length: 40 }, (_, i) => `line ${i + 3}`);
    const text = ["# Title", "", "one here", ...filler.slice(0, 30), "two here", ...filler.slice(30), ""].join("\n");
    const handle = createHandle(createTextSource(text));
    render(<SourceHarness handle={handle} />);
    pressCtrl("f");
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());
    // Flush the deferred panel focus so the textarea is not the active element
    // and the impose below is the effect work.
    await waitFor(() => expect(screen.getByTestId("find-replace-query")).toHaveFocus());

    const textarea = screen.getByLabelText("md source") as HTMLTextAreaElement;
    // jsdom lays every element out at zero height; give the field a viewport so
    // scrollSourceMatchIntoView has somewhere to land.
    Object.defineProperty(textarea, "clientHeight", { configurable: true, value: 80 });

    query("one");
    await waitFor(() => expect(textarea.selectionStart).toBe(text.indexOf("one here")));
    expect(textarea.selectionEnd).toBe(text.indexOf("one here") + 3);
    expect(textarea.scrollTop).toBe(0);

    // A different match at the SAME index must re-impose both the selection and
    // the scroll, so the field stops highlighting the old text and follows the
    // overlay new active mark.
    query("two");
    await waitFor(() => expect(textarea.selectionStart).toBe(text.indexOf("two here")));
    expect(textarea.selectionEnd).toBe(text.indexOf("two here") + 3);
    await waitFor(() => expect(textarea.scrollTop).toBeGreaterThan(0));
    expect(document.querySelectorAll("[data-testid='md-find-source-highlight'] mark[data-find-active]")).toHaveLength(1);
  });

  it("mirrors the textarea scroll into the source overlay (F-03)", async () => {
    const handle = createHandle(createTextSource(FIXTURE));
    render(<SourceHarness handle={handle} />);
    pressCtrl("f");
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());
    query("one");
    await waitFor(() => expect(document.querySelectorAll("[data-testid='md-find-source-highlight'] mark")).toHaveLength(2));

    const textarea = screen.getByLabelText("md source") as HTMLTextAreaElement;
    const overlay = screen.getByTestId("md-find-source-highlight") as HTMLElement;
    expect(overlay.scrollTop).toBe(0);

    // Scrolling the field moves the overlay by the same offset, so the marks
    // stay on the lines they belong to.
    textarea.scrollTop = 120;
    fireEvent.scroll(textarea);
    expect(overlay.scrollTop).toBe(120);

    // A repaint while scrolled (the panel re-reports the result) keeps the
    // offset instead of resetting the marks to the document top.
    query("two");
    await waitFor(() => expect(overlay.scrollTop).toBe(120));
  });

  it("searches a read-only document without offering the replace row (F-04)", async () => {
    const handle = createHandle(createTextSource(FIXTURE));
    render(<VisualHarness handle={handle} editable={false} />);
    await waitForVisualEditor();
    pressCtrl("h");
    await waitFor(() => expect(screen.getByTestId("find-replace-panel")).toBeInTheDocument());

    // Find still works: only the replace row is withheld on a read-only surface.
    expect(screen.getByTestId("find-replace-query")).not.toBeDisabled();
    query("one");
    await waitFor(() => expect(document.querySelectorAll("[data-find-match]")).toHaveLength(2));
    expect(screen.queryByTestId("find-replace-value")).not.toBeInTheDocument();
    expect(screen.queryByTestId("find-replace-all")).not.toBeInTheDocument();
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
