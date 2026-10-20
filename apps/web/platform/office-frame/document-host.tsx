"use client";

import dynamic from "next/dynamic";
import { useTranslation } from "react-i18next";
import { useOfficeTxtOpenEnabled } from "@uniwork/core/documents/office-enabled";
import type { Document } from "@uniwork/core/types/document";
import { officeModuleForFormat } from "@uniwork/core/office/office-modules";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import type { OfficeEditorHostProps } from "./module-frame-host";
import { useOfficeTabTitle } from "./tab-title";

// The document page's one Office host entry: every format a genoffice module
// opens goes to its frame (UNI-1013 Docs, UNI-1014/1015/1016 the other
// modules). It routes by FORMAT, never by elimination: a document whose format
// no module opens gets a typed unsupported state instead of being handed to a
// module that would open it as something else.

function LoadingEditor() {
  const { t } = useTranslation();
  return <div role="status" className="p-4 text-body text-muted-foreground">{t("office.editor.loading")}</div>;
}

const OfficeModuleHost = dynamic(() => import("./module-frame-host").then((module) => module.OfficeModuleHost), { ssr: false, loading: LoadingEditor });

/**
 * The format a document's file is, or `"unknown"` when nothing about it
 * identifies one. The server detects the conversion sources (xls, odt) too
 * (server/internal/service/document_office_capability.go) and never edits them
 * in place, so they are named here and get the unsupported state.
 */
export function detectDocumentFormat(document: Document, txtOpen = false): string {
  const filename = document.file?.filename.toLowerCase() ?? "";
  const mime = document.file?.mime_type.toLowerCase() ?? "";
  if (mime.includes("wordprocessingml.document") || filename.endsWith(".docx")) return "docx";
  if (mime.includes("spreadsheetml.sheet") || filename.endsWith(".xlsx")) return "xlsx";
  if (mime.includes("presentationml.presentation") || filename.endsWith(".pptx")) return "pptx";
  if (mime === "application/pdf" || filename.endsWith(".pdf")) return "pdf";
  if (mime === "text/markdown" || filename.endsWith(".md") || filename.endsWith(".markdown")) return "md";
  // UNI-1813: .txt opens in the markdown module only while office_txt_open is
  // on for the document's own organization. By extension only: a bare text/plain
  // file never maps, flag on or off.
  if (txtOpen && filename.endsWith(".txt")) return "md";
  if (mime === "text/html" || filename.endsWith(".html") || filename.endsWith(".htm")) return "html";
  if (mime === "application/vnd.ms-excel" || filename.endsWith(".xls")) return "xls";
  if (mime === "application/vnd.oasis.opendocument.text" || filename.endsWith(".odt")) return "odt";
  return "unknown";
}

/** A format no module opens. Typed, never a silent fallback. */
function UnsupportedHost({ format, title }: { format: string; title: string }) {
  const { t } = useTranslation();
  return (
    <div className="p-4" data-office-editor-host data-office-unsupported={format}>
      <Alert variant="destructive" role="alert" data-testid="office-host-unsupported">
        <AlertTitle>{t("office.editor.capability_unavailable")}</AlertTitle>
        <AlertDescription>{t("office.editor.editor_pending", { format })} {title}</AlertDescription>
      </Alert>
    </div>
  );
}

export function DocumentOfficeEditorHost(props: OfficeEditorHostProps) {
  useOfficeTabTitle(props.document.title);
  // The page's gate passes its resolved format so a .txt editor held open by
  // the leave guards keeps the markdown module even after office_txt_open has
  // settled off; a host mounted without a gate detects from the live answer.
  const txtState = useOfficeTxtOpenEnabled(props.document.organization_id);
  const format = props.officeFormat ?? detectDocumentFormat(props.document, txtState === "on");
  const officeModule = officeModuleForFormat(format);
  if (officeModule) return <OfficeModuleHost {...props} module={officeModule} />;
  return <UnsupportedHost format={format === "unknown" ? props.document.file?.filename ?? "unknown" : format} title={props.document.title} />;
}
