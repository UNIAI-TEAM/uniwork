"use client";
import { ArrowRight, BookOpen, BriefcaseBusiness, HelpCircle, Layers, Play, Workflow } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { PRODUCT_FEATURES, PRODUCT_GROUPS } from "./showcase";
export type HeaderDirectoryKey = "products" | "solutions" | "learn";

export function HeaderDirectory({ kind, onNavigate }: { kind: HeaderDirectoryKey; onNavigate: () => void }) {
  const { t } = useTranslation();
  if (kind === "products") return <>
    <div className="header-product-columns">{PRODUCT_GROUPS.map(group => <section key={group.key}><h2>{t(`landing.catalog.groups.${group.key}`)}</h2>{PRODUCT_FEATURES.filter(item => item.group === group.key).map(item => <Link key={item.key} href={paths.feature(item.key)} onClick={onNavigate}><item.icon aria-hidden /><span>{t(item.label)}</span></Link>)}</section>)}</div>
    <div className="header-directory-footer"><Link href={paths.features()} onClick={onNavigate}>{t("landing.productPages.allFeatures")}<ArrowRight aria-hidden /></Link><Link href="/#platform" onClick={onNavigate}><Play aria-hidden />{t("landing.productPages.watchDemo")}</Link></div>
  </>;
  const entries = kind === "solutions" ? [
    { to: paths.solutions.product(), title: "landing.solutions.product.name", description: "landing.solutions.product.sub", icon: BriefcaseBusiness },
    { to: paths.solutions.operations(), title: "landing.solutions.operations.name", description: "landing.solutions.operations.sub", icon: Workflow },
    { to: paths.enterprise(), title: "landing.productPages.enterprise", description: "landing.productPages.enterpriseDetails", icon: Layers },
  ] : [
    { to: paths.learn(), title: "landing.productPages.learn", description: "landing.productPages.learnDescription", icon: BookOpen },
    { to: paths.whyUniwork(), title: "landing.nav.why", description: "landing.studio.platformTitle", icon: Layers },
    { to: `${paths.learn()}#questions`, title: "landing.productPages.faqTitle", description: "landing.productPages.menuFoot", icon: HelpCircle },
  ];
  return <><div className="header-editorial-links">{entries.map(item => <Link key={item.to} href={item.to} onClick={onNavigate}><item.icon aria-hidden /><span><strong>{t(item.title)}</strong><small>{t(item.description)}</small></span><ArrowRight aria-hidden /></Link>)}</div><div className="header-directory-footer"><Link href={kind === "solutions" ? paths.solutions.root() : paths.learn()} onClick={onNavigate}>{t(kind === "solutions" ? "landing.productPages.allSolutions" : "landing.productPages.resourcesLabel")}<ArrowRight aria-hidden /></Link><span>{t("landing.productPages.menuFoot")}</span></div></>;
}
