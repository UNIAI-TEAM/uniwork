"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CreditCard, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import {
  useCancelSubscription,
  useChangePlan,
  useCreateCheckout,
  usePlans,
  useResumeSubscription,
  useSubscription,
} from "@uniwork/core/billing";
import { useBillingPermissions } from "@uniwork/core/permissions";
import type { Entitlement, Plan, Subscription } from "@uniwork/core/types";
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
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageState } from "../../layout/collection-page";
import { useWorkspace } from "../../layout/workspace-context";
import { formatPrice, isPaid, PlanCards } from "./plan-cards";
import { SettingsCard, SettingsRow, SettingsSection, SettingsTab } from "./settings-layout";

/** past_due / suspended / canceled read as warnings; the rest are neutral. */
function statusTone(status: Subscription["status"]): "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
    case "trialing":
      return "secondary";
    case "past_due":
      return "outline";
    case "suspended":
    case "canceled":
      return "destructive";
    default:
      return "outline";
  }
}

function formatDate(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale);
}

/**
 * Meters nothing writes yet (AI gateway, documents, SSO are later specs).
 * Showing "0 / unlimited" for them is noise; drop them from the list when
 * their consumer lands.
 */
const NOT_WIRED_YET = new Set(["ai.tokens", "storage.bytes", "sso.oidc"]);

/** Bar colour follows the same thresholds the server notifies at (80 %, 100 %). */
function barTone(percent: number): string {
  if (percent >= 100) return "bg-destructive";
  if (percent >= 80) return "bg-warning";
  return "bg-primary";
}

