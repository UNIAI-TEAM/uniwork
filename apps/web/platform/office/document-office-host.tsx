"use client";

import dynamic from "next/dynamic";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { detectDocumentFormat, type OfficeEditorHostProps } from "./editor-host";
import { useOfficeTabTitle } from "./tab-title";

// The document page's one host entry. It routes by FORMAT, never by
// elimination: a document whose format no host can open gets a typed
// unsupported state instead of being handed to a host that would silently
// open it as something else (the previous xlsx fallback).

function LoadingEditor() {
  const { t } = useTranslation();
  return <div role="status" className="p-4 text-body text-muted-foreground">{t("office.editor.loading")}</div>;
}

const DocxHost = dynamic(() => import("./docx-office-host").then((module) => module.DocxOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const PdfHost = dynamic(() => import("./pdf-office-host").then((module) => module.PdfOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const XlsxHost = dynamic(() => import("./xlsx-office-host").then((module) => module.XlsxOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const MarkdownHost = dynamic(() => import("./md-html-adapter").then((module) => module.MarkdownOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const HtmlHost = dynamic(() => import("./md-html-adapter").then((module) => module.HtmlOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const PptxHost = dynamic(() => import("./pptx-office-host").then((module) => module.PptxOfficeEditorHost), { ssr: false, loading: LoadingEditor });

/** A format this host build has no editor for. Typed, never a silent fallback. */
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
  const format = detectDocumentFormat(props.document);
  if (format === "pdf") return <PdfHost {...props} />;
  if (format === "docx") return <DocxHost {...props} />;
  if (format === "xlsx") return <XlsxHost {...props} />;
  if (format === "md") return <MarkdownHost {...props} />;
  if (format === "html") return <HtmlHost {...props} />;
  // UNI-927 P0-1: .pptx has its own browser host.
  if (format === "pptx") return <PptxHost {...props} />;
  // The conversion-only sources (xls, odt) have no web editor yet.
  // Say so; do not route them to a host for a different format.
  return <UnsupportedHost format={format === "unknown" ? props.document.file?.filename ?? "unknown" : format} title={props.document.title} />;
}
