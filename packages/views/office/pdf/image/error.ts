import type { TFunction } from "i18next";

/** Keep host/provider failures inside the PDF image surface and localize them. */
export function pdfImageErrorMessage(error: unknown, t: TFunction): string {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const signal = `${typeof record.code === "string" ? record.code : ""} ${typeof record.reason === "string" ? record.reason : ""}`.toLowerCase();
    if (signal.includes("asset") || signal.includes("image") || signal.includes("bytes")) return t("office.pdf.image.errors.asset", { defaultValue: "The image could not be read." });
  }
  return t("office.pdf.errors.editFailed");
}
