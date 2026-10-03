// UNI-924 A6-wire: the View tab's navigation group owns the pane's open state
// and renders the pane over the live document outline.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocxToolbarGroupContext } from "../types";
import { ViewNavigationGroup } from "./view-navigation";

function context(): DocxToolbarGroupContext {
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
  };
}

function Fixture() {
  return (
    <div data-testid="docx-editor">
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
      <ViewNavigationGroup {...context()} />
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

    fireEvent.click(screen.getByRole("button", { name: "Đóng ngăn điều hướng" }));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));
  });
});
