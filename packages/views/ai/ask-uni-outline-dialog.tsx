"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { ContentEditor, type ContentEditorRef } from "../editor";

interface Props {
  open: boolean;
  /** The outline as the proposal holds it, in Markdown. */
  markdown: string;
  /** A save is in flight. */
  busy: boolean;
  /** The last refusal, already worded. */
  error?: string;
  onOpenChange: (open: boolean) => void;
  /** Called with the trimmed Markdown, only when it differs from `markdown`. */
  onSave: (markdown: string) => void;
}

/** "Sửa dàn ý": the plan card's outline in the rich editor. The host owns the call; the dialog stays open until it answers. */
export function AskUniOutlineDialog({ open, markdown, busy, error, onOpenChange, onSave }: Props) {
  const { t } = useTranslation();
  const editor = useRef<ContentEditorRef>(null);
  // The editor rewrites Markdown in its own style (`*` bullets become `-`), so "unchanged" is judged against what
  // it returns for the untouched outline, not against the raw text.
  const baseline = useRef<string | null>(null);
  // A closed dialog drops its baseline: the next editor mount captures its own, and until then the raw text applies.
  useEffect(() => {
    if (!open) baseline.current = null;
  }, [open]);
  const captureBaseline = () => {
    baseline.current = (editor.current?.getMarkdown() ?? markdown).trim();
  };
  const save = () => {
    if (busy) return;
    const next = (editor.current?.getMarkdown() ?? markdown).trim();
    if (next === (baseline.current ?? markdown.trim())) onOpenChange(false);
    else onSave(next);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("ai.proposal.edit_outline")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] min-h-48 overflow-y-auto rounded-control border border-border px-3 py-2">
          <ContentEditor ref={editor} defaultValue={markdown} ariaLabel={t("ai.proposal.outline_label")} disableMentions onReady={captureBaseline} />
        </div>
        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("ai.proposal.cancel")}
          </Button>
          <Button type="button" aria-disabled={busy} onClick={save}>
            {t("ai.proposal.outline_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
