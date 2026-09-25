"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNotificationPreferences, useSetNotificationPreferences } from "@uniwork/core/notifications";
import { NOTIFICATION_KINDS, type NotificationPreference } from "@uniwork/core/types";
import { tintForegroundClass, tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";
import { KindIcon } from "../../notifications/kind-icon";
import { kindTone } from "../../notifications/kind-tone";
import { CATEGORY_TONE, INBOX_CATEGORIES, inboxCategory } from "../../notifications/notification-category";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsLoadError,
  SettingsSaveState,
  SettingsSection,
  type SettingsSaveStatus,
} from "./settings-layout";

export type Channel = "in_app" | "push" | "email";

type Kind = NotificationPreference["kind"];

const CELL = "w-18 px-2 py-2 text-center sm:w-24 pointer-coarse:py-0";
/**
 * A row holding switches is 44px tall on a coarse pointer, and each small
 * switch's invisible hit area grows to fill it (14px + 2×15px), so a finger
 * has a full target without the desktop matrix growing.
 */
const SWITCH_ROW = "pointer-coarse:h-11";
const SWITCH_HIT = "aria-busy:opacity-60 pointer-coarse:after:-inset-y-3.75";
/** The "every kind" checkbox: 16px, its hit area grown to 44px under a finger. */
const CHECK_HIT = "mx-auto aria-busy:opacity-60 pointer-coarse:after:-inset-y-3.5";

/**
 * The server fills every kind it knows with defaults; a kind it did not send
 * (an older server) reads as those same defaults, mirrored from `DefaultPrefs`
 * in `server/internal/notification/prefs.go`.
 */
function serverDefault(kind: Kind): NotificationPreference {
  const push = kind === "mentioned" || kind === "task_assigned" || kind === "meeting_starting";
  return { kind, in_app: true, push, email: true };
}

/**
 * Kind × channel matrix. Every switch saves on its own: there is no form to
 * submit, and a setting that needs a Save button is a setting nobody changes.
 * Only the rows being written wait; the rest of the matrix stays live. The
 * first row turns one channel on or off for every kind in a single request;
 * it is a checkbox, not a switch, because it has a third state — on for some
 * kinds — that a switch would pass off as "off". The kinds are grouped the
 * way the inbox filters them, each with its module's colour.
 */
export function NotificationsMatrix({ channels, footnotes }: { channels: Channel[]; footnotes?: ReactNode }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.notifications" });
  const { t: tSave } = useTranslation(undefined, { keyPrefix: "settings.save" });
  const { t: tInbox } = useTranslation(undefined, { keyPrefix: "notifications" });
  const prefs = useNotificationPreferences();
  const save = useSetNotificationPreferences();
  // What the reader asked for, shown until the server answers; a pending row
  // ignores further toggles so two writes of one row cannot cross.
  const [inFlight, setInFlight] = useState<Partial<Record<Kind, NotificationPreference>>>({});
  const [status, setStatus] = useState<SettingsSaveStatus>("idle");

  // Nothing is shown or written until the reader's real preferences are in:
  // a guessed row saved by a toggle would overwrite what they chose before.
  const loaded = prefs.data !== undefined;
  const rows: NotificationPreference[] = NOTIFICATION_KINDS.map(
    (kind) => inFlight[kind] ?? prefs.data?.find((p) => p.kind === kind) ?? serverDefault(kind),
  );
  const busy = (kind: Kind) => inFlight[kind] !== undefined;
  const kindLabel = (kind: Kind) => t(`kinds.${kind}`);
  const channelLabel = (c: Channel) => t(`channel_${c}`);

  const write = (next: NotificationPreference[]) => {
    if (!loaded || next.length === 0) return;
    setInFlight((cur) => ({ ...cur, ...Object.fromEntries(next.map((p) => [p.kind, p])) }));
    setStatus("saving");
    // A toggle reports through the inline save state only, never a toast.
    save
      .mutateAsync(next)
      .then(
        () => setStatus("saved"),
        () => setStatus("error"),
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
        {!loaded ? (
          prefs.isError ? (
            <SettingsLoadError onRetry={() => void prefs.refetch()} />
          ) : (
            <MatrixSkeleton columns={channels.length} />
          )
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
              <tr className={`border-t border-border bg-muted/40 ${SWITCH_ROW}`}>
                <th scope="row" className="px-4 py-2 text-left text-caption font-medium text-muted-foreground">
                  {t("all_kinds")}
                </th>
                {channels.map((c) => {
                  const allOn = rows.every((r) => r[c]);
                  const someOn = !allOn && rows.some((r) => r[c]);
                  const anyBusy = rows.some((r) => busy(r.kind));
                  return (
                    <td key={c} className={CELL}>
                      <Checkbox
                        aria-label={t("channel_all", { channel: channelLabel(c) })}
                        aria-busy={anyBusy || undefined}
                        className={CHECK_HIT}
                        checked={allOn}
                        indeterminate={someOn}
                        // Mixed turns everything on, the way a "select all" does.
                        onCheckedChange={() => toggleChannel(c, !allOn)}
                      />
                    </td>
                  );
                })}
              </tr>
            </thead>
            {INBOX_CATEGORIES.map((category) => {
              const group = rows.filter((r) => inboxCategory(r.kind) === category);
              if (group.length === 0) return null;
              return (
                <tbody key={category}>
                  <tr className="border-t border-border">
                    <th
                      scope="rowgroup"
                      colSpan={channels.length + 1}
                      className="px-4 pt-3 pb-1 text-left text-overline font-medium text-muted-foreground"
                    >
                      <span className="flex items-center gap-2">
                        <span aria-hidden className={cn("size-2 rounded-full", tintSolidClass[CATEGORY_TONE[category]])} />
                        {tInbox(`category.${category}`)}
                      </span>
                    </th>
                  </tr>
                  {group.map((row) => (
                    <tr key={row.kind} className={`border-t border-border ${SWITCH_ROW}`}>
                      <th scope="row" className="px-4 py-2 text-left font-normal">
                        <span className="flex min-h-7 items-center gap-2">
                          <KindIcon kind={row.kind} className={cn("size-4 shrink-0", tintForegroundClass[kindTone(row.kind)])} />
                          <span className="min-w-0 text-pretty">{kindLabel(row.kind)}</span>
                        </span>
                      </th>
                      {channels.map((c) => (
                        <td key={c} className={CELL}>
                          <Switch
                            size="sm"
                            aria-label={`${kindLabel(row.kind)} · ${channelLabel(c)}`}
                            aria-busy={busy(row.kind) || undefined}
                            className={SWITCH_HIT}
                            checked={row[c]}
                            onCheckedChange={(v) => toggle(row, c, v)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        )}
        {footnotes ? <SettingsCardBody>{footnotes}</SettingsCardBody> : null}
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
