// UNI-924 A6-wire: the View tab's zoom group is the control for the shared
// zoom controller; the chrome mount owns the surface attachment.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocxToolbarGroupContext } from "../types";
import { ViewZoomGroup } from "./view-zoom";

function context(format: DocxToolbarGroupContext["format"]): DocxToolbarGroupContext {
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
    format,
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

const READY_FORMAT = {
  bold: false,
  italic: false,
  underline: false,
  headingLevel: null,
  listKind: null,
} as DocxToolbarGroupContext["format"];

describe("ViewZoomGroup", () => {
  it("renders the zoom control inert until a document is open", () => {
    render(<ViewZoomGroup {...context(null)} />);
    expect(screen.getByTestId("docx-zoom-control")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Phóng to", hidden: true })).toBeDisabled();
  });

  it("enables the control once the format state is available", () => {
    render(<ViewZoomGroup {...context(READY_FORMAT)} />);
    expect(screen.getByRole("button", { name: "Phóng to", hidden: true })).toBeEnabled();
  });
});
