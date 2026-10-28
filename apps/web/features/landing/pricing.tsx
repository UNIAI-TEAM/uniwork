"use client";
import { ArrowRight, Check, Minus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePlans, formatPlanQuotaLimit, formatPrice } from "@uniwork/core/billing";
import type { Plan, PlanFeature } from "@uniwork/core/types";
import { paths } from "@uniwork/core/paths";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MarketingLink as Link } from "../../platform/marketing-link";
import { ANCHORS } from "./anchors";
import { Container, SectionTitle } from "./layout-primitives";
import { PRICING_QUOTA_KEYS as QUOTA_KEYS, pricingComparisonRows } from "./pricing-catalog";
import "./pricing.css";

function FeatureValue({ feature, featureKey }: { feature?: PlanFeature; featureKey: string }) {
  const { t, i18n } = useTranslation();
  const billingT = (key: string, options?: Record<string, unknown>) => t(`landing.pricing.labels.${key}`, options);
  if (!feature) return <span className="public-pricing-unavailable">{t("landing.pricing.notSpecified")}</span>;
  if (!feature.enabled) return <span className="public-pricing-unavailable">{t("landing.pricing.labels.not_in_plan")}</span>;
  return <>{formatPlanQuotaLimit(featureKey, feature.quota_limit, i18n.resolvedLanguage ?? "en", billingT)}</>;
}

function PlanOffer({ plan }: { plan: Plan }) {
  const { t, i18n } = useTranslation();
  const billingT = (key: string, options?: Record<string, unknown>) => t(`landing.pricing.labels.${key}`, options);
  const locale = i18n.resolvedLanguage ?? "en";
  const contact = plan.price_amount === null;
  const recurring = !contact && plan.price_amount !== 0 && plan.billing_period !== "none";
  const features = new Map(plan.features.map(feature => [feature.feature_key, feature]));
  return <article className="public-pricing-plan" data-plan-code={plan.code} data-default={plan.is_default}>
    <div className="public-pricing-plan-heading">
      <h3>{plan.name}</h3>
      {plan.is_default && <span className="public-pricing-default">{t("landing.pricing.defaultPlan")}</span>}
    </div>
    <div className="public-pricing-price" data-contact={contact}>
      <strong>{formatPrice({ ...plan, billing_period: "none" }, locale, billingT)}</strong>
      <span>{recurring
        ? t("landing.pricing.perOrganizationPeriod", { period: billingT(`period.${plan.billing_period}`, { defaultValue: plan.billing_period }) })
        : t("landing.pricing.perOrganization")}</span>
    </div>
    <dl className="public-pricing-limits">
      {QUOTA_KEYS.map(key => <div key={key}>
        <dt>{billingT(`features.${key.replaceAll(".", "_")}`)}</dt>
        <dd><FeatureValue feature={features.get(key)} featureKey={key} /></dd>
      </div>)}
    </dl>
    <Link href={contact ? paths.requestDemo() : paths.register()}
      className={cn(buttonVariants({ variant: plan.is_default ? "brand" : "outline", size: "lg" }), "public-pricing-action")}>
      {contact ? t("landing.pricing.contact") : plan.price_amount === 0 ? t("landing.cta.start") : t("landing.pricing.startWithPlan", { name: plan.name })}
      <ArrowRight aria-hidden />
    </Link>
  </article>;
}

function PlanFeatures({ plans }: { plans: Plan[] }) {
  const { t } = useTranslation();
  const rows = pricingComparisonRows(plans);
  if (!rows.length) return null;
  // Keyboard users need to focus the named horizontal scroll region at narrow widths.
  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
  return <div className="public-pricing-comparison" role="region" aria-label={t("landing.pricing.compareFeatures")} tabIndex={0} data-plan-count={plans.length}>
    <table>
      <caption>{t("landing.pricing.compareFeatures")}</caption>
      <thead><tr><th scope="col">{t("landing.pricing.feature")}</th>{plans.map(plan => <th key={plan.id} scope="col">{plan.name}</th>)}</tr></thead>
      <tbody>{rows.map(key => <tr key={key}>
        <th scope="row">{t(`landing.pricing.labels.features.${key.replaceAll(".", "_")}`)}</th>
        {plans.map(plan => {
          const feature = plan.features.find(item => item.feature_key === key);
          return <td key={plan.id}>{!feature ? <span className="public-pricing-unavailable">{t("landing.pricing.notSpecified")}</span> : <span className="public-pricing-flag">
            {feature.enabled ? <Check aria-hidden /> : <Minus aria-hidden />}
            {t(feature.enabled ? "landing.pricing.included" : "landing.pricing.labels.not_in_plan")}
          </span>}</td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}

/** Same live catalog as organization billing; no marketing prices or fallback quotas. */
export function Pricing({ showIntroduction = true }: { showIntroduction?: boolean }) {
  const { t } = useTranslation();
  const { data: plans, isPending, isError, isFetching, refetch } = usePlans();
  return <section id={ANCHORS.pricing}
    aria-labelledby={showIntroduction ? "landing-pricing-title" : undefined}
    aria-label={showIntroduction ? undefined : t("landing.pricing.title")}
    className="pricing-section public-pricing-section">
    <Container>
      {showIntroduction && <div className="pricing-introduction">
        <SectionTitle className="mt-0"><span id="landing-pricing-title">{t("landing.pricing.title")}</span></SectionTitle>
        <p>{t("landing.pricing.sub")}</p>
      </div>}
      {isPending ? <div className="public-pricing-state" role="status" aria-busy="true"><p>{t("landing.pricing.loading")}</p></div>
        : isError || !plans?.length ? <div className="public-pricing-state" role="status">
          <h3>{t(isError ? "landing.pricing.errorTitle" : "landing.pricing.emptyTitle")}</h3>
          <p>{t("landing.pricing.unavailableDescription")}</p>
          <Button variant="outline" disabled={isFetching} onClick={() => { void refetch(); }}>{t("landing.pricing.labels.retry")}</Button>
          <Link href={paths.requestDemo()}>{t("landing.pricing.contact")}<ArrowRight aria-hidden /></Link>
        </div> : <>
          <div className="public-pricing-grid pricing-offer">{plans.map(plan => <PlanOffer key={plan.id} plan={plan} />)}</div>
          <p className="public-pricing-note">{t("landing.pricing.status")}</p>
          <PlanFeatures plans={plans} />
        </>}
    </Container>
  </section>;
}
