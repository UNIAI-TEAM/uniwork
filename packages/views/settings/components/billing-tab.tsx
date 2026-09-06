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
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Label } from "@uniwork/ui/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@uniwork/ui/components/ui/native-select";
import { Progress } from "@uniwork/ui/components/ui/progress";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CollectionPageState } from "../../layout/collection-page";
import { useWorkspace } from "../../layout/workspace-context";
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

/** A paid plan needs the provider's checkout; a free one changes in place. */
function isPaid(plan: Plan): boolean {
  return plan.price_amount === null || plan.price_amount > 0;
}

function UsageRow({ entitlement, locale }: { entitlement: Entitlement; locale: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.billing" });
  const { quota_limit: limit, current_usage: used, enabled, kind, name, unit } = entitlement;
  if (kind !== "quota") {
    return (
      <SettingsRow label={name} size="none">
        <Badge variant={enabled ? "secondary" : "outline"}>{enabled ? t("flag_on") : t("flag_off")}</Badge>
      </SettingsRow>
    );
  }
  const usedText = used.toLocaleString(locale);
  const limitText = limit === null ? t("unlimited") : limit.toLocaleString(locale);
  const percent = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <SettingsRow label={name} description={unit} size="none" align="start">
      <div className="flex w-full flex-col gap-1 sm:w-64">
        <span className="text-caption text-muted-foreground">
          {t("usage_of", { used: usedText, limit: limitText })}
        </span>
        {limit !== null && limit > 0 ? (
          <Progress value={percent} aria-label={name} className="gap-0" />
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
  const [target, setTarget] = useState("");

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
  const targetPlan = plans.data?.find((p) => p.code === target);
  const fail = (err: unknown) => toast.error(apiErrorMessage(err) ?? t("error_title"));

  const submitPlan = async () => {
    if (!targetPlan) return;
    try {
      if (isPaid(targetPlan)) {
        // Paths only: the server prefixes FRONTEND_ORIGIN. The provider's page
        // is another origin, so it opens in its own tab like an invoice link.
        const back = `/${workspace.organization_slug}/${workspace.slug}/settings?tab=billing`;
        const url = await checkout.mutateAsync({ plan_code: targetPlan.code, success_path: back, cancel_path: back });
        if (url) window.open(url, "_blank", "noopener");
        return;
      }
      await changePlan.mutateAsync({ plan_code: targetPlan.code, row_version: sub.row_version });
      setTarget("");
      toast.success(t("plan_changed"));
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
          {sub.current_period_end ? (
            <SettingsRow label={t("period_end")} size="none">
              <span>{formatDate(sub.current_period_end, locale)}</span>
            </SettingsRow>
          ) : null}
          {sub.cancel_at ? (
            <SettingsRow label={t("cancel_at")} description={t("cancel_at_hint")} size="none">
              <span>{formatDate(sub.cancel_at, locale)}</span>
            </SettingsRow>
          ) : null}
          {canManage.allowed ? (
            <SettingsRow
              label={t("change_plan")}
              description={canManage.allowed ? undefined : t("owner_only")}
              size="none"
              align="start"
            >
              <div className="flex w-full flex-col gap-2 sm:w-80">
                <Label htmlFor="billing-plan" className="sr-only">
                  {t("change_plan")}
                </Label>
                <NativeSelect
                  id="billing-plan"
                  value={target}
                  disabled={busy || plans.isLoading}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <NativeSelectOption value="">{t("pick_plan")}</NativeSelectOption>
                  {(plans.data ?? [])
                    .filter((p) => p.code !== sub.plan_code)
                    .map((p) => (
                      <NativeSelectOption key={p.id} value={p.code}>
                        {isPaid(p) ? t("plan_paid", { name: p.name }) : t("plan_free", { name: p.name })}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={!targetPlan || busy} onClick={() => void submitPlan()}>
                    {targetPlan && isPaid(targetPlan) ? t("checkout") : t("apply_plan")}
                  </Button>
                  {sub.cancel_at ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => resume.mutateAsync(undefined).then(() => toast.success(t("resumed")), fail)}
                    >
                      {t("resume")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => cancel.mutateAsync(undefined).then(() => toast.success(t("canceled")), fail)}
                    >
                      {t("cancel")}
                    </Button>
                  )}
                </div>
              </div>
            </SettingsRow>
          ) : (
            <p className="text-caption text-muted-foreground">{t("owner_only")}</p>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("usage")} description={t("usage_description")}>
        {view.entitlements.length === 0 ? (
          <CollectionPageState icon={CreditCard} title={t("no_entitlements")} role="status" />
        ) : (
          <SettingsCard>
            {view.entitlements.map((e) => (
              <UsageRow key={e.feature_key} entitlement={e} locale={locale} />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>
    </SettingsTab>
  );
}
