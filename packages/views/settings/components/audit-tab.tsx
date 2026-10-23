"use client";

import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuditPermissions } from "@uniwork/core/permissions";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CollectionPageState } from "../../layout/collection-page";
import { useWorkspace } from "../../layout/workspace-context";
import { AuditExports, AuditRetention } from "./audit-exports";
import { AuditLog } from "./audit-log";
import { SettingsSkeletonRows, SettingsTab } from "./settings-layout";

/** The tab's shape while the role loads: the filter row, then the log's rows. */
function AuditTabSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-48" />
      </div>
      <SettingsSkeletonRows rows={5} withAvatar />
    </div>
  );
}

export function AuditTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit" });
  const { workspace } = useWorkspace();
  const orgId = workspace.organization_id;
  const { canRead, canManage, isLoading: permissionsLoading } = useAuditPermissions(orgId);

  if (permissionsLoading) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <AuditTabSkeleton />
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
          headingLevel={3}
        />
      </SettingsTab>
    );
  }

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      {/* The server sends an IP address to the owner only (viewsFor in
          audit_service.go), which is exactly who may manage audit settings. */}
      <AuditLog orgId={orgId} workspaceId={workspace.id} canSeeIp={canManage.allowed} />
      <AuditRetention orgId={orgId} canManage={canManage.allowed} />
      <AuditExports orgId={orgId} canManage={canManage.allowed} />
    </SettingsTab>
  );
}
