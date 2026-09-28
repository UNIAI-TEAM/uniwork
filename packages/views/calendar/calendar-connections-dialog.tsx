"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Link2, Unplug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  calendarKeys,
  useCalendarConnections,
  useExternalCalendars,
} from "@uniwork/core/calendar";
import {
  disconnectCalendarConnection,
  selectExternalCalendars,
  startCalendarConnection,
  type CalendarProvider,
} from "@uniwork/core/api/endpoints/calendar";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@uniwork/ui/components/ui/dialog";

const PROVIDERS: CalendarProvider[] = ["google", "outlook"];

export function CalendarConnectionsDialog({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const connections = useCalendarConnections(workspaceId);

  const connect = async (provider: CalendarProvider) => {
    setError(false);
    const popup = window.open(
      "about:blank",
      "uniwork-calendar-oauth",
      "popup,width=560,height=720",
    );
    if (!popup) {
      setError(true);
      return;
    }
    try {
      const url = await startCalendarConnection(workspaceId, provider);
      if (!url) throw new Error("Missing calendar authorization URL");
      popup.location.href = url;
      const timer = window.setInterval(() => {
        if (!popup.closed) return;
        window.clearInterval(timer);
        void qc.invalidateQueries({ queryKey: calendarKeys.connections(workspaceId) });
      }, 400);
    } catch {
      popup?.close();
      setError(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="toolbar"
            className="relative"
            aria-label={t("calendar.connected_calendars")}
          />
        }
      >
        <Link2 aria-hidden className="size-4" />
        {(connections.data?.length ?? 0) > 0 ? (
          <span aria-hidden className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary" />
        ) : null}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("calendar.connected_calendars")}</DialogTitle>
          <DialogDescription>{t("calendar.connected_calendars_description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 overflow-y-auto pr-1">
          {PROVIDERS.map((provider) => (
            <ProviderRow
              key={provider}
              workspaceId={workspaceId}
              provider={provider}
              connection={connections.data?.find((item) => item.provider === provider)}
              onConnect={() => void connect(provider)}
              onChanged={() =>
                void qc.invalidateQueries({ queryKey: calendarKeys.connections(workspaceId) })
              }
              onError={() => setError(true)}
            />
          ))}
        </div>
        {error || connections.isError ? (
          <p role="alert" className="text-body text-destructive">
            {t("calendar.connection_error")}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ProviderRow({ workspaceId, provider, connection, onConnect, onChanged, onError }: {
  workspaceId: string;
  provider: CalendarProvider;
  connection?: { email: string };
  onConnect: () => void;
  onChanged: () => void;
  onError: () => void;
}) {
  const { t } = useTranslation();
  const calendars = useExternalCalendars(workspaceId, provider, Boolean(connection));
  const toggle = async (id: string, checked: boolean) => {
    const ids = (calendars.data ?? []).filter((item) => item.selected).map((item) => item.id);
    const next = checked ? [...new Set([...ids, id])] : ids.filter((item) => item !== id);
    try {
      await selectExternalCalendars(workspaceId, provider, next);
      await calendars.refetch();
    } catch {
      onError();
    }
  };

  return (
    <section className="rounded-lg border border-surface-border p-3">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-md bg-surface-hover text-foreground">
          <CalendarDays aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-foreground">
            {t(provider === "google" ? "calendar.google_calendar" : "calendar.outlook_calendar")}
          </p>
          <p className="truncate text-caption text-muted-foreground">
            {connection?.email ?? t("calendar.not_connected")}
          </p>
        </div>
        {connection ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void disconnectCalendarConnection(workspaceId, provider)
                .then(onChanged)
                .catch(onError)
            }
          >
            <Unplug aria-hidden className="size-4" />
            {t("calendar.disconnect")}
          </Button>
        ) : (
          <Button size="sm" onClick={onConnect}>
            {t("calendar.connect")}
          </Button>
        )}
      </div>
      {connection ? (
        <div className="mt-3 grid gap-1 border-t border-surface-border pt-3">
          {calendars.isError ? (
            <p className="px-2 text-caption text-destructive">
              {t("calendar.calendars_load_error")}
            </p>
          ) : null}
          {calendars.data?.map((calendar) => (
            <label key={calendar.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-surface-hover">
              <Checkbox checked={calendar.selected} onCheckedChange={(checked) => void toggle(calendar.id, checked === true)} />
              <span className="size-2 rounded-full bg-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-body">{calendar.name}</span>
              {calendar.primary ? <Check aria-hidden className="size-3.5 text-muted-foreground" /> : null}
            </label>
          ))}
        </div>
      ) : null}
    </section>
  );
}
