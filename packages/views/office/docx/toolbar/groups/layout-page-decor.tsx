"use client";

// B6 (UNI-924): Layout > page decoration. W-H adds typed ribbon items: the
// primary dropdown opens the watermark / page colour / borders / theme dialog
// (the same command the old toolbar button ran). The dialog is mounted by the
// toolbar-level `RibbonDialogHosts` (F7) so folding the group cannot destroy it;
// the kept sr-only trigger is an anchor only (F9).
import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { RibbonItem } from "../../../ribbon";
import { DocxPageDecorDialog } from "../../page-decor/docx-page-decor-dialog";
import type { DocxToolbarGroupContext } from "../types";
import { createRibbonOpenStore, registerRibbonDialogHost, ribbonHostItem, useRibbonOpen } from "./ribbon-open-store";

/** Shared open state of the page-decoration dialog. */
const pageDecorDialog = createRibbonOpenStore();

/** The typed ribbon items for the Layout > page decoration group. */
export function layoutPageDecorRibbonItems({ format, commands, readOnly }: DocxToolbarGroupContext): readonly RibbonItem[] {
  const disabled = readOnly || !commands || !format?.docxPageDecor;
  const open = () => pageDecorDialog.open();
  return [
    {
      kind: "dropdown",
      id: "layout-page-decor",
      labelKey: "office.docx.toolbar.groups.pageDecor",
      icon: Palette,
      size: "large",
      collapseAs: "small",
      disabled,
      menu: [
        {
          id: "layout-page-decor-dialog",
          labelKey: "office.docx.toolbar.groups.pageDecor",
          icon: Palette,
          disabled,
          onSelect: open,
        },
      ],
    },
    ribbonHostItem("layout-page-decor-host", "office.docx.toolbar.groups.pageDecor"),
  ];
}

/** Layout > page decoration: the typed items live on the registry entry; this
 * component owns the dialog and is mounted by `RibbonDialogHosts`. */
export function LayoutPageDecorGroup({ format, commands, readOnly }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [open] = useRibbonOpen(pageDecorDialog);
  const state = format?.docxPageDecor ?? null;
  const disabled = readOnly || !commands || !state;
  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.toolbar.groups.pageDecor")}
        aria-haspopup="dialog"
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onClick={() => pageDecorDialog.open()}
        data-testid="docx-page-decor-open"
      >
        <Palette aria-hidden />
      </Button>
      {open && state ? (
        <DocxPageDecorDialog
          open
          onOpenChange={pageDecorDialog.set}
          state={state}
          readOnly={readOnly}
          onApply={(edits) => {
            if (commands?.applyDocxPageDecor(edits)) pageDecorDialog.close();
          }}
        />
      ) : null}
    </>
  );
}

registerRibbonDialogHost("layout-page-decor-host", LayoutPageDecorGroup);
