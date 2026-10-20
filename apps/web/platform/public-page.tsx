import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { SupportedLocale } from "@uniwork/core/i18n/types";
import { marketingRoute } from "@uniwork/core/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { MarketingCopyProvider } from "./marketing-context";
import { loadMarketingDictionary } from "./marketing-dictionary";
import { pageStructuredData, serializeStructuredData } from "./seo";

/** Resolve only a catalogued public page; application routes never enter this renderer. */
export async function publicPage(path: string, locale: SupportedLocale = "en") {
  const route = marketingRoute(path);
  if (!route) notFound();
  const dictionaryPromise = loadMarketingDictionary(locale, path);
  let body: ReactNode;
  if (path === "/") { const { LandingPage } = await import("../features/landing/landing-page"); body = <LandingPage />; }
  else if (path === "/apps") { const { AppsPage } = await import("../features/landing/apps/apps-page"); body = <AppsPage />; }
  else if (path === "/apps/office") { const { OfficePage } = await import("../features/landing/office-page"); body = <OfficePage />; }
  else if (path === "/apps/unichat") { const { UniChatPage } = await import("../features/landing/unichat-page"); body = <UniChatPage />; }
  else if (path === "/features") { const { FeaturesPage } = await import("../features/landing/feature-page"); body = <FeaturesPage />; }
  else if (path.startsWith("/features/")) {
    const { FeaturePage } = await import("../features/landing/feature-page");
    const { isFeaturePageKey } = await import("../features/landing/feature-page-catalog");
    if (!isFeaturePageKey(route.key)) notFound();
    body = <FeaturePage featureKey={route.key} />;
  } else if (path === "/solutions/product" || path === "/solutions/operations") {
    const { SolutionPage } = await import("../features/landing/solution-page"); body = <SolutionPage solution={path.endsWith("/product") ? "product" : "operations"} />;
  } else if (path === "/why-uniwork") { const { WhyPage } = await import("../features/landing/why-page"); body = <WhyPage />; }
  else if (path === "/changelog") { const { ChangelogPage } = await import("../features/landing/changelog/page"); body = <ChangelogPage />; }
  else if (path === "/request-demo") { const { RequestDemoPage } = await import("../features/landing/request-demo-page"); body = <RequestDemoPage />; }
  else if (["/solutions", "/learn", "/pricing", "/enterprise"].includes(path)) {
    const pages = await import("../features/landing/marketing-overview-pages");
    const Component = path === "/solutions" ? pages.SolutionsPage : path === "/learn" ? pages.LearnPage : path === "/pricing" ? pages.PricingPage : pages.EnterprisePage;
    body = <Component />;
  } else { const { GuidePage } = await import("../features/landing/guide-page"); body = <GuidePage contentKey={route.key} locale={locale} />; }
  const dictionary = await dictionaryPromise;
  return <MarketingCopyProvider locale={locale} dictionary={dictionary}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(pageStructuredData(path, locale, runtimeConfig().appUrl)) }} />{body}</MarketingCopyProvider>;
}
