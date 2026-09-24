import type { Metadata } from "next";
import { bundledDictionary } from "@uniwork/core/i18n/server";
import { paths } from "@uniwork/core/paths";
import type { FeaturePageKey } from "../features/landing/feature-page-catalog";

/** Source-language metadata, matching the established public-page convention. */
export function featureMetadata(key: FeaturePageKey): Metadata {
  const dictionary = bundledDictionary("vi") as { landing: { productPages: { features: Record<FeaturePageKey, { title: string; description: string }> } } };
  const copy = dictionary.landing.productPages.features[key];
  return { title: copy.title, description: copy.description, alternates: { canonical: paths.feature(key) }, openGraph: { title: copy.title, description: copy.description, url: paths.feature(key) } };
}
