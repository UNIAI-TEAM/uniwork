"use client";

// A13 wire (UNI-924): insert > header/footer. A single toolbar button opens the
// header/footer dialog (six slots, first-page and odd/even variants, live
// preview). Every edit leaves through the shared command runtime's
// set_header_footer / set_title_pg / set_even_odd_headers edits, so the group
// never touches the editor or the save path directly.
import { PanelTop } from "lucide-react";
import { useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { DocxHeaderFooterDialog } from "../../header-footer/docx-header-footer-dialog";
import { emptyHeaderFooterState } from "../../header-footer/header-footer-state";
import type { DocxToolbarGroupContext } from "../types";

/** A group component that can declare its command area absent for a context;
 * the toolbar shell renders nothing for it instead of an empty labelled box. */
export type AvailabilityAwareGroup = ComponentType<DocxToolbarGroupContext> & {
  isAvailable?: (context: DocxToolbarGroupContext) => boolean;
};

/** A handle that only stubs the base contract has no header/footer command
 * area, so the group renders nothing. */
export function headerFooterGroupAvailable({ commands }: DocxToolbarGroupContext): boolean {
  return typeof commands?.setDocxHeaderFooterSlot === "function";
}

export const InsertHeaderFooterGroup: AvailabilityAwareGroup = (props) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!headerFooterGroupAvailable(props)) return null;
  const { format, commands, readOnly, saving } = props;
  const state = format?.docxHeaderFooter ?? emptyHeaderFooterState();
  const editable = !readOnly && !saving;

  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.toolbar.groups.headerFooter")}
        aria-pressed={open}
        data-testid="docx-header-footer-open"
        onClick={() => setOpen(true)}
      >
        <PanelTop aria-hidden />
      </Button>
      <DocxHeaderFooterDialog
        open={open}
        onOpenChange={setOpen}
        state={state}
        readOnly={!editable}
        saving={saving}
        onSetSlot={(slot, hf) => {
          commands?.setDocxHeaderFooterSlot(slot, hf);
        }}
        onSetTitlePg={(value) => {
          commands?.setDocxTitlePg(value);
        }}
        onSetEvenOdd={(value) => {
          commands?.setDocxEvenOddHeaders(value);
        }}
      />
    </>
  );
};

InsertHeaderFooterGroup.isAvailable = headerFooterGroupAvailable;