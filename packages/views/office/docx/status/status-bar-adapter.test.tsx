import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { DocxStatusBar, readDocumentLang } from "../status-bar";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import type { DocxEditorHandle, DocxSaveCoordinator } from "../types";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

function coordinator(): DocxSaveCoordinator {
  const state = {
    state: "saved" as const,
    identity: {
      deploymentId: "dep",
      accountId: "account",
      organizationId: "org",
      workspaceId: "workspace",
      documentId: "doc",
      generation: 0,
      baseVersionId: "version",
      baseRevision: "0",
    },
    dirtyGeneration: 0,
    lastSavedGeneration: 0,
    activeIntentId: null,
    error: null,
  };
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
  };
}

function editor(): DocxEditorHandle {
  return {
    format: "docx",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 0,
    captureSnapshot: vi.fn(async () => ({ generation: 0, fingerprint: "fp", value: {} })),
    dispose: vi.fn(),
  };
}

/** The shared context docx-editor.tsx spreads into every chrome slot. */
function context(): DocxToolbarGroupContext {
  return {
    editor: editor(),
    coordinator: coordinator(),
    format: null,
    commands: undefined,
    selection: null,
    readOnly: false,
    saving: false,
    dirty: false,
    canUndo: true,
    canRedo: false,
    onUndo: () => undefined,
    onRedo: () => undefined,
  };
}

describe("DocxStatusBar chrome adapter", () => {
  it("renders the real bar from the shared toolbar context", () => {
    render(<DocxStatusBar {...context()} />);
    expect(screen.getByRole("group", { name: "Document status" })).toBeInTheDocument();
    expect(screen.getByTestId("docx-status-bar")).toHaveAttribute("aria-live", "off");
  });

  it("keeps every readout on the unknown marks while no counts seam is wired", () => {
    render(<DocxStatusBar {...context()} />);
    for (const testId of [
      "docx-status-page",
      "docx-status-words",
      "docx-status-characters",
      "docx-status-characters-no-spaces",
      "docx-status-language",
      "docx-status-zoom",
    ]) {
      expect(screen.getByTestId(testId)).toHaveTextContent("—");
    }
    expect(screen.getByTestId("docx-status-zoom")).not.toHaveTextContent("%");
  });

  it("reads the document language from the editor root or the mounted surface (M-7)", () => {
    const surface = document.createElement("div");
    surface.innerHTML = '<div class="doc-page" lang="vi-VN"></div>';
    // The editor root carries nothing: the surface's document root supplies it.
    const bare = document.createElement("div");
    expect(readDocumentLang(bare, surface)).toBe("vi-VN");
    // The editor root's own attribute wins.
    const own = document.createElement("div");
    own.setAttribute("lang", "en-GB");
    expect(readDocumentLang(own, surface)).toBe("en-GB");
    // Neither declares a language: the bar keeps its unknown mark.
    expect(readDocumentLang(bare, null)).toBeNull();
    expect(readDocumentLang(null, null)).toBeNull();
    // A blank attribute is not a language.
    const blank = document.createElement("div");
    blank.setAttribute("lang", "  ");
    expect(readDocumentLang(blank, null)).toBeNull();
  });

  it("renders only the bar even when the handle carries a document surface", () => {
    const rich = context();
    rich.editor = {
      ...editor(),
      renderSurface: () => <div data-testid="stub-surface" />,
      selection: { getSelection: () => null, subscribe: () => () => undefined },
    };
    render(<DocxStatusBar {...rich} />);
    expect(screen.getByTestId("docx-status-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-surface")).not.toBeInTheDocument();
  });
});