function UsageRow({ entitlement, locale }: { entitlement: Entitlement; locale: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.billing" });
  const { quota_limit: limit, current_usage: used, enabled, kind, name, unit } = entitlement;
  const unitLabel = unit ? t(`units.${unit}`, { defaultValue: unit }) : "";
  if (kind !== "quota") {
    return (
      <SettingsRow label={name} size="none">
        <Badge variant={enabled ? "secondary" : "outline"}>{enabled ? t("flag_on") : t("flag_off")}</Badge>
      </SettingsRow>
    );
  }
  const usedText = used.toLocaleString(locale);
  const bounded = limit !== null && limit > 0;
  const percent = bounded ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const remaining = bounded ? Math.max(0, limit - used) : 0;
  return (
    <SettingsRow label={name} size="none" align="start">
      <div className="flex w-full flex-col gap-1.5 sm:w-64">
        <span className="flex items-baseline justify-between gap-2 text-caption">
          <span className="tabular-nums">
            {bounded
              ? t("usage_of", { used: usedText, limit: limit.toLocaleString(locale), unit: unitLabel })
              : t("usage_unbounded", { used: usedText, unit: unitLabel })}
          </span>
          {bounded ? (
            <span className={cn("tabular-nums", percent >= 100 ? "text-destructive" : percent >= 80 ? "text-warning" : "text-muted-foreground")}>
              {percent >= 100 ? t("usage_full") : t("usage_remaining", { n: remaining.toLocaleString(locale) })}
            </span>
          ) : null}
        </span>
        {bounded ? (
          // Plain bar: the registry Progress cannot recolour its indicator.
          <div
            role="progressbar"
            aria-label={name}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div className={cn("h-full rounded-full transition-all", barTone(percent))} style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </div>
    </SettingsRow>
  );
}

export function BillingTab() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.billing" });
  const { workspace } = useWorkspace();
  const orgId = workspace.organization_id;
  const { canView, canManage, isLoading: permissionsLoading } = useBillingPermissions(orgId);
  const subscription = useSubscription(canView.allowed ? orgId : "");
  const plans = usePlans();
  const changePlan = useChangePlan(orgId);
  const cancel = useCancelSubscription(orgId);
  const resume = useResumeSubscription(orgId);
  const checkout = useCreateCheckout(orgId);
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (permissionsLoading) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <Skeleton className="h-64 w-full" />
      </SettingsTab>
    );
  }
  if (!canView.allowed) {
    return (
      <SettingsTab title={t("title")}>
        <CollectionPageState
          icon={ShieldAlert}
          title={t("forbidden_title")}
          description={t("forbidden_description")}
          role="status"
        />
      </SettingsTab>
    );
  }
  if (subscription.isLoading) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <Skeleton className="h-64 w-full" />
      </SettingsTab>
    );
  }
  const view = subscription.data;
  if (subscription.isError || !view) {
    return (
      <SettingsTab title={t("title")}>
        <CollectionPageState
          icon={AlertCircle}
          tone="destructive"
          role="alert"
          title={t("error_title")}
          description={t("error_description")}
          actions={
            <Button variant="outline" onClick={() => void subscription.refetch()}>
              {t("retry")}
            </Button>
          }
        />
      </SettingsTab>
    );
  }

  const sub = view.subscription;
  const locale = i18n.language;
  const busy = changePlan.isPending || cancel.isPending || resume.isPending || checkout.isPending;
  const currentPlan = plans.data?.find((p) => p.code === sub.plan_code);
  const visible = view.entitlements.filter((e) => !NOT_WIRED_YET.has(e.feature_key));
  const fail = (err: unknown) => toast.error(apiErrorMessage(err) ?? t("error_title"));

  const choose = async (plan: Plan) => {
    try {
      if (isPaid(plan)) {
        // Paths only: the server prefixes FRONTEND_ORIGIN. The provider's page
        // is another origin, so it opens in its own tab like an invoice link.
        const back = `/${workspace.organization_slug}/${workspace.slug}/settings?tab=billing`;
        const url = await checkout.mutateAsync({ plan_code: plan.code, success_path: back, cancel_path: back });
        if (url) window.open(url, "_blank", "noopener");
        return;
      }
      await changePlan.mutateAsync({ plan_code: plan.code, row_version: sub.row_version });
      toast.success(t("plan_changed", { name: plan.name }));
    } catch (err) {
      fail(err);
    }
  };

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      <SettingsSection title={t("current_plan")}>
        <SettingsCard>
          <SettingsRow label={t("plan")} size="none">
            <span className="flex items-center gap-2">
              <span className="font-medium">{sub.plan_name}</span>
              <Badge variant={statusTone(sub.status)}>{t(`status.${sub.status}`, { defaultValue: sub.status })}</Badge>
            </span>
          </SettingsRow>
          <SettingsRow label={t("price")} size="none">
            <span className="tabular-nums">{currentPlan ? formatPrice(currentPlan, locale, t) : t("price_unknown")}</span>
          </SettingsRow>
          {sub.current_period_end ? (
            <SettingsRow label={t("period_end")} size="none">
              <span>{formatDate(sub.current_period_end, locale)}</span>
            </SettingsRow>
          ) : null}
          {sub.cancel_at ? (
            <SettingsRow label={t("cancel_at")} description={t("cancel_at_hint")} size="none">
              <span className="flex flex-wrap items-center gap-2">
                <span>{formatDate(sub.cancel_at, locale)}</span>
                {canManage.allowed ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => resume.mutateAsync(undefined).then(() => toast.success(t("resumed")), fail)}
                  >
                    {t("resume")}
                  </Button>
                ) : null}
              </span>
            </SettingsRow>
          ) : null}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("usage")} description={t("usage_description")}>
        {visible.length === 0 ? (
          <CollectionPageState icon={CreditCard} title={t("no_entitlements")} role="status" />
        ) : (
          <SettingsCard>
            {visible.map((e) => (
              <UsageRow key={e.feature_key} entitlement={e} locale={locale} />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>

      <SettingsSection
        title={t("plans")}
        description={canManage.allowed ? t("plans_description") : t("owner_only")}
      >
        {canManage.allowed ? (
          plans.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <PlanCards
              plans={plans.data ?? []}
              currentCode={sub.plan_code}
              entitlements={view.entitlements}
              busy={busy}
              onChoose={(plan) => void choose(plan)}
            />
          )
        ) : null}
      </SettingsSection>

      {canManage.allowed && !sub.cancel_at ? (
        <SettingsSection title={t("cancel_section")} description={t("cancel_description")}>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmCancel(true)}>
            {t("cancel")}
          </Button>
          <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("confirm_cancel_title")}</AlertDialogTitle>
                <AlertDialogDescription>{t("confirm_cancel_description")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>{t("confirm_back")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    setConfirmCancel(false);
                    cancel.mutateAsync(undefined).then(() => toast.success(t("canceled")), fail);
                  }}
                >
                  {t("cancel")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SettingsSection>
      ) : null}
    </SettingsTab>
  );
}
