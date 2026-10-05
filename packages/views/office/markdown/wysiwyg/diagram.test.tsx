// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import { MarkdownWysiwygEditor } from "./editor";
import { MERMAID_TEMPLATE, insertMermaidDiagram } from "./diagram";
import type { TextEditorHandle } from "../../source-editor-types";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

// Pay the cold `import("mermaid")` here instead of inside the assertion. The
// shared `MermaidDiagram` resolves the same module specifier from its effect,
// so warming the registry first keeps the error surface from racing a
// multi-hundred-millisecond bundle compile under a loaded CI runner.
beforeAll(async () => {
  await import("mermaid");
});

const FIXTURE = "# Title\n\nBody paragraph.\n";

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

describe("insertMermaidDiagram", () => {
  it("inserts a fenced mermaid block with the starter template", async () => {
    const handle = createHandle(FIXTURE);
    let live: Editor | null = null;
    render(<MarkdownWysiwygEditor documentKey="doc" editor={handle} onEditorReady={(editor) => { live = editor; }} />);
    await waitFor(() => expect(live).not.toBeNull());
    await act(async () => {
      insertMermaidDiagram(live);
    });
    await waitFor(() => expect(handle.source!.getText()).toContain("```mermaid"));
    const markdown = handle.source!.getText();
    expect(markdown).toContain(MERMAID_TEMPLATE.split("\n")[0] as string);
    // It is a code block whose info string is the mermaid language, so the
    // shared node view renders it and the serializer keeps the fence.
    const inserted = live!.getJSON().content?.find((node) => node.type === "codeBlock");
    expect(inserted?.attrs?.language).toBe("mermaid");
  });

  it("does nothing on a read-only editor", async () => {
    const handle = createHandle(FIXTURE);
    let live: Editor | null = null;
    render(<MarkdownWysiwygEditor documentKey="doc" editor={handle} editable={false} onEditorReady={(editor) => { live = editor; }} />);
    await waitFor(() => expect(live).not.toBeNull());
    const before = handle.source!.getText();
    await act(async () => {
      insertMermaidDiagram(live);
    });
    expect(handle.source!.getText()).toBe(before);
  });
});

describe("diagram error surface", () => {
  it("surfaces the parser's own message for invalid source, through the shared renderer", async () => {
    // The production error state belongs to the shared `MermaidDiagram` the
    // code-block node view mounts — not a second wrapper. Invalid source shows
    // the parser message instead of a broken canvas.
    const handle = createHandle("# Title\n\n```mermaid\nnot a diagram\n```\n");
    let live: Editor | null = null;
    render(<MarkdownWysiwygEditor documentKey="doc" editor={handle} onEditorReady={(editor) => { live = editor; }} />);
    await waitFor(() => expect(live).not.toBeNull());
    const error = await screen.findByText(
      "Unable to render Mermaid diagram.",
      {},
      { timeout: 15_000 },
    );
    expect(error).toBeTruthy();
    // The parser's own message is shown: it is the only clue about the line.
    await waitFor(
      () => expect(document.querySelector(".mermaid-diagram-error-detail")?.textContent?.length ?? 0).toBeGreaterThan(0),
      { timeout: 15_000 },
    );
  });
});
