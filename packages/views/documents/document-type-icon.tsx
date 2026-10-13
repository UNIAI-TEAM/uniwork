"use client";

import { File, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { FileTypeMark, isFileMarkFormat } from "./file-type-marks";

export type DocumentIconFormat = "docx" | "xlsx" | "pptx" | "pdf" | "md" | "html" | "page" | "folder" | "file";

/** The lowercase extension of a file name, or "" when it has none. */
export function fileExtension(name: string | null | undefined): string {
  const dot = name?.lastIndexOf(".") ?? -1;
  return dot > 0 && name ? name.slice(dot + 1).toLowerCase() : "";
}

/** What a library row draws: pages and folders by kind, files by extension. */
export function documentIconFormat(kind: string, title: string): string {
  if (kind === "page" || kind === "folder") return kind;
  return fileExtension(title) || "file";
}

/**
 * The file-type mark shared by create cards, library rows, chips and the tree.
 * Office formats and pages use the UniWork Office marks; a folder and any
 * other file use the line icon in the current text colour.
 */
export function DocumentTypeIcon({
  format,
  className,
  decorative = false,
}: {
  format?: string | null;
  className?: string;
  /** Beside text that already names the type (a create card or menu item): hidden from assistive tech. */
  decorative?: boolean;
}) {
  const { t } = useTranslation();
  const normalized = format?.toLowerCase() ?? "file";
  const label = labelFor(normalized, t);
  if (isFileMarkFormat(normalized)) {
    return (
      <span {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })} className={cn("inline-flex shrink-0", className)}>
        <FileTypeMark format={normalized} className="size-full" />
      </span>
    );
  }
  const Icon = normalized === "folder" ? Folder : File;
  return decorative ? <Icon className={className} aria-hidden /> : <Icon className={className} aria-label={label} role="img" />;
}

function labelFor(format: string, t: (key: string) => string): string {
  switch (format) {
    case "docx":
      return t("documents.file_types.docx");
    case "xlsx":
      return t("documents.file_types.xlsx");
    case "pptx":
      return t("documents.file_types.pptx");
    case "pdf":
      return t("documents.file_types.pdf");
    case "md":
      return t("documents.file_types.md");
    case "html":
      return t("documents.file_types.html");
    case "page":
      return t("documents.file_types.page");
    case "folder":
      return t("documents.file_types.folder");
    default:
      return t("documents.file_types.file");
  }
}
