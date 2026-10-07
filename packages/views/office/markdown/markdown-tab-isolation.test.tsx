import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { MarkdownEditor } from "./editor";
import { OfficeDocumentActiveProvider } from "../common/document-active";
import type { MarkdownEditorHandle, MarkdownOpenOutcome } from "./types";
import type { TextCapability } from "../source-editor-types";

// UNI-957: the desktop keeps every open Markdown document mounted; only the
// active one may answer window/document level shortcuts.
initI18n();
beforeEach(async () => { await setLocale("en"); });

const CAPABILITY: TextCapability & { format: "md" } = { format: "md", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] };

function makeCoordinator() {
  const state = { state: "dirty" as const, dirtyGeneration: 1, lastSavedGeneration: 0, identity: { deploymentId: "dep", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseVersionId: "v", baseRevision: "1" }, activeIntentId: null, error: null };
  return { getState: () => state, subscribe: () => () => undefined, save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })), markDirty: vi.fn(), checkpoint: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) };
}

function tab(key: string, active: boolean) {
  let text = "# " + key;
  const handle: MarkdownEditorHandle = {
    format: "md",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 2,
    captureSnapshot: vi.fn(async () => ({ generation: 2, fingerprint: "fp", value: { text } })),
    undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), cancel: vi.fn(),
    source: { getText: () => text, setText: (next) => { text = next; } },
  };
  const outcome: MarkdownOpenOutcome = { outcome: "opened", document_id: key, document_model_ref: "model", warnings: [] };
  const coordinator = makeCoordinator();
  const element = (
    <OfficeDocumentActiveProvider active={active}>
      <div data-testid={`tab-${key}`}>
        <MarkdownEditor documentKey={key} editor={handle} open={{ open: vi.fn(async () => outcome) }} coordinator={coordinator} capability={CAPABILITY} />
      </div>
    </OfficeDocumentActiveProvider>
  );
  return { coordinator, element };
}

describe("Markdown tab isolation (UNI-957)", () => {
  it("Ctrl+F opens find only in the active document", async () => {
    const a = tab("a", true);
    const b = tab("b", false);
    const { getByTestId } = render(<>{a.element}{b.element}</>);
    await waitFor(() => expect(within(getByTestId("tab-a")).getByTestId("md-wysiwyg")).toBeInTheDocument());
    await waitFor(() => expect(within(getByTestId("tab-b")).getByTestId("md-wysiwyg")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    await waitFor(() => expect(within(getByTestId("tab-a")).getByTestId("find-replace-panel")).toBeInTheDocument());
    expect(within(getByTestId("tab-b")).queryByTestId("find-replace-panel")).toBeNull();
  });

  it("a window-level Ctrl+S saves only the active document", async () => {
    const a = tab("a", true);
    const b = tab("b", false);
    const { getByTestId } = render(<>{a.element}{b.element}</>);
    await waitFor(() => expect(within(getByTestId("tab-b")).getByTestId("md-wysiwyg")).toBeInTheDocument());
    fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });
    expect(a.coordinator.save).toHaveBeenCalledWith("shortcut");
    expect(b.coordinator.save).not.toHaveBeenCalled();
  });
});
