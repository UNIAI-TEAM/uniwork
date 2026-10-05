import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import { box } from "./canvas/pptx-render-fixtures";
import { buildPptxPanel, readPptxPanelMotion, pptxContextualSelection, pptxPanelForContextualTab, pptxPanelForTab, pptxPanelSelection, pptxPanelPlacement, type PptxPanelEdit } from "./pptx-panel-host";

initI18n();
beforeEach(async () => { await setLocale("en"); });

/** The four WIRE-MOUNT panels route every committed edit through ONE generic
 *  channel: the host-supplied onApplyEdit, else the handle edit port, else the
 *  panel stays honestly disabled. */
describe("PptxPanelHost seam", () => {
  it("maps the review tab to the notes pane and the view tab to the sorter", () => {
    expect(pptxPanelForTab("review")).toBe("notes");
    expect(pptxPanelForTab("view")).toBe("sorter");
    expect(pptxPanelForTab("insert")).toBe("insert");
    expect(pptxPanelForTab("nope")).toBeNull();
  });

  it("routes the notes pane commit to the set_notes edit", async () => {
    const onApplyEdit = vi.fn(async (_edit: PptxPanelEdit) => undefined);
    render(buildPptxPanel({ panelKind: "notes", onApplyEdit, slideIndex: 1, slides: [], data: { notes: "old" } }));
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_notes", slideIndex: 1, text: "new" }));
  });

  it("routes the comments add and delete to the committed edit kinds", async () => {
    const onApplyEdit = vi.fn(async (_edit: PptxPanelEdit) => undefined);
    render(buildPptxPanel({
      panelKind: "comments",
      onApplyEdit,
      slideIndex: 0,
      slides: [],
      data: { comments: [{ authorId: 4, author: "An", initials: "AN", dt: "", idx: 2, text: "hi" }], defaultAuthor: "An" },
    }));
    fireEvent.click(screen.getByRole("button", { name: "Delete comment by An" }));
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledWith({ op: "delete_comment", slideIndex: 0, authorId: 4, idx: 2 }));
    const textbox = screen.getByRole("textbox", { name: "Write a comment" });
    fireEvent.change(textbox, { target: { value: "look" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledWith({ op: "add_comment", slideIndex: 0, text: "look", author: "An" }));
  });

  it("routes the header/footer apply to the committed edit", async () => {
    const onApplyEdit = vi.fn(async (_edit: PptxPanelEdit) => undefined);
    render(buildPptxPanel({ panelKind: "headerfooter", onApplyEdit, slideIndex: 0, slides: [{ id: "s1" }, { id: "s2" }] }));
    fireEvent.change(screen.getByLabelText("Footer text"), { target: { value: "Confidential" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to all" }));
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledWith({ op: "apply_header_footer", settings: { footer: "Confidential", slideNum: false, date: null } }));
  });

  it("falls back to the handle edit port and stays unbound without one", async () => {
    const edit = vi.fn(async (_edits: readonly PptxEdit[]) => ({ revision: 1 }));
    render(buildPptxPanel({ panelKind: "notes", edit, slideIndex: 0, slides: [], data: { notes: "old" } }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await waitFor(() => expect(edit).toHaveBeenCalledWith([{ op: "set_notes", slideIndex: 0, text: "x" }]));
  });

  it("keeps the notes readable but never writable without an edit channel (W10 review F2)", () => {
    render(buildPptxPanel({ panelKind: "notes", slideIndex: 0, slides: [], data: { notes: "old" } }));
    expect(screen.getByTestId("pptx-notes-pane")).toHaveAttribute("data-pptx-notes-mode", "ready");
    expect(screen.getByRole("textbox")).toHaveValue("old");
    expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Save notes" })).not.toBeInTheDocument();
  });

  it("leaves an unbound panel without a notes baseline honestly disabled", () => {
    render(buildPptxPanel({ panelKind: "notes", slideIndex: 0, slides: [], data: {} }));
    expect(screen.getByTestId("pptx-notes-pane")).toHaveAttribute("data-pptx-notes-mode", "unbound");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save notes" })).not.toBeInTheDocument();
  });
});

describe("pptxContextualSelection", () => {
  it("returns the flags for the selected node types, undefined for no match", () => {
    const boxes = [{ sourceId: "picture-1", type: "picture" as const, box: box() }];
    expect(pptxContextualSelection(boxes, [])).toBeUndefined();
    expect(pptxContextualSelection(boxes, ["missing"])).toBeUndefined();
    expect(pptxContextualSelection(boxes, ["picture-1"])).toEqual({ picture: true });
    const shapeBoxes = [{ sourceId: "shape-1", type: "shape" as const, box: box() }];
    expect(pptxContextualSelection(shapeBoxes, ["shape-1"])).toEqual({ shape: true });
    const tableBoxes = [{ sourceId: "table-1", type: "table" as const, box: box() }];
    expect(pptxContextualSelection(tableBoxes, ["table-1"])).toEqual({ table: true });
  });
});

describe("pptxPanelPlacement", () => {
  it("puts notes at the bottom and every other panel in the aside", () => {
    expect(pptxPanelPlacement("notes")).toBe("bottom");
    expect(pptxPanelPlacement("design")).toBe("aside");
    expect(pptxPanelPlacement("comments")).toBe("aside");
  });

  it("wraps the panel in the placement requested", () => {
    const { container, unmount } = render(buildPptxPanel({ panelKind: "notes", slideIndex: 0, slides: [], data: { notes: "n" }, placement: "bottom" }));
    expect(container.querySelector("section[data-pptx-panel-placement='bottom']")).not.toBeNull();
    expect(container.querySelector("aside")).toBeNull();
    unmount();
    const aside = render(buildPptxPanel({ panelKind: "notes", slideIndex: 0, slides: [], data: { notes: "n" } }));
    expect(aside.container.querySelector("aside[data-pptx-panel-placement='aside']")).not.toBeNull();
  });
});

describe("selection wiring", () => {
  const boxes = [
    { sourceId: "t1", type: "text" as const, box: box() },
    { sourceId: "pic1", type: "picture" as const, box: box() },
    { sourceId: "tbl1", type: "table" as const, box: box() },
    { sourceId: "ch1", type: "chart" as const, box: box() },
  ];

  it("derives the anchor and typed ids from the boxes", () => {
    expect(pptxPanelSelection(boxes, [])).toEqual({ elementId: null, elementType: null, ids: [], tableId: null, chartId: null, pictureId: null });
    expect(pptxPanelSelection(boxes, ["pic1", "t1"])).toMatchObject({ elementId: "pic1", elementType: "picture", pictureId: "pic1", tableId: null, chartId: null });
    expect(pptxPanelSelection(boxes, ["tbl1"])).toMatchObject({ elementType: "table", tableId: "tbl1", pictureId: null });
    expect(pptxPanelSelection(boxes, ["ch1"])).toMatchObject({ elementType: "chart", chartId: "ch1" });
    expect(pptxPanelSelection(boxes, ["t1"])).toMatchObject({ elementType: "text", tableId: null });
    expect(pptxPanelSelection(boxes, ["gone"])).toMatchObject({ elementId: "gone", elementType: null });
  });

  it("flags chart in the contextual selection", () => {
    expect(pptxContextualSelection(boxes, ["ch1"])).toEqual({ chart: true });
  });

  it("maps contextual tabs to panels", () => {
    expect(pptxPanelForContextualTab("context-shape")).toBe("format");
    expect(pptxPanelForContextualTab("context-picture")).toBe("format");
    expect(pptxPanelForContextualTab("context-table")).toBe("tables");
    expect(pptxPanelForContextualTab("context-chart")).toBe("charts");
    expect(pptxPanelForContextualTab("design")).toBeNull();
  });

  it("routes a text-format edit with the selected element", async () => {
    const onApplyEdit = vi.fn(async (_edit: PptxPanelEdit) => undefined);
    render(buildPptxPanel({ panelKind: "text-format", onApplyEdit, slideIndex: 2, slides: [], selection: pptxPanelSelection(boxes, ["t1"]) }));
    fireEvent.click(screen.getByTestId("pptx-text-toggle-bold"));
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_font", slideIndex: 2, elementId: "t1", font: { bold: true } }));
  });

  it("gives the tables panel its table and remounts on selection change", () => {
    const hint = "Select a table on the slide to edit it.";
    const build = (ids: string[]) => buildPptxPanel({ panelKind: "tables", onApplyEdit: async () => undefined, slideIndex: 0, slides: [{ id: "s1" }], selection: pptxPanelSelection(boxes, ids) });
    const view = render(build([]));
    expect(screen.getByText(hint)).toBeInTheDocument();
    view.rerender(build(["tbl1"]));
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    view.rerender(build([]));
    expect(screen.getByText(hint)).toBeInTheDocument();
  });

  it("remounts a selection panel when the same element id is selected on another slide (W5 review F14)", () => {
    const build = (slideIndex: number) => buildPptxPanel({ panelKind: "text-format", onApplyEdit: async () => undefined, slideIndex, slides: [{ id: "s1" }, { id: "s2" }], selection: pptxPanelSelection(boxes, ["t1"]) });
    const view = render(build(0));
    fireEvent.click(screen.getByTestId("pptx-text-toggle-bold"));
    expect(screen.getByTestId("pptx-text-toggle-bold")).toHaveAttribute("aria-pressed", "true");
    view.rerender(build(0));
    expect(screen.getByTestId("pptx-text-toggle-bold")).toHaveAttribute("aria-pressed", "true");
    view.rerender(build(1));
    expect(screen.getByTestId("pptx-text-toggle-bold")).toHaveAttribute("aria-pressed", "false");
  });

  it("lists comments read-only, with the reason, when no edit channel is bound (W5 review F3)", () => {
    render(buildPptxPanel({ panelKind: "comments", slideIndex: 0, slides: [], data: { comments: [{ authorId: 4, author: "An", initials: "AN", dt: "", idx: 2, text: "hi" }] } }));
    expect(screen.getByTestId("pptx-comments-panel")).toHaveAttribute("data-pptx-comments-mode", "ready");
    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(screen.getByTestId("pptx-comments-readonly")).toHaveTextContent("This presentation cannot be edited here");
    expect(screen.queryByRole("textbox", { name: "Write a comment" })).toBeNull();
  });
});

describe("panel read-back (X1)", () => {
  it("shows the slide's transition and advance time as read (R2-1)", () => {
    const view = render(buildPptxPanel({ panelKind: "transitions", onApplyEdit: async () => undefined, slideIndex: 0, slides: [{ id: "s1" }], data: { transition: { kind: "fade", advanceMs: 3000 } } }));
    expect(screen.getByTestId("pptx-transitions-current")).toHaveTextContent("Current transition: Fade");
    expect(screen.getByRole("textbox", { name: "Seconds" })).toHaveValue("3");
    // An undo reads back the previous state: the panel follows it.
    view.rerender(buildPptxPanel({ panelKind: "transitions", onApplyEdit: async () => undefined, slideIndex: 0, slides: [{ id: "s1" }], data: { transition: { kind: "none", advanceMs: null } } }));
    expect(screen.getByTestId("pptx-transitions-current")).toHaveTextContent("Current transition: None");
    expect(screen.queryByRole("textbox", { name: "Seconds" })).toBeNull();
  });

  it("applies a transition to every slide in one gesture when 'Apply to all' is on", async () => {
    const onApplyEdit = vi.fn(async (_edit: PptxPanelEdit) => undefined);
    const onApplyEdits = vi.fn(async (_edits: readonly PptxPanelEdit[]) => undefined);
    render(buildPptxPanel({ panelKind: "transitions", onApplyEdit, onApplyEdits, slideIndex: 1, slides: [{ id: "s1" }, { id: "s2" }, { id: "s3" }] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Apply to all slides" }));
    fireEvent.click(screen.getByRole("button", { name: "Fade" }));
    await waitFor(() => expect(onApplyEdits).toHaveBeenCalledWith([0, 1, 2].map((slideIndex) => ({ op: "set_transition", slideIndex, kind: "fade" }))));
    expect(onApplyEdit).not.toHaveBeenCalled();
  });

  it("lists the slide's animations as read (R2-2)", () => {
    render(buildPptxPanel({
      panelKind: "animations",
      onApplyEdit: async () => undefined,
      slideIndex: 0,
      slides: [{ id: "s1" }],
      data: { animations: [{ effect: "fade", trigger: "onClick", durationMs: 500, delayMs: 0 }, { effect: "zoom", trigger: "afterPrev", durationMs: 700, delayMs: 200 }] },
    }));
    expect(screen.queryByTestId("pptx-animation-empty")).toBeNull();
    const list = screen.getByRole("list", { name: "Animation order" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Fade, starts On click" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom, starts After previous" })).toBeInTheDocument();
  });

  it("reads the handle's live-slide ports, guarding absent and throwing ones", () => {
    const transition = { kind: "fade" as const, advanceMs: null };
    const handle = { slideTransition: vi.fn(() => transition), slideAnimations: vi.fn(() => { throw new Error("no_slide"); }) };
    expect(readPptxPanelMotion(handle, 2)).toEqual({ transition, animations: null });
    expect(handle.slideTransition).toHaveBeenCalledWith(2);
    expect(readPptxPanelMotion({ slideAnimations: () => null }, 0)).toEqual({ animations: null });
    expect(readPptxPanelMotion(null, 0)).toEqual({});
  });
});
