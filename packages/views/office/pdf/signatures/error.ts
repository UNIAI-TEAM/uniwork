import type { useTranslation } from "react-i18next";
import { formatSignatureByteCap, MAX_SAVED_SIGNATURE_BYTES, PdfSignatureFileError } from "./image-file";

type Translate = ReturnType<typeof useTranslation>["t"];

/** Keep local file-validation failures and endpoint failures inside the
 *  signature surface and localize each one. Every branch names what did not
 *  happen; nothing is thrown at the user. */
export function pdfSignatureErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof PdfSignatureFileError) {
    switch (error.code) {
      case "file_type":
        return t("office.pdf.signatures.errors.fileType");
      case "file_too_large":
        return t("office.pdf.signatures.errors.fileTooLarge", { limit: formatSignatureByteCap(MAX_SAVED_SIGNATURE_BYTES) });
      case "image_mismatch":
        return t("office.pdf.signatures.errors.imageMismatch");
      case "file_unreadable":
      default:
        return t("office.pdf.signatures.errors.fileUnreadable");
    }
  }
  if (error && typeof error === "object") {
    const code = (error as Record<string, unknown>).code;
    const status = (error as Record<string, unknown>).status;
    if (code === "invalid_request" || status === 400) return t("office.pdf.signatures.errors.rejected");
    if (status === 403 || code === "forbidden") return t("office.pdf.signatures.errors.forbidden");
    if (status === 404 || code === "not_found") return t("office.pdf.signatures.errors.gone");
  }
  return t("office.pdf.signatures.errors.save");
}
