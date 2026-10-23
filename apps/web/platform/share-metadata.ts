import type { Metadata } from "next";
import type { SupportedLocale } from "@uniwork/core/i18n/server";
import { OG_IMAGES } from "./og-image.generated";

export const SITE_NAME = "UniWork";

/**
 * What a link preview says when the page has nothing more specific. English:
 * a crawler sends no locale cookie, and English is what that request renders.
 */
export const SITE_DESCRIPTION =
  "UniWork Business OS connects tasks, meetings, conversations and AI teammates in one workspace.";

const OG_LOCALE: Record<SupportedLocale, string> = { en: "en_US", vi: "vi_VN" };

type ShareCopy = {
  title: string;
  description: string;
  /** Canonical path; also the preview's `og:url`. */
  url?: string;
  locale?: SupportedLocale;
  /** Which link-preview card; the root one unless the route has its own. */
  card?: keyof typeof OG_IMAGES;
};

/**
 * Title, description, Open Graph and Twitter tags for one page, from one copy.
 *
 * Next merges metadata one level deep: a segment that sets `openGraph` replaces
 * its parent's whole `openGraph` object, and one that leaves `twitter` alone
 * keeps the parent's. Writing a page's copy into `openGraph` alone therefore
 * dropped `og:site_name`, `og:type` and `og:locale`, and left the Twitter card
 * (which Telegram and Slack also read) on the root layout's text. Every page
 * that has its own copy sets all three through here.
 *
 * The card is named explicitly: a segment that sets `openGraph` also drops the
 * card its parent got by file convention, so without this every marketing page
 * unfurled with no image at all. The URLs carry a version generated with the
 * cards (`pnpm brand:build`), because unfurlers cache images by URL.
 */
export function shareMetadata({ title, description, url, locale = "en", card = "root" }: ShareCopy): Metadata {
  const image = OG_IMAGES[card];
  return {
    title,
    description,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description,
      locale: OG_LOCALE[locale],
      alternateLocale: Object.values(OG_LOCALE).filter((l) => l !== OG_LOCALE[locale]),
      ...(url ? { url } : {}),
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
