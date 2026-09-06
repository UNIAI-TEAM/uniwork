"use client";

import { useTranslation } from "react-i18next";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { useNotificationPreferences, useSetNotificationPreferences } from "@uniwork/core/notifications";
import { usePush } from "@uniwork/core/notifications/push";
import { NOTIFICATION_KINDS, type NotificationPreference } from "@uniwork/core/types";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { KindIcon } from "../../notifications/kind-icon";
import { SettingsCard, SettingsRow, SettingsSection, SettingsTab } from "./settings-layout";

type Channel = "in_app" | "push" | "email";

/**
 * Kind × channel matrix. Every switch saves on its own: there is no form
 * to submit, and a setting that needs a Save button is a setting nobody
 * changes. The push column exists only when the server can push and this
 * browser is subscribed.
 */
export function NotificationsTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.notifications" });
  const { t: tk } = useTranslation();
  const prefs = useNotificationPreferences();
  const save = useSetNotificationPreferences();
  const push = usePush();

  const rows: NotificationPreference[] = NOTIFICATION_KINDS.map(
    (kind) => prefs.data?.find((p) => p.kind === kind) ?? { kind, in_app: true, push: false, email: true },
  );
  const channels: Channel[] = push.available ? ["in_app", "push", "email"] : ["in_app", "email"];

  const toggle = (row: NotificationPreference, channel: Channel, value: boolean) => {
    save.mutate([{ ...row, [channel]: value }], {
      onSuccess: () => toast.success(t("toast_saved"), { id: "settings-auto-save" }),
      onError: () => toast.error(t("error")),
    });
  };

  const togglePush = async (on: boolean) => {
    try {
      if (on) await push.enable();
      else await push.disable();
      toast.success(t("toast_saved"), { id: "settings-auto-save" });
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      toast.error(code === "push_denied" ? t("push_denied") : t("error"));
    }
  };

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      {push.available ? (
        <SettingsSection title={t("push_section")} description={t("push_description")}>
          <SettingsCard>
            <SettingsRow label={t("push_this_browser")} size="none">
              <Switch
                aria-label={t("push_this_browser")}
                checked={push.subscribed}
                disabled={push.isPending || push.isLoading || push.permission === "denied"}
                onCheckedChange={(v) => void togglePush(v)}
              />
            </SettingsRow>
            {push.permission === "denied" ? (
              <p className="px-4 pb-3 text-caption text-warning">{t("push_denied")}</p>
            ) : null}
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <SettingsSection title={t("matrix_section")} description={t("matrix_description")}>
        <SettingsCard>
          {prefs.isLoading ? (
            <div className="space-y-2 p-4" aria-busy>
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body">
                <thead>
                  <tr className="text-left text-caption text-muted-foreground">
                    <th scope="col" className="px-4 py-2 font-medium">
                      {t("kind")}
                    </th>
                    {channels.map((c) => (
                      <th key={c} scope="col" className="px-3 py-2 text-center font-medium">
                        {t(`channel_${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.kind} className="border-t border-border">
                      <th scope="row" className="flex min-h-11 items-center gap-2 px-4 py-2 text-left font-normal">
                        <KindIcon kind={row.kind} className="size-4 shrink-0 text-muted-foreground" />
                        <span>{tk(`settings.notifications.kinds.${row.kind}`)}</span>
                      </th>
                      {channels.map((c) => (
                        <td key={c} className="px-3 py-2 text-center">
                          <Switch
                            size="sm"
                            aria-label={`${tk(`settings.notifications.kinds.${row.kind}`)} · ${t(`channel_${c}`)}`}
                            checked={row[c]}
                            disabled={save.isPending}
                            onCheckedChange={(v) => toggle(row, c, v)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SettingsCard>
        <p className="flex items-center gap-2 px-1 text-caption text-muted-foreground">
          <BellRing aria-hidden className="size-3.5" />
          {t("digest_hint")}
        </p>
      </SettingsSection>
    </SettingsTab>
  );
}
