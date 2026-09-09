"use client";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Logo } from "@uniwork/ui/brand";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { ANCHORS, href } from "./anchors";
import { ScrollTrigger, useGSAP } from "./animation/register-gsap";
import { Container } from "./layout-primitives";

/**
 * Nav targets resolve to a real route where one exists and to an in-page
 * anchor where it does not. "Giải pháp" is an anchor rather than a route on
 * purpose: the two department pages sit behind it, and sending a visitor to
 * one of them is a choice they have not made yet. "Giới thiệu", "Blog", "Bảo mật" and "Điều khoản"
 * are deliberately absent rather than pointed at an unrelated anchor. "Bảng
 * giá" is absent for a stronger reason: there is no pricing, and PRODUCT.md
 * rules out advertising one.
 */
const NAV = [
  { key: "landing.nav.features", to: href(ANCHORS.platform) },
  { key: "landing.nav.solutions", to: href(ANCHORS.solutions) },
  { key: "landing.workforce.badge", to: href(ANCHORS.workforce) },
  { key: "landing.nav.contact", to: href(ANCHORS.contact) },
] as const;

/**
 * Written out as a literal so Tailwind's scanner emits the utility; it is only
 * ever applied by ScrollTrigger, never by JSX.
 */
const SCROLLED = "shadow-[var(--menu-shadow)]";

export function SiteHeader() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);

  // The header's only response to scroll, and the one place on the page where
  // GSAP decides WHEN but CSS decides WHAT: a shadow is neither a transform nor
  // an opacity, so it is toggled as a class and the transition below paints it.
  // The header cannot fade its ground in instead — it starts over the hero
  // photograph, where a transparent bar would leave the nav unreadable.
  //
  // No reduced-motion branch: this is a 150ms state change on a 4px shadow,
  // not motion, and hiding it would leave the header with no scrolled state.
  useGSAP(
    () => {
      if (!header.current) return;
      ScrollTrigger.create({
        start: 24,
        // Past the bottom, not at it. `end: "max"` reads as inactive once the
        // page is scrolled all the way down, which drops the shadow on the
        // last pixel of every scroll — a flicker at the footer.
        end: () => ScrollTrigger.maxScroll(window) + window.innerHeight,
        toggleClass: { targets: header.current, className: SCROLLED },
      });
    },
    { scope: header },
  );

  return (
    <header
      ref={header}
      className="fixed inset-x-0 top-0 z-50 border-b border-border bg-surface/90 backdrop-blur-xl transition-shadow duration-150"
    >
      <Container className="flex h-16 items-center justify-between sm:h-18">
        <Link
          href={paths.root()}
          aria-label="UniWork"
          className="flex items-center pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          <Logo variant="lockup" size={26} />
        </Link>

        <nav aria-label={t("landing.nav.features")} className="hidden items-center gap-7 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.key}
              href={item.to}
              className="inline-flex items-center text-body font-medium text-muted-foreground transition-colors hover:text-brand pointer-coarse:min-h-11"
            >
              {t(item.key)}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <Link
            href={paths.login()}
            className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "hidden sm:inline-flex")}
          >
            {t("landing.nav.login")}
          </Link>
          <Link
            href={paths.register()}
            className={cn(buttonVariants({ variant: "brand", size: "lg" }), "hidden rounded-full px-5 sm:inline-flex")}
          >
            {t("landing.cta.start")}
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="lg:hidden"
            aria-label={open ? t("landing.nav.closeMenu") : t("landing.nav.openMenu")}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </Container>

      {open ? (
        <nav aria-label={t("landing.nav.openMenu")} className="border-t border-border bg-surface lg:hidden">
          <Container className="grid gap-1 py-3">
            {NAV.map((item) => (
              <a
                key={item.key}
                href={item.to}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-body font-medium hover:bg-muted"
              >
                {t(item.key)}
              </a>
            ))}
            <Link
              href={paths.login()}
              className="rounded-lg px-3 py-3 text-body font-medium hover:bg-muted sm:hidden"
            >
              {t("landing.nav.login")}
            </Link>
            <Link
              href={paths.register()}
              className={cn(buttonVariants({ variant: "brand", size: "lg" }), "mt-1 h-11 sm:hidden")}
            >
              {t("landing.cta.start")}
            </Link>
          </Container>
        </nav>
      ) : null}
    </header>
  );
}
