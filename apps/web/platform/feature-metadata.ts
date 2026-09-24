import type { Metadata } from "next";
import { bundledDictionary, loadDictionary } from "@uniwork/core/i18n/server";
import { paths } from "@uniwork/core/paths";
import { featureCopyPrefix, type FeaturePageKey } from "../features/landing/feature-page-catalog";
import { resolveRequestLocale } from "./locale-server";

/** Match server-rendered copy to the request locale, including English previews. */
async function localizedCopy(prefix: string): Promise<Record<string, string>> {
  const locale = await resolveRequestLocale();
  const dictionary = bundledDictionary(locale) ?? await loadDictionary(locale);
  let value: unknown = dictionary;
  for (const part of prefix.split(".")) value = (value as Record<string, unknown>)[part];
  return value as Record<string, string>;
}

export async function featureMetadata(key: FeaturePageKey): Promise<Metadata> {
  const copy = await localizedCopy(featureCopyPrefix(key));
  return { title: copy.title, description: copy.description, alternates: { canonical: paths.feature(key) }, openGraph: { title: copy.title, description: copy.description, url: paths.feature(key) } };
}

export async function marketingMetadata(key: "home" | "directory" | "learn" | "pricing" | "enterprise" | "solutions", canonical: string): Promise<Metadata> {
  const copy = await localizedCopy("landing.productPages");
  const home = key === "home" ? await localizedCopy("landing.studio") : null;
  const title = home ? "UniWork — " + home.heroLine1 : copy[`${key}Title`];
  const description = home ? home.heroDescription : copy[`${key}Description`];
  return { title, description, alternates: { canonical }, openGraph: { title, description, url: canonical } };
}
