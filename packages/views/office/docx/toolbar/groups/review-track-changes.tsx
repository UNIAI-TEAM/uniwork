"use client";

// A12 (UNI-924): review ▸ tracked changes. The toolbar entry (count badge)
// opens the change pane; the command runtime owns collection and every
// accept/reject mutation, so this group only drives open/jump state.
import { History } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { DocxReviewPanel } from "../../review/docx-review-panel";
import type { DocxToolbarGroupContext } from "../types";

export function ReviewTrackChangesGroup({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  // null until both the command runtime and the opened document exist: the
  // panel then keeps its loading state instead of claiming the document has no
  // changes.
  const changes = commands && format ? format.reviewChanges : null;
  const count = changes?.length ?? 0;

  const setOpenState = (next: boolean): void => {
    setOpen(next);
    if (!next) setActiveId(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpenState}>
      <PopoverTrigger
        disabled={!commands}
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            aria-label={t("office.docx.toolbar.groups.trackChanges")}
            aria-pressed={open}
            data-testid="docx-review-toggle"
          />
        }
      >
        <History aria-hidden />
        {count > 0 ? <span className="text-caption text-muted-foreground">{count}</span> : null}
      </PopoverTrigger>
      {/* keepMounted: the panel hosts the bulk confirmation dialog, and the
          popup would otherwise tear down with its child when focus leaves. */}
      <PopoverContent align="end" className="w-[26rem] max-w-[calc(100vw-2rem)]" keepMounted>
        <DocxReviewPanel
          changes={changes}
          activeId={activeId}
          readOnly={readOnly}
          busy={saving}
          onAccept={(id) => {
            commands?.acceptReviewChange(id);
          }}
          onReject={(id) => {
            commands?.rejectReviewChange(id);
          }}
          onAcceptAll={() => {
            commands?.acceptAllReviewChanges();
          }}
          onRejectAll={() => {
            commands?.rejectAllReviewChanges();
          }}
          onJump={(id) => {
            if (commands?.jumpToReviewChange(id)) setActiveId(id);
          }}
          onClose={() => setOpenState(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
