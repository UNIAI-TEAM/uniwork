import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HtmlEditor } from "./editor";
import { OfficeDocumentActiveProvider } from "../common/document-active";
import type { HtmlEditorHandle, HtmlOpenOutcome } from "./types";

// UNI-957: the desktop keeps every open HTML document mounted; only the active
// one may answer window/document level shortcuts.
initI18n();
beforeEach(async () => { await setLocale("en"); });

function tab(key: string, active: boolean) {
  let source = "<!doctype html><p>" + key + "</p>";
  const state = { state: "dirty" as const, dirtyGeneration: 1, lastSavedGeneration: 0, identity: { deploymentId: "dep", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseVersionId: "v", baseRevision: "1" }, activeIntentId: null, error: null };
  const coordinator = { getState: () => state, subscribe: () => () => undefined, save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })), markDirty: vi.fn(), checkpoint: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) };
  const editor: HtmlEditorHandle = {
    format: "html",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 1,
    captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { source } })),
    undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), cancel: vi.fn(),
    source: { getText: () => source, setText: (next) => { source = next; } },
    getAssetManifest: () => ({ entries: [] }),
  };
  const outcome: HtmlOpenOutcome = { outcome: "opened", document_id: key, document_model_ref: "model", warnings: [] };
  return (
    <OfficeDocumentActiveProvider active={active}>
      <div data-testid={`tab-${key}`}>
        <HtmlEditor documentKey={key} editor={editor} open={{ open: vi.fn(async () => outcome) }} coordinator={coordinator} capability={{ format: "html", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} />
      </div>
    </OfficeDocumentActiveProvider>
  );
}

async function mount() {
  const view = render(<>{tab("a", true)}{tab("b", false)}</>);
  await waitFor(() => expect(within(view.getByTestId("tab-a")).getByTestId("html-shell")).toBeInTheDocument());
  await waitFor(() => expect(within(view.getByTestId("tab-b")).getByTestId("html-shell")).toBeInTheDocument());
  return view;
}

describe("HTML tab isolation (UNI-957)", () => {
  it("Ctrl+F opens find only in the active document", async () => {
    const { getByTestId } = await mount();
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    await waitFor(() => expect(within(getByTestId("tab-a")).getByTestId("html-find")).toBeInTheDocument());
    expect(within(getByTestId("tab-b")).queryByTestId("html-find")).toBeNull();
  });

  it("a window-level Ctrl+Backslash cycles only the active document's view", async () => {
    const { getByTestId } = await mount();
    const mode = (key: string) => within(getByTestId(`tab-${key}`)).getByTestId("html-shell").getAttribute("data-html-view");
    const before = mode("a");
    fireEvent.keyDown(document.body, { key: "\\", code: "Backslash", ctrlKey: true });
    await waitFor(() => expect(mode("a")).not.toBe(before));
    expect(mode("b")).toBe(before);
  });
});
