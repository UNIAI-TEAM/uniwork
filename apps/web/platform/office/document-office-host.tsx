"use client";

import dynamic from "next/dynamic";
import { useTranslation } from "react-i18next";
import "@uniwork/core/i18n/office-resources";
import type { OfficeEditorHostProps } from "./editor-host";

function LoadingEditor() {
  const { t } = useTranslation();
  return <div role="status" className="p-4 text-body text-muted-foreground">{t("office.editor.loading")}</div>;
}

const DocxHost = dynamic(() => import("./docx-office-host").then((module) => module.DocxOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const PdfHost = dynamic(() => import("./pdf-office-host").then((module) => module.PdfOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const XlsxHost = dynamic(() => import("./xlsx-office-host").then((module) => module.XlsxOfficeEditorHost), { ssr: false, loading: LoadingEditor });

export function DocumentOfficeEditorHost(props: OfficeEditorHostProps) {
  const file = props.document.file;
  const pdf = file?.mime_type.toLowerCase().includes("application/pdf") || file?.filename.toLowerCase().endsWith(".pdf");
  if (pdf) return <PdfHost {...props} />;
  const docx = file?.mime_type.toLowerCase().includes("wordprocessingml.document") || file?.filename.toLowerCase().endsWith(".docx");
  return docx ? <DocxHost {...props} /> : <XlsxHost {...props} />;
}
