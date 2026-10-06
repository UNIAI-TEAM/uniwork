"use client";

import { useTranslation } from "react-i18next";
import { RuleSetDropNotice } from "./conditional-format/rule-set-drop-notice";
import type { XlsxEditorHandle } from "./types";

export interface XlsxFrameNoticesProps {
  recalcProgress: number | null;
  recalcError: string | null;
  editFailed: boolean;
  onCancelRecalculate: () => void;
  /** The save coordinator error code; xlsx_rule_sets_dropped shows the drop notice. */
  saveErrorCode?: string | null;
  editor?: Pick<XlsxEditorHandle, "droppedRuleSets">;
}

/** The frame subbar notices: recalculation progress and the two inline errors. */
export function XlsxFrameNotices({ recalcProgress, recalcError, editFailed, onCancelRecalculate, saveErrorCode, editor }: XlsxFrameNoticesProps) {
  const { t } = useTranslation();
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
      <RuleSetDropNotice errorCode={saveErrorCode} editor={editor} />
    </>
  );
}
