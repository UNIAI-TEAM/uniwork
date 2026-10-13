"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plug, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type { ConnectedApp } from "@uniwork/core/api/endpoints/connect";
import { useMcpPolicy, useOrgConnectedApps, useRevokeOrgConnectedApp, useSetMcpPolicy } from "@uniwork/core/connect";
import { useOrgMembership } from "@uniwork/core/organizations";
import { Button } from "@uniwork/ui/components/ui/button";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { ConfirmDialog } from "../../common/form-dialog";
import { useWorkspace } from "../../layout/workspace-context";
import { toastApiError } from "../../toast-api-error";
import { CopyAddress } from "./copy-address";
import {
  SettingsBadge,
  SettingsCard,
  SettingsEmpty,
  SettingsList,
  SettingsListItem,
  SettingsLoadError,
  SettingsRow,
  SettingsSection,
  SettingsSkeletonRows,
  SettingsTab,
  SettingsTabSkeleton,
} from "./settings-layout";

const ADMIN_ROLES = new Set(["owner", "admin"]);

/**
 * Organization tab: the switch that lets members connect outside AI
 * assistants, and every connection made in the organization. Owner and admin
 * only. The server's `available` answer (the platform's own rollout flag)
 * decides the "not open yet" state, so a tab reached by URL never has to
 * guess it from a client flag.
 */
export function AiAccessTab() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.aiAccess" });
  const { workspace } = useWorkspace();
  const org = workspace.organization_slug;
  const membership = useOrgMembership(org);
  const isAdmin = !!membership.data && ADMIN_ROLES.has(membership.data.role);
  const policy = useMcpPolicy(org, { enabled: isAdmin });
  const setPolicy = useSetMcpPolicy(org);
  const grants = useOrgConnectedApps(org, { enabled: isAdmin });
  const revoke = useRevokeOrgConnectedApp(org);
  const [pending, setPending] = useState<ConnectedApp | null>(null);
  // One formatter per render. A date the server drifted on ("" or garbage)
  // reads as "", never a RangeError that would unmount the whole tab.
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  const day = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : dateFormat.format(d);
  };

  if (membership.isLoading) return <SettingsTabSkeleton />;
  if (!isAdmin) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <SettingsCard>
          <SettingsEmpty icon={<ShieldCheck aria-hidden />}>{t("adminOnly")}</SettingsEmpty>
        </SettingsCard>
      </SettingsTab>
    );
  }

  const busy = setPolicy.isPending;
  const rows = grants.data ?? [];
  // A date that did not parse drops out of the line instead of leaving a
  // dangling "connected ".
  const metaLine = (g: ConnectedApp) => {
    const created = day(g.created_at);
    return created ? t("meta", { user: g.user_name, created }) : g.user_name;
  };

  // The switch appears only once the server has answered: a read that failed,
  // or answered something the schema cannot use, is not "off", and a switch
  // shown before the answer would sit there dead. A background refetch that
  // fails keeps the answer already on screen.
  const state = policy.data;
  let toggle;
  if (policy.isPending) {
    toggle = <SettingsSkeletonRows rows={1} />;
  } else if (!state) {
    toggle = (
      <SettingsCard>
        <SettingsLoadError onRetry={() => void policy.refetch()} />
      </SettingsCard>
    );
  } else {
    toggle = (
      <SettingsCard>
        <SettingsRow label={t("toggleLabel")} description={t("toggleDescription")}>
          <Switch
            aria-label={t("toggleLabel")}
            checked={state.enabled}
            aria-busy={busy || undefined}
            aria-disabled={busy || (!state.available && !state.enabled) || undefined}
            className="aria-busy:opacity-60 pointer-coarse:after:-inset-y-[13px]"
            onCheckedChange={(next) => {
              // One write at a time; and while the platform has not opened
              // the feature an owner can still turn an old "on" off, never on.
              if (busy || (!state.available && next === true)) return;
              void setPolicy.mutateAsync(next === true).catch(() => undefined);
            }}
          />
        </SettingsRow>
      </SettingsCard>
    );
  }

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      <SettingsSection>
        {toggle}
        {state && !state.available ? <p className="px-1 pt-2 text-caption text-muted-foreground">{t("unavailable")}</p> : null}
        {setPolicy.isError ? (
          <p role="alert" className="px-1 pt-2 text-caption text-destructive">
            {t("saveFailed")}
          </p>
        ) : null}
      </SettingsSection>

      {state?.available && state.mcp_url ? (
        // Under an organization-level pilot a member's own settings may not
        // show the address yet (Ruling 50), so the admin can hand it over.
        <SettingsSection title={i18n.t("settings.connectedApps.connectTitle")} description={t("addressBody")}>
          <SettingsCard>
            <CopyAddress value={state.mcp_url} />
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <SettingsSection title={t("grantsTitle")}>
        {grants.isPending ? (
          <SettingsSkeletonRows rows={2} />
        ) : grants.isError ? (
          <SettingsCard>
            <SettingsLoadError onRetry={() => void grants.refetch()}>{t("error")}</SettingsLoadError>
          </SettingsCard>
        ) : rows.length === 0 ? (
          <SettingsCard>
            <SettingsEmpty icon={<Plug aria-hidden />}>{t("empty")}</SettingsEmpty>
          </SettingsCard>
        ) : (
          <SettingsList aria-label={t("grantsTitle")}>
            {rows.map((g) => (
              <SettingsListItem
                key={g.id}
                title={g.client_name}
                badge={g.verified ? <SettingsBadge tone="success">{i18n.t("settings.connectedApps.verified")}</SettingsBadge> : null}
                meta={metaLine(g)}
                actions={
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("revokeAria", { client: g.client_name, user: g.user_name })}
                    onClick={() => setPending(g)}
                  >
                    {t("revoke")}
                  </Button>
                }
              />
            ))}
          </SettingsList>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={t("revokeTitle", { client: pending?.client_name ?? "" })}
        description={t("revokeBody", { user: pending?.user_name ?? "" })}
        confirmLabel={t("revoke")}
        pending={revoke.isPending}
        onConfirm={() => {
          if (!pending) return;
          const client = pending.client_name;
          revoke.mutate(pending.id, {
            onSuccess: () => {
              setPending(null);
              toast.success(t("revoked", { client }));
            },
            onError: (err) => toastApiError(err, t("revokeFailed")),
          });
        }}
      />
    </SettingsTab>
  );
}
