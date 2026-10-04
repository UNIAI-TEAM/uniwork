// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { Editor } from "@tiptap/react";
import { MarkdownWysiwygEditor } from "./editor";
import {
  MERMAID_TEMPLATE,
  MermaidBlockPreview,
  insertMermaidDiagram,
  validateMermaidSource,
} from "./diagram";
import type { TextEditorHandle } from "../../source-editor-types";

initI18n();
beforeEach(async () => {
  await setLocale("en");
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
});

describe("validateMermaidSource", () => {
  it("accepts a real diagram and reports the parser message on invalid source", async () => {
    expect(await validateMermaidSource(MERMAID_TEMPLATE)).toEqual({ status: "valid" });
    const invalid = await validateMermaidSource("this is not a diagram");
    expect(invalid.status).toBe("invalid");
    if (invalid.status === "invalid") expect(invalid.message.length).toBeGreaterThan(0);
  });
});

describe("MermaidBlockPreview", () => {
  it("surfaces the typed error state for invalid source", async () => {
    render(<MermaidBlockPreview source="not a diagram" />);
    const error = await screen.findByRole("alert");
    expect(error).toHaveAttribute("data-mermaid-error");
    expect(screen.getByText("The diagram could not be rendered. Check the Mermaid syntax.")).toBeTruthy();
    // The parser's own message is shown: it is the only clue about the line.
    await waitFor(() => expect(document.querySelector("[data-mermaid-error-detail]")?.textContent?.length ?? 0).toBeGreaterThan(0));
  });
});
