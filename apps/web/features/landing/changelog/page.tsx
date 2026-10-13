"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Link as LinkIcon } from "lucide-react";
import Link from "next/link";
import { CHANGELOG_RELEASES, groupReleasesByMonth } from "@uniwork/core/changelog";
import { paths } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import { landingFont } from "../../../platform/landing-font";
import { Container } from "../layout-primitives";
import { SiteHeader } from "../site-header";
import { SiteFooter } from "../site-footer";
import "../landing.css";
import "./changelog.css";

const groups = groupReleasesByMonth(CHANGELOG_RELEASES);
const releases = groups.flatMap((group) => group.releases);

function formatDate(value: string, locale: string, monthOnly = false) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC", year: "numeric", month: "long", ...(monthOnly ? {} : { day: "numeric" as const }),
  }).format(new Date(value + "T00:00:00Z"));
}

/** The reference supplies the chronological reading structure; UniWork keeps its public visual system. */
export function ChangelogPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === "vi" ? "vi" : "en";
  const [active, setActive] = useState(releases[0]?.id ?? "");
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState(false);
  const resetCopy = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const trackHash = () => {
      const id = window.location.hash.slice(1);
      if (releases.some((release) => release.id === id)) setActive(id);
    };
    trackHash();
    window.addEventListener("hashchange", trackHash);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: "-110px 0px -55% 0px" });
    for (const release of releases) {
      const article = document.getElementById(release.id);
      if (article) observer.observe(article);
    }
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", trackHash);
      if (resetCopy.current) clearTimeout(resetCopy.current);
    };
  }, []);
  const copyLink = async (id: string) => {
    setCopyError(false);
    try {
      const url = new URL(paths.changelog(), window.location.origin);
      url.hash = id;
      await navigator.clipboard.writeText(url.href);
      setCopied(id);
      if (resetCopy.current) clearTimeout(resetCopy.current);
      resetCopy.current = setTimeout(() => setCopied(""), 2500);
    } catch { setCopyError(true); }
  };

  return <div className={`landing-site changelog-site ${landingFont.variable}`} data-design-contract="uniwork-changelog">
    <a className="landing-skip" href="#changelog-main">{t("landing.studio.skip")}</a>
    <SiteHeader />
    <main id="changelog-main">
      <Container className="changelog-layout">
        <header className="changelog-intro">
          <h1>{t("changelog.title")}</h1>
          <p>{t("changelog.description")}</p>
        </header>
        <aside className="changelog-index">
          <nav aria-label={t("changelog.allReleases")}>
            <h2>{t("changelog.allReleases")}</h2>
            {groups.map((group) => <section className="changelog-month" key={group.month}>
              <h3>{formatDate(group.month + "-01", locale, true)}</h3>
              <ol>{group.releases.map((release) => <li key={release.id}>
                <a href={`#${release.id}`} aria-current={active === release.id ? "location" : undefined} onClick={() => setActive(release.id)}>
                  <span className="changelog-timeline-dot" aria-hidden />
                  <span className="changelog-day">{release.date.slice(-2)}</span>
                  <span>{`v${release.version}`}</span>
                </a>
              </li>)}</ol>
            </section>)}
          </nav>
        </aside>
        <div className="changelog-feed">
          {releases.map((release, index) => {
            const prefix = `changelog.releases.${release.contentKey}`;
            return <article key={release.id} id={release.id} tabIndex={-1} aria-labelledby={`${release.id}-title`} className="changelog-release">
              <div className="changelog-release-meta">
                <a className="changelog-version" href={`#${release.id}`}>{`v${release.version}`}</a>
                <time dateTime={release.date}>{formatDate(release.date, locale)}</time>
                {index === 0 && <span className="changelog-latest">{t("changelog.latest")}</span>}
                <Button variant="ghost" size="icon" className="changelog-copy" aria-label={t(copied === release.id ? "changelog.copied" : "changelog.copyLink", { version: release.version })} onClick={() => void copyLink(release.id)}>
                  {copied === release.id ? <Check aria-hidden /> : <LinkIcon aria-hidden />}
                </Button>
              </div>
              <h2 id={`${release.id}-title`}>{t(`${prefix}.title`)}</h2>
              <p className="changelog-summary">{t(`${prefix}.summary`)}</p>
              {release.sections.map((section) => <section className="changelog-change-group" key={section.kind} aria-labelledby={`${release.id}-${section.kind}`}>
                <h3 id={`${release.id}-${section.kind}`}>{t(`changelog.sections.${section.kind}`)}</h3>
                <ul>{section.items.map((item) => <li key={item}>{t(`${prefix}.${section.kind}.${item}`)}</li>)}</ul>
              </section>)}
              <p className="changelog-release-note">{t(`${prefix}.note`)}</p>
              <Link className="changelog-explore" href={paths.features()}>{t("changelog.explore")}<ArrowRight aria-hidden /></Link>
            </article>;
          })}
          <p className="changelog-copy-status" role="status" aria-live="polite">{copyError ? t("changelog.copyError") : copied ? t("changelog.copied") : ""}</p>
        </div>
      </Container>
    </main>
    <SiteFooter />
  </div>;
}
