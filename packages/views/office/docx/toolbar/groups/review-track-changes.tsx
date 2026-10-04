"use client";

// A12 (UNI-924): review > tracked changes. W-H adds typed ribbon items: the
// primary split opens the change pane and its menu carries Accept all / Reject
// all, the same commands the old toolbar entry exposed. A zero-width host item
// keeps this component (which mounts the pane) mounted next to the typed split,
// so the typed items stay plain data (no hooks) and every command path is kept.
import { CheckCheck, History, XCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import type { RibbonItem } from "../../../ribbon";
import { DocxReviewPanel } from "../../review/docx-review-panel";
import type { DocxToolbarGroupContext } from "../types";
import { createRibbonOpenStore, ribbonHostItem, useRibbonOpen } from "./ribbon-open-store";

/** Shared open state of the tracked-changes pane. */
const reviewPane = createRibbonOpenStore();

/** The typed ribbon items for the Review > track changes group. */
export function reviewTrackChangesRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const { format, commands } = context;
  const disabled = !commands;
  const hasChanges = (format?.reviewChanges.length ?? 0) > 0;
  return [
    {
      kind: "split",
      id: "review-track-changes",
      labelKey: "office.docx.toolbar.groups.trackChanges",
      icon: History,
      size: "large",
      collapseAs: "small",
      disabled,
      onExecute: () => reviewPane.open(),
      menu: [
        {
          id: "review-track-changes-accept-all",
          labelKey: "office.docx.review.acceptAll",
          icon: CheckCheck,
          disabled: disabled || !hasChanges,
          onSelect: () => commands?.acceptAllReviewChanges(),
        },
        {
          id: "review-track-changes-reject-all",
          labelKey: "office.docx.review.rejectAll",
          icon: XCircle,
          disabled: disabled || !hasChanges,
          onSelect: () => commands?.rejectAllReviewChanges(),
        },
      ],
    },
    ribbonHostItem("review-track-changes-host", "office.docx.toolbar.groups.trackChanges", ReviewTrackChangesGroup, context),
  ];
}

/** Review > track changes: the typed items live on the registry entry; this
 * component keeps the pane mount and stays exported for direct use. */
export function ReviewTrackChangesGroup({ format, commands, readOnly, saving }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [open] = useRibbonOpen(reviewPane);
  const [activeId, setActiveId] = useState<string | null>(null);
  // null until both the command runtime and the opened document exist: the
  // panel then keeps its loading state instead of claiming the document has no
  // changes.
  const changes = commands && format ? format.reviewChanges : null;

  const setOpenState = (next: boolean): void => {
    reviewPane.set(next);
    if (!next) setActiveId(null);
  };

  const count = changes?.length ?? 0;
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
            className="sr-only"
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

ReviewTrackChangesGroup.ribbonItems = reviewTrackChangesRibbonItems;




