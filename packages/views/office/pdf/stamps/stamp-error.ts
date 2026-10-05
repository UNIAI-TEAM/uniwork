import type { useTranslation } from "react-i18next";
import { PdfStampProviderError } from "./provider";
import { PdfStampImageError } from "./stamp-image";

type Translate = ReturnType<typeof useTranslation>["t"];

/** One sentence per failure kind, so a stamp that could not be placed says what
 *  happened instead of leaking the host's error text into the panel. */
export function pdfStampErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof PdfStampImageError) {
    switch (error.code) {
      case "file_type":
        return t("office.pdf.stamps.errors.fileType");
      case "file_too_large":
        return t("office.pdf.stamps.errors.fileTooLarge");
      case "file_unreadable":
      default:
        return t("office.pdf.stamps.errors.fileUnreadable");
    }
  }
  if (error instanceof PdfStampProviderError) {
    if (error.code === "unsupported_operation") return t("office.pdf.stamps.errors.unsupported");
    return t("office.pdf.stamps.errors.invalidPlacement");
  }
  if (error && typeof error === "object" && (error as Record<string, unknown>).code === "unsupported_operation") {
    return t("office.pdf.stamps.errors.unsupported");
  }
  return t("office.pdf.stamps.errors.place");
}
