import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOfficeRibbonPreferencesStore } from "@uniwork/core/office/ribbon-preferences";
import { XlsxToolbar } from "../xlsx-toolbar";
import { XLSX_TOOLBAR_TABS } from "./tabs";
import type { XlsxSaveCoordinator } from "../types";

// Visual r4 R4-4: icon-only controls are named for assistive tech but a sighted
// user had to guess them. Every icon-only ribbon button now carries BOTH an
// accessible name and a tooltip, on every tab.

const noop = () => undefined;
const state = {
  state: "dirty" as const,
  identity: {
    deploymentId: "dep", accountId: "account", organizationId: "org", workspaceId: "workspace",
    documentId: "doc", generation: 1, baseVersionId: "version", baseRevision: "1",
  },
  dirtyGeneration: 1,
  lastSavedGeneration: 0,
  activeIntentId: null,
  error: null,
};
const coordinator: XlsxSaveCoordinator = {
  getState: () => state,
  subscribe: () => noop,
  save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
  markDirty: vi.fn(),
};

beforeEach(() => {
  useOfficeRibbonPreferencesStore.setState({ collapsed: {} });
});

describe("icon-only ribbon controls", () => {
  it("name and tooltip every icon-only button on every tab", () => {
    render(
      <XlsxToolbar
        coordinator={coordinator} dirty saving={false} onSave={noop} onCancelSave={noop} showSave
        readOnly={false} permissions={{}} selection={{ sheet: "Data", address: "C1" }}
        canUndo canRedo canRecalculate canFormat recalculating={false}
        onUndo={noop} onRedo={noop} onNumberFormat={noop} onRecalculate={noop}
        onCut={noop} onCopy={noop} onPaste={noop} onShowSheets={noop}
        commands={{ execute: () => true }}
      />,
    );
    const unnamed: string[] = [];
    for (const tab of XLSX_TOOLBAR_TABS) {
      fireEvent.click(document.querySelector(`[data-ribbon-tab="${tab.id}"]`)!);
      const panel = document.querySelector<HTMLElement>("[role='tabpanel']")!;
      for (const button of Array.from(panel.querySelectorAll("button"))) {
        if ((button.textContent ?? "").trim() !== "") continue;
        const name = button.getAttribute("aria-label")?.trim() ?? "";
        // Typed ribbon items get their tooltip from the Tooltip primitive.
        const title = button.getAttribute("title")?.trim() ?? "";
        const tooltip = title !== "" || button.getAttribute("data-slot") === "tooltip-trigger";
        if (name === "" || !tooltip) unnamed.push(`${tab.id}: ${button.outerHTML.slice(0, 120)}`);
      }
    }
    expect(unnamed).toEqual([]);
  });
});
