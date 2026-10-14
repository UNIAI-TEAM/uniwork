"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, Presentation } from "lucide-react";
import { useDemoRequests, useUpdateDemoRequest, type DemoRequest, type DemoStatus } from "@uniwork/core/demo-requests";
import { useAdminMe } from "@uniwork/core/admin";
import { Button } from "@uniwork/ui/components/ui/button";
import { Label } from "@uniwork/ui/components/ui/label";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@uniwork/ui/components/ui/table";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { ReasonDialog } from "./reason-dialog";

const statuses: DemoStatus[] = ["new", "in_progress", "completed"];
export function AdminDemoRequestsView() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "admin.demo_requests" });
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<DemoRequest | null>(null);
  const [nextStatus, setNextStatus] = useState<DemoStatus>("new");
  const [error, setError] = useState("");
  const rows = useDemoRequests({ status, limit: 20, offset });
  const update = useUpdateDemoRequest();
  const me = useAdminMe();
  const canEdit = me.data === "admin";
  async function submit(reason: string) {
    if (!editing) return;
    setError("");
    try { await update.mutateAsync({ id: editing.id, status: nextStatus, reason }); setEditing(null); }
    catch { setError(t("update_error")); }
  }
  return <>
    <CollectionPageHeader icon={Presentation} title={t("title")} description={t("description")} count={rows.data?.total} />
    <div className="flex flex-wrap gap-2 p-4" aria-label={t("filter")}>
      {["", ...statuses].map(value => <Button key={value} variant={status === value ? "secondary" : "ghost"} aria-pressed={status === value} onClick={() => { setStatus(value); setOffset(0); }}>{t(value ? `status.${value}` : "all")}</Button>)}
      <Button variant="outline" className="ml-auto" onClick={() => void rows.refetch()}>{t("refresh")}</Button>
    </div>
    {rows.isPending ? <div className="grid gap-2 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
      : rows.isError ? <CollectionPageState icon={CircleAlert} tone="destructive" role="alert" title={t("load_error")} description={t("retry_hint")} actions={<Button onClick={() => void rows.refetch()}>{t("refresh")}</Button>} />
      : rows.data.requests.length === 0 ? <CollectionPageState icon={Presentation} role="status" title={t("empty")} description={t("empty_description")} />
      : <div className="overflow-x-auto"><Table><TableHeader><TableRow>
        <TableHead>{t("contact")}</TableHead><TableHead>{t("company")}</TableHead><TableHead>{t("message")}</TableHead><TableHead>{t("status_label")}</TableHead><TableHead>{t("received")}</TableHead>{canEdit && <TableHead>{t("action")}</TableHead>}
      </TableRow></TableHeader><TableBody>{rows.data.requests.map(row => <TableRow key={row.id}>
        <TableCell><p className="font-medium">{row.full_name}</p><a className="text-brand underline underline-offset-2" href={`mailto:${row.work_email}`}>{row.work_email}</a></TableCell>
        <TableCell><p>{row.company_name}</p><small className="text-caption text-muted-foreground">{t("people", { size: row.team_size })}</small></TableCell>
        <TableCell className="max-w-80 whitespace-pre-wrap break-words">{row.message || t("no_message")}</TableCell>
        <TableCell>{t(`status.${row.status}`, { defaultValue: row.status })}</TableCell>
        <TableCell className="whitespace-nowrap">{Number.isNaN(Date.parse(row.created_at)) ? row.created_at : new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.created_at))}</TableCell>
        {canEdit && <TableCell><Button variant="outline" onClick={() => { setEditing(row); setNextStatus(statuses.find(value => value === row.status) ?? "new"); setError(""); }}>{t("update")}</Button></TableCell>}
      </TableRow>)}</TableBody></Table></div>}
    <div className="flex items-center justify-end gap-3 p-4">
      <Button variant="outline" disabled={offset === 0 || rows.isFetching} onClick={() => setOffset(Math.max(0, offset - 20))}>{t("previous")}</Button>
      <span className="text-caption text-muted-foreground">{t("page", { page: offset / 20 + 1 })}</span>
      <Button variant="outline" disabled={offset + 20 >= (rows.data?.total ?? 0) || rows.isFetching} onClick={() => setOffset(offset + 20)}>{t("next")}</Button>
    </div>
    <ReasonDialog open={!!editing} onOpenChange={open => { if (!open) setEditing(null); }} title={t("update_title")} description={editing?.company_name} pending={update.isPending} submitDisabled={nextStatus === editing?.status} onSubmit={reason => { void submit(reason); }}>
      <Label htmlFor="demo-request-status">{t("status_label")}</Label>
      <Select value={nextStatus} items={statuses.map(value => ({ value, label: t(`status.${value}`) }))} onValueChange={value => { const selected = statuses.find(status => status === value); if (selected) setNextStatus(selected); }}>
        <SelectTrigger id="demo-request-status" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{statuses.map(value => <SelectItem key={value} value={value}>{t(`status.${value}`)}</SelectItem>)}</SelectContent>
      </Select>
      {error && <p role="alert" className="text-body text-destructive">{error}</p>}
    </ReasonDialog>
  </>;
}
