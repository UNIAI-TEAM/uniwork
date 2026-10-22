"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, Flag } from "lucide-react";
import { useAdminChatReports, useAdminMe, useResolveAdminChatReport, type AdminChatReport, type AdminChatReportStatus } from "@uniwork/core/admin";
import { paths } from "@uniwork/core/paths";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@uniwork/ui/components/ui/table";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { AppLink } from "../navigation";
import { ReasonDialog } from "./reason-dialog";

const PAGE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const FILTERS: (AdminChatReportStatus | "")[] = ["open", "resolved", ""];

/**
 * The operator's queue of chat reports (store UGC policy, Apple 1.2): every
 * organization's reports, with how many wait and since when against the
 * 24-hour promise of the terms of use. Ids and the reason only: the console
 * never reads a message or the reporter's words; the organization's owner
 * does, and the operator asks them or suspends the organization. support
 * reads; admin closes a report with a reason.
 */
export function AdminChatReportsView() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "admin.chat_reports" });
  const [status, setStatus] = useState<AdminChatReportStatus | "">("open");
  const [offset, setOffset] = useState(0);
  const [closing, setClosing] = useState<AdminChatReport | null>(null);
  const [error, setError] = useState("");
  const rows = useAdminChatReports({ status, limit: PAGE, offset });
  const resolve = useResolveAdminChatReport();
  const me = useAdminMe();
  const canClose = me.data === "admin";
  const when = (iso: string) => (Number.isNaN(Date.parse(iso)) ? iso : new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)));
  const overdue = (iso: string | null | undefined) => !!iso && Date.now() - Date.parse(iso) > DAY_MS;

  async function submit(reason: string) {
    if (!closing) return;
    setError("");
    try {
      await resolve.mutateAsync({ id: closing.id, reason });
      setClosing(null);
    } catch {
      setError(t("resolve_error"));
    }
  }

  const queue = rows.data;
  return (
    <>
      <CollectionPageHeader icon={Flag} title={t("title")} description={t("description")} count={queue?.total} />
      {queue ? (
        <p role="status" className="flex flex-wrap items-center gap-2 px-4 pt-4 text-body text-muted-foreground">
          {queue.open_count > 0 && queue.oldest_open_at ? t("queue_open", { count: queue.open_count, since: when(queue.oldest_open_at) }) : t("queue_clear")}
          {overdue(queue.oldest_open_at) && queue.open_count > 0 ? <Badge variant="destructive">{t("overdue")}</Badge> : null}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 p-4" role="group" aria-label={t("filter")}>
        {FILTERS.map((value) => (
          <Button key={value || "all"} variant={status === value ? "secondary" : "ghost"} aria-pressed={status === value} onClick={() => { setStatus(value); setOffset(0); }}>
            {value ? t(`status.${value}`) : t("all")}
          </Button>
        ))}
        <Button variant="outline" className="ml-auto" onClick={() => void rows.refetch()}>{t("refresh")}</Button>
      </div>
      {rows.isPending ? (
        <div className="grid gap-2 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
      ) : rows.isError ? (
        <CollectionPageState icon={CircleAlert} tone="destructive" role="alert" title={t("load_error")} description={t("retry_hint")} actions={<Button onClick={() => void rows.refetch()}>{t("refresh")}</Button>} />
      ) : rows.data.reports.length === 0 ? (
        <CollectionPageState icon={Flag} role="status" title={t("empty")} description={t("empty_description")} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("organization")}</TableHead>
                <TableHead>{t("reason_label")}</TableHead>
                <TableHead>{t("subject")}</TableHead>
                <TableHead>{t("reporter")}</TableHead>
                <TableHead>{t("status_label")}</TableHead>
                <TableHead>{t("received")}</TableHead>
                {canClose && <TableHead>{t("action")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.data.reports.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <AppLink className="font-medium text-brand underline underline-offset-2" href={paths.admin.organization(row.organization_id)}>{row.organization_name || row.organization_slug || row.organization_id}</AppLink>
                    {row.organization_status && row.organization_status !== "active" ? <p className="text-caption text-muted-foreground">{row.organization_status}</p> : null}
                  </TableCell>
                  <TableCell>{t(`reason.${row.reason}`, { defaultValue: row.reason })}</TableCell>
                  <TableCell className="font-mono text-caption">
                    <p>{t("person", { id: row.target_user_id })}</p>
                    {row.message_id ? <p className="text-muted-foreground">{t("message", { id: row.message_id })}</p> : null}
                  </TableCell>
                  <TableCell className="font-mono text-caption">{row.reporter_id}</TableCell>
                  <TableCell>
                    {t(`status.${row.status}`, { defaultValue: row.status })}
                    {row.status === "open" && overdue(row.created_at) ? <Badge variant="destructive" className="ml-2">{t("overdue")}</Badge> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{when(row.created_at)}</TableCell>
                  {canClose && (
                    <TableCell>
                      {row.status === "open" ? <Button variant="outline" onClick={() => { setClosing(row); setError(""); }}>{t("resolve")}</Button> : null}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex items-center justify-end gap-3 p-4">
        <Button variant="outline" disabled={offset === 0 || rows.isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t("previous")}</Button>
        <span className="text-caption text-muted-foreground">{t("page", { page: offset / PAGE + 1 })}</span>
        <Button variant="outline" disabled={offset + PAGE >= (rows.data?.total ?? 0) || rows.isFetching} onClick={() => setOffset(offset + PAGE)}>{t("next")}</Button>
      </div>
      <ReasonDialog open={!!closing} onOpenChange={(open) => { if (!open) setClosing(null); }} title={t("resolve_title")} description={t("resolve_description")} pending={resolve.isPending} onSubmit={(reason) => { void submit(reason); }}>
        {error && <p role="alert" className="text-body text-destructive">{error}</p>}
      </ReasonDialog>
    </>
  );
}
