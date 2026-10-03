import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useImperativeHandle, useRef } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XlsxEditor } from "./xlsx-editor";
import { createXlsxModelHost } from "./xlsx-render-model-bridge";
import type { XlsxGridSurfaceProps } from "./xlsx-grid-surface";
import type { XlsxEditorHandle, XlsxEditorProps, XlsxSaveCoordinator, XlsxWorkbookSnapshot } from "./types";

const grid = vi.hoisted(() => ({
  props: null as XlsxGridSurfaceProps | null,
  commitEdit: vi.fn(async (): Promise<void> => undefined),
  ready: true,
}));

// The real Univer input is an imperative sibling of its nested React tree.
// A React child with a bubbling stopPropagation handler does not reproduce it.
vi.mock("./xlsx-grid-surface", () => ({
  XlsxGridSurface: function NativeSurface(props: XlsxGridSurfaceProps) {
    grid.props = props;
    const container = useRef<HTMLDivElement>(null);
    const onReady = useRef(props.onReady);
    onReady.current = props.onReady;
    useImperativeHandle(props.ref, () => ({ commitEdit: grid.commitEdit }) as never);
    useEffect(() => {
      const host = container.current!;
      const root = createRoot(host);
      function NativeTree() {
        useEffect(() => {
          const input = document.createElement("div");
          input.contentEditable = "true";
          input.dataset.testid = "native-input";
          host.appendChild(input);
          if (grid.ready) onReady.current?.();
          return () => { input.remove(); };
        }, []);
        return <span />;
      }
      root.render(<NativeTree />);
      return () => { queueMicrotask(() => root.unmount()); };
    }, []);
    return <div ref={container} className="xlsx-surface" />;
  },
}));

function setup(overrides: Partial<XlsxEditorProps> = {}) {
  const snapshot: XlsxWorkbookSnapshot = { revision: 1, sheets: [{ id: "sh1", name: "Data", cells: { A1: { value: 2 } } }] };
  let generation = 0;
  const editor: XlsxEditorHandle = {
    format: "xlsx", open: async () => undefined, dispose: vi.fn(),
    getDirtyGeneration: () => generation,
    getWorkbookSnapshot: () => snapshot,
    captureSnapshot: async () => ({ generation, fingerprint: "fp", value: snapshot }),
    edit: vi.fn(async () => { generation += 1; }),
  };
  const coordinator: XlsxSaveCoordinator = {
    getState: () => ({ state: "dirty", identity: {} as never, dirtyGeneration: 1, lastSavedGeneration: 0, activeIntentId: null, error: null }),
    subscribe: () => () => undefined,
    markDirty: vi.fn(),
    save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
  };
  const rendererHost = createXlsxModelHost({
    revision: 1, activeTab: 0, date1904: false, styles: [], dxfStyles: [],
    sheets: [{ id: "sh1", name: "Data", rowCount: 50, columnCount: 10, merges: [], columnWidths: [], rowsMeta: [], hyperlinks: [], cells: { A1: { v: 2 } } }],
  }, { sessionId: "model", name: "test.xlsx", sha256: "a".repeat(64) });
  const props: XlsxEditorProps = {
    documentKey: "doc", editor, coordinator, rendererHost,
    open: { open: async () => ({ outcome: "opened", document_id: "doc", document_model_ref: "model", snapshot }) },
    ...overrides,
  };
  const view = render(<XlsxEditor {...props} />);
  return { props, editor, coordinator, view };
}

function keydown(target: Element, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true, composed: true, ...options });
  fireEvent(target, event);
  return event;
}

beforeEach(() => { grid.commitEdit.mockReset().mockResolvedValue(undefined); grid.ready = true; });

