"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ChevronRight, ScrollText } from "lucide-react";
import { useAuditEvents, type AuditQuery } from "@uniwork/core/audit";
import { useDebouncedValue } from "@uniwork/core/hooks/use-debounced-value";
import type { AuditEvent } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@uniwork/ui/components/ui/table";
import { cn } from "@uniwork/ui/lib/utils";
import {
  ActionIcon,
  ActorIcon,
  ChangeSummary,
  EventTime,
  shortId,
  useAuditLabels,
} from "../../audit/event-presenter";
import { CollectionPageState } from "../../layout/collection-page";
import { AuditDetailSheet } from "./audit-detail-sheet";
import { AuditFilters, EMPTY_FILTERS, type AuditFilterValues } from "./audit-filters";
import { SettingsCard, SettingsSection } from "./settings-layout";

/** A day the user picked becomes an instant the server can compare against. */
export function dayStart(value: string): string {
  return value ? new Date(`${value}T00:00:00`).toISOString() : "";
}

export function dayEnd(value: string): string {
  return value ? new Date(`${value}T23:59:59`).toISOString() : "";
}

function toQuery(filters: AuditFilterValues): AuditQuery {
  return {
    action: filters.action,
    actor_id: filters.actor_id.trim(),
    resource_type: filters.resource_type,
    from: dayStart(filters.from),
    to: dayEnd(filters.to),
  };
}

function LogSkeleton() {
  return (
    <div className="divide-y divide-border" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

export function AuditLog({ orgId, workspaceId }: { orgId: string; workspaceId: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit" });
  const labels = useAuditLabels();
  const [filters, setFilters] = useState<AuditFilterValues>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  // Best effort: the log is organization-wide, the member list is this
  // workspace's. A colleague from another workspace still shows as a short id.
  const members = useMembers(workspaceId);
  const names = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.user_id, m.display_name])),
    [members.data],
  );

  // Every filter applies as it changes. A picked member applies at once; typed
  // text waits for the typing to stop, and text that still matches a member's
  // name is a search in the picker, not an id, so it filters nothing yet.
  const actor = filters.actor_id.trim();
  const typedActor = useDebouncedValue(actor, 300);
  const searchingByName =
    actor !== "" &&
    !names.has(actor) &&
    [...names.values()].some((name) => name.toLowerCase().includes(actor.toLowerCase()));
  let appliedActor = "";
  if (names.has(actor)) appliedActor = actor;
  else if (typedActor === actor && !searchingByName) appliedActor = actor;
  const applied = toQuery({ ...filters, actor_id: appliedActor });

  const events = useAuditEvents(orgId, applied);
  const actorName = (event: AuditEvent) =>
    event.actor_kind === "system"
      ? labels.actorKind("system")
      : names.get(event.actor_id) ?? shortId(event.actor_id);

  const rows = events.data?.pages.flatMap((p) => p.events) ?? [];
  const filtering = Object.values(applied).some(Boolean);

  return (
    <>
      <SettingsSection>
        <AuditFilters
          filters={filters}
          onChange={setFilters}
          members={members.data ?? []}
          fetching={events.isFetching && !events.isFetchingNextPage && Boolean(events.data)}
        />
      </SettingsSection>

      <SettingsSection>
        {events.isLoading ? (
          <SettingsCard><LogSkeleton /></SettingsCard>
        ) : events.isError ? (
          <CollectionPageState
            icon={AlertCircle}
            tone="destructive"
            role="alert"
            title={t("error_title")}
            description={t("error_description")}
            actions={
              <Button variant="outline" onClick={() => void events.refetch()}>
                {t("retry")}
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <CollectionPageState
            icon={ScrollText}
            title={filtering ? t("empty_title") : t("empty_fresh_title")}
            description={filtering ? t("empty_description") : t("empty_fresh_description")}
            role="status"
            actions={
              filtering ? (
                <Button variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>
                  {t("filters.clear")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <SettingsCard className={cn(events.isPlaceholderData && "opacity-60 transition-opacity")}>
            {/* A page is capped at 100 rows by the API, so the table renders
                whole rather than virtualizing; paging is the cursor below. */}
            <div className="overflow-x-auto">
              <Table className="table-fixed md:min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[70%] pl-4 md:w-[34%]">{t("table.action")}</TableHead>
                    <TableHead className="hidden w-[18%] md:table-cell">{t("table.actor")}</TableHead>
                    <TableHead className="hidden w-[33%] md:table-cell">{t("table.changes")}</TableHead>
                    <TableHead className="w-[30%] pr-4 text-right md:w-[15%]">{t("table.time")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((event) => (
                    <TableRow
                      key={event.id}
                      className="group cursor-pointer hover:bg-surface-hover"
                      onClick={() => setSelected(event)}
                    >
                      <TableCell className="pl-4">
                        <button
                          type="button"
                          className="flex min-h-9 w-full items-center gap-3 text-left pointer-coarse:min-h-11"
                          onClick={(e) => { e.stopPropagation(); setSelected(event); }}
                        >
                          <ActionIcon action={event.action} />
                          <span className="min-w-0">
                            <span className="block truncate text-body font-medium">{labels.action(event.action)}</span>
                            <span className="block truncate text-caption text-muted-foreground">
                              {labels.resource(event.resource_type)}
                              <span className="md:hidden"> · {actorName(event)}</span>
                            </span>
                          </span>
                          <span className="sr-only">{t("table.row_label")}</span>
                        </button>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="flex items-center gap-1.5">
                          <ActorIcon kind={event.actor_kind} className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate" title={event.actor_id}>{actorName(event)}</span>
                        </span>
                      </TableCell>
                      <TableCell className="hidden overflow-hidden md:table-cell">
                        <ChangeSummary event={event} empty={t("table.no_changes")} />
                      </TableCell>
                      <TableCell className="pr-4 text-right whitespace-nowrap text-caption text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <EventTime iso={event.occurred_at} />
                          <ChevronRight aria-hidden className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SettingsCard>
        )}
        {events.hasNextPage ? (
          <div className="flex justify-center">
            <Button variant="outline" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
              {events.isFetchingNextPage ? <Spinner data-icon="inline-start" aria-label={t("loading")} /> : null}
              {t("load_more")}
            </Button>
          </div>
        ) : null}
      </SettingsSection>

      <AuditDetailSheet event={selected} actorName={selected ? actorName(selected) : ""} onClose={() => setSelected(null)} />
    </>
  );
}
