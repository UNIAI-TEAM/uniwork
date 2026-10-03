import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocxCommandRuntime } from "../../commands";
import type { DocxToolbarGroupContext } from "../types";
import type { DocxPageSetupSection, DocxPageSetupState } from "../../page-setup/docx-page-setup";
import { LayoutPageSetupGroup } from "./layout-page-setup";

const SECTION: DocxPageSetupSection = {
  index: 0,
  firstBlockIndex: 0,
  lastBlockIndex: 0,
  pageWidth: 11906,
  pageHeight: 16838,
  orientation: "portrait",
  marginTop: 1440,
  marginRight: 1440,
  marginBottom: 1440,
  marginLeft: 1440,
  columns: 1,
  columnSpace: 720,
  startType: "nextPage",
};

const STATE: DocxPageSetupState = { sections: [SECTION], activeIndex: 0 };

function runtime(): DocxCommandRuntime {
  return { setDocxSectionProperties: vi.fn(() => true) } as unknown as DocxCommandRuntime;
}

function renderGroup(options: { commands?: DocxCommandRuntime; state?: DocxPageSetupState | null; readOnly?: boolean } = {}) {
  const commands = "commands" in options ? options.commands : runtime();
  const props: DocxToolbarGroupContext = {
    editor: {} as DocxToolbarGroupContext["editor"],
    coordinator: {} as DocxToolbarGroupContext["coordinator"],
    format: { docxPageSetup: "state" in options ? options.state : STATE } as unknown as DocxToolbarGroupContext["format"],
    commands,
    selection: null,
    readOnly: options.readOnly ?? false,
    saving: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
  render(<LayoutPageSetupGroup {...props} />);
  return { commands };
}

describe("LayoutPageSetupGroup", () => {
  it("opens the page-setup dialog and records the edit on the runtime", () => {
    const { commands } = renderGroup();
    const trigger = screen.getByRole("button", { name: "Thiết lập trang" });
    expect(trigger).toBeEnabled();
    fireEvent.click(trigger);
    expect(screen.getByTestId("docx-page-setup-dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("docx-page-setup-margin-top"), { target: { value: "1.27" } });
    fireEvent.click(screen.getByTestId("docx-page-setup-apply"));
    expect(commands?.setDocxSectionProperties).toHaveBeenCalledWith(0, { marginTop: 720 });
    expect(screen.queryByTestId("docx-page-setup-dialog")).not.toBeInTheDocument();
  });

  it("disables the entry without a command runtime", () => {
    renderGroup({ commands: undefined });
    expect(screen.getByRole("button", { name: "Thiết lập trang" })).toBeDisabled();
  });

  it("disables the entry while no document is open (no sections)", () => {
    renderGroup({ state: null });
    expect(screen.getByRole("button", { name: "Thiết lập trang" })).toBeDisabled();
  });

  it("disables the entry on a read-only document", () => {
    renderGroup({ readOnly: true });
    expect(screen.getByRole("button", { name: "Thiết lập trang" })).toBeDisabled();
  });
});
