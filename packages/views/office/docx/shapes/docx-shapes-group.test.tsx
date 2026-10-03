// The popover is mocked the way the repo's other popover tests do it: jsdom has
// no layout, so the real Base UI positioner never opens; the stand-in forwards
// open state/props so the group's wiring stays under test.
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DocxCommandRuntime } from "../commands";
import type { DocxShapeInfo } from "./docx-shape-model";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { DocxShapesGroup } from "./docx-shapes-group";

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

const SHAPE: DocxShapeInfo = {
  prst: "rect",
  straight: false,
  fill: "4472C4",
  borderColor: "2F5496",
  widthPx: 189,
  heightPx: 113,
  wrap: null,
  offsetXEmu: null,
  offsetYEmu: null,
};

function runtime(overrides: Partial<DocxCommandRuntime> = {}): DocxCommandRuntime {
  return {
    insertDocxShape: vi.fn(() => true),
    applyDocxShapeEdit: vi.fn(() => true),
    ...overrides,
  } as unknown as DocxCommandRuntime;
}

function renderGroup(
  options: { commands?: DocxCommandRuntime; readOnly?: boolean; saving?: boolean; shape?: DocxShapeInfo | null } = {},
) {
  popoverState.open = false;
  const commands = "commands" in options ? options.commands : runtime();
  const props: DocxToolbarGroupContext = {
    editor: {} as unknown as DocxToolbarGroupContext["editor"],
    coordinator: {} as unknown as DocxToolbarGroupContext["coordinator"],
    format: { docxShape: options.shape ?? null } as unknown as DocxToolbarGroupContext["format"],
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
  render(<DocxShapesGroup {...props} />);
  return { commands };
}

describe("DocxShapesGroup gallery", () => {
  it("inserts a basic shape with its localized label", () => {
    const { commands } = renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Hình dạng" }));
    fireEvent.click(screen.getByRole("button", { name: "Hình chữ nhật" }));
    expect(commands?.insertDocxShape).toHaveBeenCalledWith("rect", "Hình chữ nhật");
  });

  it("inserts a text box from the same gallery", () => {
    const { commands } = renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Hình dạng" }));
    fireEvent.click(screen.getByRole("button", { name: "Hộp văn bản" }));
    expect(commands?.insertDocxShape).toHaveBeenCalledWith("textBox", "Hộp văn bản");
  });

  it("disables the gallery on a read-only document, while saving and without a runtime", () => {
    renderGroup({ readOnly: true });
    expect(screen.getByRole("button", { name: "Hình dạng" })).toBeDisabled();
    renderGroup({ saving: true });
    expect(screen.getAllByRole("button", { name: "Hình dạng" }).at(-1)).toBeDisabled();
    renderGroup({ commands: undefined });
    expect(screen.getAllByRole("button", { name: "Hình dạng" }).at(-1)).toBeDisabled();
  });
});

describe("DocxShapesGroup format panel", () => {
  it("is disabled without a selected shape and explains why", () => {
    renderGroup();
    const trigger = screen.getByRole("button", { name: "Định dạng hình" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("title", "Hãy chọn một hình trước.");
  });

  it("maps fill, outline and size edits to the command runtime", () => {
    const { commands } = renderGroup({ shape: SHAPE });
    fireEvent.click(screen.getByRole("button", { name: "Định dạng hình" }));

    fireEvent.change(screen.getByTestId("docx-shape-fill"), { target: { value: "#ff0000" } });
    expect(commands?.applyDocxShapeEdit).toHaveBeenCalledWith({ kind: "fill", color: "ff0000" });

    fireEvent.click(screen.getByRole("button", { name: "Không tô" }));
    expect(commands?.applyDocxShapeEdit).toHaveBeenCalledWith({ kind: "fill", color: null });

    fireEvent.click(screen.getByRole("button", { name: "Không viền" }));
    expect(commands?.applyDocxShapeEdit).toHaveBeenCalledWith({ kind: "outline", color: null });

    const width = screen.getByTestId("docx-shape-width");
    fireEvent.change(width, { target: { value: "240" } });
    fireEvent.blur(width);
    expect(commands?.applyDocxShapeEdit).toHaveBeenCalledWith({ kind: "size", widthPx: 240, heightPx: 113 });

    // an out-of-range draft snaps back to the model value and writes nothing
    const height = screen.getByTestId("docx-shape-height");
    fireEvent.change(height, { target: { value: "0" } });
    fireEvent.blur(height);
    expect(height).toHaveValue("113");
  });

  it("locks the height of a straight line and disables offsets while inline", () => {
    renderGroup({ shape: { ...SHAPE, prst: "lineArrow", straight: true, heightPx: 12 } });
    fireEvent.click(screen.getByRole("button", { name: "Định dạng hình" }));
    expect(screen.getByTestId("docx-shape-height")).toBeDisabled();
    expect(screen.getByTestId("docx-shape-offset-x")).toBeDisabled();
    expect(screen.getByTestId("docx-shape-offset-y")).toBeDisabled();
  });

  it("commits a floating offset pair once the shape wraps", () => {
    const { commands } = renderGroup({ shape: { ...SHAPE, wrap: "square-left" } });
    fireEvent.click(screen.getByRole("button", { name: "Định dạng hình" }));
    const offsetX = screen.getByTestId("docx-shape-offset-x");
    const offsetY = screen.getByTestId("docx-shape-offset-y");
    fireEvent.change(offsetX, { target: { value: "96" } });
    fireEvent.change(offsetY, { target: { value: "48" } });
    fireEvent.blur(offsetY);
    expect(commands?.applyDocxShapeEdit).toHaveBeenCalledWith({
      kind: "position",
      wrap: "square-left",
      offsetXEmu: 96 * 9525,
      offsetYEmu: 48 * 9525,
    });
  });

  it("disables the panel controls on a read-only document", () => {
    renderGroup({ shape: SHAPE, readOnly: true });
    expect(screen.getByRole("button", { name: "Định dạng hình" })).toBeDisabled();
  });
});
