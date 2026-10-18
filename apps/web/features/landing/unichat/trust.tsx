"use client";
import { ArrowRight, Globe, Lock, Monitor, Smartphone, UserMinus, Users, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { MarketingLink as Link } from "../../../platform/marketing-link";
import { Container } from "../layout-primitives";
import { AppPill } from "../apps/app-sections";

function Card({ ns, rows, footer }: { ns: "devices" | "data"; rows: readonly (readonly [LucideIcon, string])[]; footer?: ReactNode }) {
  const { t } = useTranslation();
  const k = (key: string) => t(`landing.unichat.${ns}.${key}`);
  return <article className="uc-card" aria-labelledby={`unichat-${ns}-title`}>
    <AppPill>{k("eyebrow")}</AppPill>
    <h2 id={`unichat-${ns}-title`}>{k("title")}</h2>
    <p>{k("body")}</p>
    <ul>{rows.map(([Icon, key]) => <li key={key}><span aria-hidden><Icon /></span><span><b>{k(key)}</b><small>{k(`${key}Body`)}</small></span></li>)}</ul>
    {footer}
  </article>;
}

/** The same chat on every device, and the data staying in the team's workspace. */
export function UniChatTrust() {
  const { t } = useTranslation();
  return <section className="app-section">
    <Container className="uc-split">
      <Card ns="devices" rows={[[Globe, "web"], [Monitor, "desktop"], [Smartphone, "phone"]]} />
      <Card ns="data" rows={[[Lock, "account"], [Users, "workspace"], [UserMinus, "revoke"]]} footer={<Link className="app-link" href={paths.security()}>{t("landing.unichat.security")}<ArrowRight aria-hidden /></Link>} />
    </Container>
  </section>;
}
