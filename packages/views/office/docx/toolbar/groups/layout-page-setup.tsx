"use client";

// B4 (UNI-924): Layout > page setup. W-H adds typed ribbon items: the primary
// entry opens the page-setup dialog (the same command the old toolbar button
// ran) and the split menu offers the same dialog from the menu side. The dialog
// itself is mounted by the toolbar-level `RibbonDialogHosts` (F7), so it keeps
// living when this group folds into a popover; the kept sr-only trigger is an
// anchor only and is removed from the tab order and the a11y tree (F9).
import { LayoutTemplate } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { RibbonItem } from "../../../ribbon";
import { DocxPageSetupDialog } from "../../page-setup/docx-page-setup-dialog";
import type { DocxToolbarGroupContext } from "../types";
import { scopedRibbonOpenStore, registerRibbonDialogHost, ribbonHostItem, useRibbonOpen } from "./ribbon-open-store";

/** Shared open state of the page-setup dialog: the typed item drives it, this
 * component renders the dialog. */
const pageSetupDialogFor = scopedRibbonOpenStore();

/** The typed ribbon items for the Layout > page setup group. */
export function layoutPageSetupRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const { format, commands, readOnly } = context;
  const pageSetupDialog = pageSetupDialogFor(context.docScope);
  const disabled = readOnly || !commands || !format?.docxPageSetup;
  const open = () => pageSetupDialog.open();
  return [
    {
      kind: "split",
      id: "layout-page-setup",
      labelKey: "office.docx.toolbar.groups.pageSetup",
      icon: LayoutTemplate,
      size: "large",
      collapseAs: "small",
      disabled,
      onExecute: open,
      menu: [
        {
          id: "layout-page-setup-dialog",
          labelKey: "office.docx.toolbar.groups.pageSetup",
          icon: LayoutTemplate,
          disabled,
          onSelect: open,
        },
      ],
    },
    ribbonHostItem("layout-page-setup-host", "office.docx.toolbar.groups.pageSetup"),
  ];
}

/** Layout > page setup: the typed items live on the registry entry; this
 * component owns the dialog and is mounted by `RibbonDialogHosts`. */
export function LayoutPageSetupGroup({ format, commands, readOnly, docScope: scope }: DocxToolbarGroupContext) {
  const pageSetupDialog = pageSetupDialogFor(scope);
  const { t } = useTranslation();
  const [open] = useRibbonOpen(pageSetupDialog);
  const state = format?.docxPageSetup ?? null;
  const disabled = readOnly || !commands || !state;
  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.toolbar.groups.pageSetup")}
        aria-haspopup="dialog"
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        data-testid="docx-page-setup-open"
        onClick={() => pageSetupDialog.open()}
      >
        <LayoutTemplate aria-hidden />
      </Button>
      {open && state ? (
        <DocxPageSetupDialog
          open
          onOpenChange={pageSetupDialog.set}
          state={state}
          readOnly={readOnly}
          onApply={(sectionIndex, properties) => {
            if (commands?.setDocxSectionProperties(sectionIndex, properties)) pageSetupDialog.close();
          }}
        />
      ) : null}
    </>
  );
}

registerRibbonDialogHost("layout-page-setup-host", LayoutPageSetupGroup);
