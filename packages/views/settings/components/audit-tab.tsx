"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Download, ScrollText, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  useAuditEvents,
  useAuditExports,
  useAuditRetention,
  useCreateAuditExport,
  useSetAuditRetention,
  type AuditQuery,
} from "@uniwork/core/audit";
import { useAuditPermissions } from "@uniwork/core/permissions";
import type { AuditEvent } from "@uniwork/core/types";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { NativeSelect } from "@uniwork/ui/components/ui/native-select";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@uniwork/ui/components/ui/table";
import { CollectionPageState } from "../../layout/collection-page";
import { useWorkspace } from "../../layout/workspace-context";
import { AuditDetailSheet } from "./audit-detail-sheet";
import { SettingsCard, SettingsSection, SettingsTab } from "./settings-layout";

/** Empty strings are dropped by the endpoint, so the draft can stay flat. */
const EMPTY_FILTERS = { action: "", actor_id: "", resource_type: "", from: "", to: "" };
type Filters = typeof EMPTY_FILTERS;

/** A day the user picked becomes an instant the server can compare against. */
function dayStart(value: string): string {
  return value ? new Date(`${value}T00:00:00`).toISOString() : "";
}

function dayEnd(value: string): string {
  return value ? new Date(`${value}T23:59:59`).toISOString() : "";
}

function toQuery(filters: Filters): AuditQuery {
  return {
    action: filters.action.trim(),
    actor_id: filters.actor_id.trim(),
    resource_type: filters.resource_type.trim(),
    from: dayStart(filters.from),
    to: dayEnd(filters.to),
  };
}

function changeSummary(event: AuditEvent): string {
  const fields = Object.keys(event.changes ?? {});
  return fields.join(", ");
}

