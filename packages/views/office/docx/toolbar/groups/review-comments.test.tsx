// The popover is mocked the way the repo's other popover tests do it: jsdom
// has no layout, so the real Base UI positioner never opens; the stand-in
// forwards open state/props so the group's wiring stays under test.
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DocxCommentInfo } from "@uniwork/office-engine/docx";
import type { DocxCommandRuntime } from "../../commands";
import type { DocxToolbarGroupContext } from "../types";
import { ReviewCommentsGroup } from "./review-comments";

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

const COMMENTS: DocxCommentInfo[] = [
  { id: "1", author: "Alice", text: "xin chào" },
  { id: "2", author: "Bob", text: "đồng ý", parentId: "1" },
];

function runtime(): DocxCommandRuntime {
  return {
    listDocxComments: vi.fn(() => COMMENTS),
    docxCommentsRevision: vi.fn(() => 0),
    canAddDocxComment: vi.fn(() => true),
    addDocxComment: vi.fn(() => COMMENTS[0]),
    replyToDocxComment: vi.fn(() => null),
    resolveDocxComment: vi.fn(() => true),
    deleteDocxComment: vi.fn(() => true),
    hasDocxCommentAnchor: vi.fn(() => true),
    docxCommentAnchorTexts: vi.fn(() => new Map([["1", "trích đoạn"]])),
    jumpToDocxComment: vi.fn(() => true),
  } as unknown as DocxCommandRuntime;
}

function renderGroup(options: { commands?: DocxCommandRuntime; readOnly?: boolean; comments?: DocxCommentInfo[] } = {}) {
  popoverState.open = false;
  const commands = "commands" in options ? options.commands : runtime();
  const props: DocxToolbarGroupContext = {
    editor: {} as unknown as DocxToolbarGroupContext["editor"],
    coordinator: {} as unknown as DocxToolbarGroupContext["coordinator"],
    format: { docxComments: options.comments ?? COMMENTS } as unknown as DocxToolbarGroupContext["format"],
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
  render(<ReviewCommentsGroup {...props} />);
  return { commands };
}

describe("ReviewCommentsGroup", () => {
  it("shows the thread count, not the entry count, and opens the pane from the toolbar entry", () => {
    renderGroup();
    const trigger = screen.getByRole("button", { name: "Bình luận" });
    // one thread with a reply: the badge counts 1, not 2 entries
    expect(trigger).toHaveTextContent("1");
    fireEvent.click(trigger);
    expect(screen.getByText("xin chào")).toBeInTheDocument();
    expect(screen.getByText("trích đoạn")).toBeInTheDocument();
  });

  it("adds a comment on the current selection through the runtime", () => {
    const { commands } = renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Bình luận" }));
    fireEvent.click(screen.getByRole("button", { name: "Thêm bình luận" }));
    fireEvent.change(screen.getByLabelText("Nhập nội dung bình luận…"), { target: { value: "ghi chú mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    expect(commands?.addDocxComment).toHaveBeenCalledWith("ghi chú mới", "UniWork", "UN");
  });

  it("disables the entry without a command runtime", () => {
    renderGroup({ commands: undefined });
    expect(screen.getByRole("button", { name: "Bình luận" })).toBeDisabled();
  });

  it("keeps comments readable but not editable on a read-only document", () => {
    renderGroup({ readOnly: true });
    fireEvent.click(screen.getByRole("button", { name: "Bình luận" }));
    expect(screen.getByText("xin chào")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thêm bình luận" })).not.toBeInTheDocument();
  });
});
