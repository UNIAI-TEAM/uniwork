"use client";

import { Save, Undo2, Redo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { OfficeRibbon } from "../../ribbon";
import { RibbonDialogHosts } from "./groups/ribbon-open-store";
import { HomeFindGroup } from "./groups/home-find";
import { buildDocxContextualTabs } from "./contextual-tabs";
import { buildDocxRibbonTabs } from "./ribbon-tabs";
import type { DocxToolbarProps } from "./types";

/**
 * The DOCX editor chrome (C6/C10, chrome amendment R): one shared Office
 * ribbon replaces the old per-lane tab row + command strip. The ribbon owns the
 * tab row, adaptive collapse, collapse-to-tabs and the simplified phone layout;
 * the quick-access undo/redo pair sits left of the tabs, Find and the host Save
 * at the far right. No selection/position text lives here (it moved to the
 * status bar, C10).
 *
 * Every command group still plugs in through DOCX_TOOLBAR_TABS via
 * ./ribbon-tabs.ts, so the migration is a re-mount: no group loses its place.
 */
export function DocxToolbarShell(context: DocxToolbarProps) {
  const { t } = useTranslation();
  const { coordinator, readOnly = false, saving, dirty, canUndo, canRedo, onUndo, onRedo, onSave } = context;
  const blocked = readOnly || saving;

  return (
    <div data-testid="docx-toolbar">
      <OfficeRibbon
        tabs={[...buildDocxRibbonTabs(context), ...buildDocxContextualTabs(context)]}
        scope="docx"
        labelKey="office.ribbon.label"
        quickAccess={
          <>
            <Button
              type="button"
              variant="toolbar"
              size="icon-sm"
              aria-label={t("office.docx.actions.undo")}
              disabled={blocked || !canUndo}
              onClick={onUndo}
            >
              <Undo2 aria-hidden />
            </Button>
            <Button
              type="button"
              variant="toolbar"
              size="icon-sm"
              aria-label={t("office.docx.actions.redo")}
              disabled={blocked || !canRedo}
              onClick={onRedo}
            >
              <Redo2 aria-hidden />
            </Button>
          </>
        }
        trailing={
          <>
            <HomeFindGroup {...context} />
            {onSave ? (
              <Button
                type="button"
                variant="brand"
                size="sm"
                aria-disabled={blocked || !dirty || undefined}
                disabled={blocked || !dirty}
                data-testid="docx-save"
                onClick={() => onSave()}
              >
                <Save aria-hidden />
                {saving ? t("office.docx.actions.saving") : t("office.docx.actions.save")}
              </Button>
            ) : null}
          </>
        }
      />
      {/* F7: one persistent, fold-proof mount for every typed group's dialog/panel. */}
      <RibbonDialogHosts {...context} />
      {onSave ? (
        <span className="sr-only" role="status" aria-live="polite">
          {t(`office.docx.saveState.${coordinator.getState().state}`)}
        </span>
      ) : null}
    </div>
  );
}
