"use client";

// B4 (UNI-924): Layout > page setup. W-H adds typed ribbon items: the primary
// entry opens the page-setup dialog (the same command the old toolbar button
// ran) and the split menu offers the same dialog from the menu side. A
// zero-width host item keeps this component (which mounts the dialog) mounted
// next to the typed split, so the typed items stay plain data (no hooks) and
// every command path is kept.
import { LayoutTemplate } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { RibbonItem } from "../../../ribbon";
import { DocxPageSetupDialog } from "../../page-setup/docx-page-setup-dialog";
import type { DocxToolbarGroupContext } from "../types";
import { createRibbonOpenStore, ribbonHostItem, useRibbonOpen } from "./ribbon-open-store";

/** Shared open state of the page-setup dialog: the typed item drives it, this
 * component renders the dialog. */
const pageSetupDialog = createRibbonOpenStore();

/** The typed ribbon items for the Layout > page setup group. */
export function layoutPageSetupRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const { format, commands, readOnly } = context;
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
    ribbonHostItem("layout-page-setup-host", "office.docx.toolbar.groups.pageSetup", LayoutPageSetupGroup, context),
  ];
}

/** Layout > page setup: the typed items live on the registry entry; this
 * component keeps the dialog mount and stays exported for direct use. */
export function LayoutPageSetupGroup({ format, commands, readOnly }: DocxToolbarGroupContext) {
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
        className="sr-only"
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

LayoutPageSetupGroup.ribbonItems = layoutPageSetupRibbonItems;




