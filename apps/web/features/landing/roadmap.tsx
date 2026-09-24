"use client";
import { ArrowRight, Monitor, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { ANCHORS } from "./anchors";
import { Container } from "./layout-primitives";

/** Separate the approved product reference from deployment readiness. */
export function Roadmap() {
  const { t } = useTranslation();
  return <section id={ANCHORS.roadmap} className="deployment-readiness" aria-labelledby="readiness-title"><Container>
    <div><h2 id="readiness-title">{t("landing.revision.readiness.title")}</h2><p>{t("landing.revision.readiness.description")}</p><Link href={`${paths.learn()}#setup`} className="revision-text-link">{t("landing.revision.readiness.cta")}<ArrowRight aria-hidden /></Link></div>
    <ol>{[Monitor, Settings, ShieldCheck].map((Icon, index) => <li key={index}><Icon aria-hidden /><div><h3>{t(`landing.revision.readiness.items.${index}.title`)}</h3><p>{t(`landing.revision.readiness.items.${index}.description`)}</p></div></li>)}</ol>
  </Container></section>;
}
