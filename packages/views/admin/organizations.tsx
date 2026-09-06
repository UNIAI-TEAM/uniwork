"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowDownUp, Building2, Search } from "lucide-react";
import { useAdminOrganizations } from "@uniwork/core/admin";
import { paths } from "@uniwork/core/paths";
import { ORGANIZATION_STATUSES, type AdminOrganization } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@uniwork/ui/components/ui/table";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { PAGE_TOOLBAR } from "../layout/page-header";
import { useNavigation } from "../navigation";
import { formatDateTime, OrganizationStatusBadge } from "./status-badge";

const ALL = "all";

function byLastActivity(dir: "desc" | "asc") {
  return (a: AdminOrganization, b: AdminOrganization) => {
    const av = a.last_activity_at ?? "";
    const bv = b.last_activity_at ?? "";
    return dir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
  };
}

/** /admin — every organization, metadata only; a row opens the detail. */
export function AdminOrganizationsView() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "admin.organizations" });
  const { push } = useNavigation();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(ALL);
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const query = useAdminOrganizations({ q: q.trim() || undefined, status: status === ALL ? undefined : status });
  const statusItems = [
    { value: ALL, label: t("status_all") },
    ...ORGANIZATION_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
  ];
  const rows = [...(query.data ?? [])].sort(byLastActivity(dir));

  return (
    <>
      <CollectionPageHeader icon={Building2} title={t("title")} count={rows.length} />
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col.name")}</TableHead>
              <TableHead>{t("col.status")}</TableHead>
              <TableHead>{t("col.plan")}</TableHead>
              <TableHead className="text-right">{t("col.members")}</TableHead>
              <TableHead className="text-right">{t("col.workspaces")}</TableHead>
              <TableHead aria-sort={dir === "desc" ? "descending" : "ascending"}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => setDir(dir === "desc" ? "asc" : "desc")}
                >
                  {t("col.last_activity")}
                  <ArrowDownUp aria-hidden="true" className="size-3" />
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((org) => (
              <TableRow
                key={org.id}
                tabIndex={0}
                className="cursor-pointer"
                onClick={() => push(paths.admin.organization(org.id))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    push(paths.admin.organization(org.id));
                  }
                }}
              >
                <TableCell>
                  <span className="font-medium">{org.name}</span>
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
      )}
    </>
  );
}
