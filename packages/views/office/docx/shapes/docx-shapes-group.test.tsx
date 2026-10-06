// The popover is mocked the way the repo's other popover tests do it: jsdom has
// no layout, so the real Base UI positioner never opens; the stand-in forwards
// open state/props so the group's wiring stays under test.
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DocxCommandRuntime } from "../commands";
import type { DocxShapeInfo } from "./docx-shape-model";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { DocxShapesGroup, docxShapesRibbonItems } from "./docx-shapes-group";
import { createDocxDocumentScope } from "../editor-store";

vi.mock("@uniwork/ui/components/ui/popover", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  // One context per Popover instance: the group renders TWO popovers (gallery
  // and format panel), so shared module state would let the panel's props
  // overwrite the gallery's and the gallery would never open.
  const Ctx = React.createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);
  return {
    Popover: ({ children, open, onOpenChange }: { children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void }) => {
      const [internal, setInternal] = React.useState(open);
      React.useEffect(() => {
        setInternal(open);
      }, [open]);
      const setOpen = (next: boolean) => {
        setInternal(next);
        onOpenChange?.(next);
      };
      return React.createElement(Ctx.Provider, { value: { open: internal, setOpen } }, children);
    },
    PopoverTrigger: ({ render, children, ...props }: { render: ReactElement; children?: ReactNode } & Record<string, unknown>) => {
      const ctx = React.useContext(Ctx);
      return React.cloneElement(
        render as ReactElement<Record<string, unknown>>,
        { ...props, onClick: () => ctx?.setOpen(!ctx.open) },
        children,
      );
    },
    PopoverContent: ({ children }: { children: ReactNode }) => {
      const ctx = React.useContext(Ctx);
      return ctx?.open ? React.createElement("div", { role: "dialog" }, children) : null;
    },
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
  parsed: false,
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
  const commands = "commands" in options ? options.commands : runtime();
  const props: DocxToolbarGroupContext = {
    docScope: createDocxDocumentScope(),
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

    fireEvent.click(screen.getByRole("button", { name: "Bỏ tô" }));
    expect(commands?.applyDocxShapeEdit).toHaveBeenCalledWith({ kind: "fill", color: null });

    fireEvent.click(screen.getByRole("button", { name: "Bỏ viền" }));
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

  it("locks the height of a straight line and disables offsets while no wrap mode is set", () => {
    renderGroup({ shape: { ...SHAPE, prst: "lineArrow", straight: true, heightPx: 12 } });
    fireEvent.click(screen.getByRole("button", { name: "Định dạng hình" }));
    expect(screen.getByTestId("docx-shape-height")).toBeDisabled();
    const offsetHint = "Lệch cần một cách bao văn bản nổi; hình nằm trong dòng không có lệch.";
    expect(screen.getByTestId("docx-shape-offset-x")).toBeDisabled();
    expect(screen.getByTestId("docx-shape-offset-y")).toBeDisabled();
    expect(screen.getByTestId("docx-shape-offset-x")).toHaveAttribute("title", offsetHint);
    expect(screen.getByTestId("docx-shape-offset-y")).toHaveAttribute("title", offsetHint);
  });

  it("rests on the shape-default placeholder instead of a fake inline mode", () => {
    renderGroup({ shape: SHAPE });
    fireEvent.click(screen.getByRole("button", { name: "Định dạng hình" }));
    const wrap = screen.getByRole("combobox", { name: "Cách bao văn bản" });
    expect(wrap).toHaveTextContent("Mặc định của hình");
    // an inserted shape still persists a wrap pick, so the picker stays live
    expect(wrap).not.toBeDisabled();
  });

  it("disables the wrap picker for a parsed shape and explains why on the trigger", () => {
    renderGroup({ shape: { ...SHAPE, parsed: true } });
    fireEvent.click(screen.getByRole("button", { name: "Định dạng hình" }));
    const wrap = screen.getByRole("combobox", { name: "Cách bao văn bản" });
    expect(wrap).toBeDisabled();
    expect(wrap).toHaveAttribute(
      "title",
      "Cách bao văn bản cho hình có sẵn trong tài liệu chỉ được lưu khi vị trí thay đổi.",
    );
    // m-3: the reason is also visible without hover (keyboard/touch users)
    expect(
      screen.getByText(
        "Cách bao văn bản cho hình có sẵn trong tài liệu chỉ được lưu khi vị trí thay đổi.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the parsed-shape caption out of an inserted shape", () => {
    renderGroup({ shape: SHAPE });
    fireEvent.click(screen.getByRole("button", { name: "Định dạng hình" }));
    expect(
      screen.queryByText(
        "Cách bao văn bản cho hình có sẵn trong tài liệu chỉ được lưu khi vị trí thay đổi.",
      ),
    ).toBeNull();
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

// W-G (UNI-924): the typed ribbon path for the shapes group. The ribbon renders
// these items instead of the group component, so every shape the dropdown offers
// must still call the same insertDocxShape command as the gallery - with the
// TRANSLATED label, not the raw i18n key.
describe("docxShapesRibbonItems", () => {
  function typedContext(commands: DocxCommandRuntime): DocxToolbarGroupContext {
    return {
      docScope: createDocxDocumentScope(),
      editor: {} as unknown as DocxToolbarGroupContext["editor"],
      coordinator: {} as unknown as DocxToolbarGroupContext["coordinator"],
      format: {} as unknown as DocxToolbarGroupContext["format"],
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
  }

  it("exposes the primary Shape command as a large dropdown of the five shapes", () => {
    const items = docxShapesRibbonItems(typedContext(runtime()));
    expect(items[0]).toMatchObject({
      kind: "dropdown",
      id: "insert-shapes",
      size: "large",
      labelKey: "office.docx.shapes.insert",
    });
    expect(items[1]).toMatchObject({ kind: "custom", id: "insert-shapes-gallery" });
    const primary = items[0]!;
    if (primary.kind !== "dropdown") throw new Error("expected a dropdown");
    expect(primary.menu.map((entry) => entry.id)).toEqual([
      "insert-shape-rect",
      "insert-shape-ellipse",
      "insert-shape-line",
      "insert-shape-arrow",
      "insert-shape-textBox",
    ]);
  });

  it("routes every shape through the same insertDocxShape command with its translated label", () => {
    const commands = runtime();
    const items = docxShapesRibbonItems(typedContext(commands));
    const primary = items[0]!;
    if (primary.kind !== "dropdown") throw new Error("expected a dropdown");
    for (const entry of primary.menu) entry.onSelect();
    expect(commands.insertDocxShape).toHaveBeenCalledWith("rect", "Hình chữ nhật");
    expect(commands.insertDocxShape).toHaveBeenCalledWith("ellipse", "Hình bầu dục");
    expect(commands.insertDocxShape).toHaveBeenCalledWith("line", "Đường thẳng");
    expect(commands.insertDocxShape).toHaveBeenCalledWith("arrow", "Mũi tên");
    expect(commands.insertDocxShape).toHaveBeenCalledWith("textBox", "Hộp văn bản");
    expect(commands.insertDocxShape).toHaveBeenCalledTimes(5);
  });

  it("disables the typed items while read-only or without a runtime", () => {
    const readOnly = docxShapesRibbonItems({ ...typedContext(runtime()), readOnly: true });
    expect(readOnly[0]).toMatchObject({ disabled: true });
    const noRuntime = docxShapesRibbonItems({ ...typedContext(runtime()), commands: undefined });
    expect(noRuntime[0]).toMatchObject({ disabled: true });
  });
});
