import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createPptxCommandMap, type PptxCommand, type PptxCommandId } from "./command-map";
import { PPTX_MASTER_VIEW_REASON } from "./pptx-ribbon-master-gate";
import { usePptxMasterViewGate } from "./use-pptx-master-view-gate";

/**
 * UNI-939 find_gate (review-final F1/F3): the command-level allowlist of the master
 * view, and the surfaces (Find/Replace, slide sorter) that act on the hidden deck
 * closing when the view opens.
 */
const available: readonly PptxCommand[] = createPptxCommandMap({ host: null, includePresentation: true }).map((command) => ({ ...command, capability: { status: "available" as const } }));

const LIVE: readonly PptxCommandId[] = ["slideMaster", "undo", "redo", "save", "open", "export-pdf", "print", "render-fidelity", "fullscreen", "presenter"];

function setup(initial: { open: boolean; findOpen?: boolean; sorterOpen?: boolean }) {
  const clearSelection = vi.fn();
  const closeFind = vi.fn();
  const closeSorter = vi.fn();
  const view = renderHook((props: { open: boolean; findOpen: boolean; sorterOpen: boolean }) => usePptxMasterViewGate({
    open: props.open,
    commands: available,
    clearSelection,
    find: { open: props.findOpen, close: closeFind },
    sorter: { open: props.sorterOpen, close: closeSorter },
  }), { initialProps: { open: initial.open, findOpen: initial.findOpen ?? false, sorterOpen: initial.sorterOpen ?? false } });
  return { view, clearSelection, closeFind, closeSorter };
}

describe("usePptxMasterViewGate", () => {
  it("returns the commands untouched while the master view is closed", () => {
    const { view } = setup({ open: false });
    expect(view.result.current).toBe(available);
  });

  it("keeps only the allowlisted commands available in master view, Find included in the locked ones", () => {
    const { view } = setup({ open: true });
    const byId = new Map(view.result.current.map((command) => [command.id, command]));
    for (const id of LIVE) {
      const command = byId.get(id);
      if (command) expect(command.capability.status, id).toBe("available");
    }
    const find = byId.get("find");
    expect(find?.capability).toEqual({ status: "unavailable", reason: PPTX_MASTER_VIEW_REASON });
    for (const command of view.result.current) {
      if (LIVE.includes(command.id)) continue;
      expect(command.capability.status, command.id).toBe("unavailable");
    }
  });

  it("closes an open Find/Replace panel and the sorter when the view opens, and drops the slide selection", () => {
    const { view, closeFind, closeSorter, clearSelection } = setup({ open: false, findOpen: true, sorterOpen: true });
    expect(closeFind).not.toHaveBeenCalled();
    expect(closeSorter).not.toHaveBeenCalled();
    view.rerender({ open: true, findOpen: true, sorterOpen: true });
    expect(closeFind).toHaveBeenCalledTimes(1);
    expect(closeSorter).toHaveBeenCalledTimes(1);
    expect(clearSelection).toHaveBeenCalledTimes(1);
  });

  it("closes the sorter again when it is reopened (status bar) while the view stays open", () => {
    const { view, closeSorter } = setup({ open: true });
    expect(closeSorter).not.toHaveBeenCalled();
    view.rerender({ open: true, findOpen: false, sorterOpen: true });
    expect(closeSorter).toHaveBeenCalledTimes(1);
  });

  it("leaves both surfaces alone while the view is closed", () => {
    const { view, closeFind, closeSorter } = setup({ open: false });
    view.rerender({ open: false, findOpen: true, sorterOpen: true });
    expect(closeFind).not.toHaveBeenCalled();
    expect(closeSorter).not.toHaveBeenCalled();
  });
});
