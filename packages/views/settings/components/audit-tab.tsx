"use client";

import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuditPermissions } from "@uniwork/core/permissions";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CollectionPageState } from "../../layout/collection-page";
import { useWorkspace } from "../../layout/workspace-context";
import { AuditExports, AuditRetention } from "./audit-exports";
import { AuditLog } from "./audit-log";
import { SettingsTab } from "./settings-layout";

export function AuditTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit" });
  const { workspace } = useWorkspace();
  const orgId = workspace.organization_id;
  const { canRead, canManage, isLoading: permissionsLoading } = useAuditPermissions(orgId);

  if (permissionsLoading) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <Skeleton className="h-64 w-full" />
      </SettingsTab>
    );
  }

  if (!canRead.allowed) {
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

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      <AuditLog orgId={orgId} workspaceId={workspace.id} />
      <AuditRetention orgId={orgId} canManage={canManage.allowed} />
      <AuditExports orgId={orgId} canManage={canManage.allowed} />
    </SettingsTab>
  );
}
