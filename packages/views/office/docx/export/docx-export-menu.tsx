"use client";

// C1 (UNI-924): the toolbar entry for print/export. W-H adds a typed ribbon
// dropdown: Print (browser dialog on the paginated surface), Export HTML
// (standalone file through a Blob) and Export PDF (honest guidance dialog - no
// docx->pdf engine op is bound, see worker-C1 report). The same commands the
// old dropdown ran. The group is disabled until the command runtime reports an
// open document. A zero-width host item keeps this component (which mounts the
// PDF dialog) registered with the fold-proof `RibbonDialogHosts`.

import { FileDown, FileOutput, FileText, Printer } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { useEffect } from "react";
import { getI18n, useTranslation } from "react-i18next";
import type { RibbonItem } from "../../ribbon";
import { scopedRibbonOpenStore, registerRibbonDialogHost, ribbonHostItem, useRibbonOpen } from "../toolbar/groups/ribbon-open-store";
import { docxScopeOf, useDocxDocumentScope } from "../editor-store";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { DocxExportPdfDialog } from "./docx-export-pdf-dialog";
import { installDocxPrintStyles } from "./docx-print";

/** Shared open state of the PDF guidance dialog. */
const pdfDialogFor = scopedRibbonOpenStore();

/** The typed ribbon items for the View > export group. */
export function docxExportRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  const pdfDialog = pdfDialogFor(docxScopeOf(context));
  const { commands, format } = context;
  const { t } = getI18n();
  const disabled = !commands || !(format?.docxExportReady ?? false);
  return [
    {
      kind: "dropdown",
      id: "export",
      labelKey: "office.docx.export.menuLabel",
      icon: FileOutput,
      size: "large",
      collapseAs: "small",
      disabled,
      menu: [
        {
          id: "export-print",
          labelKey: "office.docx.export.print",
          icon: Printer,
          disabled,
          onSelect: () => {
            commands?.printDocx();
          },
        },
        {
          id: "export-html",
          labelKey: "office.docx.export.html",
          icon: FileDown,
          disabled,
          onSelect: () => {
            // `downloadDocxHtml` takes literal strings, not keys: the legacy
            // path passed `t(...)` and the typed path must do the same.
            commands?.downloadDocxHtml(t("office.docx.export.fileName"), t("office.docx.export.documentTitle"));
          },
        },
        {
          id: "export-pdf",
          labelKey: "office.docx.export.pdf.label",
          icon: FileText,
          disabled,
          onSelect: () => pdfDialog.open(),
        },
      ],
    },
    ribbonHostItem("export-host", "office.docx.toolbar.groups.export"),
  ];
}

/** View > export: the typed items live on the registry entry; this component
 * keeps the PDF dialog mount and stays exported for direct use. */
export function DocxExportGroup({ commands, format }: DocxToolbarGroupContext) {
  const scope = useDocxDocumentScope();
  const pdfDialog = pdfDialogFor(scope);
  const { t } = useTranslation();
  const [pdfOpen] = useRibbonOpen(pdfDialog);
  const disabled = !commands || !(format?.docxExportReady ?? false);

  // Installing here (the group mounts with the ready toolbar) also arms the
  // beforeprint hook, so a native Ctrl+P prints the document alone.
  useEffect(() => {
    installDocxPrintStyles();
  }, []);

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
              tabIndex={-1}
              aria-hidden
              className="sr-only"
              data-testid="docx-export-menu"
            />
          }
        >
          <FileOutput aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            data-testid="docx-export-print"
            onClick={() => {
              commands?.printDocx();
            }}
          >
            <Printer aria-hidden />
            {t("office.docx.export.print")}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="docx-export-html"
            onClick={() => {
              commands?.downloadDocxHtml(t("office.docx.export.fileName"), t("office.docx.export.documentTitle"));
            }}
          >
            <FileDown aria-hidden />
            {t("office.docx.export.html")}
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="docx-export-pdf" onClick={() => pdfDialog.open()}>
            <FileText aria-hidden />
            {t("office.docx.export.pdf.label")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {pdfOpen ? (
        <DocxExportPdfDialog
          open
          onOpenChange={pdfDialog.set}
          onPrint={() => {
            pdfDialog.close();
            commands?.printDocx();
          }}
        />
      ) : null}
    </>
  );
}

registerRibbonDialogHost("export-host", DocxExportGroup);
