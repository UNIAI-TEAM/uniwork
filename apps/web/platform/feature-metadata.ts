import type { Metadata } from "next";
import { loadDictionary, type SupportedLocale } from "@uniwork/core/i18n/server";
import { paths } from "@uniwork/core/paths";
import type { FeaturePageKey } from "../features/landing/feature-page-catalog";
import { resolveRequestLocale } from "./locale-server";
import { shareMetadata } from "./share-metadata";

type Copy = { title: string; description: string };
type LandingDictionary = {
  landing: {
    meta: Record<MarketingPageKey, Copy>;
    productPages: { features: Record<FeaturePageKey, Copy> };
    solutions: Record<"product" | "operations", { metaTitle: string; metaDesc: string }>;
    why: { metaTitle: string; metaDesc: string };
  };
};

type MarketingPageKey = "home" | "features" | "solutions" | "learn" | "pricing" | "enterprise"; // plan-literal-ok: page keys

/**
 * The public pages switch language with the visitor, so the tab title and
 * search snippet follow the same request locale the page renders in; a
 * Vietnamese title above an English page reads as a broken translation.
 */
async function landingCopy(): Promise<{ copy: LandingDictionary["landing"]; locale: SupportedLocale }> {
  const locale: SupportedLocale = await resolveRequestLocale();
  const dictionary = (await loadDictionary(locale)) as LandingDictionary;
  return { copy: dictionary.landing, locale };
}

async function page(pick: (copy: LandingDictionary["landing"]) => Copy, canonical: string): Promise<Metadata> {
  const { copy, locale } = await landingCopy();
  const { title, description } = pick(copy);
  return shareMetadata({ title, description, url: canonical, locale });
}

export function featureMetadata(key: FeaturePageKey): Promise<Metadata> {
  return page((c) => c.productPages.features[key], paths.feature(key));
}

export function marketingMetadata(key: MarketingPageKey, canonical: string): Promise<Metadata> {
  return page((c) => c.meta[key], canonical);
}

export function solutionMetadata(key: "product" | "operations"): Promise<Metadata> {
  return page(
    (c) => ({ title: c.solutions[key].metaTitle, description: c.solutions[key].metaDesc }),
    `/solutions/${key}`,
  );
}

export function whyMetadata(): Promise<Metadata> {
  return page((c) => ({ title: c.why.metaTitle, description: c.why.metaDesc }), "/why-uniwork");
}
