"use client";

import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { OfficeStatusBar } from "../frame";

/** The rows the Markdown shortcuts sheet lists; labels reuse existing keys. */
const SHORTCUT_ROWS: readonly { id: string; labelKey: string; keys: string }[] = [
  { id: "undo", labelKey: "office.markdown.actions.undo", keys: "Ctrl+Z" },
  { id: "redo", labelKey: "office.markdown.actions.redo", keys: "Ctrl+Y" },
  { id: "save", labelKey: "office.markdown.actions.save", keys: "Ctrl+S" },
  { id: "find", labelKey: "office.common.chrome.find", keys: "Ctrl+F" },
  { id: "replace", labelKey: "office.common.find.title", keys: "Ctrl+H" },
  { id: "mode", labelKey: "office.markdown.view.label", keys: "Ctrl+\\" },
];

/**
 * The Markdown status row (F1/F8): one shared `OfficeStatusBar` carrying the
 * save state on the left, the active canvas on the right and the `?` help
 * affordance last. It replaces the hand-rolled header state text, so the
 * editor draws no chrome row of its own.
 */
export function MarkdownStatusBar({ state, mode, readOnly = false }: { state: string; mode: "visual" | "source"; readOnly?: boolean }) {
  const { t } = useTranslation();
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <>
      <OfficeStatusBar
        labelKey="office.status.label"
        start={
          <span data-testid="md-open-state">{t(`office.markdown.saveState.${state}`)}</span>
        }
        end={
          <>
            {readOnly ? <span data-testid="md-readonly">{t("office.markdown.saveState.readonly")}</span> : null}
            <span data-testid="md-view-label">{t(mode === "source" ? "office.markdown.view.source" : "office.markdown.view.wysiwyg")}</span>
          </>
        }
        help={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("office.markdown.shortcuts.title")}
            title={t("office.markdown.shortcuts.title")}
            aria-haspopup="dialog"
            data-testid="md-shortcuts-help-trigger"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp aria-hidden />
          </Button>
        }
      />
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent data-testid="md-shortcuts-dialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("office.markdown.shortcuts.title")}</DialogTitle>
            <DialogDescription>{t("office.markdown.shortcuts.description")}</DialogDescription>
          </DialogHeader>
          <dl className="divide-y divide-border" data-testid="md-shortcuts-list">
            {SHORTCUT_ROWS.map((row) => (
              <div key={row.id} className="flex min-h-8 items-center justify-between gap-4 py-1.5">
                <dt className="text-body text-foreground">{t(row.labelKey)}</dt>
                <dd className="font-mono text-caption text-muted-foreground">{row.keys}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
