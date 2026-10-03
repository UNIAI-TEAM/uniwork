"use client";

// C1 (UNI-924): the toolbar entry for print/export. One dropdown owns the
// three document outputs: Print (browser dialog on the paginated surface),
// Export HTML (standalone file through a Blob) and Export PDF (honest
// guidance dialog — no docx->pdf engine op is bound, see worker-C1 report).
// The group is disabled until the command runtime reports an open document.

import { FileDown, FileOutput, FileText, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { DocxExportPdfDialog } from "./docx-export-pdf-dialog";
import { installDocxPrintStyles } from "./docx-print";

export function DocxExportGroup({ commands, format }: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [pdfOpen, setPdfOpen] = useState(false);
  const ready = commands?.docxExportReady ?? format?.docxExportReady ?? false;
  const disabled = !commands || !ready;

  // Installing here (the group mounts with the ready toolbar) also arms the
  // beforeprint hook, so a native Ctrl+P prints the document alone.
  useEffect(() => {
    installDocxPrintStyles();
  }, []);

  const print = () => {
    commands?.printDocx();
  };

  const exportHtml = () => {
    commands?.downloadDocxHtml(t("office.docx.export.fileName"), t("office.docx.export.documentTitle"));
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="toolbar"
              size="icon-sm"
              disabled={disabled}
              aria-label={t("office.docx.export.menuLabel")}
              aria-haspopup="menu"
              data-testid="docx-export-menu"
            />
          }
        >
          <FileOutput aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem data-testid="docx-export-print" onClick={print}>
            <Printer aria-hidden />
            {t("office.docx.export.print")}
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="docx-export-html" onClick={exportHtml}>
            <FileDown aria-hidden />
            {t("office.docx.export.html")}
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="docx-export-pdf" onClick={() => setPdfOpen(true)}>
            <FileText aria-hidden />
            {t("office.docx.export.pdf.label")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {pdfOpen ? (
        <DocxExportPdfDialog
          open
          onOpenChange={setPdfOpen}
          onPrint={() => {
            setPdfOpen(false);
            print();
          }}
        />
      ) : null}
    </>
  );
}
