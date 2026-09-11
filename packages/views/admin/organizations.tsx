"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowDown, ArrowDownUp, ArrowUp, Building2, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useAdminOrganizations, type AdminOrganizationSort } from "@uniwork/core/admin";
import { useDebouncedValue } from "@uniwork/core/hooks";
import { paths } from "@uniwork/core/paths";
import { ORGANIZATION_STATUSES } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@uniwork/ui/components/ui/table";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { PAGE_TOOLBAR } from "../layout/page-header";
import { AppLink } from "../navigation";
import { formatDateTime, OrganizationStatusBadge } from "./status-badge";

const ALL = "all";
/** One screenful; the server caps it at 200 either way. */
const PAGE_SIZE = 50;

/** Sorting is the server's job, so the order holds across pages. */
const ACTIVITY_SORTS: Record<"desc" | "asc", AdminOrganizationSort> = {
  desc: "activity_desc",
  asc: "activity_asc",
};

/** /admin/organizations — every organization, metadata only; a name opens the detail. */
export function AdminOrganizationsView() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "admin.organizations" });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(ALL);
  const [activity, setActivity] = useState<"desc" | "asc" | null>(null);
  const [offset, setOffset] = useState(0);
  const search = useDebouncedValue(q.trim());
  const sort = activity ? ACTIVITY_SORTS[activity] : undefined;

  // A filter change re-cuts the whole set, so page 3 of the old one is gone.
  useEffect(() => setOffset(0), [search, status, sort]);

  const query = useAdminOrganizations({
    q: search || undefined,
    status: status === ALL ? undefined : status,
    sort,
    limit: PAGE_SIZE,
    offset,
  });
  const statusItems = [
    { value: ALL, label: t("status_all") },
    ...ORGANIZATION_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
  ];
  const rows = query.data?.organizations ?? [];
  const total = query.data?.total ?? 0;
  const SortIcon = activity === null ? ArrowDownUp : activity === "desc" ? ArrowDown : ArrowUp;

  return (
    <>
      <CollectionPageHeader icon={Building2} title={t("title")} count={total} />
      <div className={PAGE_TOOLBAR}>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search_placeholder")}
            aria-label={t("search_label")}
            className="h-8 pl-8"
          />
        </div>
        <Select items={statusItems} value={status} onValueChange={(next) => next && setStatus(next)}>
          <SelectTrigger size="sm" aria-label={t("status_label")}>
            <SelectValue>{statusItems.find((i) => i.value === status)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {statusItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {query.isPending ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : query.isError ? (
        <CollectionPageState
          icon={AlertCircle}
          tone="destructive"
          role="alert"
          title={t("error_title")}
          description={t("error_description")}
          actions={
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t("retry")}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <CollectionPageState icon={Building2} title={t("empty_title")} description={t("empty_description")} role="status" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("col.name")}</TableHead>
                <TableHead>{t("col.status")}</TableHead>
                <TableHead>{t("col.plan")}</TableHead>
                <TableHead className="text-right">{t("col.members")}</TableHead>
                <TableHead className="text-right">{t("col.workspaces")}</TableHead>
                <TableHead aria-sort={activity === "desc" ? "descending" : activity === "asc" ? "ascending" : "none"}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => setActivity(activity === "desc" ? "asc" : activity === "asc" ? null : "desc")}
                  >
                    {t("col.last_activity")}
                    <SortIcon aria-hidden="true" className="size-3" />
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((org) => (
                <TableRow key={org.id}>
                  <TableCell>
                    <AppLink
                      href={paths.admin.organization(org.id)}
                      className="font-medium hover:underline focus-visible:underline"
                    >
                      {org.name}
                    </AppLink>
                    <span className="ml-2 font-mono text-caption text-muted-foreground">{org.slug}</span>
                  </TableCell>
                  <TableCell>
                    <OrganizationStatusBadge status={org.status} />
                  </TableCell>
                  <TableCell className="font-mono text-caption">{org.plan_code}</TableCell>
                  <TableCell className="text-right tabular-nums">{org.member_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{org.workspace_count}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {org.last_activity_at ? formatDateTime(org.last_activity_at, i18n.language) : t("never")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <nav aria-label={t("pager_label")} className="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
            <p aria-live="polite" className="text-caption text-muted-foreground">
              {t("range", { from: offset + 1, to: offset + rows.length, total })}
            </p>
            <span className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0 || query.isFetching}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <ChevronLeft aria-hidden="true" className="size-3.5" />
                {t("previous")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + rows.length >= total || query.isFetching}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {t("next")}
                <ChevronRight aria-hidden="true" className="size-3.5" />
              </Button>
            </span>
          </nav>
        </>
      )}
    </>
  );
}
