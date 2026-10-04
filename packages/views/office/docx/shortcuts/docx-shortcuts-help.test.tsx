import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureShortcutPlatform } from "@uniwork/core/shortcuts";
import { createDocxCommandRuntime } from "../commands";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { DocxShortcutsHelp } from "./docx-shortcuts-help";

// The sheet spells chords for the resolved platform; pin it so the assertions
// do not change with the machine running the suite.
beforeEach(() => configureShortcutPlatform("windows"));
afterEach(() => configureShortcutPlatform(null));

function context(overrides: Partial<DocxToolbarGroupContext> = {}): DocxToolbarGroupContext {
  const runtime = createDocxCommandRuntime(() => null);
  const coordinatorState = {
    state: "dirty" as const,
    identity: {
      deploymentId: "dep",
      accountId: "account",
      organizationId: "org",
      workspaceId: "workspace",
      documentId: "doc",
      generation: 1,
      baseVersionId: "version",
      baseRevision: "1",
    },
    dirtyGeneration: 1,
    lastSavedGeneration: 0,
    activeIntentId: null,
    error: null,
  };
  return {
    editor: {
      format: "docx",
      open: vi.fn(async () => undefined),
      getDirtyGeneration: () => 0,
      captureSnapshot: vi.fn(async () => ({ generation: 0, fingerprint: "fp", value: {} })),
      dispose: vi.fn(),
    },
    coordinator: {
      getState: () => coordinatorState,
      subscribe: () => () => undefined,
      save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
    },
    format: runtime.getState(),
    commands: runtime,
    selection: null,
    readOnly: false,
    saving: false,
    dirty: false,
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

function openDialog(overrides: Partial<DocxToolbarGroupContext> = {}) {
  render(<DocxShortcutsHelp {...context(overrides)} />);
  fireEvent.click(screen.getByTestId("docx-shortcuts-help-trigger"));
  return screen.findByTestId("docx-shortcuts-dialog");
}

describe("DocxShortcutsHelp", () => {
  it("opens from the question-mark trigger and lists the grouped shortcuts", async () => {
    render(<DocxShortcutsHelp {...context()} />);
    const trigger = screen.getByTestId("docx-shortcuts-help-trigger");
    expect(trigger).toHaveAccessibleName("Phím tắt");

    fireEvent.click(trigger);
    const dialog = await screen.findByTestId("docx-shortcuts-dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId("docx-shortcut-save")).toHaveTextContent("Lưu lên UniWork");
    expect(screen.getByTestId("docx-shortcut-bold")).toHaveTextContent("Đậm");
    expect(screen.getByRole("heading", { name: "Tài liệu" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Định dạng ký tự" })).toBeInTheDocument();
  });

  it("spells the chord for the current platform and separates alternates", async () => {
    await openDialog();
    // jsdom reports an unknown platform, which the keycaps render as Ctrl.
    expect(screen.getByTestId("docx-shortcut-save")).toHaveTextContent("Ctrl");
    expect(screen.getByTestId("docx-shortcut-save").querySelectorAll("kbd").length).toBeGreaterThan(0);
    // Redo carries two chords outside macOS; the sheet joins them with "hoặc".
    expect(screen.getByTestId("docx-shortcut-redo")).toHaveTextContent("hoặc");
  });

  it("opens on Mod+/ and closes on Escape", async () => {
    render(<DocxShortcutsHelp {...context()} />);
    fireEvent.keyDown(document, { key: "/", ctrlKey: true });
    const dialog = await screen.findByTestId("docx-shortcuts-dialog");

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("docx-shortcuts-dialog")).not.toBeInTheDocument());
  });

  it("filters by name and shows an empty state", async () => {
    await openDialog();
    const search = screen.getByTestId("docx-shortcuts-search");

    fireEvent.change(search, { target: { value: "đậm" } });
    expect(screen.getByTestId("docx-shortcut-bold")).toBeInTheDocument();
    expect(screen.queryByTestId("docx-shortcut-save")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByTestId("docx-shortcuts-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("docx-shortcut-bold")).not.toBeInTheDocument();
  });

  it("marks write commands unavailable in a read-only document", async () => {
    await openDialog({ readOnly: true });
    expect(screen.getByTestId("docx-shortcuts-readonly-note")).toBeInTheDocument();
    expect(screen.getByTestId("docx-shortcut-bold")).toHaveTextContent("Chỉ đọc");
    expect(screen.getByTestId("docx-shortcut-save")).not.toHaveTextContent("Chỉ đọc");
  });

  it("clears the search when the dialog closes", async () => {
    await openDialog();
    const search = screen.getByTestId("docx-shortcuts-search");
    fireEvent.change(search, { target: { value: "đậm" } });
    fireEvent.keyDown(screen.getByTestId("docx-shortcuts-dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("docx-shortcuts-dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId("docx-shortcuts-help-trigger"));
    expect(await screen.findByTestId("docx-shortcuts-search")).toHaveValue("");
  });
});
