"use client";

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { toastApiError } from "../../toast-api-error";
import { useRevokeOtherSessions, useRevokeSession, useSessions } from "@uniwork/core/auth";
import type { UserSession } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { ConfirmDialog } from "../../common/form-dialog";
import { describeUserAgent, isLoopbackIp } from "./session-device";
import {
  SettingsBadge,
  SettingsCard,
  SettingsCardBody,
  SettingsEmpty,
  SettingsList,
  SettingsListItem,
  SettingsSection,
  SettingsSkeletonRows,
} from "./settings-layout";

type PendingRevoke = { kind: "one"; id: string; device: string } | { kind: "others"; count: number } | null;

function useSessionText() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.security.sessions" });
  return {
    device(session: UserSession): { label: string; mobile: boolean } {
      const { browser, os, platform } = describeUserAgent(session.user_agent);
      const label =
        browser && os
          ? t("device", { browser, os })
          : browser
            ? browser
            : os
              ? t("deviceOsOnly", { os })
              : t("unknownBrowser");
      return { label, mobile: platform === "mobile" };
    },
    meta(session: UserSession): string {
      const at = session.last_seen_at ? new Date(session.last_seen_at).toLocaleString(i18n.language) : "";
      const place = !session.ip ? "" : isLoopbackIp(session.ip) ? t("localMachine") : t("ip", { ip: session.ip });
      const active = at ? t("activeAt", { at }) : "";
      return [place, active].filter(Boolean).join(" · ");
    },
  };
}

/**
 * Every signed-in browser, this one first-class. Both revoke paths confirm
 * first: a revoked session is signed out and cannot be brought back.
 */
export function SessionsSection() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.security.sessions" });
  const text = useSessionText();
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [pending, setPending] = useState<PendingRevoke>(null);

  const rows: UserSession[] = sessions.data ?? [];
  const others = rows.filter((s) => !s.current).length;

  const confirm = () => {
    if (!pending) return;
    if (pending.kind === "one") {
      revoke.mutate(pending.id, {
        onSuccess: () => {
          setPending(null);
          toast.success(t("revokedOne"));
        },
        onError: (err) => toastApiError(err, t("revokeFailed")),
      });
      return;
    }
    revokeOthers.mutate(undefined, {
      onSuccess: () => {
        setPending(null);
        toast.success(t("revokedOthers"));
      },
      onError: (err) => toastApiError(err, t("revokeFailed")),
    });
  };

  let body;
  if (sessions.isPending) {
    body = <SettingsSkeletonRows rows={2} withAvatar />;
  } else if (sessions.isError) {
    body = (
      <SettingsCard>
        <SettingsCardBody className="flex items-center justify-between gap-3">
          <span role="alert" className="text-body">
            {t("error")}
          </span>
          <Button variant="outline" size="sm" onClick={() => void sessions.refetch()}>
            {t("retry")}
          </Button>
        </SettingsCardBody>
      </SettingsCard>
    );
  } else if (rows.length === 0) {
    body = (
      <SettingsCard>
        <SettingsEmpty icon={<Monitor aria-hidden />}>{t("empty")}</SettingsEmpty>
      </SettingsCard>
    );
  } else {
    body = (
      <SettingsList aria-label={t("section")}>
        {rows.map((s) => {
          const device = text.device(s);
          const Icon = device.mobile ? Smartphone : Monitor;
          return (
            <SettingsListItem
              key={s.id}
              leading={
                <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon aria-hidden className="size-4" />
                </span>
              }
              title={device.label}
              badge={s.current ? <SettingsBadge tone="success">{t("current")}</SettingsBadge> : null}
              meta={text.meta(s)}
              actions={
                s.current ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("revokeAria", { device: device.label })}
                    onClick={() => setPending({ kind: "one", id: s.id, device: device.label })}
                  >
                    {t("revoke")}
                  </Button>
                )
              }
            />
          );
        })}
      </SettingsList>
    );
  }

  return (
    <SettingsSection
      title={t("section")}
      description={t("description")}
      action={
        others > 0 ? (
          <Button variant="outline" size="sm" onClick={() => setPending({ kind: "others", count: others })}>
            {t("revokeOthers", { count: others })}
          </Button>
        ) : null
      }
    >
      {body}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={
          pending?.kind === "others"
            ? t("revokeOthersTitle", { count: pending.count })
            : t("revokeTitle", { device: pending?.device ?? "" })
        }
        description={pending?.kind === "others" ? t("revokeOthersBody") : t("revokeBody")}
        confirmLabel={pending?.kind === "others" ? t("revokeOthers", { count: pending.count }) : t("revoke")}
        pending={revoke.isPending || revokeOthers.isPending}
        onConfirm={confirm}
      />
    </SettingsSection>
  );
}
