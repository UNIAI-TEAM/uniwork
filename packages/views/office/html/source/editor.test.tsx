import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import { HtmlSourceEditor } from "./editor";

const KITCHEN_SINK = [
  "<!doctype html>",
  '<html lang="vi">',
  "  <head>",
  '    <meta charset="utf-8" />',
  "    <!-- giữ nguyên: dấu tiếng Việt, &amp;, <script> -->",
  "  </head>",
  "  <body>",
  '    <section data-x="1" class="a b">Xin chào — “trích dẫn”</section>',
  "  </body>",
  "</html>",
].join("\n");

function view(container: HTMLElement): EditorView {
  const dom = container.querySelector(".cm-editor");
  if (!dom) throw new Error("no cm-editor");
  const found = EditorView.findFromDOM(dom as HTMLElement);
  if (!found) throw new Error("no EditorView");
  return found;
}

describe("HtmlSourceEditor", () => {
  it("mounts a CodeMirror view and reports user edits through onChange", async () => {
    const onChange = vi.fn();
    const onCheckpoint = vi.fn();
    const { container } = render(<HtmlSourceEditor value="" onChange={onChange} onCheckpoint={onCheckpoint} ariaLabel="Source" />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    const v = view(container);
    v.dispatch({ changes: { from: 0, insert: "<p>hi</p>" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("<p>hi</p>");
    expect(onCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("reports the caret and selection as the document and cursor change (T12)", async () => {
    const onSelectionChange = vi.fn();
    const { container } = render(<HtmlSourceEditor value={"ab\ncde"} onChange={vi.fn()} onSelectionChange={onSelectionChange} ariaLabel="Source" />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    const v = view(container);
    v.dispatch({ selection: { anchor: 5 } });
    expect(onSelectionChange).toHaveBeenLastCalledWith({ from: 5, to: 5, head: 5 });
    v.dispatch({ selection: { anchor: 1, head: 4 } });
    expect(onSelectionChange).toHaveBeenLastCalledWith({ from: 1, to: 4, head: 4 });
  });

  it("does not fire onChange during an IME composition and fires once on compositionend", async () => {
    const onChange = vi.fn();
    const onCheckpoint = vi.fn();
    const { container } = render(<HtmlSourceEditor value="" onChange={onChange} onCheckpoint={onCheckpoint} />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    const v = view(container);
    fireEvent.compositionStart(v.contentDOM);
    v.dispatch({ changes: { from: 0, insert: "hợp" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(onCheckpoint).not.toHaveBeenCalled();
    fireEvent.compositionEnd(v.contentDOM);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("hợp");
    expect(onCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("makes the view non-editable when readOnly", async () => {
    const { container, rerender } = render(<HtmlSourceEditor value="<p>x</p>" readOnly onChange={() => undefined} />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    const v = view(container);
    expect(v.state.facet(EditorState.readOnly)).toBe(true);
    expect(v.contentDOM.getAttribute("contenteditable")).toBe("false");
    rerender(<HtmlSourceEditor value="<p>x</p>" onChange={() => undefined} />);
    await waitFor(() => expect(v.state.facet(EditorState.readOnly)).toBe(false));
    expect(v.contentDOM.getAttribute("contenteditable")).toBe("true");
  });

  it("applies an external controlled value change to the document", async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<HtmlSourceEditor value="<p>one</p>" onChange={onChange} />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    const v = view(container);
    expect(v.state.doc.toString()).toBe("<p>one</p>");
    rerender(<HtmlSourceEditor value="<p>two</p>" onChange={onChange} />);
    await waitFor(() => expect(v.state.doc.toString()).toBe("<p>two</p>"));
    // The controlled write is marked with the externalSync annotation, so it
    // must never echo back through onChange.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("flushes a pending change when a composition is cancelled without compositionend", async () => {
    const onChange = vi.fn();
    const onCheckpoint = vi.fn();
    const { container } = render(<HtmlSourceEditor value="" onChange={onChange} onCheckpoint={onCheckpoint} />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    const v = view(container);
    fireEvent.compositionStart(v.contentDOM);
    v.dispatch({ changes: { from: 0, insert: "hợp" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.compositionEnd(v.contentDOM);
    expect(onChange).toHaveBeenCalledTimes(1);
    // A second composition that is cancelled (no compositionend) must not
    // leave the gate stuck true: the edit is reported and later edits flow.
    fireEvent.compositionStart(v.contentDOM);
    v.dispatch({ changes: { from: v.state.doc.length, insert: "!" } });
    // `compositioncancel` is not in testing-library's event map; dispatch it raw.
    v.contentDOM.dispatchEvent(new Event("compositioncancel", { bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith("hợp!");
    expect(onCheckpoint).toHaveBeenCalledTimes(2);
    v.dispatch({ changes: { from: v.state.doc.length, insert: "?" } });
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith("hợp!?");
  });

  it("keeps byte identity between the value in and the onChange value out", async () => {
    const onChange = vi.fn();
    const { container } = render(<HtmlSourceEditor value="" onChange={onChange} />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    const v = view(container);
    v.dispatch({ changes: { from: 0, to: 0, insert: KITCHEN_SINK } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(KITCHEN_SINK);
    // And the round-trip back in as a controlled value is stable.
    expect(v.state.doc.toString()).toBe(KITCHEN_SINK);
  });

  // CRLF decision (N5): CodeMirror normalises `\r\n` to `\n` in the document,
  // exactly as the Markdown <textarea> does, so a CRLF file emits LF on its
  // first edit. That is md/html parity, not a regression, and the adapter
  // treats the text as opaque bytes - so no CRLF round-trip is pinned here.
  it("normalises CRLF to LF, matching the Markdown textarea", async () => {
    const onChange = vi.fn();
    const { container } = render(<HtmlSourceEditor value={""} onChange={onChange} />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    const v = view(container);
    v.dispatch({ changes: { from: 0, insert: "<p>a</p>\r\n<p>b</p>" } });
    expect(onChange).toHaveBeenCalledWith("<p>a</p>\n<p>b</p>");
  });

  it("puts the accessible name on the editable content node, not the container", async () => {
    const { container, rerender } = render(<HtmlSourceEditor value="" onChange={() => undefined} ariaLabel="HTML source" />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    const v = view(container);
    // ARIA ignores a label on the generic container div; the editable node is
    // CodeMirror's `.cm-content`, which must carry the name itself.
    expect(v.contentDOM).toHaveAttribute("aria-label", "HTML source");
    expect(screen.getByTestId("html-codemirror")).not.toHaveAttribute("aria-label");
    rerender(<HtmlSourceEditor value="" onChange={() => undefined} ariaLabel="Renamed" />);
    await waitFor(() => expect(v.contentDOM).toHaveAttribute("aria-label", "Renamed"));
  });

  it("does not own undo: a Mod-z keydown leaves the document and onChange untouched", async () => {
    const onChange = vi.fn();
    const { container } = render(<HtmlSourceEditor value="<p>one</p>" onChange={onChange} />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    const v = view(container);
    v.dispatch({ changes: { from: v.state.doc.length, insert: "<!-- typed -->" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    // CodeMirror has no `history()`/`historyKeymap`: the shared source surface
    // owns undo through the editor handle's snapshot stack. If CM owned a
    // second stack, this keydown would revert the doc here and fire onChange.
    fireEvent.keyDown(v.contentDOM, { key: "z", ctrlKey: true });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(v.state.doc.toString()).toBe("<p>one</p><!-- typed -->");
  });
});
