"use client";

import { Redo2, Search, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { OfficeRibbon } from "../../ribbon";
import { PDF_COMMANDS, type PdfCommandId } from "../pdf-command-map";
import type { PdfToolbarCommand, PdfToolbarTab } from "../toolbar";
import { createPdfRibbonTabs, PDF_RIBBON_SCOPE } from "./pdf-ribbon";

export interface PdfRibbonBarProps {
  activeTab: PdfToolbarTab;
  onTabChange: (tab: PdfToolbarTab) => void;
  commands: readonly PdfToolbarCommand[];
  onCommand?: (id: PdfCommandId) => void;
  findOpen: boolean;
  onFindToggle: () => void;
}

/**
 * The PDF ribbon frame, now the shared Amendment R <OfficeRibbon>: the tab row
 * (quick undo/redo far left, tabs in the middle, Find far right), adaptive group
 * collapse, the collapse-to-tabs toggle and the phone layout all come from the
 * shared ribbon. `createPdfRibbonTabs` supplies the PDF tabs and labelled groups.
 * Presentational - every command is a callback and nothing here touches the
 * office engine. Selection and position text live in the status bar, never in the
 * ribbon (C6).
 */
export function PdfRibbonBar({
  activeTab,
  onTabChange,
  commands,
  onCommand,
  findOpen,
  onFindToggle,
}: PdfRibbonBarProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const commandById = useMemo(() => new Map(commands.map((command) => [command.id, command] as const)), [commands]);

  const runCommand = useCallback(
    (command: PdfToolbarCommand) => {
      command.onExecute?.();
      onCommand?.(command.id);
    },
    [onCommand],
  );

  const tabs = useMemo(() => createPdfRibbonTabs(commands, onCommand), [commands, onCommand]);
  // Stable signature of the tab ids. `commands` is rebuilt whenever editor
  // state changes, so `tabs` changes identity far more often than the tab set
  // does; the annotation effect below keys on this signature to stay off that
  // churn (and off every plain re-render).
  const tabIdSignature = useMemo(() => tabs.map((tab) => tab.id).join(" "), [tabs]);

  const undo = commandById.get(PDF_COMMANDS.undo);
  const redo = commandById.get(PDF_COMMANDS.redo);

  const quickAccess = useMemo(
    () => (
      <>
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          data-testid="pdf-chrome-undo"
          aria-label={t("office.pdf.chrome.undo")}
          disabled={!undo || undo.disabled}
          onClick={() => undo && runCommand(undo)}
        >
          <Undo2 aria-hidden />
        </Button>
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          data-testid="pdf-chrome-redo"
          aria-label={t("office.pdf.chrome.redo")}
          disabled={!redo || redo.disabled}
          onClick={() => redo && runCommand(redo)}
        >
          <Redo2 aria-hidden />
        </Button>
      </>
    ),
    [redo, runCommand, t, undo],
  );

  const trailing = useMemo(
    () => (
      <ToggleGroup
        value={findOpen ? ["find"] : []}
        onValueChange={() => onFindToggle()}
        className="shrink-0"
        data-testid="pdf-chrome-find-group"
      >
        <ToggleGroupItem
          value="find"
          variant="toolbar"
          size="sm"
          className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          data-testid="pdf-chrome-find"
          aria-label={t("office.pdf.chrome.find")}
        >
          <Search aria-hidden />
        </ToggleGroupItem>
      </ToggleGroup>
    ),
    [findOpen, onFindToggle, t],
  );

  // The shared ribbon owns its tab buttons and body and exposes no per-tab test
  // id, so the PDF chrome annotates them after commit to keep the long-standing
  // pdf-chrome-tab-<id> / pdf-chrome-command-row consumer contract. Additive and
  // idempotent: React never manages these attributes, so a re-render keeps them.
  // Keyed on the tab-id signature, not the render: the annotation only has work
  // to do when the tab set changes, so it stays off the per-render path.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const buttons = new Map<string, HTMLElement>();
    root.querySelectorAll<HTMLElement>("[data-ribbon-tab]").forEach((node) => {
      const id = node.dataset.ribbonTab;
      if (id) buttons.set(id, node);
    });
    for (const id of tabIdSignature.split(" ")) {
      buttons.get(id)?.setAttribute("data-testid", `pdf-chrome-tab-${id}`);
    }
    root.querySelector<HTMLElement>("[data-ribbon-body]")?.setAttribute("data-testid", "pdf-chrome-command-row");
  }, [tabIdSignature]);

  return (
    <div className="min-w-0" data-testid="pdf-ribbon-bar" ref={rootRef}>
      <OfficeRibbon
        tabs={tabs}
        scope={PDF_RIBBON_SCOPE}
        activeTabId={activeTab}
        onActiveTabChange={(id) => onTabChange(id as PdfToolbarTab)}
        quickAccess={quickAccess}
        trailing={trailing}
        labelKey="office.pdf.toolbar.label"
      />
    </div>
  );
}
