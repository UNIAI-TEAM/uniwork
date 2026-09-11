"use client";

import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities } from "@uniwork/core/ai";
import { useMyMembership } from "@uniwork/core/workspaces";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { AiUsageSection } from "../../ai/ai-usage-section";
import { CollectionPageState } from "../../layout/collection-page";
import { useWorkspace } from "../../layout/workspace-context";
import { SettingsTab } from "./settings-layout";

const ADMIN_ROLES = new Set(["owner", "admin"]);

/** Settings → AI: usage of this workspace (spec F-09 §6). Mirrors AskUNIService.WorkspaceUsage (owner/admin). */
export function AiTab() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.ai" });
  const { workspace } = useWorkspace();
  const me = useMyMembership(workspace.id);
  const caps = useAiCapabilities(workspace.id);

  if (me.isLoading) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <Skeleton className="h-48 w-full" />
      </SettingsTab>
    );
  }
  if (!me.data || !ADMIN_ROLES.has(me.data.role)) {
    return (
      <SettingsTab title={t("title")}>
        <CollectionPageState icon={ShieldAlert} title={t("forbidden_title")} description={t("forbidden_description")} role="status" />
      </SettingsTab>
    );
  }
  const quota = caps.data?.quota;
  const quotaLine = caps.data?.enabled
    ? quota?.limit_tokens != null
      ? t("quota_line", { used: quota.used_tokens.toLocaleString(i18n.language), limit: quota.limit_tokens.toLocaleString(i18n.language) })
      : t("quota_unbounded", { used: (quota?.used_tokens ?? 0).toLocaleString(i18n.language) })
    : t("disabled");
  return (
    <SettingsTab title={t("title")} description={quotaLine}>
      <AiUsageSection workspaceId={workspace.id} />
    </SettingsTab>
  );
}
