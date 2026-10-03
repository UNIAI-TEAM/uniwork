// The popover is mocked the way the repo's other popover tests do it: jsdom
// has no layout, so the real Base UI positioner never opens; the stand-in
// forwards open state/props so the group's wiring stays under test.
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DocxCommandRuntime } from "../../commands";
import type { DocxToolbarGroupContext } from "../types";
import { InsertNotesGroup } from "./insert-notes";

const popoverState = vi.hoisted(() => ({
  open: false,
  onOpenChange: undefined as ((open: boolean) => void) | undefined,
}));

vi.mock("@uniwork/ui/components/ui/popover", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    Popover: ({ children, open, onOpenChange }: { children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void }) => {
      popoverState.open = open;
      popoverState.onOpenChange = onOpenChange;
      return React.createElement(React.Fragment, null, children);
    },
    PopoverTrigger: ({ render, children, ...props }: { render: ReactElement; children?: ReactNode } & Record<string, unknown>) =>
      React.cloneElement(
        render as ReactElement<Record<string, unknown>>,
        { ...props, onClick: () => popoverState.onOpenChange?.(!popoverState.open) },
        children,
      ),
    PopoverContent: ({ children }: { children: ReactNode }) =>
      popoverState.open ? React.createElement("div", { role: "dialog" }, children) : null,
  };
});

const NOTES = { footnotes: [{ id: "1", text: "ghi chú một" }], endnotes: [] };

function runtime(overrides: Partial<DocxCommandRuntime> = {}): DocxCommandRuntime {
  return {
    listDocxNotes: vi.fn(() => NOTES),
    docxNotesRevision: vi.fn(() => 0),
    canInsertDocxNote: vi.fn(() => true),
    insertDocxNote: vi.fn(() => ({ id: "2", text: "mới" })),
    setDocxNoteText: vi.fn(() => true),
    deleteDocxNote: vi.fn(() => true),
    hasDocxNoteRef: vi.fn(() => true),
    jumpToDocxNote: vi.fn(() => true),
    snapshotDocxNotes: vi.fn(() => ({ ...NOTES, edited: { footnote: true, endnote: false } })),
    restoreDocxNotes: vi.fn(),
    ...overrides,
  } as unknown as DocxCommandRuntime;
}

function renderGroup(options: { commands?: DocxCommandRuntime; readOnly?: boolean; saving?: boolean; notes?: typeof NOTES } = {}) {
  popoverState.open = false;
  const commands = "commands" in options ? options.commands : runtime();
  const props: DocxToolbarGroupContext = {
    editor: {} as unknown as DocxToolbarGroupContext["editor"],
    coordinator: {} as unknown as DocxToolbarGroupContext["coordinator"],
    format: { docxNotes: options.notes ?? NOTES } as unknown as DocxToolbarGroupContext["format"],
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
  render(<InsertNotesGroup {...props} />);
  return { commands };
}

describe("InsertNotesGroup", () => {
  it("inserts a footnote through the dialog at the caret", async () => {
    const { commands } = renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Chèn chú thích chân trang" }));
    fireEvent.change(await screen.findByLabelText("Nội dung chú thích"), { target: { value: "  nội dung mới  " } });
    fireEvent.click(screen.getByRole("button", { name: "Chèn" }));
    expect(commands?.insertDocxNote).toHaveBeenCalledWith("footnote", "nội dung mới");
  });

  it("inserts an endnote through the dialog", async () => {
    const { commands } = renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Chèn chú thích cuối văn bản" }));
    fireEvent.change(await screen.findByLabelText("Nội dung chú thích"), { target: { value: "kết luận" } });
    fireEvent.click(screen.getByRole("button", { name: "Chèn" }));
    expect(commands?.insertDocxNote).toHaveBeenCalledWith("endnote", "kết luận");
  });

  it("keeps the dialog open and reports an insert the editor refused", async () => {
    const commands = runtime({ insertDocxNote: vi.fn(() => null) });
    renderGroup({ commands });
    fireEvent.click(screen.getByRole("button", { name: "Chèn chú thích chân trang" }));
    fireEvent.change(await screen.findByLabelText("Nội dung chú thích"), { target: { value: "mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Chèn" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Nội dung chú thích")).toBeInTheDocument();
  });

  it("shows the note count and opens the notes pane from the toolbar entry", () => {
    renderGroup();
    const trigger = screen.getByRole("button", { name: "Chú thích" });
    expect(trigger).toHaveTextContent("1");
    fireEvent.click(trigger);
    expect(screen.getByText("ghi chú một")).toBeInTheDocument();
  });

  it("disables the insert entries without a selection and explains why", () => {
    const commands = runtime({ canInsertDocxNote: vi.fn(() => false) });
    renderGroup({ commands });
    const trigger = screen.getByRole("button", { name: "Chèn chú thích chân trang" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("title", "Hãy đặt con trỏ trong văn bản trước.");
  });

  it("disables everything without a command runtime", () => {
    renderGroup({ commands: undefined });
    expect(screen.getByRole("button", { name: "Chèn chú thích chân trang" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Chú thích" })).toBeDisabled();
  });

  it("keeps notes readable but not editable on a read-only document", () => {
    renderGroup({ readOnly: true });
    expect(screen.getByRole("button", { name: "Chèn chú thích chân trang" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Chú thích" }));
    expect(screen.getByText("ghi chú một")).toBeInTheDocument();
    expect(screen.getByText(/chỉ đọc/)).toBeInTheDocument();
  });
});
