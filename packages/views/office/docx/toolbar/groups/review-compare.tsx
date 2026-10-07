"use client";

// C2 (UNI-924): Review > Compare. W-H adds a typed ribbon button: the entry
// opens the dialog (the same command the old toolbar button ran). The dialog
// reads the live document through the command runtime and parses the picked
// file off-session, so nothing here touches the save path. Comparison stays
// available on a read-only document - it only reads. The dialog is mounted by
// the toolbar-level `RibbonDialogHosts` (F7) so folding the group cannot destroy
// it; the kept sr-only trigger is an anchor only (F9).
import { GitCompareArrows } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { RibbonItem } from "../../../ribbon";
import { DocxCompareDialog } from "../../compare/compare-dialog";
import type { DocxToolbarGroupContext } from "../types";
import { scopedRibbonOpenStore, registerRibbonDialogHost, ribbonHostItem, useRibbonOpen } from "./ribbon-open-store";

/** Shared open state of the compare dialog. */
const compareDialogFor = scopedRibbonOpenStore();

/** The typed ribbon items for the Review > compare group. */
export function reviewCompareRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const { format, commands } = context;
  const compareDialog = compareDialogFor(context.docScope);
  // Both halves matter: without a command runtime the dialog has no live-text
  // reader, and every compared block would read as "added".
  const ready = format?.docxCompareReady === true && commands != null;
  return [
    {
      kind: "button",
      id: "review-compare",
      labelKey: "office.docx.compare.action",
      icon: GitCompareArrows,
      size: "large",
      collapseAs: "small",
      disabled: !ready,
      onExecute: () => compareDialog.open(),
    },
    ribbonHostItem("review-compare-host", "office.docx.toolbar.groups.compare"),
  ];
}

/** Review > Compare: the typed items live on the registry entry; this component
 * owns the dialog and is mounted by `RibbonDialogHosts`. */
export function ReviewCompareGroup({ format, commands, docScope: scope }: DocxToolbarGroupContext) {
  const compareDialog = compareDialogFor(scope);
  const { t } = useTranslation();
  const [open] = useRibbonOpen(compareDialog);
  const ready = format?.docxCompareReady === true && commands != null;
  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.compare.action")}
        aria-haspopup="dialog"
        disabled={!ready}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onClick={() => compareDialog.open()}
        data-testid="docx-compare-toggle"
      >
        <GitCompareArrows aria-hidden />
      </Button>
      {open && ready ? (
        <DocxCompareDialog open onOpenChange={compareDialog.set} currentTexts={() => commands?.compareDocumentTexts() ?? []} />
      ) : null}
    </>
  );
}

registerRibbonDialogHost("review-compare-host", ReviewCompareGroup);
