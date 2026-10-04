// The popover is mocked the way the repo’s other popover tests do it: jsdom
// has no layout, so the real Base UI positioner never opens; the stand-in
// forwards open state/props so the group’s wiring stays under test.
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DocxCommandRuntime } from "../../commands";
import type { DocxReviewChange } from "../../review/revision-model";
import type { DocxToolbarGroupContext } from "../types";
import { ReviewTrackChangesGroup } from "./review-track-changes";

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

const CHANGES: DocxReviewChange[] = [
  { id: "ins:1:6", kind: "ins", author: "Alice", date: "2026-01-02T03:04:05Z", from: 1, to: 6, snippet: "đoạn được chèn" },
  { id: "del:7:10", kind: "del", author: "Bob", from: 7, to: 10, snippet: "đoạn bị xóa" },
];

function runtime(): DocxCommandRuntime {
  return {
    listReviewChanges: vi.fn(() => CHANGES),
    acceptReviewChange: vi.fn(() => true),
    rejectReviewChange: vi.fn(() => true),
    acceptAllReviewChanges: vi.fn(() => true),
    rejectAllReviewChanges: vi.fn(() => true),
    jumpToReviewChange: vi.fn(() => true),
  } as unknown as DocxCommandRuntime;
}

function renderGroup(options: { commands?: DocxCommandRuntime; format?: DocxToolbarGroupContext["format"] } = {}) {
  popoverState.open = false;
  const commands = "commands" in options ? options.commands : runtime();
  const props: DocxToolbarGroupContext = {
    editor: {} as unknown as DocxToolbarGroupContext["editor"],
    coordinator: {} as unknown as DocxToolbarGroupContext["coordinator"],
    format: "format" in options ? options.format ?? null : ({ reviewChanges: CHANGES } as unknown as DocxToolbarGroupContext["format"]),
    commands,
    selection: null,
    readOnly: false,
    saving: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
  render(<ReviewTrackChangesGroup {...props} />);
  return { commands };
}

describe("ReviewTrackChangesGroup", () => {
  it("shows the change count and opens the pane from the toolbar entry", () => {
    renderGroup();
    // F9: the kept trigger is an sr-only anchor (aria-hidden), so query by testid.
    const trigger = screen.getByTestId("docx-review-toggle");
    expect(trigger).toHaveTextContent("2");
    fireEvent.click(trigger);
    expect(screen.getByText("đoạn được chèn")).toBeInTheDocument();
  });

  it("keeps the loading state while the document is still opening", () => {
    renderGroup({ format: null });
    fireEvent.click(screen.getByTestId("docx-review-toggle"));
    expect(screen.getByText("Đang tải thay đổi…")).toBeInTheDocument();
    expect(screen.queryByText("Không có thay đổi được theo dõi")).not.toBeInTheDocument();
  });

  it("clears the jumped-to highlight when the pane closes", () => {
    renderGroup();
    fireEvent.click(screen.getByTestId("docx-review-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "Đến thay đổi: đoạn được chèn" }));
    expect(screen.getByText("đoạn được chèn").closest("li")).toHaveClass("bg-surface-hover");
    fireEvent.click(screen.getByRole("button", { name: "Đóng danh sách thay đổi" }));
    fireEvent.click(screen.getByTestId("docx-review-toggle"));
    expect(screen.getByText("đoạn được chèn").closest("li")).not.toHaveClass("bg-surface-hover");
  });

  it("disables the entry without a command runtime", () => {
    renderGroup({ commands: undefined });
    expect(screen.getByTestId("docx-review-toggle")).toBeDisabled();
  });
});
