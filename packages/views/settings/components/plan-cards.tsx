"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import type { Entitlement, Plan } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@uniwork/ui/components/ui/card";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { ConfirmDialog } from "../../common/form-dialog";
import { featureLabel } from "./billing-usage";
import { SettingsBadge } from "./settings-layout";

/**
 * A plan with a price goes through the provider's checkout. A plan priced on
 * request (price_amount null) has nothing to charge, so it is not paid here:
 * the UI offers no online action for it at all (see isContactOnly).
 */
export function isPaid(plan: Plan): boolean {
  return plan.price_amount !== null && plan.price_amount > 0;
}

/** Priced on request: no checkout and no in-place switch. */
export function isContactOnly(plan: Plan): boolean {
  return plan.price_amount === null;
}

/** Currencies whose minor unit is never shown (ISO 4217 exponent 0 in practice). */
const ZERO_DECIMAL_CURRENCIES = new Set(["VND", "JPY", "KRW", "CLP", "ISK", "UGX", "XAF", "XOF"]);

function formatAmount(amount: number, currency: string, locale: string): string {
  const code = currency.toUpperCase();
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(code);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      ...(zeroDecimal ? { maximumFractionDigits: 0 } : {}),
    }).format(amount);
  } catch {
    // An unknown currency code throws RangeError; a price must not take the
    // whole tab down with it, so show the number and the raw code.
    return `${amount.toLocaleString(locale)} ${currency}`.trim();
  }
}

export function formatPrice(plan: Plan, locale: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (plan.price_amount === null) return t("price_contact");
  if (plan.price_amount === 0) return t("price_free");
  const amount = formatAmount(plan.price_amount, plan.price_currency, locale);
  return plan.billing_period === "none"
    ? amount
    : t("price_per", { amount, period: t(`period.${plan.billing_period}`, { defaultValue: plan.billing_period }) });
}

/** The quota keys worth a line on a plan card, in this order. Flags follow. */
const HEADLINE_QUOTAS = ["members.max", "workspaces.max", "tasks.max", "meeting.participant_minutes"];

function planLines(plan: Plan, known: Map<string, Entitlement>, locale: string, t: (k: string, o?: Record<string, unknown>) => string): string[] {
  const byKey = new Map(plan.features.map((f) => [f.feature_key, f]));
  const lines: string[] = [];
  for (const key of HEADLINE_QUOTAS) {
    const f = byKey.get(key);
    const e = known.get(key);
    if (!f || !e || !f.enabled) continue;
    const limit = f.quota_limit === null ? t("unlimited") : f.quota_limit.toLocaleString(locale);
    lines.push(t("plan_line_quota", { name: featureLabel(t, key, e.name), limit }));
  }
  for (const f of plan.features) {
    const e = known.get(f.feature_key);
    if (!e || e.kind !== "flag" || !f.enabled) continue;
    lines.push(featureLabel(t, f.feature_key, e.name));
  }
  return lines;
}

/** Columns follow the plan count so a lone plan never leaves half a row empty. */
function gridColumns(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
}

export interface PlanCardsProps {
  plans: Plan[];
  currentCode: string;
  entitlements: Entitlement[];
  busy: boolean;
  /** Code of the plan whose change or checkout is in flight, "" otherwise. */
  pendingCode: string;
  onChoose: (plan: Plan) => void;
}

/**
 * Plans side by side, the current one marked, so the owner sees what a plan
 * includes before committing. A free plan applies after a confirmation; a
 * paid one goes to checkout.
 */
export function PlanCards({ plans, currentCode, entitlements, busy, pendingCode, onChoose }: PlanCardsProps) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.billing" });
  const [pending, setPending] = useState<Plan | null>(null);
  const known = new Map(entitlements.map((e) => [e.feature_key, e]));
  const locale = i18n.language;
  const single = plans.length <= 1;
  // Side by side, a description of one or two lines would push one card's
  // feature list below its neighbour's; reserve the same room on every card.
  const describes = !single && plans.some((p) => p.description);

  return (
    <>
      <div className={cn("grid gap-3", gridColumns(plans.length))}>
        {plans.map((plan) => {
          const current = plan.code === currentCode;
          const paid = isPaid(plan);
          return (
            <Card
              key={plan.id}
              className={cn("h-full gap-3 shadow-none", current && "border-brand ring-1 ring-brand")}
              data-testid={`plan-card-${plan.code}`}
            >
              <CardHeader className="gap-1.5 px-4">
                {/* The section title "Các gói" is the h3; each plan is one level under it. */}
                <div className="flex min-h-6 items-center justify-between gap-2">
                  <h4 className="truncate text-body font-semibold">{plan.name}</h4>
                  {current ? <SettingsBadge tone="brand">{t("plan_current")}</SettingsBadge> : null}
                </div>
                <p className="text-title font-semibold tabular-nums">{formatPrice(plan, locale, t)}</p>
                {describes || plan.description ? (
                  <p className={cn("text-caption text-pretty text-muted-foreground", describes && "line-clamp-2 min-h-10")}>
                    {plan.description}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="flex-1 px-4">
                <ul className={cn("grid gap-1.5 text-caption", single && "sm:grid-cols-2 sm:gap-x-6")}>
                  {planLines(plan, known, locale, t).map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              {current ? null : isContactOnly(plan) ? (
                // No contact channel exists in the product, so there is no
                // button to press: the price line already says "contact us".
                <CardFooter className="mt-auto px-4">
                  <p className="text-caption text-pretty text-muted-foreground">{t("contact_only")}</p>
                </CardFooter>
              ) : (
                // The current plan is already marked in the header; a second
                // "current plan" control would only repeat it. The footer sits
                // at the card's bottom so buttons line up across the row.
                <CardFooter className="mt-auto px-4">
                  <Button
                    type="button"
                    variant={paid ? "default" : "secondary"}
                    className="w-full"
                    disabled={busy}
                    aria-busy={pendingCode === plan.code}
                    onClick={() => (paid ? onChoose(plan) : setPending(plan))}
                  >
                    {pendingCode === plan.code ? <Spinner aria-hidden aria-label={undefined} role="presentation" /> : null}
                    {paid ? t("checkout") : t("choose_plan")}
                  </Button>
                </CardFooter>
              )}
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("confirm_change_title", { name: pending?.name ?? "" })}
        description={t("confirm_change_description")}
        confirmLabel={t("confirm_change_action")}
        destructive={false}
        pending={busy}
        onConfirm={() => {
          if (pending) onChoose(pending);
          setPending(null);
        }}
      />
    </>
  );
}
