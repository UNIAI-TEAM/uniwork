// C3 (UNI-924): the Review ▸ Protect group against the real command runtime.
// The panel reads its state from the runtime and every action is recorded as a
// pending edit the save snapshot carries — a read-only host blocks the actions
// instead of faking them.
import { Editor } from "@tiptap/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocxCommandRuntime } from "../commands";
import { docxExtensions } from "../docx-schema";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { ReviewProtectGroup } from "./review-protect";

const editors: Editor[] = [];

const RESTRICTION = { edit: "readOnly", enforced: true, hash: "aGFzaA==", salt: "c2FsdA==", spinCount: 1000, algorithmSid: 14 };

function context(overrides: Partial<DocxToolbarGroupContext> = {}): DocxToolbarGroupContext {
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
    format: null,
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

function renderGroup(options: { readOnly?: boolean; parsed?: unknown; withCommands?: boolean } = {}) {
  const editor = new Editor({ extensions: docxExtensions(), content: { type: "doc", content: [{ type: "docParagraph", attrs: { docxIndex: 0 }, content: [{ type: "text", text: "body" }] }] } });
  editors.push(editor);
  const runtime = createDocxCommandRuntime(() => editor);
  runtime.seedDocxProtection(options.parsed ?? {});
  const format = runtime.getState() as DocxToolbarGroupContext["format"];
  const commands = options.withCommands === false ? undefined : runtime;
  render(<ReviewProtectGroup {...context({ commands, format, readOnly: options.readOnly ?? false })} />);
  return { editor, runtime };
}

async function openPanel(): Promise<void> {
  fireEvent.click(screen.getByTestId("docx-protect-open"));
  await screen.findByTestId("docx-protect-panel");
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

describe("ReviewProtectGroup", () => {
  it("opens the panel and shows the document's protection state", async () => {
    const { runtime } = renderGroup({ parsed: { protection: RESTRICTION, writeProtection: { recommended: true } } });
    expect(screen.getByTestId("docx-protect-open")).toBeEnabled();
    await openPanel();
    expect(screen.getByTestId("docx-protect-restriction-state")).toHaveTextContent("Chỉ đọc");
    expect(screen.getByTestId("docx-protect-restriction-state")).toHaveTextContent("mật khẩu");
    expect(screen.getByTestId("docx-protect-modify-state")).toHaveTextContent("chỉ đọc");
    expect(runtime.getState().docxProtection?.pending).toBe(false);
  });

  it("shows an empty state when the document carries nothing", async () => {
    renderGroup();
    await openPanel();
    expect(screen.getByTestId("docx-protect-restriction-state")).toHaveTextContent("không có giới hạn");
    expect(screen.getByTestId("docx-protect-modify-state")).toHaveTextContent("Không đặt mật khẩu");
    expect(screen.getByTestId("docx-protect-restriction-remove")).toBeDisabled();
    expect(screen.getByTestId("docx-protect-modify-remove")).toBeDisabled();
  });

  it("records an applied restriction as a pending save edit", async () => {
    const { runtime } = renderGroup();
    await openPanel();
    fireEvent.click(screen.getByTestId("docx-protect-restriction-apply"));
    const pending = runtime.snapshotDocxProtection();
    expect(pending).toEqual({ protection: { edit: "readOnly", enforced: true } });
    expect(runtime.getState().docxProtection).toMatchObject({
      protection: { edit: "readOnly", enforced: true },
      pending: true,
    });
  });

  it("records the removal of an existing restriction", async () => {
    const { runtime } = renderGroup({ parsed: { protection: RESTRICTION } });
    await openPanel();
    fireEvent.click(screen.getByTestId("docx-protect-restriction-remove"));
    expect(runtime.snapshotDocxProtection()).toEqual({ protection: null });
  });

  it("sets a recommended read-only without a password", async () => {
    const { runtime } = renderGroup();
    await openPanel();
    expect(screen.getByTestId("docx-protect-modify-apply")).toBeDisabled();
    fireEvent.click(screen.getByTestId("docx-protect-modify-recommended"));
    fireEvent.click(screen.getByTestId("docx-protect-modify-apply"));
    expect(runtime.snapshotDocxProtection()).toEqual({ writeProtection: { recommended: true } });
  });

  it("blocks every action on a read-only host with a visible reason", async () => {
    const { runtime } = renderGroup({ readOnly: true });
    await openPanel();
    expect(screen.getByTestId("docx-protect-gate")).toHaveTextContent("chỉ đọc");
    expect(screen.getByTestId("docx-protect-restriction-apply")).toBeDisabled();
    expect(screen.getByTestId("docx-protect-restriction-remove")).toBeDisabled();
    expect(screen.getByTestId("docx-protect-restriction-password")).toBeDisabled();
    fireEvent.click(screen.getByTestId("docx-protect-restriction-apply"));
    expect(runtime.snapshotDocxProtection()).toBeUndefined();
  });

  it("disables the trigger until a document is open", () => {
    renderGroup({ withCommands: false });
    expect(screen.getByTestId("docx-protect-open")).toBeDisabled();
    expect(screen.getByTestId("docx-protect-open")).toHaveAttribute("title", "Cần mở tài liệu để dùng tùy chọn bảo vệ.");
  });
});
