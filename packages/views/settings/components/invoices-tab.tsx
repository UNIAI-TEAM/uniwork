"use client";

import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBillingPermissions } from "@uniwork/core/permissions";
import { CollectionPageState } from "../../layout/collection-page";
import { useWorkspace } from "../../layout/workspace-context";
import { InvoicesPanel } from "./invoices-panel";
import { SettingsSkeletonRows, SettingsTab } from "./settings-layout";

export function InvoicesTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.invoices" });
  const { workspace } = useWorkspace();
  const orgId = workspace.organization_id;
  const { canView, isLoading: permissionsLoading } = useBillingPermissions(orgId);

  if (permissionsLoading) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <SettingsSkeletonRows rows={4} />
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

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      <InvoicesPanel orgId={orgId} />
    </SettingsTab>
  );
}
