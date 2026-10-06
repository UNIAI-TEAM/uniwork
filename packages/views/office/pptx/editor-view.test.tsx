import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import { PptxEditorView } from "./editor-view";

initI18n();
beforeEach(async () => { await setLocale("en"); });

const host = { read: {} as never, write: {} as never, assets: {} as never, ipc: { call: vi.fn(), send: vi.fn(), subscribe: vi.fn() } } as unknown as OfficeHost;

describe("PptxEditorView", () => {
  it.each([["error", "The file could not be opened"], ["password-cancel", "Password entry was cancelled"], ["unsupported", "Editing is not supported on this screen size"]] as const)("does not mount a blank editor for %s", (openState, title) => {
    render(<PptxEditorView title="Deck" host={host} capability="available" openState={openState} />);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByTestId("pptx-canvas")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it.each([["local", "Save to this computer"], ["cloud", "Save to UniWork"]] as const)("names the %s save target in the header Save button", (saveDestination, name) => {
    const saveCoordinator = { save: vi.fn(async () => undefined), getState: () => ({ state: "saved", error: null }) as never };
    render(<PptxEditorView title="Deck" host={host} capability="available" openState="ready" saveCoordinator={saveCoordinator} saveDestination={saveDestination} />);
    expect(screen.getByRole("button", { name })).toHaveTextContent(/^Save$/);
  });

  it("renders the host notice in the shell editor slot: below the file header, above the editor, like DOCX", () => {
    render(<PptxEditorView title="Deck" host={host} capability="available" openState="loading" notice={<p role="status">Draft recovered</p>} />);
    const notice = screen.getByText("Draft recovered");
    const title = screen.getByText("Deck");
    expect(title.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const main = notice.closest("main")!;
    expect(main.firstElementChild).toBe(notice);
    expect(notice.closest("[data-office-canvas]")).toBeNull();
  });

  it("renders nothing extra without a notice", () => {
    render(<PptxEditorView title="Deck" host={host} capability="available" openState="loading" />);
    expect(screen.queryByText("Draft recovered")).not.toBeInTheDocument();
  });

  it("keeps the lazy editor mounted when the shared shell rerenders", async () => {
    const editorHandle = {
      format: "pptx",
      open: vi.fn(),
      getDirtyGeneration: () => 1,
      captureSnapshot: vi.fn(),
      dispose: vi.fn(),
    } as unknown as EditorHandle;
    const saveCoordinator = { save: vi.fn(async () => undefined), getState: () => ({ state: "ready", error: null }) as never };
    const props = {
      title: "Deck",
      host,
      editorHandle,
      capability: "available" as const,
      openState: "ready" as const,
      slides: [{ id: "s1", label: "Intro" }],
      saveCoordinator,
    };
    const view = render(<PptxEditorView {...props} />);
    await waitFor(() => expect(document.querySelector("[data-pptx-canvas]")).not.toBeNull());
    view.rerender(
      <PptxEditorView
        {...props}
        selectedIndex={1}
        slides={[{ id: "s1", label: "Intro" }, { id: "s2", label: "Second" }]}
        onSlideSelect={vi.fn()}
        fullscreen
      />,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(editorHandle.dispose).not.toHaveBeenCalled();
  });
});
