"use client";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Container } from "./layout-primitives";

export function MarketGapTeaser() {
  const { t } = useTranslation();
  return (
    <section className="market-section" aria-labelledby="market-title">
      <Container className="market-layout">
        <h2 id="market-title">{t("landing.marketGap.title")}</h2>
        <Link href={paths.whyUniwork()}>{t("landing.marketGap.cta")}<ArrowRight aria-hidden /></Link>
      </Container>
    </section>
  );
}
