import type { Metadata, MetadataRoute } from "next";
import type { SupportedLocale } from "@uniwork/core/i18n/types";
import { MARKETING_ROUTES, marketingHref, marketingRoute } from "@uniwork/core/paths";
import { shareMetadata } from "./share-metadata";
import { seoCopy } from "./seo-copy";
import { siteInformation } from "./site-information";

export const PRODUCTION_ORIGIN = "https://uniworkos.com";
export function isSearchProduction(origin: string): boolean {
  return origin.replace(/\/$/, "") === PRODUCTION_ORIGIN;
}

export function seoMetadata(path: string, locale: SupportedLocale = "en"): Metadata {
  const route = marketingRoute(path);
  if (!route) throw new Error(`Unknown public route: ${path}`);
  const copy = seoCopy(route.key, locale);
  return {
    ...shareMetadata({ ...copy, url: marketingHref(route.path, locale), locale }),
    ...(copy.title.includes("UniWork") ? { title: { absolute: copy.title } } : {}),
    robots: { index: true, follow: true },
    alternates: { canonical: marketingHref(route.path, locale), languages: { en: route.path, vi: marketingHref(route.path, "vi"), "x-default": route.path } },
  };
}

export function sitemapEntries(origin: string): MetadataRoute.Sitemap {
  if (!isSearchProduction(origin)) return [];
  return MARKETING_ROUTES.flatMap(route => (["en", "vi"] as const).map(locale => ({
    url: new URL(marketingHref(route.path, locale), origin).href,
    alternates: { languages: { en: new URL(route.path, origin).href, vi: new URL(marketingHref(route.path, "vi"), origin).href, "x-default": new URL(route.path, origin).href } },
  })));
}

export function robotsPolicy(origin: string): MetadataRoute.Robots {
  return isSearchProduction(origin)
    ? { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/oauth/", "/mcp"] }, sitemap: `${PRODUCTION_ORIGIN}/sitemap.xml` }
    : { rules: { userAgent: "*", disallow: "/" } };
}

export function serializeStructuredData(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function pageStructuredData(path: string, locale: SupportedLocale, origin: string) {
  const route = marketingRoute(path);
  if (!route) return null;
  const copy = seoCopy(route.key, locale);
  const absolute = (href: string) => new URL(marketingHref(href, locale), origin).href;
  const organizationId = `${origin}/#organization`;
  const websiteId = `${origin}/#website`;
  const parent = path.startsWith("/features/") ? "/features" : path.startsWith("/learn/") ? "/learn" : path.startsWith("/solutions/") ? "/solutions" : path.startsWith("/apps/") ? "/apps" : null;
  const crumbs = [{ name: "UniWork", item: absolute("/") }, ...(parent ? [{ name: seoCopy(marketingRoute(parent)!.key, locale).title, item: absolute(parent) }] : []), ...(path !== "/" ? [{ name: copy.title, item: absolute(path) }] : [])];
  const graph: Record<string, unknown>[] = [
    { "@type": "Organization", "@id": organizationId, name: siteInformation.name, url: origin, logo: `${origin}/icon.svg`, ...(siteInformation.legalName ? { legalName: siteInformation.legalName } : {}), ...(siteInformation.supportEmail ? { email: siteInformation.supportEmail } : {}) },
    { "@type": "WebSite", "@id": websiteId, name: "UniWork", url: origin, inLanguage: ["en", "vi"], publisher: { "@id": organizationId } },
    { "@type": "WebPage", "@id": `${absolute(path)}#webpage`, url: absolute(path), name: copy.title, description: copy.description, inLanguage: locale, isPartOf: { "@id": websiteId } },
    { "@type": "BreadcrumbList", itemListElement: crumbs.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, ...crumb })) },
  ];
  const app = path === "/apps/office" ? { name: "UniOffice", operatingSystem: "Windows, macOS, Linux" } : path === "/apps/unichat" ? { name: "UniChat", operatingSystem: "Windows, macOS, Linux, iOS, Android" } : null;
  if (app) graph.push({ "@type": "SoftwareApplication", ...app, url: absolute(path), applicationCategory: "BusinessApplication", description: copy.description, publisher: { "@id": organizationId } });
  return { "@context": "https://schema.org", "@graph": graph };
}
