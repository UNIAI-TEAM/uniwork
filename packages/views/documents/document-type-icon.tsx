"use client";

import { File, FileCodeCorner, FileSpreadsheet, FileText, FileTypeCorner, Presentation } from "lucide-react";
import { useTranslation } from "react-i18next";

export type DocumentIconFormat = "docx" | "xlsx" | "pptx" | "pdf" | "md" | "html" | "file";

export function DocumentTypeIcon({ format, className }: { format?: string | null; className?: string }) {
  const { t } = useTranslation();
  const normalized = format?.toLowerCase();
  const Icon = normalized === "docx" ? FileText : normalized === "xlsx" ? FileSpreadsheet : normalized === "pptx" ? Presentation : normalized === "md" || normalized === "html" ? FileCodeCorner : normalized === "pdf" ? FileTypeCorner : File;
  const label = normalized === "docx" ? t("documents.file_types.docx") : normalized === "xlsx" ? t("documents.file_types.xlsx") : normalized === "pptx" ? t("documents.file_types.pptx") : normalized === "pdf" ? t("documents.file_types.pdf") : normalized === "md" ? t("documents.file_types.md") : normalized === "html" ? t("documents.file_types.html") : t("documents.file_types.file");
  return <Icon className={className} aria-label={label} role="img" />;
}
