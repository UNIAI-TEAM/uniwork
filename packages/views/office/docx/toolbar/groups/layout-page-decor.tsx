"use client";

// B6 (UNI-924): Layout ▸ page decoration. The toolbar entry opens the
// watermark / page colour / borders / theme dialog; the command runtime owns
// the read state and the pending ops, so this group only drives open state.
import { Palette } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { DocxPageDecorDialog } from "../../page-decor/docx-page-decor-dialog";
import type { DocxToolbarGroupContext } from "../types";

export function LayoutPageDecorGroup({ format, commands, readOnly }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
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
        onClick={() => setOpen(true)}
        data-testid="docx-page-decor-open"
      >
        <Palette aria-hidden />
      </Button>
      {open && state ? (
        <DocxPageDecorDialog
          open
          onOpenChange={setOpen}
          state={state}
          readOnly={readOnly}
          onApply={(edits) => {
            if (commands?.applyDocxPageDecor(edits)) setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
