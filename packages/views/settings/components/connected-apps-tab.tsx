"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Plug } from "lucide-react";
import { toast } from "sonner";
import type { ConnectedApp } from "@uniwork/core/api/endpoints/connect";
import { useMyConnectedApps, useRevokeMyConnectedApp } from "@uniwork/core/connect";
import { Button } from "@uniwork/ui/components/ui/button";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { ConfirmDialog } from "../../common/form-dialog";
import { toastApiError } from "../../toast-api-error";
import {
  SettingsBadge,
  SettingsCard,
  SettingsCardBody,
  SettingsEmpty,
  SettingsList,
  SettingsListItem,
  SettingsLoadError,
  SettingsSection,
  SettingsTab,
  SettingsTabSkeleton,
} from "./settings-layout";

/**
 * Personal tab: the AI assistants this person let read UniWork, and the one
 * address they paste into an assistant to connect it. The connect panel sits
 * above the list because the empty line points at it ("the address above").
 */
export function ConnectedAppsTab() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.connectedApps" });
  const apps = useMyConnectedApps();
  const revoke = useRevokeMyConnectedApp();
  const [pending, setPending] = useState<ConnectedApp | null>(null);
  const day = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(new Date(iso));

  if (apps.isPending) return <SettingsTabSkeleton />;

  const rows = apps.data?.grants ?? [];
  let body;
  if (apps.isError) {
    body = (
      <SettingsCard>
        <SettingsLoadError onRetry={() => void apps.refetch()}>{t("error")}</SettingsLoadError>
      </SettingsCard>
    );
  } else if (rows.length === 0) {
    body = (
      <SettingsCard>
        <SettingsEmpty icon={<Plug aria-hidden />}>{t("empty")}</SettingsEmpty>
      </SettingsCard>
    );
  } else {
    body = (
      <SettingsList aria-label={t("section")}>
        {rows.map((g) => (
          <SettingsListItem
            key={g.id}
            title={g.client_name}
            badge={g.verified ? <SettingsBadge tone="success">{t("verified")}</SettingsBadge> : null}
            meta={[
              t("meta", { org: g.organization_name, created: day(g.created_at) }),
              g.last_used_at ? t("lastUsed", { when: day(g.last_used_at) }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            actions={
              <Button variant="ghost" size="sm" aria-label={t("revokeAria", { client: g.client_name })} onClick={() => setPending(g)}>
                {t("revoke")}
              </Button>
            }
          />
        ))}
      </SettingsList>
    );
  }

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      {apps.data?.mcp_url ? (
        <SettingsSection title={t("connectTitle")} description={t("connectBody")}>
          <SettingsCard>
            <CopyAddress value={apps.data.mcp_url} />
          </SettingsCard>
        </SettingsSection>
      ) : null}
      <SettingsSection title={t("section")}>{body}</SettingsSection>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={t("revokeTitle", { client: pending?.client_name ?? "" })}
        description={t("revokeBody")}
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

/**
 * The address and its copy button. The confirmation goes through a status
 * region that stays mounted so a screen reader hears it; a copy the browser
 * refuses says so, since the address on screen is then the only way out.
 */
function CopyAddress({ value }: { value: string }) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.connectedApps" });
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <SettingsCardBody className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all text-caption">{value}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t("copy")}
        onClick={async () => {
          if (await copyText(value)) {
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          } else {
            toast.error(i18n.t("settings.workspace.copy_failed"));
          }
        }}
      >
        {copied ? <Check aria-hidden className="text-success" /> : <Copy aria-hidden />}
      </Button>
      <span role="status" className="sr-only">
        {copied ? t("copied") : ""}
      </span>
    </SettingsCardBody>
  );
}
