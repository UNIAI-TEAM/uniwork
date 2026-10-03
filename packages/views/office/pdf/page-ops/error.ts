import type { useTranslation } from "react-i18next";

/** Keep page-op failures inside the PDF surface and localize them. */
export function pdfPageOpsErrorMessage(error: unknown, t: ReturnType<typeof useTranslation>["t"]): string {
  if (error && typeof error === "object") {
    const code = typeof (error as Record<string, unknown>).code === "string" ? ((error as Record<string, unknown>).code as string) : "";
    if (code === "asset_provider_missing" || code === "asset_unavailable") return t("office.pdf.pageOps.errors.asset");
    if (code === "commit_failed") return t("office.pdf.pageOps.errors.commit");
    if (code === "invalid_input") return t("office.pdf.pageOps.errors.input");
  }
  return t("office.pdf.pageOps.errors.failed");
}
