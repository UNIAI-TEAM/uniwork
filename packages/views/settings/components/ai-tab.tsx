"use client";

import { AlertCircle, ShieldAlert, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities } from "@uniwork/core/ai";
import { useMyMembership } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { AiUsageSection } from "../../ai/ai-usage-section";
import { Notice } from "../../common/notice";
import { CollectionPageState } from "../../layout/collection-page";
import { useWorkspace } from "../../layout/workspace-context";
import { QuotaMeterRow } from "./quota-meter";
import { SettingsCard, SettingsSection, SettingsSkeletonRows, SettingsTab } from "./settings-layout";

const ADMIN_ROLES = new Set(["owner", "admin"]);

/**
 * Settings → AI: calls made from this workspace (spec F-09 §6), plus the
 * organization's token quota they draw on. Mirrors AskUNIService.Capabilities
 * and WorkspaceUsage (owner/admin).
 *
 * `enabled` is the deployment's gateway (AI_PROVIDER in .env.example): no
 * organization setting turns it on, so the off state names who can.
 */
export function AiTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.ai" });
  const { workspace } = useWorkspace();
  const me = useMyMembership(workspace.id);
  const caps = useAiCapabilities(workspace.id);

  if (me.isLoading || caps.isLoading) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <SettingsSkeletonRows rows={1} />
        <SettingsSkeletonRows rows={2} />
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

  const enabled = caps.data?.enabled === true;
  const quota = caps.data?.quota;

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      {caps.isError ? (
        <Notice
          tone="destructive"
          icon={AlertCircle}
          layout="inline"
          live="assertive"
          action={
            <Button type="button" size="sm" variant="outline" onClick={() => void caps.refetch()}>
              {t("retry")}
            </Button>
          }
        >
          {t("capabilities_error")}
        </Notice>
      ) : enabled ? (
        <SettingsSection title={t("quota_title")} description={t("quota_description")}>
          <SettingsCard>
            <QuotaMeterRow
              label={t("quota_label")}
              used={quota?.used_tokens ?? 0}
              limit={quota?.limit_tokens ?? null}
              unit="tokens"
            />
          </SettingsCard>
        </SettingsSection>
      ) : (
        <SettingsCard>
          <CollectionPageState
            icon={Sparkles}
            title={t("disabled_title")}
            description={t("disabled_description")}
            role="status"
            className="py-10"
          />
        </SettingsCard>
      )}
      <AiUsageSection workspaceId={workspace.id} aiEnabled={enabled} />
    </SettingsTab>
  );
}
