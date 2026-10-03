"use client";

import dynamic from "next/dynamic";
import { useTranslation } from "react-i18next";
import type { OfficeEditorHostProps } from "./editor-host";

function LoadingEditor() {
  const { t } = useTranslation();
  return <div role="status" className="p-4 text-body text-muted-foreground">{t("office.editor.loading")}</div>;
}

const DocxHost = dynamic(() => import("./docx-office-host").then((module) => module.DocxOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const XlsxHost = dynamic(() => import("./xlsx-office-host").then((module) => module.XlsxOfficeEditorHost), { ssr: false, loading: LoadingEditor });
const PptxHost = dynamic(() => import("./pptx-office-host").then((module) => module.PptxOfficeEditorHost), { ssr: false, loading: LoadingEditor });

export function DocumentOfficeEditorHost(props: OfficeEditorHostProps) {
  const file = props.document.file;
  const docx = file?.mime_type.toLowerCase().includes("wordprocessingml.document") || file?.filename.toLowerCase().endsWith(".docx");
  // UNI-927 P0-1: .pptx has its own browser host; it must stop falling
  // through to the XLSX host the way every non-docx file did.
  const pptx = file?.mime_type.toLowerCase().includes("presentationml.presentation") || file?.filename.toLowerCase().endsWith(".pptx");
  if (docx) return <DocxHost {...props} />;
  if (pptx) return <PptxHost {...props} />;
  return <XlsxHost {...props} />;
}
