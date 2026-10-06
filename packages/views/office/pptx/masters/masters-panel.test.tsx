import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { MastersPanel } from "./masters-panel";
import type { MasterElementView, MasterPanelEdit, MasterPanelProps, MasterPartView } from "./masters-model";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const PARTS: MasterPartView[] = [
  { partPath: "ppt/slideMasters/slideMaster1.xml", kind: "master", name: "Office Theme" },
  { partPath: "ppt/slideLayouts/slideLayout1.xml", kind: "layout", name: "Title Slide" },
  { partPath: "ppt/slideLayouts/slideLayout2.xml", kind: "layout", name: "Title and Content" },
];
const PART = PARTS[1]!.partPath;
const ELEMENTS: MasterElementView[] = [
  { id: "t1", type: "shape", label: "Title 1", placeholder: "title", box: { x: 10, y: 20, w: 300, h: 80 }, fill: null },
  { id: "p1", type: "picture", label: "Logo", box: { x: 0, y: 0, w: 50, h: 50 } },
];

function baseProps(overrides: Partial<MasterPanelProps> = {}): MasterPanelProps {
  return {
    parts: PARTS,
    activePart: PART,
    onSelectPart: vi.fn(),
    elements: ELEMENTS,
    selectedElementId: "t1",
    onSelectElement: vi.fn(),
    onEdit: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

function setup(overrides: Partial<MasterPanelProps> = {}) {
  const onEdit = vi.fn<(edit: MasterPanelEdit) => void>();
  const props = baseProps({ onEdit, ...overrides });
  render(<MastersPanel {...props} />);
  return { onEdit, onSelectPart: props.onSelectPart, onSelectElement: props.onSelectElement, onClose: props.onClose };
}

const panel = () => document.querySelector("[data-pptx-masters-panel]") as HTMLElement;

describe("MastersPanel", () => {
  it("lists the master first, then its layouts, with kind badges", () => {
    setup();
    const parts = screen.getByRole("listbox", { name: "Masters and layouts" });
    const options = within(parts).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("data-key"))).toEqual(PARTS.map((p) => p.partPath));
    expect(within(options[0]!).getByText("Master")).toBeInTheDocument();
    expect(within(options[1]!).getByText("Layout")).toBeInTheDocument();
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(panel()).toHaveAttribute("data-state", "ready");
  });

  it("selects a part by click and by keyboard", () => {
    const { onSelectPart } = setup();
    const parts = screen.getByRole("listbox", { name: "Masters and layouts" });
    fireEvent.click(within(parts).getByText("Title and Content"));
    expect(onSelectPart).toHaveBeenLastCalledWith(PARTS[2]!.partPath);
    fireEvent.keyDown(parts, { key: "ArrowDown" });
    expect(onSelectPart).toHaveBeenLastCalledWith(PARTS[2]!.partPath);
    fireEvent.keyDown(parts, { key: "ArrowUp" });
    expect(onSelectPart).toHaveBeenLastCalledWith(PARTS[0]!.partPath);
    fireEvent.keyDown(parts, { key: "End" });
    expect(onSelectPart).toHaveBeenLastCalledWith(PARTS[2]!.partPath);
    fireEvent.keyDown(parts, { key: "Home" });
    expect(onSelectPart).toHaveBeenLastCalledWith(PARTS[0]!.partPath);
  });

  it("selects and clears elements by keyboard", () => {
    const { onSelectElement } = setup();
    const list = screen.getByRole("listbox", { name: "Elements" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(onSelectElement).toHaveBeenLastCalledWith("p1");
    fireEvent.keyDown(list, { key: "Escape" });
    expect(onSelectElement).toHaveBeenLastCalledWith(null);
    fireEvent.click(within(list).getByText("Logo"));
    expect(onSelectElement).toHaveBeenLastCalledWith("p1");
  });

  it("emits the text edit for a placeholder element", () => {
    const { onEdit } = setup();
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Click to add title" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply text" }));
    expect(onEdit).toHaveBeenCalledWith({
      op: "master_edit_text",
      part: PART,
      elementId: "t1",
      text: "Click to add title",
    });
  });

  it("seeds the text field from the element text, and re-seeds when it changes", () => {
    const seeded: MasterElementView[] = [{ ...ELEMENTS[0]!, text: "Click to edit" }, ELEMENTS[1]!];
    const view = render(<MastersPanel {...baseProps({ elements: seeded })} />);
    expect(screen.getByLabelText("Text")).toHaveValue("Click to edit");
    view.rerender(<MastersPanel {...baseProps({ elements: [{ ...ELEMENTS[0]!, text: "Changed" }, ELEMENTS[1]!] })} />);
    expect(screen.getByLabelText("Text")).toHaveValue("Changed");
  });

  it("hides the text field for non-text elements", () => {
    setup({ selectedElementId: "p1" });
    expect(screen.queryByLabelText("Text")).toBeNull();
  });

  it("emits a validated transform and refuses an invalid box", () => {
    const { onEdit } = setup();
    expect(screen.getByLabelText("X")).toHaveValue(10);
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply position" }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("width and height must be at least 1");
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "320" } });
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply position" }));
    expect(onEdit).toHaveBeenCalledWith({
      op: "master_set_transform",
      part: PART,
      elementId: "t1",
      box: { x: 12.5, y: 20, w: 320, h: 80 },
    });
  });

  it("emits fill colour and no-fill edits", () => {
    const { onEdit } = setup();
    fireEvent.change(screen.getAllByLabelText("Hex colour")[0]!, { target: { value: "12ab34" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply fill" }));
    expect(onEdit).toHaveBeenLastCalledWith({ op: "master_set_fill", part: PART, elementId: "t1", color: "#12AB34" });
    fireEvent.click(screen.getByRole("button", { name: "No fill" }));
    expect(onEdit).toHaveBeenLastCalledWith({ op: "master_set_fill", part: PART, elementId: "t1", color: null });
  });

  it("disables Apply fill for a half-typed colour", () => {
    setup();
    fireEvent.change(screen.getAllByLabelText("Hex colour")[0]!, { target: { value: "#12" } });
    expect(screen.getByRole("button", { name: "Apply fill" })).toBeDisabled();
    expect(screen.getAllByText("Enter a colour like #4472C4.")).toHaveLength(1);
  });

  it("emits outline edits with and without a width", () => {
    const { onEdit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Apply outline" }));
    expect(onEdit).toHaveBeenLastCalledWith({ op: "master_set_stroke", part: PART, elementId: "t1", color: "#000000" });
    fireEvent.change(screen.getByLabelText("Outline width (pt)"), { target: { value: "2.5" } });
    fireEvent.change(screen.getAllByLabelText("Hex colour")[1]!, { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply outline" }));
    expect(onEdit).toHaveBeenLastCalledWith({
      op: "master_set_stroke",
      part: PART,
      elementId: "t1",
      color: "#FF0000",
      widthPt: 2.5,
    });
    fireEvent.click(screen.getByRole("button", { name: "No outline" }));
    expect(onEdit).toHaveBeenLastCalledWith({ op: "master_set_stroke", part: PART, elementId: "t1", color: null });
  });

  it("refuses a negative outline width", () => {
    const { onEdit } = setup();
    fireEvent.change(screen.getByLabelText("Outline width (pt)"), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply outline" }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("from 0 to 1584");
  });

  it("emits a delete edit without confirmation", () => {
    const { onEdit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete element" }));
    expect(onEdit).toHaveBeenCalledWith({ op: "master_delete_element", part: PART, elementId: "t1" });
  });

  it("disables every control while an edit is pending", () => {
    const { onEdit } = setup({ pending: true });
    expect(panel()).toHaveAttribute("data-state", "pending");
    expect(screen.getByRole("button", { name: "Delete element" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply position" })).toBeDisabled();
    expect(screen.getByTestId("pptx-masters-busy")).toHaveTextContent("Applying...");
    expect(screen.getByRole("listbox", { name: "Elements" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Delete element" }));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("shows the unbound notice and disables edits without onEdit", () => {
    setup({ onEdit: undefined });
    expect(panel()).toHaveAttribute("data-state", "unbound");
    expect(screen.getByTestId("pptx-masters-unbound")).toHaveTextContent("not connected");
    expect(screen.getByRole("button", { name: "Delete element" })).toBeDisabled();
  });

  it("honours an explicit unbound status", () => {
    setup({ status: "unbound" });
    expect(panel()).toHaveAttribute("data-state", "unbound");
  });

  it("renders the loading skeleton", () => {
    setup({ status: "loading" });
    expect(panel()).toHaveAttribute("data-state", "loading");
    expect(screen.getByRole("status", { name: "Loading the slide master..." })).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("explains empty parts, no active part, empty elements and no selection", () => {
    const empty = render(<MastersPanel {...baseProps({ parts: [], activePart: null, elements: [] })} />);
    expect(screen.getByTestId("pptx-masters-parts-empty")).toBeInTheDocument();
    empty.unmount();

    const noPart = render(<MastersPanel {...baseProps({ activePart: null, elements: [] })} />);
    expect(screen.getByTestId("pptx-masters-no-part")).toBeInTheDocument();
    noPart.unmount();

    const noEls = render(<MastersPanel {...baseProps({ elements: [] })} />);
    expect(screen.getByTestId("pptx-masters-elements-empty")).toBeInTheDocument();
    noEls.unmount();

    render(<MastersPanel {...baseProps({ selectedElementId: null })} />);
    expect(screen.getByTestId("pptx-masters-no-element")).toBeInTheDocument();
  });

  it("closes through the Close master view button", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close master view" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("localises to Vietnamese", async () => {
    await setLocale("vi");
    setup();
    expect(screen.getByRole("button", { name: "Đóng chế độ bản cái" })).toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Bản cái và bố cục" })).toBeInTheDocument();
  });

  it("reseeds the inspector when the element changes", () => {
    const view = render(<MastersPanel {...baseProps({ selectedElementId: "t1" })} />);
    expect(within(view.container).getByLabelText("Width")).toHaveValue(300);
    view.rerender(<MastersPanel {...baseProps({ selectedElementId: "p1" })} />);
    expect(within(view.container).getByLabelText("Width")).toHaveValue(50);
  });
});
