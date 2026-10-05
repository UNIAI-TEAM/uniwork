import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOfficeRibbonPreferencesStore } from "@uniwork/core/office/ribbon-preferences";
import { setLocale } from "@uniwork/core/i18n";
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

describe("XlsxToolbar protect label", () => {
  it("shows the short key as the visible label and keeps the long text as the tooltip", () => {
    const button = renderReview({ onOpenProtect: vi.fn() });

    // Pin the exact translated label, not the raw i18n key: the old
    // /openShort|…/ regex also matched an untranslated key (F5).
    expect(button).toHaveTextContent(/^Bảo vệ trang tính$/);
    expect(button.textContent).not.toContain("tên");
    expect(button).toHaveAttribute("title", "Bảo vệ trang tính và tên");
  });

  it("shows the translated short label in English too", async () => {
    await setLocale("en");
    const button = renderReview({ onOpenProtect: vi.fn() });

    expect(button).toHaveTextContent(/^Protect sheet$/);
    expect(button).toHaveAttribute("title", "Protect sheet and names");
  });
});
