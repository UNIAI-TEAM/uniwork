"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Link2, MoreHorizontal, Plus, Unplug } from "lucide-react";
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
  type CalendarConnection,
  type CalendarProvider,
} from "@uniwork/core/api/endpoints/calendar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { CalendarProviderIcon } from "./calendar-provider-icons";

const PROVIDERS: CalendarProvider[] = ["google", "outlook"];

export function CalendarConnectionsDialog({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [connecting, setConnecting] = useState<CalendarProvider | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<CalendarProvider | null>(null);
  const connections = useCalendarConnections(workspaceId);
  const connectedProviders = new Set(connections.data?.map((item) => item.provider));
  const availableProviders = PROVIDERS.filter((provider) => !connectedProviders.has(provider));

  const refreshCalendar = () =>
    queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });

  const connect = async (provider: CalendarProvider) => {
    setError(false);
    setConnecting(provider);
    const popup = window.open(
      "about:blank",
      "uniwork-calendar-oauth",
      "popup,width=560,height=720",
    );
    if (!popup) {
      setConnecting(null);
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
        setConnecting(null);
        void refreshCalendar();
      }, 400);
    } catch {
      popup.close();
      setConnecting(null);
      setError(true);
    }
  };

  const disconnect = async () => {
    if (!disconnectTarget) return;
    const provider = disconnectTarget;
    setDisconnectTarget(null);
    setError(false);
    try {
      await disconnectCalendarConnection(workspaceId, provider);
      await refreshCalendar();
    } catch {
      setError(true);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
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
                  <span
                    aria-hidden
                    className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary"
                  />
                ) : null}
              </DialogTrigger>
            }
          />
          <TooltipContent side="bottom">
            {t("calendar.connected_calendars")}
          </TooltipContent>
        </Tooltip>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("calendar.connected_calendars")}</DialogTitle>
            <DialogDescription>
              {t("calendar.connected_calendars_description")}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-caption font-medium text-muted-foreground">
                {t("calendar.your_calendars")}
              </p>
              <span className="text-caption tabular-nums text-muted-foreground">
                {connections.data?.length ?? 0}
              </span>
            </div>

            {connections.isPending ? (
              <p className="py-5 text-center text-body text-muted-foreground">
                {t("calendar.loading_connections")}
              </p>
            ) : null}

            {!connections.isPending && (connections.data?.length ?? 0) === 0 ? (
              <div className="flex items-center gap-3 border-y border-surface-border py-4">
                <Link2 aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-body font-medium text-foreground">
                    {t("calendar.no_connected_calendars")}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {t("calendar.no_connected_calendars_description")}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="divide-y divide-surface-border">
              {connections.data?.map((connection) => (
                <ConnectedProviderRow
                  key={connection.provider}
                  workspaceId={workspaceId}
                  connection={connection}
                  onChanged={refreshCalendar}
                  onDisconnect={() => setDisconnectTarget(connection.provider)}
                  onError={() => setError(true)}
                />
              ))}
            </div>

            {availableProviders.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      className="mt-2 w-full justify-start px-1.5"
                      disabled={Boolean(connecting)}
                    />
                  }
                >
                  <Plus aria-hidden className="size-4" />
                  {connecting
                    ? t("calendar.connecting")
                    : t("calendar.add_calendar")}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-64">
                  {availableProviders.map((provider) => (
                    <DropdownMenuItem
                      key={provider}
                      className="gap-3 px-2 py-2"
                      onClick={() => void connect(provider)}
                    >
                      <CalendarProviderIcon provider={provider} className="size-6" />
                      <span translate="no" className="font-medium">
                        {providerName(t, provider)}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>

          {error || connections.isError ? (
            <p role="alert" aria-live="polite" className="text-body text-destructive">
              {t("calendar.connection_error")}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(disconnectTarget)}
        onOpenChange={(next) => {
          if (!next) setDisconnectTarget(null);
        }}
      >
        <AlertDialogContent nested>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("calendar.disconnect_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("calendar.disconnect_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void disconnect()}>
              {t("calendar.disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ConnectedProviderRow({
  workspaceId,
  connection,
  onChanged,
  onDisconnect,
  onError,
}: {
  workspaceId: string;
  connection: CalendarConnection;
  onChanged: () => Promise<void>;
  onDisconnect: () => void;
  onError: () => void;
}) {
  const { t } = useTranslation();
  const provider = connection.provider;
  const calendars = useExternalCalendars(workspaceId, provider);

  const toggle = async (id: string, checked: boolean) => {
    const ids = (calendars.data ?? [])
      .filter((item) => item.selected)
      .map((item) => item.id);
    const next = checked ? [...new Set([...ids, id])] : ids.filter((item) => item !== id);
    try {
      await selectExternalCalendars(workspaceId, provider, next);
      await onChanged();
    } catch {
      onError();
    }
  };

  return (
    <section className="py-3">
      <div className="flex min-w-0 items-center gap-3">
        <CalendarProviderIcon provider={provider} className="size-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p translate="no" className="truncate text-body font-medium text-foreground">
            {providerName(t, provider)}
          </p>
          <p className="truncate text-caption text-muted-foreground">{connection.email}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t("calendar.account_actions", {
                  provider: providerName(t, provider),
                })}
              />
            }
          >
            <MoreHorizontal aria-hidden className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onClick={onDisconnect}>
              <Unplug aria-hidden className="size-4" />
              {t("calendar.disconnect")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="ml-11 mt-2 border-l border-surface-border pl-3">
        {calendars.isPending ? (
          <p className="py-2 text-caption text-muted-foreground">
            {t("calendar.loading_calendars")}
          </p>
        ) : null}
        {calendars.isError ? (
          <p className="py-2 text-caption text-destructive">
            {t("calendar.calendars_load_error")}
          </p>
        ) : null}
        {calendars.data?.map((calendar) => (
          <label
            key={calendar.id}
            className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-accent"
          >
            <Checkbox
              checked={calendar.selected}
              onCheckedChange={(checked) => void toggle(calendar.id, checked === true)}
            />
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-muted-foreground"
              style={calendar.color ? { backgroundColor: calendar.color } : undefined}
            />
            <span className="min-w-0 flex-1 truncate text-body">{calendar.name}</span>
            {calendar.primary ? (
              <Check aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            ) : null}
          </label>
        ))}
      </div>
    </section>
  );
}

function providerName(
  t: ReturnType<typeof useTranslation>["t"],
  provider: CalendarProvider,
) {
  return t(provider === "google" ? "calendar.google_calendar" : "calendar.outlook_calendar");
}
