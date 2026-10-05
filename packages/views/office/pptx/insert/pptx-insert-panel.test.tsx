// A3ui (UNI-927) - component tests for the Insert panel.
//
// jsdom + RTL, the same harness the other pptx view tests use. The panel is
// presentational, so every assertion is about what it RENDERS (states, a11y
// roles) and what it EMITS (one registered edit / typed request per action).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PptxInsertPanel, type PptxInsertPanelProps } from "./pptx-insert-panel";
import { pptxInsertNestedDictionary } from "./insert-i18n";
import type { PptxInsertElementRef } from "./insert-model";

// The panel's keys live in its own table until the UI-wire round merges them into
// the shared locale files, so register that table on the i18next singleton - the
// same seam comments-panel/notes-pane/sorter-panel tests use. Without it every
// t() returns its key and the name assertions below fail.
const i18n = initI18n();
i18n.addResourceBundle("en", "translation", pptxInsertNestedDictionary("en"), true, true);
i18n.addResourceBundle("vi", "translation", pptxInsertNestedDictionary("vi"), true, true);
beforeEach(async () => {
  await setLocale("en");
});

const elements: PptxInsertElementRef[] = [
  { id: "s1", type: "shape", label: "Rectangle 1" },
  { id: "p1", type: "picture", label: "Picture 1" },
  { id: "tbl1", type: "table", label: "Table 1" },
];

function renderPanel(props: Partial<PptxInsertPanelProps> = {}) {
  const onEdit = vi.fn();
  const onInsertConnector = vi.fn();
  const onGroupSelection = vi.fn();
  const view = render(
    <PptxInsertPanel
      slideIndex={0}
      elements={elements}
      onEdit={onEdit}
      onInsertConnector={onInsertConnector}
      onGroupSelection={onGroupSelection}
      {...props}
    />,
  );
  return { view, onEdit, onInsertConnector, onGroupSelection };
}

function pngFile(name = "photo.png"): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

