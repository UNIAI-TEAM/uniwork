"use client";

// B6 (UNI-924): Layout > page decoration. W-H adds typed ribbon items: the
// primary dropdown opens the watermark / page colour / borders / theme dialog
// (the same command the old toolbar button ran). The trigger button and a
// zero-width host item keep this component mounted next to the typed dropdown,
// so the typed items stay plain data and every command path is kept.
import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { RibbonItem } from "../../../ribbon";
import { DocxPageDecorDialog } from "../../page-decor/docx-page-decor-dialog";
import type { DocxToolbarGroupContext } from "../types";
import { createRibbonOpenStore, ribbonHostItem, useRibbonOpen } from "./ribbon-open-store";

/** Shared open state of the page-decoration dialog. */
const pageDecorDialog = createRibbonOpenStore();

/** The typed ribbon items for the Layout > page decoration group. */
export function layoutPageDecorRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const { format, commands, readOnly } = context;
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
    ribbonHostItem("layout-page-decor-host", "office.docx.toolbar.groups.pageDecor", LayoutPageDecorGroup, context),
  ];
}

/** Layout > page decoration: the typed items live on the registry entry; this
 * component keeps the dialog mount and stays exported for direct use. */
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

LayoutPageDecorGroup.ribbonItems = layoutPageDecorRibbonItems;



