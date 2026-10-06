// UNI-924 A6-wire: the View tab's navigation group owns the pane's open state
// and renders the pane over the live document outline.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocxToolbarGroupContext } from "../types";
import { ViewNavigationGroup, viewNavigationRibbonItems } from "./view-navigation";
import { useState } from "react";
import { createDocxDocumentScope, type DocxDocumentScope } from "../../editor-store";

function context(docScope: DocxDocumentScope): DocxToolbarGroupContext {
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
    docScope,
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
  };
}

function Fixture() {
  // One document: the scope a DocxEditor provides, its root bound like the editor's.
  const [scope] = useState(createDocxDocumentScope);
  return (
    <div data-testid="docx-editor" ref={(node) => { scope.root.current = node; }}>
      <div data-testid="docx-canvas">
        <div data-testid="docx-document-surface">
          <div className="doc-zoom">
            <div className="page-wrap">
              <div className="doc-page">
                <h1>One</h1>
                <h2>One A</h2>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ViewNavigationGroup {...context(scope)} />
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** The ribbon's live nav toggle (the typed custom item) plus the pane group,
 * mounted together the way the toolbar mounts them (F6). */
function RibbonFixture() {
  const [scope] = useState(createDocxDocumentScope);
  const item = viewNavigationRibbonItems(context(scope)).find((entry) => entry.id === "view-navigation");
  if (!item || item.kind !== "custom") throw new Error("expected a custom nav item");
  return (
    <div data-testid="docx-editor" ref={(node) => { scope.root.current = node; }}>
      <div data-testid="docx-canvas">
        <div data-testid="docx-document-surface">
          <div className="doc-zoom">
            <div className="page-wrap">
              <div className="doc-page">
                <h1>One</h1>
              </div>
            </div>
          </div>
        </div>
      </div>
      {item.render({ size: "large", inPanel: false })}
      <ViewNavigationGroup {...context(scope)} />
    </div>
  );
}

describe("ViewNavigationGroup", () => {
  it("opens the pane, lists the rendered headings and scrolls the clicked one", async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    render(<Fixture />);

    fireEvent.click(screen.getByTestId("docx-navigation-toggle"));
    expect(await screen.findByTestId("docx-navigation-pane")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("treeitem", { name: "One A" }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("closes the pane from its close affordance", async () => {
    render(<Fixture />);
    const toggle = screen.getByTestId("docx-navigation-toggle");
    fireEvent.click(toggle);
    await screen.findByTestId("docx-navigation-pane");

    fireEvent.click(screen.getByRole("button", { name: "Đóng ngăn điều hướng", hidden: true }));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));
  });
  it("opens the pane from the live ribbon toggle (F6)", async () => {
    render(<RibbonFixture />);
    const toggle = screen.getByTestId("docx-navigation-ribbon-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    // The store the toggle wrote is the same one the pane reads, so the pane
    // opens and the toggle's pressed state tracks it live.
    expect(await screen.findByTestId("docx-navigation-pane")).toBeInTheDocument();
    expect(screen.getByTestId("docx-navigation-ribbon-toggle")).toHaveAttribute("aria-pressed", "true");
  });
});
