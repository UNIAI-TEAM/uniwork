import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import { box } from "./canvas/pptx-render-fixtures";
import { buildPptxPanel, pptxContextualSelection, pptxPanelForTab, pptxPanelPlacement, type PptxPanelEdit } from "./pptx-panel-host";

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

  it("leaves an unbound panel honestly disabled", () => {
    render(buildPptxPanel({ panelKind: "notes", slideIndex: 0, slides: [], data: { notes: "old" } }));
    expect(screen.getByTestId("pptx-notes-pane")).toHaveAttribute("data-pptx-notes-mode", "unbound");
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
