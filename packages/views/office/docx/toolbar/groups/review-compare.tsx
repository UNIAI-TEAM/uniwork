"use client";

// C2 (UNI-924): Review ▸ Compare. The toolbar entry owns the dialog's open
// state; the dialog reads the live document through the command runtime and
// parses the picked file off-session, so nothing here touches the save path.
// Comparison stays available on a read-only document — it only reads.
import { GitCompareArrows } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { DocxCompareDialog } from "../../compare/compare-dialog";
import type { DocxToolbarGroupContext } from "../types";

export function ReviewCompareGroup({ format, commands }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ready = format?.docxCompareReady === true;

  return (
    <>
      <Button
        type="button"
        variant="toolbar"
        size="icon-sm"
        aria-label={t("office.docx.compare.action")}
        aria-haspopup="dialog"
        disabled={!ready}
        onClick={() => setOpen(true)}
        data-testid="docx-compare-toggle"
      >
        <GitCompareArrows aria-hidden />
      </Button>
      {open && ready ? (
        <DocxCompareDialog open onOpenChange={setOpen} currentTexts={() => commands?.compareDocumentTexts() ?? []} />
      ) : null}
    </>
  );
}
