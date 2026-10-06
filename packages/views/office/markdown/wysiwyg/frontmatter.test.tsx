// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findFrontmatter } from "@uniwork/office-engine/markdown";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import {
  MarkdownFrontmatterPanel,
  readFrontmatterDraftSpan,
  readFrontmatterSpan,
  replaceFrontmatterSpan,
} from "./frontmatter";
import { MarkdownWysiwygEditor } from "./editor";
import type { Editor } from "@tiptap/react";
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

describe("findFrontmatter span", () => {
  it("locates the YAML block at the top of the source", () => {
    const range = findFrontmatter(FIXTURE);
    expect(range).not.toBeNull();
    expect(range!.start).toBe(0);
    expect(range!.end).toBe(FRONTMATTER.length);
    expect(readFrontmatterSpan(FIXTURE)?.yaml).toBe(FRONTMATTER);
  });

  it("returns null when the document has no front matter", () => {
    expect(findFrontmatter(BODY)).toBeNull();
    expect(readFrontmatterSpan(BODY)).toBeNull();
    // A `---` later in the body is a thematic break, not front matter.
    expect(readFrontmatterSpan("intro\n\n---\ntitle: late\n---\n")).toBeNull();
  });

  it("keeps a CRLF front matter byte-identical", () => {
    const crlf = "---\r\ntitle: Kitchen sink\r\n---\r\n";
    const span = readFrontmatterSpan(crlf + "\r\nBody.\r\n");
    expect(span?.yaml).toBe(crlf);
    // The separator the lexer saw is CRLF, so the draft fallback must stop on a
    // CRLF blank line too - never on the LF inside it.
    expect(readFrontmatterDraftSpan("---\r\ntitle: x\r\n\r\nBody")).toEqual({
      start: 0,
      end: "---\r\ntitle: x\r\n".length,
      yaml: "---\r\ntitle: x\r\n",
    });
  });

  it("replaces exactly the span and leaves every other byte alone", () => {
    const span = readFrontmatterSpan(FIXTURE)!;
    const next = replaceFrontmatterSpan(FIXTURE, span, "---\ntitle: Renamed\n---\n");
    expect(next).toBe("---\ntitle: Renamed\n---\n" + FIXTURE.slice(span.end));
    expect(next.endsWith("\n" + BODY)).toBe(true);
  });
});

describe("MarkdownFrontmatterPanel", () => {
  it("shows the YAML as text and reports an empty state without front matter", () => {
    const source = createTextSource(FIXTURE);
    const { rerender } = render(<MarkdownFrontmatterPanel editor={createHandle(source)} />);
    const field = screen.getByTestId("md-frontmatter-text") as HTMLTextAreaElement;
    expect(field.value).toBe(FRONTMATTER);
    expect(screen.queryByTestId("md-frontmatter-empty")).toBeNull();

    source.setText(BODY);
    rerender(<MarkdownFrontmatterPanel editor={createHandle(source)} />);
    expect(screen.getByTestId("md-frontmatter-empty")).toBeInTheDocument();
  });

  it("keeps the front matter byte-identical when the BODY is edited", async () => {
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    let live: Editor | null = null;
    render(<MarkdownWysiwygEditor documentKey="doc" editor={handle} onEditorReady={(editor) => { live = editor; }} />);
    await waitFor(() => expect(live).not.toBeNull());

    await act(async () => {
      live!.commands.insertContentAt(live!.state.doc.content.size, {
        type: "paragraph",
        content: [{ type: "text", text: "Appended." }],
      });
    });

    await waitFor(() => expect(source.getText()).toContain("Appended."));
    expect(source.getText().startsWith(FRONTMATTER)).toBe(true);
    expect(source.getText().slice(0, findFrontmatter(source.getText())!.end)).toBe(FRONTMATTER);
  });

  it("keeps the field mounted when a fence is deleted mid-edit", () => {
    // Deleting the closing `---` makes `findFrontmatter` return null. Without
    // the draft fallback the panel would swap to the empty state and unmount the
    // textarea the user is typing into.
    expect(readFrontmatterSpan("---\ntitle: x\n")).toBeNull();
    expect(readFrontmatterDraftSpan("---\ntitle: x\n")?.yaml).toBe("---\ntitle: x\n");

    // Start from a valid document, focus the field, then break the fence the
    // way the keystroke that deletes it would.
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    render(<MarkdownFrontmatterPanel editor={handle} />);
    const field = screen.getByTestId("md-frontmatter-text") as HTMLTextAreaElement;

    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "---\ntitle: x\n" } });

    // The field is still there, marked invalid, not replaced by the empty state.
    expect(screen.getByTestId("md-frontmatter-text")).toBeInTheDocument();
    expect(screen.queryByTestId("md-frontmatter-empty")).toBeNull();
    expect(screen.getByTestId("md-frontmatter-text")).toHaveAttribute("aria-invalid", "true");
  });

  it("replaces exactly the front-matter span on a front-matter edit", () => {
    const source = createTextSource(FIXTURE);
    const handle = createHandle(source);
    const onChange = vi.fn();
    render(<MarkdownFrontmatterPanel editor={handle} onChange={onChange} />);
    const field = screen.getByTestId("md-frontmatter-text") as HTMLTextAreaElement;

    fireEvent.change(field, { target: { value: "---\ntitle: Renamed\n---\n" } });

    expect(onChange).toHaveBeenCalledWith("---\ntitle: Renamed\n---\n");
    expect(source.getText()).toBe("---\ntitle: Renamed\n---\n" + FIXTURE.slice(FRONTMATTER.length));
    // The body after the span is byte-identical.
    expect(source.getText().endsWith("\n" + BODY)).toBe(true);
  });
});
