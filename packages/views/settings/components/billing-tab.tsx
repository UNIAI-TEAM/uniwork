"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CalendarClock, CreditCard, ExternalLink, ShieldAlert, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
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
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { ConfirmDialog } from "../../common/form-dialog";
import { Notice } from "../../common/notice";
import { CollectionPageState } from "../../layout/collection-page";
import { useWorkspace } from "../../layout/workspace-context";
import { toastApiError } from "../../toast-api-error";
import { BillingUsage } from "./billing-usage";
import { CorrelationNote } from "./copyable-id";
import { formatPrice, isPaid, PlanCards } from "./plan-cards";
import {
  SettingsBadge,
  type SettingsBadgeTone,
  SettingsCard,
  SettingsDangerZone,
  SettingsEmpty,
  SettingsLoadError,
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

/**
 * How long past_due keeps the plan working after the period ends. Mirrors
 * pastDueGrace in server/internal/service/entitlement.go; the date it yields is
 * only said to the reader, the server decides.
 */
const PAST_DUE_GRACE_DAYS = 7;

function graceEnd(periodEnd: string | undefined): string | undefined {
  if (!periodEnd) return undefined;
  const d = new Date(periodEnd);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setDate(d.getDate() + PAST_DUE_GRACE_DAYS);
  return d.toISOString();
}

/**
 * Only a plan that can actually be stopped offers the stop: one with a price
 * (or priced on request) that is not the default everyone falls back to.
 * Stopping the free default plan would move the organization to itself.
 */
function cancellable(plan: Plan | undefined): boolean {
  return plan !== undefined && !plan.is_default && plan.price_amount !== 0;
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
  // Where the checkout link shows: beside the button that asked for it.
  const [checkoutLink, setCheckout] = useState<{ url: string; from: "plans" | "past_due" } | null>(null);

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
          headingLevel={3}
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
          headingLevel={3}
          title={t("error_title")}
          description={
            <>
              {t("error_description")}
              <CorrelationNote error={subscription.error} />
            </>
          }
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
  const fail = (err: unknown) => toastApiError(err, t("action_failed"));
  const pastDue = sub.status === "past_due";
  const canPayNow = canManage.allowed && currentPlan !== undefined && isPaid(currentPlan);

  const choose = async (plan: Plan, from: "plans" | "past_due" = "plans") => {
    setPendingCode(plan.code);
    try {
      if (isPaid(plan)) {
        // Paths only: the server prefixes FRONTEND_ORIGIN. The provider's page
        // is another origin and the URL arrives after an await, so a
        // window.open here would be popup-blocked; render a link instead.
        const back = `/${workspace.organization_slug}/${workspace.slug}/settings?tab=billing`;
        const url = await checkout.mutateAsync({ plan_code: plan.code, success_path: back, cancel_path: back });
        setCheckout(url ? { url, from } : null);
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

  const checkoutNotice = (from: "plans" | "past_due") =>
    checkoutLink?.from === from ? (
      <Notice
        tone="info"
        icon={CreditCard}
        layout="inline"
        action={
          <ButtonLink href={checkoutLink.url} target="_blank" rel="noopener noreferrer" size="sm">
            {t("open_checkout")}
            <ExternalLink aria-hidden />
          </ButtonLink>
        }
      >
        {t("checkout_notice")}
      </Notice>
    ) : null;

  const priceValue = currentPlan ? (
    <SettingsValue className="tabular-nums">{formatPrice(currentPlan, locale, t)}</SettingsValue>
  ) : plans.isLoading ? (
    <Skeleton aria-hidden className="h-4 w-24 sm:ml-auto" />
  ) : plans.isError ? (
    // Owners get the retry in the plans section below; everyone else here.
    <span className="flex flex-wrap items-center gap-2 sm:justify-end">
      <span className="text-caption text-muted-foreground">{t("plans_error")}</span>
      {canManage.allowed ? null : (
        <Button type="button" variant="outline" size="sm" onClick={() => void plans.refetch()}>
          {t("retry")}
        </Button>
      )}
    </span>
  ) : (
    <SettingsValue>{t("price_unknown")}</SettingsValue>
  );

  let plansBody: ReactNode = null;
  if (canManage.allowed) {
    if (plans.isLoading) plansBody = <SettingsSkeletonRows rows={2} />;
    else if (plans.isError)
      plansBody = (
        <SettingsCard>
          <SettingsLoadError onRetry={() => void plans.refetch()}>{t("plans_error")}</SettingsLoadError>
        </SettingsCard>
      );
    else if (!plans.data?.length)
      plansBody = (
        <SettingsCard>
          <SettingsEmpty icon={<CreditCard aria-hidden />}>{t("plans_empty")}</SettingsEmpty>
        </SettingsCard>
      );
    else
      plansBody = (
        <>
          {checkoutNotice("plans")}
          <PlanCards
            plans={plans.data}
            currentCode={sub.plan_code}
            entitlements={view.entitlements}
            busy={busy}
            pendingCode={pendingCode}
            onChoose={(plan) => void choose(plan)}
          />
        </>
      );
  }

  const graceDate = formatDate(graceEnd(sub.current_period_end), locale);

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
            {priceValue}
          </SettingsRow>
          {sub.current_period_end ? (
            <SettingsRow label={t("period_end")} size="none">
              <SettingsValue className="tabular-nums">{formatDate(sub.current_period_end, locale)}</SettingsValue>
            </SettingsRow>
          ) : null}
        </SettingsCard>
        {pastDue ? (
          <Notice
            tone="warning"
            icon={TriangleAlert}
            layout="inline"
            live="off"
            action={
              canPayNow ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  aria-busy={pendingCode === currentPlan?.code}
                  onClick={() => currentPlan && void choose(currentPlan, "past_due")}
                >
                  {pendingCode === currentPlan?.code ? (
                    <Spinner aria-hidden aria-label={undefined} role="presentation" />
                  ) : null}
                  {t("past_due_pay")}
                </Button>
              ) : null
            }
          >
            {graceDate ? t("past_due_notice", { date: graceDate }) : t("past_due_notice_undated")}
            {canManage.allowed ? null : <> {t("past_due_ask_owner")}</>}
          </Notice>
        ) : null}
        {checkoutNotice("past_due")}
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
        {plansBody}
      </SettingsSection>

      {canManage.allowed && !sub.cancel_at && cancellable(currentPlan) ? (
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
            cancelLabel={t("confirm_back")}
            pending={cancel.isPending}
            onConfirm={confirmCancel}
          />
        </SettingsDangerZone>
      ) : null}
    </SettingsTab>
  );
}
