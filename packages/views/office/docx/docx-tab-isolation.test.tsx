// UNI-957: the desktop keeps every open document mounted and only hides the
// inactive tabs, so two DocxEditors share one page. Each one owns its live
// editor, Find, zoom and DOM root; nothing done in one reaches the other.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { OfficeDocumentActiveProvider } from "../common/document-active";
import { createDocxCommandRuntime, type DocxCommandRuntime } from "./commands";
import { DocxEditor } from "./docx-editor";
import { docxExtensions } from "./docx-schema";
import { DOCX_PRINT_ATTRIBUTE, DOCX_PRINT_TARGET_ATTRIBUTE } from "./export/docx-print";
import type { DocxEditorHandle, DocxOpenOutcome, DocxSaveCoordinator } from "./types";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

const capability = { format: "docx" as const, operation: "serialize" as const, host: "browser" as const, engineBuild: "test", contractRevision: "test", status: "available" as const, fidelityWarnings: [] };

function coordinator(): DocxSaveCoordinator {
  return {
    getState: () => ({ state: "clean", dirtyGeneration: 0, lastSavedGeneration: 0 }) as never,
    subscribe: () => () => undefined,
    save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
    markDirty: vi.fn(),
  } as unknown as DocxSaveCoordinator;
}

function handleFor(text: string): { handle: DocxEditorHandle; live: Editor; commands: DocxCommandRuntime } {
  const live = new Editor({
    extensions: docxExtensions(),
    content: { type: "doc", content: [{ type: "docParagraph", content: [{ type: "text", text }] }] },
  });
  editors.push(live);
  const commands = createDocxCommandRuntime(() => live);
  const handle: DocxEditorHandle = {
    format: "docx",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 0,
    captureSnapshot: vi.fn(async () => ({ generation: 0, fingerprint: "fp", value: {} })),
    dispose: vi.fn(),
    commands,
    renderSurface: () => (
      <div data-testid="docx-document-surface">
        <div className="doc-zoom">
          <EditorContent editor={live} />
        </div>
      </div>
    ),
  };
  return { handle, live, commands };
}

const opened = (id: string): DocxOpenOutcome => ({ outcome: "opened", document_id: id, document_model_ref: id, warnings: [] });

function Doc({ id, handle }: { id: string; handle: DocxEditorHandle }) {
  return <DocxEditor documentKey={id} editor={handle} open={{ open: async () => opened(id) }} coordinator={coordinator()} capability={capability} showDocumentControls={false} />;
}

/** Tab A hidden (an inactive desktop tab), tab B the visible one. */
async function renderTwoTabs() {
  const a = handleFor("alpha beta gamma");
  const b = handleFor("one");
  render(
    <>
      <div data-testid="tab-a" hidden>
        <OfficeDocumentActiveProvider active={false}><Doc id="a" handle={a.handle} /></OfficeDocumentActiveProvider>
      </div>
      <div data-testid="tab-b">
        <OfficeDocumentActiveProvider active><Doc id="b" handle={b.handle} /></OfficeDocumentActiveProvider>
      </div>
    </>,
  );
  const tabA = screen.getByTestId("tab-a");
  const tabB = screen.getByTestId("tab-b");
  await waitFor(() => {
    expect(within(tabA).getByTestId("docx-canvas")).toBeInTheDocument();
    expect(within(tabB).getByTestId("docx-canvas")).toBeInTheDocument();
  });
  return { a, b, tabA, tabB };
}

describe("two DOCX documents in one page (UNI-957)", () => {
  it("opens Find only in the document whose toggle was pressed", async () => {
    const { tabA, tabB } = await renderTwoTabs();
    fireEvent.click(within(tabB).getByTestId("docx-find-toggle"));
    await waitFor(() => expect(within(tabB).getByTestId("docx-find-panel")).toBeInTheDocument());
    expect(within(tabA).queryByTestId("docx-find-panel")).not.toBeInTheDocument();
    expect(within(tabA).getByTestId("docx-find-toggle")).toHaveAttribute("aria-pressed", "false");
  });

  it("lets Escape close only the visible document's Find", async () => {
    const { tabA, tabB } = await renderTwoTabs();
    fireEvent.click(within(tabA).getByTestId("docx-find-toggle"));
    fireEvent.click(within(tabB).getByTestId("docx-find-toggle"));
    await waitFor(() => expect(within(tabA).getByTestId("docx-find-panel")).toBeInTheDocument());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(within(tabB).queryByTestId("docx-find-panel")).not.toBeInTheDocument();
    expect(within(tabA).getByTestId("docx-find-panel")).toBeInTheDocument();
  });

  it("counts each document's own words in its status bar", async () => {
    const { tabA, tabB } = await renderTwoTabs();
    await waitFor(() => {
      expect(within(tabA).getByTestId("docx-status-words")).toHaveTextContent("3");
      expect(within(tabB).getByTestId("docx-status-words")).toHaveTextContent("1");
    });
  });

  it("prints the document whose command ran, never the hidden one", async () => {
    const { b, tabA, tabB } = await renderTwoTabs();
    const targets: string[] = [];
    vi.spyOn(window, "print").mockImplementation(() => {
      expect(document.body.hasAttribute(DOCX_PRINT_ATTRIBUTE)).toBe(true);
      for (const tab of [tabA, tabB]) {
        if (tab.querySelector(`[${DOCX_PRINT_TARGET_ATTRIBUTE}]`)) targets.push(tab.dataset.testid ?? "");
      }
    });
    expect(b.commands.printDocx()).toBe(true);
    expect(targets).toEqual(["tab-b"]);
    // A native Ctrl+P (beforeprint) picks the visible surface too.
    targets.length = 0;
    window.dispatchEvent(new Event("beforeprint"));
    for (const tab of [tabA, tabB]) {
      if (tab.querySelector(`[${DOCX_PRINT_TARGET_ATTRIBUTE}]`)) targets.push(tab.dataset.testid ?? "");
    }
    expect(targets).toEqual(["tab-b"]);
    window.dispatchEvent(new Event("afterprint"));
    expect(document.querySelector(`[${DOCX_PRINT_TARGET_ATTRIBUTE}]`)).toBeNull();
  });

  it("drives each document's own zoom controller from its View chrome", async () => {
    const { tabA, tabB } = await renderTwoTabs();
    const zoomA = within(tabA).getByTestId("docx-status-zoom").textContent;
    const zoomInB = within(tabB).getAllByRole("button", { name: /zoom in/i })[0];
    expect(zoomInB).toBeDefined();
    fireEvent.click(zoomInB!);
    await waitFor(() => expect(within(tabB).getByTestId("docx-status-zoom").textContent).not.toBe(zoomA));
    expect(within(tabA).getByTestId("docx-status-zoom").textContent).toBe(zoomA);
  });
});
