// Settings › Privacy & legal: where each row leads. The privacy policy is the
// web's /privacy (Vietnamese under /vi, paths/marketing), whose deletion
// section keeps the fixed anchor #delete-account — the account deletion URL
// given to Google Play (apps/web/features/landing/privacy-content.ts). The
// terms of use are the web's /terms (terms-content.ts), which forbid
// objectionable content (Apple 1.2); the sign-in screen links both. The
// support address is the legal entity's (apps/web/platform/site-information.ts
// › legalEntity.email; copied: the app does not import the web).
import { marketingHref } from "@uniwork/core/paths/marketing";

export const SUPPORT_EMAIL = "contact@unicomhub.com";

export type LegalLocale = "vi" | "en";

/** The app speaks vi or en (lib/i18n); anything else reads the Vietnamese page, the default. */
export function legalLocale(language: string): LegalLocale {
  return language === "en" ? "en" : "vi";
}

export interface LegalLinks {
  privacy: string;
  deleteAccount: string;
  terms: string;
  support: string;
}

/** `appUrl` is the web app's origin (runtime config); an empty one leaves relative paths, which no row opens. */
export function legalLinks(appUrl: string, locale: LegalLocale, subject: string): LegalLinks {
  const origin = appUrl.replace(/\/+$/, "");
  const privacy = `${origin}${marketingHref("/privacy", locale)}`;
  return {
    privacy,
    deleteAccount: `${privacy}#delete-account`,
    terms: `${origin}${marketingHref("/terms", locale)}`,
    support: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`,
  };
}

/** Only an absolute http(s) page opens in the in-app browser; anything else is a misconfigured build. */
export function isOpenableWebUrl(url: string): boolean {
  return /^https?:\/\/[^/]/.test(url);
}