export function AuditTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit" });
  const { workspace } = useWorkspace();
  const orgId = workspace.organization_id;
  const { canRead, canManage, isLoading: permissionsLoading } = useAuditPermissions(orgId);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AuditQuery>({});
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const events = useAuditEvents(canRead.allowed ? orgId : "", applied);
  const retention = useAuditRetention(canRead.allowed ? orgId : "");
  const exports = useAuditExports(canRead.allowed ? orgId : "");
  const setRetention = useSetAuditRetention(orgId);
  const createExport = useCreateAuditExport(orgId);

  const [retainDays, setRetainDays] = useState("");
  const [exportRange, setExportRange] = useState({ format: "csv", from: "", to: "" });

  if (permissionsLoading) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <Skeleton className="h-64 w-full" />
      </SettingsTab>
    );
  }

  if (!canRead.allowed) {
    return (
      <SettingsTab title={t("title")}>
        <CollectionPageState
          icon={ShieldAlert}
          title={t("forbidden_title")}
          description={t("forbidden_description")}
          role="status"
        />
      </SettingsTab>
    );
  }

  const rows = events.data?.events ?? [];

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      <SettingsSection title={t("filters.legend")}>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(toQuery(filters));
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="audit-action">{t("filters.action")}</Label>
            <Input
              id="audit-action"
              value={filters.action}
              placeholder={t("filters.action_placeholder")}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-actor">{t("filters.actor")}</Label>
            <Input
              id="audit-actor"
              value={filters.actor_id}
              placeholder={t("filters.actor_placeholder")}
              onChange={(e) => setFilters({ ...filters, actor_id: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-resource">{t("filters.resource_type")}</Label>
            <Input
              id="audit-resource"
              value={filters.resource_type}
              placeholder={t("filters.resource_type_placeholder")}
              onChange={(e) => setFilters({ ...filters, resource_type: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-from">{t("filters.from")}</Label>
            <Input
              id="audit-from"
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-to">{t("filters.to")}</Label>
            <Input
              id="audit-to"
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit">{t("filters.apply")}</Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setApplied({});
              }}
            >
              {t("filters.clear")}
            </Button>
          </div>
        </form>
      </SettingsSection>

      <SettingsSection>
        {events.isLoading ? (
          <Skeleton className="h-64 w-full" />
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
            description={t("empty_description")}
            role="status"
          />
        ) : (
          <SettingsCard>
            {/* A page is capped at 100 rows by the API, so the table renders
                whole rather than virtualizing; paging is the cursor below. */}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("table.time")}</TableHead>
                    <TableHead>{t("table.actor")}</TableHead>
                    <TableHead>{t("table.action")}</TableHead>
                    <TableHead>{t("table.resource")}</TableHead>
                    <TableHead>{t("table.changes")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="whitespace-nowrap">
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          aria-label={t("table.row_label")}
                          onClick={() => setSelected(event)}
                        >
                          {new Date(event.occurred_at).toLocaleString()}
                        </button>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {t(`actor_kind.${event.actor_kind}`, t("actor_kind.unknown"))}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-caption">{event.action}</TableCell>
                      <TableCell className="font-mono text-caption">{event.resource_type}</TableCell>
                      <TableCell className="text-caption text-muted-foreground">
                        {changeSummary(event) || t("table.no_changes")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SettingsCard>
        )}
        {events.data?.nextBefore ? (
          <Button
            variant="outline"
            onClick={() => setApplied({ ...applied, before: events.data.nextBefore })}
          >
            {t("load_more")}
          </Button>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t("retention.title")} description={t("retention.description")}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const days = Number(retainDays);
            setRetention.mutate(days, {
              onSuccess: () => toast.success(t("retention.saved")),
              onError: () => toast.error(t("error_title")),
            });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="audit-retention">{t("retention.label")}</Label>
            <Input
              id="audit-retention"
              type="number"
              min={30}
              max={730}
              className="w-32"
              value={retainDays || String(retention.data ?? "")}
              disabled={!canManage.allowed}
              onChange={(e) => setRetainDays(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!canManage.allowed || setRetention.isPending}>
            {t("retention.save")}
          </Button>
          {!canManage.allowed ? (
            <p className="text-caption text-muted-foreground">{t("retention.owner_only")}</p>
          ) : null}
        </form>
      </SettingsSection>

      <SettingsSection title={t("export.title")} description={t("export.description")}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            createExport.mutate(
              {
                format: exportRange.format === "json" ? "json" : "csv",
                from: dayStart(exportRange.from),
                to: dayEnd(exportRange.to),
              },
              { onError: () => toast.error(t("error_title")) },
            );
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="audit-export-format">{t("export.format")}</Label>
            <NativeSelect
              id="audit-export-format"
              className="w-32"
              value={exportRange.format}
              disabled={!canManage.allowed}
              onChange={(e) => setExportRange({ ...exportRange, format: e.target.value })}
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-export-from">{t("export.from")}</Label>
            <Input
              id="audit-export-from"
              type="date"
              value={exportRange.from}
              disabled={!canManage.allowed}
              onChange={(e) => setExportRange({ ...exportRange, from: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-export-to">{t("export.to")}</Label>
            <Input
              id="audit-export-to"
              type="date"
              value={exportRange.to}
              disabled={!canManage.allowed}
              onChange={(e) => setExportRange({ ...exportRange, to: e.target.value })}
            />
          </div>
          <Button
            type="submit"
            disabled={!canManage.allowed || !exportRange.from || !exportRange.to || createExport.isPending}
          >
            {t("export.submit")}
          </Button>
          {!canManage.allowed ? (
            <p className="text-caption text-muted-foreground">{t("export.owner_only")}</p>
          ) : null}
        </form>

        {exports.data && exports.data.length > 0 ? (
          <ul className="grid gap-2">
            {exports.data.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-3 text-caption">
                <Badge variant="outline">{t(`export.status.${job.status}`, t("export.status.unknown"))}</Badge>
                <span className="text-muted-foreground">
                  {new Date(job.from_at).toLocaleDateString()} – {new Date(job.to_at).toLocaleDateString()}
                </span>
                <span className="text-muted-foreground">{t("export.rows", { count: job.row_count })}</span>
                {job.download_url ? (
                  <a
                    className="inline-flex items-center gap-1 underline underline-offset-2"
                    href={job.download_url}
                  >
                    <Download className="size-3.5" aria-hidden />
                    {t("export.download")}
                  </a>
                ) : null}
                {job.error ? <span className="text-destructive">{job.error}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption text-muted-foreground">{t("export.empty")}</p>
        )}
      </SettingsSection>

      <AuditDetailSheet event={selected} onClose={() => setSelected(null)} />
    </SettingsTab>
  );
}
