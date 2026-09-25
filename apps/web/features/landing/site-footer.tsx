"use client";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Logo } from "@uniwork/ui/brand";
import { ANCHORS, href } from "./anchors";
import { Container } from "./layout-primitives";
import { SOLUTIONS, SOLUTION_KEYS } from "./solutions";

/**
 * Footer links are plain anchors, so they do not inherit the Button
 * primitive's coarse-pointer floor. The negative inline margin keeps the
 * column's visual rhythm while the hit area grows to 44px on touch.
 */
const LINK =
  "inline-flex min-h-8 -my-1.5 items-center text-body text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:-my-2.5";

export function SiteFooter() {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-border bg-surface py-12">
      <Container className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <div>
          <Link
            href={paths.root()}
            aria-label="UniWork"
            className="inline-flex items-center pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          >
            <Logo variant="lockup" size={26} />
          </Link>
          <p className="mt-4 max-w-sm text-body text-muted-foreground">{t("landing.footer.sub")}</p>
        </div>

        <nav aria-label={t("landing.footer.product")}>
          <h2 className="text-body font-semibold">{t("landing.footer.product")}</h2>
          <ul className="mt-3 grid gap-2">
            <li>
              <Link className={LINK} href={paths.features()}>
                {t("landing.nav.features")}
              </Link>
            </li>
            <li>
              <Link className={LINK} href={paths.feature("meetings")}>
                {t("landing.meetings.eyebrow")}
              </Link>
            </li>
            <li>
              <Link className={LINK} href={paths.feature("agents")}>
                {t("landing.workforce.badge")}
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label={t("landing.solutions.eyebrow")}>
          <h2 className="text-body font-semibold">{t("landing.solutions.eyebrow")}</h2>
          <ul className="mt-3 grid gap-2">
            {SOLUTION_KEYS.map((key) => (
              <li key={key}>
                <Link className={LINK} href={SOLUTIONS[key].href}>
                  {t(`${SOLUTIONS[key].ns}.name`)}
                </Link>
              </li>
            ))}
            <li>
              <Link className={LINK} href={paths.enterprise()}>
                {t("landing.productPages.enterprise")}
              </Link>
            </li>
            <li>
              <Link className={LINK} href={paths.solutions.root()}>
                {t("landing.productPages.allSolutions")}
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label={t("landing.footer.resources")}>
          <h2 className="text-body font-semibold">{t("landing.footer.resources")}</h2>
          <ul className="mt-3 grid gap-2">
            <li>
              <Link className={LINK} href={paths.learn()}>
                {t("landing.productPages.learn")}
              </Link>
            </li>
            <li>
              <Link className={LINK} href={paths.whyUniwork()}>
                {t("landing.footer.why")}
              </Link>
            </li>
            <li>
              <a className={LINK} href={href(ANCHORS.roadmap)}>
                {t("landing.footer.roadmap")}
              </a>
            </li>
            <li>
              <Link className={LINK} href={paths.pricing()}>
                {t("landing.footer.pricing")}
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label={t("landing.footer.company")}>
          <h2 className="text-body font-semibold">{t("landing.footer.company")}</h2>
          <ul className="mt-3 grid gap-2">
            <li>
              <a className={LINK} href={href(ANCHORS.contact)}>
                {t("landing.nav.contact")}
              </a>
            </li>
            <li>
              <Link className={LINK} href={paths.login()}>
                {t("landing.nav.login")}
              </Link>
            </li>
          </ul>
        </nav>
      </Container>

      <Container className="mt-10 border-t border-border pt-6">
        <p className="text-caption text-muted-foreground">{t("landing.footer.copyright")}</p>
      </Container>
    </footer>
  );
}
