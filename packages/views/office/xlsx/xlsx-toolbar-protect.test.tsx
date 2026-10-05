import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOfficeRibbonPreferencesStore } from "@uniwork/core/office/ribbon-preferences";
import type { XlsxSaveCoordinator } from "./types";
import { XlsxToolbar, type XlsxToolbarProps } from "./xlsx-toolbar";

function coordinator(): XlsxSaveCoordinator {
  const state = {
    state: "ready" as const,
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
    dirtyGeneration: 0,
    lastSavedGeneration: 0,
    activeIntentId: null,
    error: null,
  };
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
    markDirty: vi.fn(),
  };
}

function renderReview(overrides: Partial<XlsxToolbarProps> = {}) {
  render(
    <XlsxToolbar
      coordinator={coordinator()}
      dirty={false}
      saving={false}
      onSave={vi.fn()}
      readOnly={false}
      permissions={{}}
      selection={{ sheet: "Data", address: "A1" }}
      canUndo
      canRedo
      canRecalculate
      canFormat
      recalculating={false}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onNumberFormat={vi.fn()}
      onRecalculate={vi.fn()}
      onCopy={vi.fn()}
      onPaste={vi.fn()}
      onShowSheets={vi.fn()}
      {...overrides}
    />,
  );
  fireEvent.click(document.querySelector<HTMLElement>('[data-ribbon-tab="review"]')!);
  return screen.getByTestId("xlsx-protect-open");
}

beforeEach(() => {
  useOfficeRibbonPreferencesStore.setState({ collapsed: {} });
});

describe("XlsxToolbar protect wiring", () => {
  it("forwards onOpenProtect to the Review-tab protect control", () => {
    const onOpenProtect = vi.fn();
    const button = renderReview({ onOpenProtect });

    expect(button).not.toHaveAttribute("aria-disabled");
    fireEvent.click(button);
    expect(onOpenProtect).toHaveBeenCalledTimes(1);
  });

  it("keeps the protect control aria-disabled when no handler is passed", () => {
    const button = renderReview();

    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("does not open protection in a read-only document", () => {
    const onOpenProtect = vi.fn();
    const button = renderReview({ onOpenProtect, readOnly: true });

    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(onOpenProtect).not.toHaveBeenCalled();
  });
});
