import type { useTranslation } from "react-i18next";

/** Keep host/provider failures inside the PDF image surface and localize them. */
export function pdfImageErrorMessage(error: unknown, t: ReturnType<typeof useTranslation>["t"]): string {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : "";
    if (code === "object_unavailable") return t("office.pdf.errors.objectUnavailable");
    const signal = `${code} ${typeof record.reason === "string" ? record.reason : ""}`.toLowerCase();
    if (signal.includes("asset") || signal.includes("image") || signal.includes("bytes")) return t("office.pdf.image.errors.asset");
  }
  return t("office.pdf.errors.editFailed");
}
