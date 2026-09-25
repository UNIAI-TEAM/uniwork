import type { SupportedLocale } from "./types";

/**
 * The dictionaries, with no React in the import graph.
 *
 * This is a separate module from `./index` for the same reason `./server.ts`
 * is: `./index` pulls in react-i18next, and Next refuses to evaluate that in a
 * server component. Server-rendered metadata reads the request locale's copy
 * from here; every locale is a dynamic import so none of them lands in a
 * client chunk through this module.
 */
const loaders: Record<SupportedLocale, () => Promise<{ default: object }>> = {
  en: () => import("./locales/en.json"),
  vi: () => import("./locales/vi.json"),
};

/** A locale's dictionary, without touching any shared i18next instance. */
export async function loadDictionary(locale: SupportedLocale): Promise<Record<string, unknown>> {
  const load = loaders[locale] ?? loaders.en;
  return (await load()).default as Record<string, unknown>;
}
