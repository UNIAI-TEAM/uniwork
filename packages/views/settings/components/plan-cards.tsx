"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import type { Entitlement, Plan } from "@uniwork/core/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@uniwork/ui/components/ui/card";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";

/** A paid plan needs the provider's checkout; a free one changes in place. */
export function isPaid(plan: Plan): boolean {
  return plan.price_amount === null || plan.price_amount > 0;
}

export function formatPrice(plan: Plan, locale: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (plan.price_amount === null) return t("price_contact");
  if (plan.price_amount === 0) return t("price_free");
  const amount = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: plan.price_currency,
    maximumFractionDigits: 0,
  }).format(plan.price_amount);
  return plan.billing_period === "none"
    ? amount
    : t("price_per", { amount, period: t(`period.${plan.billing_period}`, { defaultValue: plan.billing_period }) });
}

/** The quota keys worth a line on a plan card, in this order. Flags follow. */
const HEADLINE_QUOTAS = ["members.max", "workspaces.max", "meeting.participant_minutes"];

function planLines(plan: Plan, names: Map<string, Entitlement>, locale: string, t: (k: string, o?: Record<string, unknown>) => string): string[] {
  const byKey = new Map(plan.features.map((f) => [f.feature_key, f]));
  const lines: string[] = [];
  for (const key of HEADLINE_QUOTAS) {
    const f = byKey.get(key);
    const e = names.get(key);
    if (!f || !e || !f.enabled) continue;
    const limit = f.quota_limit === null ? t("unlimited") : f.quota_limit.toLocaleString(locale);
    lines.push(t("plan_line_quota", { name: e.name, limit }));
  }
  for (const f of plan.features) {
    const e = names.get(f.feature_key);
    if (!e || e.kind !== "flag" || !f.enabled || !names.has(f.feature_key)) continue;
    lines.push(e.name);
  }
  return lines;
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
  const names = new Map(entitlements.map((e) => [e.feature_key, e]));
  const locale = i18n.language;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const current = plan.code === currentCode;
          const paid = isPaid(plan);
          return (
            <Card
              key={plan.id}
              className={cn("gap-3 py-4", current && "border-primary ring-1 ring-primary/30")}
              data-testid={`plan-card-${plan.code}`}
            >
              <CardHeader className="px-4">
                <CardTitle className="flex items-center justify-between gap-2 text-body">
                  <span>{plan.name}</span>
                  {current ? <Badge variant="secondary">{t("plan_current")}</Badge> : null}
                </CardTitle>
                <p className="text-title font-semibold tabular-nums">{formatPrice(plan, locale, t)}</p>
                {plan.description ? (
                  <p className="text-caption text-muted-foreground">{plan.description}</p>
                ) : null}
              </CardHeader>
              <CardContent className="px-4">
                <ul className="flex flex-col gap-1.5 text-caption">
                  {planLines(plan, names, locale, t).map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              {current ? null : (
                // The current plan is already marked in the header; a second
                // "current plan" control would only repeat it.
                <CardFooter className="px-4">
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

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirm_change_title", { name: pending?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirm_change_description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("confirm_back")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (pending) onChoose(pending);
                setPending(null);
              }}
            >
              {t("confirm_change_action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
