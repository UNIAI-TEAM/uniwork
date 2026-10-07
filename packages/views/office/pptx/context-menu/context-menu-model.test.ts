import { describe, expect, it } from "vitest";
import { buildPptxContextMenu, enabledPptxContextMenuActions, type PptxContextMenuContext } from "./context-menu-model";

const ready: Partial<PptxContextMenuContext> = {
  slideBound: true,
  selectionCount: 1,
  canDelete: true,
  canEditText: true,
  canInsert: true,
  canReorder: true,
};

function rows(input: Partial<PptxContextMenuContext> = {}) {
  return buildPptxContextMenu({ ...ready, ...input });
}

function byAction(input: Partial<PptxContextMenuContext>, action: string) {
  return rows(input).find((entry) => entry.action === action);
}

describe("buildPptxContextMenu", () => {
  it("lists the canvas rows in render order with separators between groups", () => {
    expect(rows().map((entry) => entry.action)).toEqual([
      "cut",
      "copy",
      "paste",
      "delete",
      "bring-to-front",
      "send-to-back",
      "edit-text",
      "insert",
    ]);
    expect(rows().filter((entry) => entry.separatorBefore).map((entry) => entry.action)).toEqual([
      "delete",
      "bring-to-front",
      "edit-text",
      "insert",
    ]);
  });

  it("enables the real element commands when the channels and a selection exist", () => {
    const actions = enabledPptxContextMenuActions(rows());
    expect(actions).toEqual(["delete", "bring-to-front", "send-to-back", "edit-text", "insert"]);
  });

  it("keeps the clipboard rows disabled with the engine's own reason", () => {
    for (const action of ["cut", "copy", "paste"] as const) {
      const entry = byAction({}, action);
      expect(entry?.enabled).toBe(false);
      expect(entry?.reasonKey).toBe("reason_clipboard_unbound");
    }
  });

  it("disables element rows with reason_no_selection when nothing is selected", () => {
    for (const action of ["delete", "bring-to-front", "send-to-back", "edit-text"]) {
      const entry = byAction({ selectionCount: 0 }, action);
      expect(entry?.enabled).toBe(false);
      expect(entry?.reasonKey).toBe("reason_no_selection");
    }
    // Insert does not need a selection; only a slide.
    expect(byAction({ selectionCount: 0 }, "insert")?.enabled).toBe(true);
  });

  it("names the unbound channel when the operation is not wired", () => {
    expect(byAction({ canDelete: false }, "delete")?.reasonKey).toBe("reason_delete_unbound");
    expect(byAction({ canReorder: false }, "bring-to-front")?.reasonKey).toBe("reason_reorder_unbound");
    expect(byAction({ canEditText: false }, "edit-text")?.reasonKey).toBe("reason_edit_text_unbound");
    expect(byAction({ canInsert: false }, "insert")?.reasonKey).toBe("reason_insert_unbound");
  });

  it("blocks every mutating row on a read-only deck or a pending gesture", () => {
    const readonlyRows = rows({ readonly: true });
    expect(readonlyRows.filter((entry) => entry.enabled)).toEqual([]);
    expect(byAction({ readonly: true }, "delete")?.reasonKey).toBe("reason_readonly");
    expect(byAction({ gesturePending: true }, "delete")?.reasonKey).toBe("reason_pending");
    expect(byAction({ gesturePending: true }, "insert")?.reasonKey).toBe("reason_pending");
  });

  it("blocks on no slide bound", () => {
    expect(byAction({ slideBound: false }, "delete")?.reasonKey).toBe("reason_no_slide");
    expect(byAction({ slideBound: false }, "insert")?.reasonKey).toBe("reason_no_slide");
  });

  it("disables every slide edit while the master view owns the canvas", () => {
    const open = rows({ masterView: true });
    for (const action of ["delete", "bring-to-front", "send-to-back", "edit-text", "insert"]) {
      const entry = open.find((candidate) => candidate.action === action);
      expect(entry?.enabled, action).toBe(false);
      expect(entry?.reasonKey, action).toBe("reason_master_view");
    }
    expect(enabledPptxContextMenuActions(open)).toEqual([]);
  });

  it("never renders an enabled row without a reason for the disabled ones", () => {
    for (const entry of rows({ selectionCount: 0, canDelete: false, canReorder: false, canEditText: false, canInsert: false })) {
      if (!entry.enabled) expect(entry.reasonKey).toBeTruthy();
    }
  });
});