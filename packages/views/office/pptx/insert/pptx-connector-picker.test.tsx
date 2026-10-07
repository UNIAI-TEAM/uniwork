// UNI-939 T02/T03 - the connector pane: line colour / width / dash, explicit attach
// sides, and Apply-to-selected emitting set_stroke. Rendered through the Insert panel,
// the same way the host mounts it, so the real i18n copy and the real edit shapes stay in the loop.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PptxInsertPanel, type PptxInsertPanelProps } from "./pptx-insert-panel";
import type { PptxInsertElementRef } from "./insert-model";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const elements: PptxInsertElementRef[] = [
  { id: "s1", type: "shape", label: "Box A" },
  { id: "s2", type: "shape", label: "Box B" },
  { id: "c1", type: "shape", label: "Line 1", connector: true },
];

function renderPanel(props: Partial<PptxInsertPanelProps> = {}) {
  const onEdit = vi.fn();
  const onInsertConnector = vi.fn();
  render(<PptxInsertPanel slideIndex={0} elements={elements} selectedIds={["s1", "s2"]} onEdit={onEdit} onInsertConnector={onInsertConnector} {...props} />);
  return { onEdit, onInsertConnector };
}

/** Open a Base UI select by its accessible name and pick an option. */
function choose(name: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name }));
  const item = screen.getByRole("option", { name: option });
  fireEvent.pointerDown(item, { pointerType: "mouse" });
  fireEvent.pointerUp(item, { pointerType: "mouse" });
  fireEvent.click(item);
}

describe("connector attach sides (T03)", () => {
  it("defaults both ends to Auto and sends no side", () => {
    const { onInsertConnector } = renderPanel();
    expect(screen.getByTestId("pptx-connector-from-side")).toHaveTextContent("Auto");
    expect(screen.getByTestId("pptx-connector-to-side")).toHaveTextContent("Auto");
    fireEvent.click(screen.getByTestId("pptx-connector-insert"));
    const request = onInsertConnector.mock.calls[0]![0] as Record<string, unknown>;
    expect(request).toEqual({ slideIndex: 0, from: "s1", to: "s2", kind: "straight", arrow: "end" });
    expect(request).not.toHaveProperty("fromSide");
    expect(request).not.toHaveProperty("toSide");
  });

  it("pins each end to the side the user picked", () => {
    const { onInsertConnector } = renderPanel();
    choose("Start side", "Bottom");
    choose("End side", "Left");
    expect(screen.getByTestId("pptx-connector-from-side")).toHaveTextContent("Bottom");
    expect(screen.getByTestId("pptx-connector-to-side")).toHaveTextContent("Left");
    fireEvent.click(screen.getByTestId("pptx-connector-insert"));
    expect(onInsertConnector).toHaveBeenCalledWith({ slideIndex: 0, from: "s1", to: "s2", kind: "straight", arrow: "end", fromSide: "bottom", toSide: "left" });
  });

  it("pinning one end leaves the other to the engine", () => {
    const { onInsertConnector } = renderPanel();
    choose("End side", "Top");
    fireEvent.click(screen.getByTestId("pptx-connector-insert"));
    const request = onInsertConnector.mock.calls[0]![0] as Record<string, unknown>;
    expect(request.toSide).toBe("top");
    expect(request).not.toHaveProperty("fromSide");
  });

  it("reads Vietnamese labels with no raw keys", async () => {
    await setLocale("vi");
    renderPanel();
    expect(screen.getByTestId("pptx-connector-from-side")).toHaveTextContent("Tự động");
    expect(document.querySelector("[data-pptx-insert-connector]")?.textContent ?? "").not.toMatch(/office\.pptx\./);
  });
});

describe("connector line style (T02)", () => {
  it("sends no line while the pane is untouched", () => {
    const { onInsertConnector } = renderPanel();
    fireEvent.click(screen.getByTestId("pptx-connector-insert"));
    expect(onInsertConnector.mock.calls[0]![0]).not.toHaveProperty("line");
  });

  it("sends colour, width and dash with the new connector", () => {
    const { onInsertConnector } = renderPanel();
    fireEvent.change(screen.getByTestId("pptx-connector-line-color"), { target: { value: "#c00000" } });
    fireEvent.change(screen.getByTestId("pptx-connector-line-width"), { target: { value: "3" } });
    choose("Dash style", "Dash");
    fireEvent.click(screen.getByTestId("pptx-connector-insert"));
    expect(onInsertConnector).toHaveBeenCalledWith(expect.objectContaining({ line: { color: "#C00000", widthEmu: 38100, dash: "dash" } }));
  });

  it("blocks Add connector while the width is not a positive number", () => {
    renderPanel();
    fireEvent.change(screen.getByTestId("pptx-connector-line-width"), { target: { value: "0" } });
    expect(screen.getByTestId("pptx-connector-line-width")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("pptx-connector-insert")).toBeDisabled();
    fireEvent.change(screen.getByTestId("pptx-connector-line-width"), { target: { value: "2" } });
    expect(screen.getByTestId("pptx-connector-insert")).toBeEnabled();
  });

  it("restyles the selected connector with set_stroke", () => {
    const { onEdit } = renderPanel({ selectedIds: ["c1"] });
    expect(screen.getByTestId("pptx-connector-apply-line")).toBeEnabled();
    fireEvent.change(screen.getByTestId("pptx-connector-line-color"), { target: { value: "#00aa00" } });
    fireEvent.change(screen.getByTestId("pptx-connector-line-width"), { target: { value: "2" } });
    choose("Dash style", "Dot");
    fireEvent.click(screen.getByTestId("pptx-connector-apply-line"));
    expect(onEdit).toHaveBeenCalledWith({ op: "set_stroke", slideIndex: 0, elementId: "c1", stroke: { color: "#00AA00", widthEmu: 25400, dash: "dot" } });
  });

  it("keeps Apply disabled, with a hint, unless exactly one connector is selected", () => {
    renderPanel({ selectedIds: ["s1"] });
    expect(screen.getByTestId("pptx-connector-apply-line")).toBeDisabled();
    expect(document.querySelector("[data-pptx-connector-line]")).toHaveTextContent("Select a connector on the slide");
  });

  it("never offers an existing connector as a start or end shape", () => {
    renderPanel({ selectedIds: [] });
    fireEvent.click(screen.getByRole("combobox", { name: "Start shape" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Box A", "Box B"]);
  });
});
