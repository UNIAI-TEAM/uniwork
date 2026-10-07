import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { SourceEditor } from "./source-editor";
import type { TextCapability, TextEditorHandle, TextOpenOutcome, TextSaveCoordinator } from "./source-editor-types";

// review-fe-r1 R17: the shared source editor (not mounted by a host today) keeps
// the empty-stack rule: Undo/Redo aria-disabled and blocked in JS, and a step
// marks dirty and checkpoints only when the generation moved (UNI-954).

const { t } = initI18n();
const capability = { format: "md", operation: "serialize", host: "browser", engineBuild: "t", contractRevision: "t", status: "available", fidelityWarnings: [] } as TextCapability;
const opened = { outcome: "opened", document_id: "doc", document_model_ref: "m1", warnings: [] } as unknown as TextOpenOutcome;

function coordinator(): TextSaveCoordinator & { markDirty: Mock<(generation: number) => void>; checkpoint: Mock<() => Promise<void>> } {
  const state = { state: "ready" as const, identity: {} as never, dirtyGeneration: 0, lastSavedGeneration: 0, activeIntentId: null, error: null };
  return { getState: () => state, subscribe: () => () => undefined, save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })), markDirty: vi.fn<(generation: number) => void>(), checkpoint: vi.fn<() => Promise<void>>(async () => undefined) };
}

/** A text handle with a real snapshot stack; `moves: false` steps without changing anything. */
function handle(options: { depth: number; withCan?: boolean; moves?: boolean }) {
  let text = "# Tiêu đề";
  let generation = 0;
  let undoDepth = options.depth;
  let redoDepth = 0;
  const moves = options.moves ?? true;
  const editor: TextEditorHandle = {
    format: "md",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => generation,
    captureSnapshot: vi.fn(async () => ({ generation, fingerprint: `fp-${generation}`, value: text })),
    dispose: vi.fn(),
    source: { getText: () => text, setText: (next: string) => { text = next; generation += 1; } },
    undo: vi.fn(() => { if (!moves || undoDepth === 0) return; undoDepth -= 1; redoDepth += 1; text = "# Cũ"; generation += 1; }),
    redo: vi.fn(() => { if (!moves || redoDepth === 0) return; redoDepth -= 1; undoDepth += 1; text = "# Tiêu đề"; generation += 1; }),
    ...(options.withCan === false ? {} : { canUndo: () => undoDepth > 0, canRedo: () => redoDepth > 0 }),
  };
  return editor;
}

async function mount(editor: TextEditorHandle) {
  const saveCoordinator = coordinator();
  render(<SourceEditor format="md" documentKey="doc" editor={editor} open={{ open: vi.fn(async () => opened) }} coordinator={saveCoordinator} capability={capability} title="Ghi chú.md" />);
  const undo = await screen.findByRole("button", { name: t("office.markdown.actions.undo") });
  const redo = screen.getByRole("button", { name: t("office.markdown.actions.redo") });
  await waitFor(() => expect(undo).toBeInTheDocument());
  return { undo, redo, saveCoordinator };
}

describe("SourceEditor history (UNI-954, review-fe-r1 R17)", () => {
  it("keeps Undo/Redo aria-disabled on an empty stack and blocks them in JS, keyboard included", async () => {
    const editor = handle({ depth: 0 });
    const { undo, redo, saveCoordinator } = await mount(editor);
    expect(undo).toHaveAttribute("aria-disabled", "true");
    expect(redo).toHaveAttribute("aria-disabled", "true");
    // Still in the tab order: aria-disabled, not disabled.
    expect(undo).not.toBeDisabled();
    fireEvent.click(undo);
    fireEvent.click(redo);
    expect(editor.undo).not.toHaveBeenCalled();
    expect(editor.redo).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "z", ctrlKey: true });
    expect(saveCoordinator.markDirty).not.toHaveBeenCalled();
    expect(saveCoordinator.checkpoint).not.toHaveBeenCalled();
  });

  it("steps a real stack, marks dirty with the new generation and checkpoints, then flips the disabled states", async () => {
    const editor = handle({ depth: 1 });
    const { undo, redo, saveCoordinator } = await mount(editor);
    expect(undo).not.toHaveAttribute("aria-disabled");
    fireEvent.click(undo);
    expect(editor.undo).toHaveBeenCalledTimes(1);
    expect(saveCoordinator.markDirty).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole("textbox")).toHaveValue("# Cũ");
    await waitFor(() => expect(undo).toHaveAttribute("aria-disabled", "true"));
    expect(redo).not.toHaveAttribute("aria-disabled");
    fireEvent.click(redo);
    expect(editor.redo).toHaveBeenCalledTimes(1);
    expect(saveCoordinator.markDirty).toHaveBeenLastCalledWith(2);
  });

  it("does not mark dirty when a handle without canUndo steps nothing", async () => {
    const editor = handle({ depth: 0, withCan: false, moves: false });
    const { undo, saveCoordinator } = await mount(editor);
    // No depth facet: the control is offered, and the generation check guards the step.
    expect(undo).not.toHaveAttribute("aria-disabled");
    fireEvent.click(undo);
    expect(editor.undo).toHaveBeenCalledTimes(1);
    expect(saveCoordinator.markDirty).not.toHaveBeenCalled();
    expect(saveCoordinator.checkpoint).not.toHaveBeenCalled();
  });
});
