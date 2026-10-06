import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { HeaderActionsMenuItems, HeaderActionsSlotProvider } from "../../layout/header-actions-slot";
import type { OfficePrintPort } from "../print";
import { createDocxCommandRuntime } from "./commands";
import { DocxEditor } from "./docx-editor";
import { docxExtensions } from "./docx-schema";
import type { DocxEditorHandle, DocxSaveCoordinator } from "./types";

const DOC = { type: "doc", content: [{ type: "docParagraph", attrs: {}, content: [{ type: "text", text: "Điều 1" }] }] };
const live: Editor[] = [];

afterEach(() => {
  for (const editor of live.splice(0)) editor.destroy();
});

function coordinator(): DocxSaveCoordinator {
  const state = {
    state: "clean" as const,
    identity: null,
    dirtyGeneration: 0,
    lastSavedGeneration: 0,
    activeIntentId: null,
    error: null,
  };
  return {
    getState: () => state as unknown as ReturnType<DocxSaveCoordinator["getState"]>,
    subscribe: () => () => undefined,
    save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
  };
}

function handle(): DocxEditorHandle {
  // The real composed runtime over a mounted editor: every ribbon group reads its state.
  const tiptap = new Editor({ extensions: docxExtensions(), content: DOC });
  live.push(tiptap);
  const commands = createDocxCommandRuntime(() => tiptap);
  return {
    format: "docx",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 0,
    captureSnapshot: vi.fn(async () => ({ generation: 0, fingerprint: "fp", value: {} })),
    dispose: vi.fn(),
    commands,
  } as unknown as DocxEditorHandle;
}

function renderEditor(printPort?: OfficePrintPort) {
  render(
    <HeaderActionsSlotProvider>
      <DropdownMenu>
        <DropdownMenuTrigger data-testid="page-menu">⋯</DropdownMenuTrigger>
        <DropdownMenuContent>
          <HeaderActionsMenuItems />
        </DropdownMenuContent>
      </DropdownMenu>
      <DocxEditor
        documentKey="doc"
        title="Hợp đồng"
        editor={handle()}
        open={{ open: async () => ({ outcome: "opened", document_id: "doc", document_model_ref: "m", warnings: [] }) }}
        coordinator={coordinator()}
        printPort={printPort}
        capability={{ format: "docx", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }}
      />
    </HeaderActionsSlotProvider>,
  );
}

describe("DocxEditor print entry", () => {
  it("contributes Print to the page header menu, bound to the injected port", async () => {
    const print = vi.fn<OfficePrintPort["print"]>(async () => ({ outcome: "printed" }));
    renderEditor({ print });
    await waitFor(() => expect(screen.getByTestId("docx-canvas")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("page-menu"));
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByTestId("docx-header-print"));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    const request = print.mock.calls[0]?.[0];
    expect(request?.title).toBe("Hợp đồng");
    expect(request?.html).toContain("<p>Điều 1</p>");
    expect(request?.html).toContain("@page docx-s0");
  });

  it("prints the document copy on Ctrl+P instead of the app window", async () => {
    const print = vi.fn<OfficePrintPort["print"]>(async () => ({ outcome: "printed" }));
    const windowPrint = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderEditor({ print });
    await waitFor(() => expect(screen.getByTestId("docx-canvas")).toBeInTheDocument());
    fireEvent.keyDown(screen.getByTestId("docx-editor"), { key: "p", ctrlKey: true });
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(windowPrint).not.toHaveBeenCalled();
    windowPrint.mockRestore();
  });

  it("defaults to the browser port on web: an isolated frame prints, never the app window", async () => {
    const appPrint = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const framePrint = vi.fn();
    const append = HTMLElement.prototype.append;
    const appendSpy = vi.spyOn(HTMLElement.prototype, "append").mockImplementation(function (this: HTMLElement, ...nodes) {
      append.apply(this, nodes);
      for (const node of nodes) {
        if (node instanceof HTMLIFrameElement && node.contentWindow) {
          (node.contentWindow as Window).print = framePrint;
          (node.contentWindow as Window).focus = () => undefined;
        }
      }
    });
    try {
      renderEditor();
      await waitFor(() => expect(screen.getByTestId("docx-canvas")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("page-menu"));
      const menu = await screen.findByRole("menu");
      fireEvent.click(within(menu).getByTestId("docx-header-print"));
      await waitFor(() => expect(framePrint).toHaveBeenCalledTimes(1));
      expect(appPrint).not.toHaveBeenCalled();
    } finally {
      appendSpy.mockRestore();
      appPrint.mockRestore();
    }
  });
});
