// G3-05c (UNI-824) - the `./i18n/locale` seam for the vendored genoffice
// sheets renderer. Same import surface the vendored modules call (`t`,
// `getLang`, `setModuleLang`, `StringKey`, `TFunc`, `DATE_LOCALES`); it
// delegates to the host i18next under `office.xlsx.editor.*` instead of
// vendoring genoffice's own i18n runtime (the g3-04c 3d pattern).
import i18next from "i18next";

export type StringKey = string;
export type TFunc = (key: string, params?: Record<string, unknown>) => string;

export const DATE_LOCALES = { en: "en-US", vi: "vi-VN" } as const;

export function getLang(): "en" | "vi" {
  return i18next.language?.toLowerCase().startsWith("vi") ? "vi" : "en";
}

export function setModuleLang(_lang: "en" | "vi" | string): void {
  // The host owns the i18next language; the renderer reads it through `t`.
}

export const t: TFunc = (key, params) => {
  const full = key.startsWith("office.xlsx.editor.") ? key : `office.xlsx.editor.${key}`;
  const translated = i18next.t(full, params as never);
  return translated && translated !== full ? translated : key;
};
