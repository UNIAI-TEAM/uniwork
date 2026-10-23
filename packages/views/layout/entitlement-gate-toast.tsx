"use client";

import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { subscribeEntitlementGateError, type EntitlementGateError } from "@uniwork/core/api";
import { useQuotaWarnings } from "@uniwork/core/billing/use-quota-warnings";
import { paths } from "@uniwork/core/paths";
import { useBillingPermissions } from "@uniwork/core/permissions";
import { useAuthStore } from "@uniwork/core/auth";
import { useNavigation } from "../navigation";
import { useWorkspace } from "./workspace-context";

function featureKeyFromFields(fields: Record<string, unknown> | undefined): string | undefined {
  const raw = fields?.feature;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function gateMessage(t: (key: string, opts?: Record<string, unknown>) => string, event: EntitlementGateError): string {
  if (event.code === "quota_exceeded") return t("gate_quota_exceeded");
  const feature = featureKeyFromFields(event.fields);
  if (feature) {
    return t("gate_entitlement_required_named", {
      feature: t(`settings.billing.features.${feature.replaceAll(".", "_")}`, { defaultValue: feature }),
    });
  }
  return t("gate_entitlement_required");
}

/**
 * C-05: toast when API gates refuse (quota / entitlement) and when a quota
 * threshold event targets the signed-in org admin.
 */
export function EntitlementGateToastHost() {
  const { t } = useTranslation(undefined, { keyPrefix: "entitlement.toast" });
  const { workspace } = useWorkspace();
  const userId = useAuthStore((s) => s.user?.id);
  const navigation = useNavigation();
  const billing = useBillingPermissions(workspace.organization_id);

  const openBilling = useCallback(() => {
    const base = paths.workspace(workspace.organization_slug, workspace.slug).settings();
    navigation.push(`${base}?tab=billing`);
  }, [navigation, workspace.organization_slug, workspace.slug]);

  useQuotaWarnings({
    organizationId: workspace.organization_id,
    userId,
    onThreshold: useCallback(() => {
      toast.warning(t("quota_threshold"), {
        action: billing.canView.allowed
          ? { label: t("view_billing"), onClick: openBilling }
          : undefined,
      });
    }, [billing.canView.allowed, openBilling, t]),
  });

  useEffect(() => {
    return subscribeEntitlementGateError((event) => {
      const message = gateMessage(t, event);
      const canOpenBilling = billing.canView.allowed || billing.canManage.allowed;
      toast.error(message, {
        action: canOpenBilling ? { label: t("view_billing"), onClick: openBilling } : undefined,
        description: canOpenBilling ? undefined : t("contact_admin"),
      });
    });
  }, [billing.canManage.allowed, billing.canView.allowed, openBilling, t]);

  return null;
}
