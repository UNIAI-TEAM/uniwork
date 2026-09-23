"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CalendarClock, CreditCard, ExternalLink, ShieldAlert } from "lucide-react";
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
import type { Plan, Subscription } from "@uniwork/core/types";
import { Button, ButtonLink } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { ConfirmDialog } from "../../common/form-dialog";
import { Notice } from "../../common/notice";
import { CollectionPageState } from "../../layout/collection-page";
import { useWorkspace } from "../../layout/workspace-context";
import { BillingUsage } from "./billing-usage";
import { formatPrice, isPaid, PlanCards } from "./plan-cards";
import {
  SettingsBadge,
  type SettingsBadgeTone,
  SettingsCard,
  SettingsDangerZone,
  SettingsRow,
  SettingsSection,
  SettingsSkeletonRows,
  SettingsTab,
  SettingsValue,
} from "./settings-layout";

/** Signal tone per status; a status this client does not know stays quiet. */
function statusTone(status: Subscription["status"]): SettingsBadgeTone {
  switch (status) {
    case "active":
      return "success";
    case "trialing":
      return "info";
    case "past_due":
      return "warning";
    case "suspended":
    case "canceled":
      return "destructive";
    default:
      return "muted";
  }
}

function formatDate(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale);
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
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [pendingCode, setPendingCode] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState("");

  if (permissionsLoading || (canView.allowed && subscription.isLoading)) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <SettingsSkeletonRows rows={3} />
        <SettingsSkeletonRows rows={2} />
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
  const fail = (err: unknown) => toast.error(apiErrorMessage(err) ?? t("error_title"));

  const choose = async (plan: Plan) => {
    setPendingCode(plan.code);
    try {
      if (isPaid(plan)) {
        // Paths only: the server prefixes FRONTEND_ORIGIN. The provider's page
        // is another origin and the URL arrives after an await, so a
        // window.open here would be popup-blocked; render a link instead.
        const back = `/${workspace.organization_slug}/${workspace.slug}/settings?tab=billing`;
        const url = await checkout.mutateAsync({ plan_code: plan.code, success_path: back, cancel_path: back });
        setCheckoutUrl(url);
        if (url) toast.success(t("checkout_ready"));
        return;
      }
      await changePlan.mutateAsync({ plan_code: plan.code, row_version: sub.row_version });
      toast.success(t("plan_changed", { name: plan.name }));
    } catch (err) {
      fail(err);
    } finally {
      setPendingCode("");
    }
  };

  const confirmCancel = () => {
    cancel.mutateAsync(undefined).then(
      () => {
        setConfirmingCancel(false);
        toast.success(t("canceled"));
      },
      (err: unknown) => {
        setConfirmingCancel(false);
        fail(err);
      },
    );
  };

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      <SettingsSection title={t("current_plan")}>
        <SettingsCard>
          <SettingsRow label={t("plan")} size="none">
            <span className="flex items-center gap-2 sm:justify-end">
              <span className="font-medium">{sub.plan_name}</span>
              <SettingsBadge tone={statusTone(sub.status)}>{t(`status.${sub.status}`, { defaultValue: sub.status })}</SettingsBadge>
            </span>
          </SettingsRow>
          <SettingsRow label={t("price")} size="none">
            <SettingsValue className="tabular-nums">{currentPlan ? formatPrice(currentPlan, locale, t) : t("price_unknown")}</SettingsValue>
          </SettingsRow>
          {sub.current_period_end ? (
            <SettingsRow label={t("period_end")} size="none">
              <SettingsValue className="tabular-nums">{formatDate(sub.current_period_end, locale)}</SettingsValue>
            </SettingsRow>
          ) : null}
        </SettingsCard>
        {sub.cancel_at ? (
          <Notice
            tone="warning"
            icon={CalendarClock}
            layout="inline"
            live="off"
            action={
              canManage.allowed ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-busy={resume.isPending}
                  onClick={() => resume.mutateAsync(undefined).then(() => toast.success(t("resumed")), fail)}
                >
                  {resume.isPending ? <Spinner aria-hidden aria-label={undefined} role="presentation" /> : null}
                  {t("resume")}
                </Button>
              ) : null
            }
          >
            {t("cancel_notice", { date: formatDate(sub.cancel_at, locale) })}
          </Notice>
        ) : null}
      </SettingsSection>

      <BillingUsage entitlements={view.entitlements} />

      <SettingsSection
        title={t("plans")}
        description={canManage.allowed ? t("plans_description") : t("owner_only")}
      >
        {canManage.allowed ? (
          plans.isLoading ? (
            <SettingsSkeletonRows rows={2} />
          ) : (
            <>
              {checkoutUrl ? (
                <Notice
                  tone="info"
                  icon={CreditCard}
                  layout="inline"
                  action={
                    <ButtonLink href={checkoutUrl} target="_blank" rel="noopener noreferrer" size="sm">
                      {t("open_checkout")}
                      <ExternalLink aria-hidden />
                    </ButtonLink>
                  }
                >
                  {t("checkout_notice")}
                </Notice>
              ) : null}
              <PlanCards
                plans={plans.data ?? []}
                currentCode={sub.plan_code}
                entitlements={view.entitlements}
                busy={busy}
                pendingCode={pendingCode}
                onChoose={(plan) => void choose(plan)}
              />
            </>
          )
        ) : null}
      </SettingsSection>

      {canManage.allowed && !sub.cancel_at ? (
        <SettingsDangerZone title={t("cancel_section")} description={t("cancel_description")}>
          <SettingsRow label={t("cancel_label")} description={t("cancel_hint")} size="none">
            <div className="flex justify-start sm:justify-end">
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                aria-busy={cancel.isPending}
                onClick={() => setConfirmingCancel(true)}
              >
                {t("cancel_open")}
              </Button>
            </div>
          </SettingsRow>
          <ConfirmDialog
            open={confirmingCancel}
            onOpenChange={(open) => !cancel.isPending && setConfirmingCancel(open)}
            title={t("confirm_cancel_title")}
            description={t("confirm_cancel_description")}
            confirmLabel={t("cancel")}
            pending={cancel.isPending}
            onConfirm={confirmCancel}
          />
        </SettingsDangerZone>
      ) : null}
    </SettingsTab>
  );
}
