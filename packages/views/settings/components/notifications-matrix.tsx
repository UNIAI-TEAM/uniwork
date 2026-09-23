"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useNotificationPreferences, useSetNotificationPreferences } from "@uniwork/core/notifications";
import { NOTIFICATION_KINDS, type NotificationPreference } from "@uniwork/core/types";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { KindIcon } from "../../notifications/kind-icon";
import { SettingsCard, SettingsSaveState, SettingsSection, type SettingsSaveStatus } from "./settings-layout";

export type Channel = "in_app" | "push" | "email";

type Kind = NotificationPreference["kind"];

const CELL = "w-18 px-2 py-2 text-center sm:w-24";

/**
 * Kind × channel matrix. Every switch saves on its own: there is no form to
 * submit, and a setting that needs a Save button is a setting nobody changes.
 * Only the rows being written wait; the rest of the matrix stays live. The
 * first row turns one channel on or off for every kind in a single request.
 */
export function NotificationsMatrix({ channels }: { channels: Channel[] }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.notifications" });
  const { t: tSave } = useTranslation(undefined, { keyPrefix: "settings.save" });
  const prefs = useNotificationPreferences();
  const save = useSetNotificationPreferences();
  // What the reader asked for, shown until the server answers; a pending row
  // ignores further toggles so two writes of one row cannot cross.
  const [inFlight, setInFlight] = useState<Partial<Record<Kind, NotificationPreference>>>({});
  const [status, setStatus] = useState<SettingsSaveStatus>("idle");

  const rows: NotificationPreference[] = NOTIFICATION_KINDS.map(
    (kind) =>
      inFlight[kind] ??
      prefs.data?.find((p) => p.kind === kind) ?? { kind, in_app: true, push: false, email: true },
  );
  const busy = (kind: Kind) => inFlight[kind] !== undefined;
  const kindLabel = (kind: Kind) => t(`kinds.${kind}`);
  const channelLabel = (c: Channel) => t(`channel_${c}`);

  const write = (next: NotificationPreference[]) => {
    if (next.length === 0) return;
    setInFlight((cur) => ({ ...cur, ...Object.fromEntries(next.map((p) => [p.kind, p])) }));
    setStatus("saving");
    save
      .mutateAsync(next)
      .then(
        () => setStatus("saved"),
        () => {
          setStatus("error");
          toast.error(t("error"));
        },
      )
      .finally(() =>
        setInFlight((cur) => {
          const rest = { ...cur };
          for (const p of next) delete rest[p.kind];
          return rest;
        }),
      );
  };

  const toggle = (row: NotificationPreference, channel: Channel, value: boolean) => {
    if (busy(row.kind)) return;
    write([{ ...row, [channel]: value }]);
  };

  const toggleChannel = (channel: Channel, value: boolean) => {
    if (rows.some((r) => busy(r.kind))) return;
    write(rows.filter((r) => r[channel] !== value).map((r) => ({ ...r, [channel]: value })));
  };

  return (
    <SettingsSection
      title={t("matrix_section")}
      description={t("matrix_description")}
      action={
        <SettingsSaveState
          status={status}
          savingLabel={tSave("saving")}
          savedLabel={tSave("saved")}
          errorLabel={tSave("error")}
        />
      }
    >
      <SettingsCard>
        {prefs.isLoading ? (
          <MatrixSkeleton columns={channels.length} />
        ) : (
          <table className="w-full table-fixed text-body">
            <thead>
              <tr className="text-caption text-muted-foreground">
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  {t("kind")}
                </th>
                {channels.map((c) => (
                  <th key={c} scope="col" className={`${CELL} font-medium`}>
                    {channelLabel(c)}
                  </th>
                ))}
              </tr>
              <tr className="border-t border-border bg-muted/40">
                <th scope="row" className="px-4 py-2 text-left text-caption font-medium text-muted-foreground">
                  {t("all_kinds")}
                </th>
                {channels.map((c) => {
                  const allOn = rows.every((r) => r[c]);
                  const anyBusy = rows.some((r) => busy(r.kind));
                  return (
                    <td key={c} className={CELL}>
                      <Switch
                        size="sm"
                        aria-label={t("channel_all", { channel: channelLabel(c) })}
                        aria-busy={anyBusy || undefined}
                        className="aria-busy:opacity-60"
                        checked={allOn}
                        onCheckedChange={(v) => toggleChannel(c, v)}
                      />
                    </td>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.kind} className="border-t border-border">
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    <span className="flex min-h-7 items-center gap-2">
                      <KindIcon kind={row.kind} className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 text-pretty">{kindLabel(row.kind)}</span>
                    </span>
                  </th>
                  {channels.map((c) => (
                    <td key={c} className={CELL}>
                      <Switch
                        size="sm"
                        aria-label={`${kindLabel(row.kind)} · ${channelLabel(c)}`}
                        aria-busy={busy(row.kind) || undefined}
                        className="aria-busy:opacity-60"
                        checked={row[c]}
                        onCheckedChange={(v) => toggle(row, c, v)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

/** The matrix's own shape while it loads: a label column and one switch per channel. */
function MatrixSkeleton({ columns }: { columns: number }) {
  return (
    <div aria-hidden className="divide-y divide-border">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Skeleton className="h-3 w-12" />
        <div className="ml-auto flex">
          {Array.from({ length: columns }, (_, i) => (
            <div key={i} className="flex w-18 justify-center sm:w-24">
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      </div>
      {Array.from({ length: 6 }, (_, row) => (
        <div key={row} className="flex min-h-11 items-center gap-3 px-4">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-3.5 w-36 max-w-[40%]" />
          <div className="ml-auto flex">
            {Array.from({ length: columns }, (_, i) => (
              <div key={i} className="flex w-18 justify-center sm:w-24">
                <Skeleton className="h-3.5 w-6 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
