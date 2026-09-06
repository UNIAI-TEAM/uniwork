"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ChevronDown, ChevronRight, ScrollText, Search, X } from "lucide-react";
import { useAuditEvents, type AuditQuery } from "@uniwork/core/audit";
import type { AuditEvent } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@uniwork/ui/components/ui/native-select";
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
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
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
import { SettingsCard, SettingsSection } from "./settings-layout";

/**
 * The actions the UI knows to offer in the filter. The server may write more
 * (a newer release); those still render in the table under their raw name.
 */
const KNOWN_ACTIONS = [
  "auth.login_succeeded", "auth.login_failed", "auth.password_changed",
  "auth.password_reset_requested", "auth.session_revoked",
  "organization.created", "organization.updated", "member.invited", "member.joined",
  "member.removed", "member.role_changed", "workspace.created", "workspace.updated",
  "workspace_member.added", "workspace_member.removed", "workspace_member.role_changed",
  "workspace_agent.added", "agent.created", "agent.updated", "task.created", "task.updated",
  "task.deleted", "task.comment_added", "subscription.changed", "audit.retention_set",
  "audit.export_requested", "webhook.deliver",
];
const KNOWN_RESOURCES = [
  "task", "task_comment", "workspace", "workspace_member", "workspace_agent_member", "organization",
  "organization_member", "invitation", "agent", "user", "session", "subscription", "audit", "webhook",
];

/** Empty strings are dropped by the endpoint, so the draft can stay flat. */
const EMPTY_FILTERS = { action: "", actor_id: "", resource_type: "", from: "", to: "" };
type Filters = typeof EMPTY_FILTERS;

/** A day the user picked becomes an instant the server can compare against. */
export function dayStart(value: string): string {
  return value ? new Date(`${value}T00:00:00`).toISOString() : "";
}

export function dayEnd(value: string): string {
  return value ? new Date(`${value}T23:59:59`).toISOString() : "";
}

function toQuery(filters: Filters): AuditQuery {
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
  const isMobile = useIsMobile();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AuditQuery>({});
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const events = useAuditEvents(orgId, applied);
  // Best effort: the log is organization-wide, the member list is this
  // workspace's. A colleague from another workspace still shows as a short id.
  const members = useMembers(workspaceId);
  const names = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.user_id, m.display_name])),
    [members.data],
  );
  const actorName = (event: AuditEvent) =>
    event.actor_kind === "system"
      ? labels.actorKind("system")
      : names.get(event.actor_id) ?? shortId(event.actor_id);

  const rows = events.data?.pages.flatMap((p) => p.events) ?? [];
  const filtering = Object.values(applied).some(Boolean);
  const field = (key: keyof Filters) => (value: string) => setFilters({ ...filters, [key]: value });

  return (
    <>
      <SettingsSection>
        {/* On a phone the reader came for the rows, not the form: the filters
            fold behind one line and open on demand. Wider screens keep them
            in view, where five fields cost one row. */}
        <details open={!isMobile} className="group rounded-lg border border-border bg-surface">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-body font-medium md:hidden [&::-webkit-details-marker]:hidden">
            <Search aria-hidden className="size-4 text-muted-foreground" />
            {t("filters.legend")}
            {filtering ? <span className="size-1.5 rounded-full bg-primary" aria-label={t("filters.active")} /> : null}
            <ChevronDown aria-hidden className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
        <form
          role="search"
          aria-label={t("filters.legend")}
          className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(toQuery(filters));
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="audit-action">{t("filters.action")}</Label>
            <NativeSelect id="audit-action" className="w-full" value={filters.action} onChange={(e) => field("action")(e.target.value)}>
              <NativeSelectOption value="">{t("filters.any")}</NativeSelectOption>
              {KNOWN_ACTIONS.map((a) => (
                <NativeSelectOption key={a} value={a}>{labels.action(a)}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-resource">{t("filters.resource_type")}</Label>
            <NativeSelect id="audit-resource" className="w-full" value={filters.resource_type} onChange={(e) => field("resource_type")(e.target.value)}>
              <NativeSelectOption value="">{t("filters.any")}</NativeSelectOption>
              {KNOWN_RESOURCES.map((r) => (
                <NativeSelectOption key={r} value={r}>{labels.resource(r)}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-actor">{t("filters.actor")}</Label>
            <Input
              id="audit-actor"
              list="audit-actor-options"
              value={filters.actor_id}
              placeholder={t("filters.actor_placeholder")}
              onChange={(e) => field("actor_id")(e.target.value)}
            />
            <datalist id="audit-actor-options">
              {(members.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
              ))}
            </datalist>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-from">{t("filters.from")}</Label>
            <Input id="audit-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => field("from")(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-to">{t("filters.to")}</Label>
            <Input id="audit-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => field("to")(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
            <Button type="submit">
              <Search data-icon="inline-start" aria-hidden />
              {t("filters.apply")}
            </Button>
            {filtering || Object.values(filters).some(Boolean) ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setApplied({});
                }}
              >
                <X data-icon="inline-start" aria-hidden />
                {t("filters.clear")}
              </Button>
            ) : null}
            {events.isFetching && !events.isFetchingNextPage && events.data ? (
              <span role="status" className="ml-auto inline-flex items-center gap-1.5 text-caption text-muted-foreground">
                <Spinner className="size-3" aria-label={t("loading")} />
                {t("loading")}
              </span>
            ) : null}
          </div>
        </form>
        </details>
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
            title={t("empty_title")}
            description={filtering ? t("empty_description") : t("empty_fresh_description")}
            role="status"
            actions={
              filtering ? (
                <Button variant="outline" onClick={() => { setFilters(EMPTY_FILTERS); setApplied({}); }}>
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
                              {labels.resource(event.resource_type)} · {shortId(event.resource_id)}
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
