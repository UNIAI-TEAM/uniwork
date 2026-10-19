"use client";
import { ArrowRight, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MarketingAnchor, MarketingLink as Link } from "../../platform/marketing-link";
import { AppBar } from "./apps/app-bar";
import { AppDownload } from "./apps/app-download";
import { OtherApps } from "./apps/app-sections";
import { DESKTOP_ORDER, PHONE_ORDER } from "./apps/catalog";
import { useVisitorDevice } from "./apps/visitor-device";
import { Faq } from "./faq";
import { Container } from "./layout-primitives";
import { MarketingShell } from "./marketing-shell";
import { UniChatStage } from "./unichat/stage";
import { UniChatStory } from "./unichat/story";
import { UniChatTrust } from "./unichat/trust";
import "./apps/apps.css";
import "./unichat.css";

const DOWNLOAD = "#unichat-download";
const SECTIONS = [
  { id: "unichat-overview", labelKey: "landing.apps.bar.overview" },
  { id: "unichat-features", labelKey: "landing.apps.bar.features" },
  { id: "unichat-download", labelKey: "landing.apps.bar.download" },
  { id: "unichat-faq", labelKey: "landing.apps.bar.faq" },
] as const;

/** "Download for macOS" when the visitor's system is known, "Download UniChat" otherwise. */
function useDownloadLabel() {
  const { t, i18n } = useTranslation();
  const device = useVisitorDevice();
  const own = device.phone ?? device.desktop;
  const name = (os: string) => (os === "ios" || os === "android" ? t(`landing.apps.platform.${os}`) : t(`office.desktop.install.os.${os}`));
  const label = own ? t("landing.apps.downloadFor", { os: name(own) }) : t("landing.unichat.hero.download");
  const others = [...DESKTOP_ORDER, ...PHONE_ORDER].filter((os) => os !== own).map(name);
  const also = t("landing.unichat.hero.also", { list: new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(others) });
  return { label, also };
}

/**
 * THESIS: UniChat is the UniWork workspace chat in its own desktop and phone app.
 * STORY: the opening and its stage, what the chat does for the work, the same
 * chat everywhere, the downloads, the questions, then the site's own closing:
 * the shape and shared pieces of UniOffice's page (UNI-1913). The stage is drawn
 * from the chat's own tokens with fictional demo identities, never captured
 * customer data.
 */
export function UniChatPage() {
  const { t } = useTranslation();
  const { label, also } = useDownloadLabel();
  return <MarketingShell className="apps-site" closingTitle="landing.unichat.closing" closingAction={{ href: `${paths.apps.unichat()}${DOWNLOAD}`, labelKey: "landing.unichat.hero.download", icon: "arrow" }}>
    <AppBar app="unichat" sections={SECTIONS} cta={{ href: DOWNLOAD, label, short: t("landing.apps.bar.short") }} />
    <section id="unichat-overview" className="uc-hero" aria-labelledby="unichat-title">
      <Container>
        <div className="uc-hero-copy">
          <h1 id="unichat-title"><span>{t("landing.unichat.hero.line1")}</span><span>{t("landing.unichat.hero.line2")}</span></h1>
          <p className="app-lead">{t("landing.unichat.hero.sub")}</p>
          <div className="app-actions">
            <MarketingAnchor className={cn(buttonVariants({ variant: "brand", size: "lg" }))} href={DOWNLOAD}><Download aria-hidden />{label}</MarketingAnchor>
            <Link className={cn(buttonVariants({ variant: "outline", size: "lg" }), "uc-web-action")} href={paths.login()}>{t("landing.unichat.hero.web")}<ArrowRight aria-hidden /></Link>
          </div>
          <p className="uc-also-line">{also} <MarketingAnchor href={DOWNLOAD}>{t("landing.unichat.hero.allBuilds")}</MarketingAnchor></p>
        </div>
        <UniChatStage />
        <p className="uc-caption">{t("landing.unichat.stage.caption")}</p>
      </Container>
    </section>
    <UniChatStory />
    <UniChatTrust />
    <section id="unichat-download" className="app-section app-download-band" aria-labelledby="unichat-download-title">
      <Container>
        <div className="app-download-head">
          <h2 id="unichat-download-title" className="app-h2">{t("landing.unichat.download.title")}</h2>
          <p className="app-lead">{t("landing.unichat.download.sub")}</p>
        </div>
        <AppDownload app="unichat" copy="landing.unichat" />
      </Container>
    </section>
    <div id="unichat-faq"><Faq namespace="landing.unichat.faq" count={4} title="landing.unichat.faq.title" /></div>
    <OtherApps current="unichat" />
  </MarketingShell>;
}
