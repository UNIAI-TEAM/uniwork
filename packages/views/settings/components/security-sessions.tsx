"use client";

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { toastApiError } from "../../toast-api-error";
import { useRevokeOtherSessions, useRevokeSession, useSessions } from "@uniwork/core/auth";
import type { UserSession } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { ConfirmDialog } from "../../common/form-dialog";
import { cn } from "@uniwork/ui/lib/utils";
import { describeUserAgent, isLoopbackIp } from "./session-device";
import {
  SettingsBadge,
  SettingsCard,
  SettingsEmpty,
  SettingsList,
  SettingsListItem,
  SettingsLoadError,
  SettingsSection,
} from "./settings-layout";

/** The device glyph's tile, shared with the skeleton so loading and loaded rows line up. */
const DEVICE_TILE = "flex size-8 items-center justify-center rounded-md";

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
    body = <SessionsSkeleton />;
  } else if (sessions.isError) {
    body = (
      <SettingsCard>
        <SettingsLoadError onRetry={() => void sessions.refetch()}>{t("error")}</SettingsLoadError>
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
                <span className={cn(DEVICE_TILE, "bg-muted text-muted-foreground")}>
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

/** Loading rows in the list's own shape: a square device tile, not a round avatar. */
function SessionsSkeleton() {
  return (
    <div className="divide-y divide-border rounded-xl border border-surface-border bg-surface" aria-hidden>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
          <Skeleton className={DEVICE_TILE} />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
