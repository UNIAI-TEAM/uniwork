import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocxCommandRuntime } from "../commands";
import { InsertSymbolsGroup } from "../toolbar/groups/insert-symbols";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { createDocxDocumentScope } from "../editor-store";

function runtime(): DocxCommandRuntime {
  return {
    insertSymbol: vi.fn(),
    insertEquation: vi.fn(() => true),
  } as unknown as DocxCommandRuntime;
}

function renderGroup(options: { readOnly?: boolean; saving?: boolean; commands?: DocxCommandRuntime } = {}) {
  const commands = "commands" in options ? options.commands : runtime();
  const props: DocxToolbarGroupContext = {
    docScope: createDocxDocumentScope(),
    editor: {} as unknown as DocxToolbarGroupContext["editor"],
    coordinator: {} as unknown as DocxToolbarGroupContext["coordinator"],
    format: null,
    commands,
    selection: null,
    readOnly: options.readOnly ?? false,
    saving: options.saving ?? false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
  render(<InsertSymbolsGroup {...props} />);
  return { commands };
}

describe("InsertSymbolsGroup", () => {
  it("inserts a picked symbol through the command runtime", async () => {
    const { commands } = renderGroup();
    fireEvent.click(screen.getByTestId("docx-symbol-picker"));
    fireEvent.click(await screen.findByTestId("docx-symbol-euro"));
    expect(commands?.insertSymbol).toHaveBeenCalledWith("€");
  });

  it("opens the equation dialog, inserts the LaTeX and closes", () => {
    const { commands } = renderGroup();
    fireEvent.click(screen.getByTestId("docx-equation-open"));
    expect(screen.getByTestId("docx-equation-dialog")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("docx-equation-latex"), { target: { value: "x^2" } });
    fireEvent.click(screen.getByTestId("docx-equation-insert"));
    expect(commands?.insertEquation).toHaveBeenCalledWith("x^2");
    expect(screen.queryByTestId("docx-equation-dialog")).not.toBeInTheDocument();
  });

  it("disables both entries without a command runtime", () => {
    renderGroup({ commands: undefined });
    expect(screen.getByTestId("docx-symbol-picker")).toBeDisabled();
    expect(screen.getByTestId("docx-equation-open")).toBeDisabled();
  });

  it("disables both entries on a read-only document", () => {
    renderGroup({ readOnly: true });
    expect(screen.getByTestId("docx-symbol-picker")).toBeDisabled();
    expect(screen.getByTestId("docx-equation-open")).toBeDisabled();
  });

  it("disables both entries while saving", () => {
    renderGroup({ saving: true });
    expect(screen.getByTestId("docx-symbol-picker")).toBeDisabled();
    expect(screen.getByTestId("docx-equation-open")).toBeDisabled();
  });
});
