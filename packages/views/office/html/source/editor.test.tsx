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
    const { container, rerender } = render(<HtmlSourceEditor value="<p>one</p>" onChange={() => undefined} />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    const v = view(container);
    expect(v.state.doc.toString()).toBe("<p>one</p>");
    rerender(<HtmlSourceEditor value="<p>two</p>" onChange={() => undefined} />);
    await waitFor(() => expect(v.state.doc.toString()).toBe("<p>two</p>"));
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

  it("renders the container testid and aria-label", async () => {
    render(<HtmlSourceEditor value="" onChange={() => undefined} ariaLabel="HTML source" />);
    const node = screen.getByTestId("html-codemirror");
    expect(node).toHaveAttribute("aria-label", "HTML source");
  });
});
