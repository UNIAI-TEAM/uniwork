"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { subscribeCommandRefusals } from "./fire-command";
import { RuleSetDropNotice } from "./conditional-format/rule-set-drop-notice";
import { useRuleSetDropRestore, type RuleSetRestoreGrid } from "./conditional-format/use-rule-set-drop-restore";
import type { XlsxEditorHandle } from "./types";

export interface XlsxFrameNoticesProps {
  recalcProgress: number | null;
  recalcError: string | null;
  editFailed: boolean;
  onCancelRecalculate: () => void;
  /** The save coordinator error code; xlsx_rule_sets_dropped shows the drop notice. */
  saveErrorCode?: string | null;
  editor?: Pick<XlsxEditorHandle, "droppedRuleSets">;
  /** The live grid: a drop restores what the grid paints (r3 MA-3). */
  grid?: RuleSetRestoreGrid;
}

/** The frame subbar notices: recalculation progress and the two inline errors. */
export function XlsxFrameNotices({ recalcProgress, recalcError, editFailed, onCancelRecalculate, saveErrorCode, editor, grid }: XlsxFrameNoticesProps) {
  const { t } = useTranslation();
  const [commandRefused, setCommandRefused] = useState(false);
  useEffect(() => subscribeCommandRefusals(() => setCommandRefused(true)), []);
  useRuleSetDropRestore(saveErrorCode, editor, grid);
  return (
    <>
      {recalcProgress !== null ? (
        <div className="flex items-center gap-2 border-b border-border bg-office-band px-3 py-1 text-caption" data-testid="xlsx-recalc-progress" role="status">
          <span>{t("office.xlsx.recalc.progress", { progress: recalcProgress })}</span>
          <progress max={100} value={recalcProgress} aria-label={t("office.xlsx.recalc.progress", { progress: recalcProgress })} />
          <button type="button" className="text-primary underline" onClick={onCancelRecalculate} data-testid="xlsx-recalc-cancel">{t("office.xlsx.recalc.cancel")}</button>
        </div>
      ) : null}
      {recalcError ? <p className="border-b border-destructive/30 bg-destructive/10 px-3 py-1 text-caption text-destructive" role="alert" data-testid="xlsx-recalc-error">{recalcError}</p> : null}
      {editFailed ? <p className="border-b border-destructive/30 px-3 py-1 text-caption text-destructive" role="alert" data-testid="xlsx-edit-error">{t("office.xlsx.errors.editFailed")}</p> : null}
      {commandRefused ? (
        <p className="flex items-center gap-2 border-b border-destructive/30 px-3 py-1 text-caption text-destructive" role="alert" data-testid="xlsx-command-refused">
          <span>{t("office.xlsx.errors.commandRefused")}</span>
          <button type="button" className="underline" onClick={() => setCommandRefused(false)}>{t("office.xlsx.errors.dismiss")}</button>
        </p>
      ) : null}
      <RuleSetDropNotice errorCode={saveErrorCode} editor={editor} />
    </>
  );
}