describe("PptxInsertPanel states", () => {
  it("renders every insert section in the ready state", () => {
    renderPanel();
    const panel = document.querySelector("[data-pptx-insert-panel]") as HTMLElement;
    expect(panel).toHaveAttribute("data-state", "ready");
    expect(panel).toHaveAttribute("aria-label", "Insert");
    expect(screen.getByRole("button", { name: "Shapes" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Text box" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Picture" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Replace picture" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "WordArt" })).toBeEnabled();
    expect(screen.getByRole("group", { name: "Insert tools" })).toBeInTheDocument();
  });

  it("renders a loading state instead of the tools", () => {
    renderPanel({ loading: true });
    const panel = document.querySelector("[data-pptx-insert-panel]") as HTMLElement;
    expect(panel).toHaveAttribute("data-state", "loading");
    expect(panel).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("pptx-insert-loading")).toHaveTextContent("Loading the insert tools");
    expect(screen.queryByRole("button", { name: "Shapes" })).not.toBeInTheDocument();
  });

  it("renders an empty state with every control disabled when no slide is bound", () => {
    renderPanel({ slideIndex: null });
    expect(document.querySelector("[data-pptx-insert-panel]")).toHaveAttribute("data-state", "empty");
    expect(screen.getByTestId("pptx-insert-hint")).toHaveTextContent("Select a slide to insert into.");
    expect(screen.getByRole("button", { name: "Text box" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Picture" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "WordArt" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add connector" })).toBeDisabled();
  });

  it("renders a disabled state with the host's reason", () => {
    renderPanel({ disabled: true, disabledReason: "This deck is read-only." });
    expect(document.querySelector("[data-pptx-insert-panel]")).toHaveAttribute("data-state", "disabled");
    expect(screen.getByTestId("pptx-insert-hint")).toHaveTextContent("This deck is read-only.");
    expect(screen.getByRole("button", { name: "Text box" })).toBeDisabled();
  });

  it("falls back to a generic hint when disabled without a reason", () => {
    renderPanel({ disabled: true });
    expect(screen.getByTestId("pptx-insert-hint")).toHaveTextContent("Insert is unavailable while the editor is busy.");
  });

  it("renders a busy state and a live status", () => {
    renderPanel({ busy: true });
    expect(document.querySelector("[data-pptx-insert-panel]")).toHaveAttribute("data-state", "busy");
    expect(screen.getByTestId("pptx-insert-busy")).toHaveTextContent("Applying the insert");
    expect(screen.getByRole("button", { name: "Text box" })).toBeDisabled();
  });

  it("surfaces an error the host reported", () => {
    renderPanel({ error: "The engine refused the insert." });
    const alert = document.querySelector("[data-pptx-insert-error]") as HTMLElement;
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("The engine refused the insert.");
  });

  it("disables the edit controls when no edit channel is bound", () => {
    renderPanel({ onEdit: undefined });
    expect(screen.getByRole("button", { name: "Text box" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shapes" })).toBeDisabled();
  });
});

describe("PptxInsertPanel shapes and text box", () => {
  it("emits add_element for a gallery shape", () => {
    const { onEdit } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));
    expect(screen.getByRole("group", { name: "Shape gallery" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rectangle" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0]![0]).toEqual({
      op: "add_element",
      slideIndex: 0,
      kind: "rect",
      xPx: 100,
      yPx: 80,
      wPx: 220,
      hPx: 150,
      fillColor: "#4472C4",
    });
  });

  it("gives a line preset a zero-height frame", () => {
    const { onEdit } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));
    fireEvent.click(screen.getByRole("button", { name: "Arrow" }));
    expect(onEdit.mock.calls[0]![0]).toMatchObject({ kind: "lineArrow", hPx: 0 });
    expect(onEdit.mock.calls[0]![0]).not.toHaveProperty("fillColor");
  });

  it("emits add_element for the text box action", () => {
    const { onEdit } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Text box" }));
    expect(onEdit).toHaveBeenCalledWith({
      op: "add_element",
      slideIndex: 0,
      kind: "textbox",
      xPx: 100,
      yPx: 100,
      wPx: 360,
      hPx: 90,
      paragraphs: [{ runs: [{ text: "Type your text" }] }],
    });
  });
});

describe("PptxInsertPanel WordArt", () => {
  it("emits a coloured add_element for the picked preset", async () => {
    const { onEdit } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "WordArt" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Insert decorative text");
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Blue, bold" }));
    // Picking a preset only selects it; the labelled button performs the insert.
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Insert WordArt" }));
    const edit = onEdit.mock.calls[0]![0] as { op: string; kind: string; paragraphs: Array<{ runs: Array<Record<string, unknown>> }> };
    expect(edit.op).toBe("add_element");
    expect(edit.kind).toBe("textbox");
    expect(edit.paragraphs[0]!.runs[0]).toEqual({ text: "Hello", color: "#4472C4", bold: true });
  });

  it("does not insert a duplicate when a preset is picked then inserted", async () => {
    const { onEdit } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "WordArt" }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Blue, bold" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert WordArt" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

describe("PptxInsertPanel picture", () => {
  it("reads the picked file and emits add_image with its bytes and extension", async () => {
    const { onEdit } = renderPanel();
    const input = document.querySelector('[data-pptx-image-input="insert"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    const edit = onEdit.mock.calls[0]![0] as { op: string; ext: string; bytes: Uint8Array; wPx: number };
    expect(edit.op).toBe("add_image");
    expect(edit.ext).toBe("png");
    expect(edit.bytes.length).toBe(4);
    expect(edit.wPx).toBeGreaterThan(0);
  });

  it("emits add_image from the insert control even while a picture is selected", async () => {
    const { onEdit } = renderPanel({ pictureId: "p1" });
    const input = document.querySelector('[data-pptx-image-input="insert"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    const edit = onEdit.mock.calls[0]![0] as { op: string };
    expect(edit.op).toBe("add_image");
  });

  it("emits replace_picture when a picture is selected", async () => {
    const { onEdit } = renderPanel({ pictureId: "p1" });
    const input = document.querySelector('[data-pptx-image-input="replace"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile("new.jpeg")] } });
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    const edit = onEdit.mock.calls[0]![0] as { op: string; elementId: string; ext: string };
    expect(edit.op).toBe("replace_picture");
    expect(edit.elementId).toBe("p1");
    expect(edit.ext).toBe("jpeg");
  });

  it("keeps Replace picture honest when no picture is selected", () => {
    const { onEdit } = renderPanel({ pictureId: null });
    const replace = screen.getByRole("button", { name: "Replace picture" });
    expect(replace).toBeDisabled();
    const hint = document.querySelector('[data-pptx-image-hint]') as HTMLElement;
    expect(hint).toHaveTextContent("Select a picture on the slide to replace it.");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("refuses an unsupported extension before the engine sees it", async () => {
    const { onEdit } = renderPanel();
    const input = document.querySelector('[data-pptx-image-input="insert"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], "deck.pptx")] } });
    const error = await screen.findByTestId("pptx-image-error");
    expect(error).toHaveTextContent("pptx is not a supported image format.");
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe("PptxInsertPanel connectors and grouping", () => {
  it("emits the validated connector request", () => {
    const { onInsertConnector } = renderPanel({ selectedIds: ["s1", "p1"] });
    expect(screen.getByTestId("pptx-connector-insert")).toBeEnabled();
    fireEvent.click(screen.getByTestId("pptx-connector-insert"));
    expect(onInsertConnector).toHaveBeenCalledWith({
      slideIndex: 0,
      from: "s1",
      to: "p1",
      kind: "straight",
      arrow: "end",
    });
  });

  it("explains why the same shape cannot connect to itself", () => {
    const { onInsertConnector } = renderPanel({ selectedIds: ["s1", "s1"] });
    expect(screen.getByTestId("pptx-connector-insert")).toBeDisabled();
    expect(screen.getByTestId("pptx-connector-reason")).toHaveTextContent("Choose two different shapes.");
    expect(onInsertConnector).not.toHaveBeenCalled();
  });

  it("says when there is nothing to connect", () => {
    renderPanel({ elements: [], selectedIds: [] });
    expect(screen.getByTestId("pptx-connector-empty")).toHaveTextContent("Add at least two shapes");
    expect(screen.getByTestId("pptx-connector-insert")).toBeDisabled();
  });

  it("keeps Group disabled while fewer than two groupable elements are selected", () => {
    const { onGroupSelection } = renderPanel({ selectedIds: ["s1", "tbl1"] });
    // Only one of the two selection entries is groupable, so Group stays disabled.
    expect(screen.getByTestId("pptx-group-selection")).toBeDisabled();
    expect(screen.getByTestId("pptx-group-hint")).toHaveTextContent("Select at least two elements");
    expect(onGroupSelection).not.toHaveBeenCalled();
  });

  it("emits the groupable selection", () => {
    const { onGroupSelection } = renderPanel({ selectedIds: ["s1", "p1"] });
    const group = screen.getByTestId("pptx-group-selection");
    expect(group).toBeEnabled();
    fireEvent.click(group);
    expect(onGroupSelection).toHaveBeenCalledWith(["s1", "p1"]);
  });
});

describe("PptxInsertPanel a11y", () => {
  it("labels the gallery cells so a keyboard user can hear the preset", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));
    const rect = screen.getByRole("button", { name: "Rectangle" });
    expect(rect).toHaveAttribute("title", "Rectangle");
    expect(rect).toHaveAttribute("data-pptx-shape-insert", "rect");
  });

  it("reports an asynchronous edit failure as an alert", async () => {
    const onEdit = vi.fn(() => Promise.reject(new Error("engine refused")));
    renderPanel({ onEdit });
    fireEvent.click(screen.getByRole("button", { name: "Text box" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("engine refused");
  });
});