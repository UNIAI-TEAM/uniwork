import type { Metadata } from "next";
import { loadDictionary, type SupportedLocale } from "@uniwork/core/i18n/server";
import { paths } from "@uniwork/core/paths";
import type { FeaturePageKey } from "../features/landing/feature-page-catalog";
import { resolveRequestLocale } from "./locale-server";

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
async function landingCopy(): Promise<LandingDictionary["landing"]> {
  const locale: SupportedLocale = await resolveRequestLocale();
  const dictionary = (await loadDictionary(locale)) as LandingDictionary;
  return dictionary.landing;
}

function page(copy: Copy, canonical: string): Metadata {
  return { title: copy.title, description: copy.description, alternates: { canonical }, openGraph: { title: copy.title, description: copy.description, url: canonical } };
}

export async function featureMetadata(key: FeaturePageKey): Promise<Metadata> {
  return page((await landingCopy()).productPages.features[key], paths.feature(key));
}

export async function marketingMetadata(key: MarketingPageKey, canonical: string): Promise<Metadata> {
  return page((await landingCopy()).meta[key], canonical);
}

export async function solutionMetadata(key: "product" | "operations"): Promise<Metadata> {
  const copy = (await landingCopy()).solutions[key];
  return page({ title: copy.metaTitle, description: copy.metaDesc }, `/solutions/${key}`);
}

export async function whyMetadata(): Promise<Metadata> {
  const copy = (await landingCopy()).why;
  return page({ title: copy.metaTitle, description: copy.metaDesc }, "/why-uniwork");
}
