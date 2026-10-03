"use client";

// B4 (UNI-924): Layout ▸ page setup. The toolbar entry opens the page-setup
// dialog for the section at the cursor; the command runtime owns the section
// list and the pending edits, so this group only drives open state.
import { LayoutTemplate } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { DocxPageSetupDialog } from "../../page-setup/docx-page-setup-dialog";
import type { DocxToolbarGroupContext } from "../types";

export function LayoutPageSetupGroup({ format, commands, readOnly }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
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
        onClick={() => setOpen(true)}
      >
        <LayoutTemplate aria-hidden />
      </Button>
      {open && state ? (
        <DocxPageSetupDialog
          open
          onOpenChange={setOpen}
          state={state}
          readOnly={readOnly}
          onApply={(sectionIndex, properties) => {
            if (commands?.setDocxSectionProperties(sectionIndex, properties)) setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
