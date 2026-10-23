import Image from "next/image";
import type { SupportedLocale } from "@uniwork/core/i18n/types";
import { officeShotSrc } from "../features/landing/office-data";

/** CSS chooses the visible theme before hydration; the hidden image remains lazy. */
export function MarketingGuideImage({ locale, alt, caption }: { locale: SupportedLocale; alt: string; caption: string }) {
  return <figure className="public-guide-illustration">
    {(["light", "dark"] as const).map(theme => <Image key={theme} className={`public-guide-image-${theme}`} src={officeShotSrc("docs", locale, theme)} width={2400} height={1500} loading="lazy" unoptimized alt={alt} />)}
    <figcaption>{caption}</figcaption>
  </figure>;
}