describe("XLSX native input Save ownership", () => {
  it.each([{ ctrlKey: true }, { ctrlKey: false, metaKey: true }])("prepares and saves a native Ctrl/Cmd+S event once (%j)", async (modifiers) => {
    const { coordinator } = setup();
    const input = await screen.findByTestId("native-input");
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    const bubble = vi.fn();
    window.addEventListener("keydown", bubble);
    try {
      const event = keydown(input, modifiers);
      await waitFor(() => expect(coordinator.save).toHaveBeenCalledExactlyOnceWith("shortcut"));
      expect(event.defaultPrevented).toBe(true);
      expect(bubble).not.toHaveBeenCalled();
      expect(grid.commitEdit).toHaveBeenCalledOnce();
      expect(grid.commitEdit.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(coordinator.save).mock.invocationCallOrder[0]!);
    } finally { window.removeEventListener("keydown", bubble); }
  });

  it("awaits the real commit promise and the ordered model queue before Save", async () => {
    const { editor, coordinator } = setup();
    const input = await screen.findByTestId("native-input");
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    let commit!: () => void;
    let edit!: () => void;
    grid.commitEdit.mockImplementationOnce(() => new Promise<void>((resolve) => { commit = () => {
      grid.props?.onEdits?.([{ sheetId: "sh1", row: 0, column: 0, writeValue: true, value: 42 }]);
      resolve();
    }; }));
    vi.mocked(editor.edit!).mockImplementationOnce(() => new Promise((resolve) => { edit = resolve; }));
    keydown(input);
    expect(coordinator.save).not.toHaveBeenCalled();
    await act(async () => { commit(); });
    expect(editor.edit).toHaveBeenCalledOnce();
    expect(coordinator.save).not.toHaveBeenCalled();
    await act(async () => { edit(); });
    await waitFor(() => expect(coordinator.save).toHaveBeenCalledExactlyOnceWith("shortcut"));
  });

  it("keeps a rejected inline commit from reaching Save", async () => {
    const { coordinator } = setup();
    const input = await screen.findByTestId("native-input");
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    grid.commitEdit.mockRejectedValueOnce(new Error("commit denied"));
    keydown(input);
    await screen.findByTestId("xlsx-recalc-error");
    expect(coordinator.save).not.toHaveBeenCalled();
  });

  it("routes the shortcut through the registered coordinator preparation once", async () => {
    let prepare: (() => Promise<void>) | undefined;
    const save = vi.fn(async () => { await prepare?.(); return { accepted: false as const, reason: "clean" as const }; });
    setup({ coordinator: { getState: () => ({ state: "dirty" } as never), subscribe: () => () => undefined, save },
      registerSavePreparation: (callback) => { prepare = callback; return () => { prepare = undefined; }; } });
    const input = await screen.findByTestId("native-input");
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    keydown(input);
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith("shortcut"));
    expect(grid.commitEdit).toHaveBeenCalledOnce();
  });

  it("leaves composition, other keys and targets outside this document alone", async () => {
    const { coordinator } = setup();
    const input = await screen.findByTestId("native-input");
    expect(keydown(input, { isComposing: true }).defaultPrevented).toBe(false);
    expect(keydown(input, { key: "z" }).defaultPrevented).toBe(false);
    expect(keydown(document.body).defaultPrevented).toBe(false);
    expect(coordinator.save).not.toHaveBeenCalled();
    expect(grid.commitEdit).not.toHaveBeenCalled();
  });

  it.each(["readonly", "loading", "capability readonly"])("refuses preparation and Save while %s", async (guard) => {
    grid.ready = guard !== "loading";
    const { coordinator } = setup(guard === "readonly" ? { permissions: { canEdit: false } } : guard === "capability readonly" ? {
      capability: { format: "xlsx", operation: "edit", host: "web", engineBuild: "test", contractRevision: "1", status: "readonly", fidelityWarnings: [] },
    } : {});
    const input = await screen.findByTestId("native-input");
    keydown(input);
    expect(coordinator.save).not.toHaveBeenCalled();
    expect(grid.commitEdit).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "unknown"] as const)("defaults to denial for %s capability", async (status) => {
    const { coordinator } = setup({ capability: {
      format: "xlsx", operation: "edit", host: "web", engineBuild: "test", contractRevision: "1", status, fidelityWarnings: [],
    } });
    await screen.findByTestId("xlsx-error-state");
    keydown(screen.getByTestId("xlsx-editor"));
    expect(screen.queryByTestId("native-input")).not.toBeInTheDocument();
    expect(coordinator.save).not.toHaveBeenCalled();
    expect(grid.commitEdit).not.toHaveBeenCalled();
  });

  it("unbinds detached targets and routes a replacement document to its current coordinator", async () => {
    const { props, coordinator, view } = setup();
    const oldInput = await screen.findByTestId("native-input");
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    const oldRoot = screen.getByTestId("xlsx-editor");
    const next = { ...coordinator, save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })) };
    view.rerender(<XlsxEditor {...props} documentKey="next" editor={{ ...props.editor, dispose: vi.fn() }} coordinator={next} />);
    await waitFor(() => expect(screen.getByTestId("xlsx-editor")).toHaveAttribute("aria-busy", "false"));
    const input = await screen.findByTestId("native-input");
    keydown(input);
    await waitFor(() => expect(next.save).toHaveBeenCalledExactlyOnceWith("shortcut"));
    expect(coordinator.save).not.toHaveBeenCalled();
    view.unmount();
    expect(keydown(oldRoot).defaultPrevented).toBe(false);
    expect(keydown(oldInput).defaultPrevented).toBe(false);
    expect(next.save).toHaveBeenCalledOnce();
  });
});
