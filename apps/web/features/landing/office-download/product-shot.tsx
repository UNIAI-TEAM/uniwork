"use client";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import { officeShotSrc } from "../office-data";

/**
 * The Documents editor as it really looks, framed as an app window. Decorative:
 * the download beside it says everything, so it is hidden from assistive tech.
 * Both themes are rendered and CSS shows the one that matches the page.
 */
export function ProductShot({ className }: { className?: string }) {
  const { i18n } = useTranslation();
  return <div className={className} aria-hidden>
    <div className="office-dl-window">
      <span className="office-dl-window-bar"><i /><i /><i /></span>
      {(["light", "dark"] as const).map((theme) => <Image key={theme} className={`office-dl-shot-${theme}`} src={officeShotSrc("docs", i18n.language, theme)} width={2400} height={1500} alt="" sizes="(min-width: 1100px) 640px, 100vw" />)}
    </div>
  </div>;
}
