// A13 wire (UNI-924): the Insert-tab header/footer group. The button opens the
// dialog over the command area's state and every edit leaves through the
// runtime; a handle that stubs only the base contract gets no group at all, so
// the toolbar cannot render a labelled box that does nothing.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDocxCommandRuntime, type DocxCommandRuntime } from "../../commands";
import { emptyHeaderFooterState } from "../../header-footer/header-footer-state";
import { DocxToolbarShell } from "../toolbar";
import type { DocxToolbarGroupContext } from "../types";
import { createDocxDocumentScope } from "../../editor-store";
import { InsertHeaderFooterGroup, headerFooterGroupAvailable } from "./insert-header-footer";

function context(overrides: Partial<DocxToolbarGroupContext> = {}): DocxToolbarGroupContext {
  const runtime = createDocxCommandRuntime(() => null);
  return {
    docScope: createDocxDocumentScope(),
    editor: {
      format: "docx",
      open: vi.fn(async () => undefined),
      getDirtyGeneration: () => 0,
      captureSnapshot: vi.fn(async () => ({ generation: 0, fingerprint: "fp", value: {} })),
      dispose: vi.fn(),
    },
    coordinator: {
      getState: () => ({ state: "clean", identity: null, dirtyGeneration: 0, lastSavedGeneration: 0, activeIntentId: null, error: null }),
      subscribe: () => () => undefined,
      save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
    },
    format: runtime.getState(),
    commands: runtime,
    selection: null,
    readOnly: false,
    saving: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...overrides,
  } as unknown as DocxToolbarGroupContext;
}

function renderGroup(overrides: Partial<DocxToolbarGroupContext> = {}) {
  render(<InsertHeaderFooterGroup {...context(overrides)} />);
}

describe("headerFooterGroupAvailable", () => {
  it("is available only when the runtime carries the header/footer command area", () => {
    expect(headerFooterGroupAvailable(context())).toBe(true);
    const stub = { ...createDocxCommandRuntime(() => null) } as Partial<DocxCommandRuntime>;
    delete stub.setDocxHeaderFooterSlot;
    expect(headerFooterGroupAvailable(context({ commands: stub as DocxCommandRuntime }))).toBe(false);
    expect(headerFooterGroupAvailable(context({ commands: undefined }))).toBe(false);
  });
});

describe("InsertHeaderFooterGroup", () => {
  it("renders nothing when the command area is absent", () => {
    const stub = { ...createDocxCommandRuntime(() => null) } as Partial<DocxCommandRuntime>;
    delete stub.setDocxHeaderFooterSlot;
    renderGroup({ commands: stub as DocxCommandRuntime });
    expect(screen.queryByTestId("docx-header-footer-open")).not.toBeInTheDocument();
  });

  it("opens the dialog over the seeded state and routes edits through the runtime", () => {
    const runtime = createDocxCommandRuntime(() => null);
    runtime.seedDocxHeaderFooter({ headerText: "Confidential" });
    const setSlot = vi.spyOn(runtime, "setDocxHeaderFooterSlot");
    const setTitlePg = vi.spyOn(runtime, "setDocxTitlePg");
    renderGroup({ commands: runtime, format: runtime.getState() });

    fireEvent.click(screen.getByTestId("docx-header-footer-open"));
    expect(screen.getByTestId("docx-header-footer-dialog")).toBeInTheDocument();
    // The dialog shows the parse's real content, not the empty fallback.
    expect(screen.getByTestId("docx-hf-text")).toHaveValue("Confidential");

    fireEvent.change(screen.getByTestId("docx-hf-text"), { target: { value: "Confidential v2" } });
    fireEvent.click(screen.getByTestId("docx-hf-apply"));
    expect(setSlot).toHaveBeenCalledWith("header", expect.objectContaining({ text: "Confidential v2" }));

    fireEvent.click(screen.getByTestId("docx-hf-title-pg"));
    expect(setTitlePg).toHaveBeenCalledWith(true);
  });

  it("falls back to the empty state before a document opens", () => {
    renderGroup({ format: null });
    fireEvent.click(screen.getByTestId("docx-header-footer-open"));
    expect(screen.getByTestId("docx-hf-text")).toHaveValue("");
    expect(screen.getByTestId("docx-hf-title-pg")).not.toBeChecked();
    expect(emptyHeaderFooterState().titlePg).toBe(false);
  });
});

describe("DocxToolbarShell unavailable-group skip", () => {
  it("leaves the header/footer group out of the Insert tab when its area is absent", async () => {
    const stub = { ...createDocxCommandRuntime(() => null) } as Partial<DocxCommandRuntime>;
    delete stub.setDocxHeaderFooterSlot;
    render(<DocxToolbarShell {...context({ commands: stub as DocxCommandRuntime })} />);

    fireEvent.click(screen.getByRole("tab", { name: "Chèn" }));
    await waitFor(() => expect(document.querySelector('[data-ribbon-group="insert-table"]')).toBeInTheDocument());
    expect(document.querySelector('[data-ribbon-group="insert-header-footer"]')).not.toBeInTheDocument();
  });

  it("mounts the group in the Insert tab when the command area is composed", async () => {
    render(<DocxToolbarShell {...context()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Chèn" }));
    await waitFor(() => expect(document.querySelector('[data-ribbon-group="insert-header-footer"]')).toBeInTheDocument());
    expect(screen.getByTestId("docx-header-footer-open")).toBeInTheDocument();
  });
});
