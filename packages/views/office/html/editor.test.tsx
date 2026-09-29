import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HtmlEditor } from "./editor";
import type { HtmlEditorHandle, HtmlOpenOutcome } from "./types";
import type { IsolatedPreviewPort } from "../source-editor-types";

initI18n();
beforeEach(async () => { await setLocale("en"); });

function makeCoordinator() {
  const state = { state: "dirty" as const, dirtyGeneration: 1, lastSavedGeneration: 0, identity: { deploymentId: "dep", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseVersionId: "v", baseRevision: "1" }, activeIntentId: null, error: null };
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
    markDirty: vi.fn(),
    checkpoint: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  };
}

function renderHtml(preview?: IsolatedPreviewPort) {
  let source = "<!doctype html>\n<!-- preserve -->\n<section data-x=\"1\">Keep</section>";
  const editor: HtmlEditorHandle = {
    format: "html",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 1,
    captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { source } })),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    cancel: vi.fn(),
    source: { getText: () => source, setText: (next) => { source = next; } },
    getAssetManifest: () => ({ entries: [{ path: "assets/site.css", assetId: "asset-css" }] }),
  };
  const outcome: HtmlOpenOutcome = { outcome: "opened", document_id: "doc", document_model_ref: "model", warnings: [] };
  const coordinator = makeCoordinator();
  render(<HtmlEditor documentKey="doc" editor={editor} open={{ open: vi.fn(async () => outcome) }} coordinator={coordinator} capability={{ format: "html", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }} preview={preview} />);
  return { editor, coordinator };
}

describe("HtmlEditor", () => {
  it("preserves source while mounting an injected preview and routes Save", async () => {
    const mount = vi.fn(async ({ text }: { text: string }) => {
      expect(text).toContain("<!-- preserve -->");
      return { dispose: vi.fn(), update: vi.fn() };
    });
    const { editor, coordinator } = renderHtml({ mount });
    await waitFor(() => expect(screen.getByTestId("html-source")).toBeInTheDocument());
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect((screen.getByTestId("html-source") as HTMLTextAreaElement).value).toContain("data-x=\"1\"");
    fireEvent.click(screen.getByTestId("html-save"));
    expect(coordinator.save).toHaveBeenCalledWith("button");
    expect(editor.dispose).not.toHaveBeenCalled();
  });

  it("shows an unavailable preview without an injected runtime", async () => {
    renderHtml();
    await waitFor(() => expect(screen.getByTestId("html-source")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Preview unavailable")).toBeInTheDocument());
  });
});
