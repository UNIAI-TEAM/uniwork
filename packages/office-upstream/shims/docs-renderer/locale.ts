import i18next from "i18next";

export type StringKey = string;
export const DATE_LOCALES = { en: "en-US", vi: "vi-VN" } as const;
export function getLang(): "en" | "vi" {
  return i18next.language?.toLowerCase().startsWith("vi") ? "vi" : "en";
}
export function t(key: string, options?: Record<string, unknown>): string {
  const full = key.startsWith("office.docx.editor.") ? key : `office.docx.editor.${key}`;
  return i18next.t(full, options as never) || key;
}
