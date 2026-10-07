"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ChevronLeft, ChevronRight, Receipt, Search } from "lucide-react";
import { useAdminInvoices, useAdminPaymentIntents } from "@uniwork/core/admin";
import { useDebouncedValue } from "@uniwork/core/hooks";
import { paths } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@uniwork/ui/components/ui/table";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { PAGE_TOOLBAR } from "../layout/page-header";
import { AppLink } from "../navigation";

const ALL = "all";
const PAGE_SIZE = 20;

function formatMoney(amount: number, currency: string, locale: string): string {
  const code = currency.toUpperCase();
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      ...(code === "VND" ? { maximumFractionDigits: 0 } : {}),
    }).format(amount);
  } catch {
    return `${amount.toLocaleString(locale)} ${currency}`;
  }
}

function formatWhen(iso: string, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(locale);
}

function UserCell({ name, email }: { name: string; email: string }) {
  if (!name && !email) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="min-w-0">
      <div className="truncate text-body">{name || email}</div>
      {name && email ? <div className="truncate text-caption text-muted-foreground">{email}</div> : null}
    </div>
  );
}

type Tab = "invoices" | "intents";

/** /admin/invoices — hóa đơn và giao dịch checkout trên toàn nền tảng. */
export function AdminInvoicesView() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "admin.invoices" });
  const [tab, setTab] = useState<Tab>("invoices");
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [offset, setOffset] = useState(0);
  const search = useDebouncedValue(q.trim());

  useEffect(() => setOffset(0), [search, provider, status, tab]);

  const query = {
    q: search || undefined,
    provider: provider === ALL ? undefined : provider,
    status: status === ALL ? undefined : status,
    limit: PAGE_SIZE,
    offset,
  };

  const invoices = useAdminInvoices(query, tab === "invoices");
  const intents = useAdminPaymentIntents(query, tab === "intents");
  const active = tab === "invoices" ? invoices : intents;
  const total = tab === "invoices" ? (invoices.data?.total ?? 0) : (intents.data?.total ?? 0);
  const rows =
    tab === "invoices" ? (invoices.data?.invoices ?? []) : (intents.data?.intents ?? []);

  const pager =
    rows.length > 0 ? (
      <nav
        aria-label={t("pager_label")}
        className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2"
      >
        <p aria-live="polite" className="text-caption text-muted-foreground">
          {t("pager", { from: offset + 1, to: offset + rows.length, total })}
        </p>
        <span className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0 || active.isFetching}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            <ChevronLeft aria-hidden="true" className="size-3.5" />
            {t("prev")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + rows.length >= total || active.isFetching}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            {t("next")}
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </Button>
        </span>
      </nav>
    ) : null;

  const providerItems = [
    { value: ALL, label: t("filter.provider_all") },
    { value: "vnpay", label: "VNPay" },
    { value: "manual", label: t("filter.provider_manual") },
  ];

  const statusItems =
    tab === "invoices"
      ? [
          { value: ALL, label: t("filter.status_all") },
          { value: "paid", label: t("status.paid") },
          { value: "open", label: t("status.open") },
          { value: "draft", label: t("status.draft") },
        ]
      : [
          { value: ALL, label: t("filter.status_all") },
          { value: "completed", label: t("intent.completed") },
          { value: "pending", label: t("intent.pending") },
          { value: "failed", label: t("intent.failed") },
          { value: "expired", label: t("intent.expired") },
        ];

  return (
    <>
      <CollectionPageHeader icon={Receipt} title={t("title")} count={total} description={t("description")} />
      <div className="flex gap-1 border-b border-border px-4">
        {(["invoices", "intents"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={cn(
              "border-b-2 px-3 py-2 text-body transition-colors",
              tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab(key)}
          >
            {t(`tab.${key}`)}
          </button>
        ))}
      </div>
      <div className={PAGE_TOOLBAR}>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            variant="subtle"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tab === "invoices" ? t("search_invoices") : t("search_intents")}
            aria-label={t("search_label")}
            className="h-8 pl-8"
          />
        </div>
        <Select items={providerItems} value={provider} onValueChange={(v) => v && setProvider(v)}>
          <SelectTrigger variant="subtle" size="sm" aria-label={t("filter.provider_label")}>
            <SelectValue>{providerItems.find((i) => i.value === provider)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {providerItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select items={statusItems} value={status} onValueChange={(v) => v && setStatus(v)}>
          <SelectTrigger variant="subtle" size="sm" aria-label={t("filter.status_label")}>
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
      {active.isPending ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : active.isError ? (
        <CollectionPageState
          icon={AlertCircle}
          tone="destructive"
          role="alert"
          title={t("error_title")}
          description={t("error_description")}
          actions={
            <Button variant="outline" onClick={() => void active.refetch()}>
              {t("retry")}
            </Button>
          }
        />
      ) : tab === "invoices" ? (
        <>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col.number")}</TableHead>
              <TableHead>{t("col.organization")}</TableHead>
              <TableHead>{t("col.user")}</TableHead>
              <TableHead>{t("col.amount")}</TableHead>
              <TableHead>{t("col.provider")}</TableHead>
              <TableHead>{t("col.status")}</TableHead>
              <TableHead>{t("col.paid_at")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(invoices.data?.invoices ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              invoices.data!.invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-caption">{inv.number}</TableCell>
                  <TableCell>
                    <AppLink href={paths.admin.organization(inv.organization_id)} className="text-body hover:underline">
                      {inv.org_name || inv.org_slug}
                    </AppLink>
                    <div className="text-caption text-muted-foreground">{inv.org_slug}</div>
                  </TableCell>
                  <TableCell>
                    <UserCell name={inv.user_display_name} email={inv.user_email} />
                  </TableCell>
                  <TableCell>{formatMoney(inv.amount_paid, inv.currency, i18n.language)}</TableCell>
                  <TableCell>{inv.provider}</TableCell>
                  <TableCell>{inv.status}</TableCell>
                  <TableCell className="text-caption">{formatWhen(inv.paid_at || inv.created_at, i18n.language)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {pager}
        </>
      ) : (
        <>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col.txn_ref")}</TableHead>
              <TableHead>{t("col.organization")}</TableHead>
              <TableHead>{t("col.user")}</TableHead>
              <TableHead>{t("col.plan")}</TableHead>
              <TableHead>{t("col.amount")}</TableHead>
              <TableHead>{t("col.status")}</TableHead>
              <TableHead>{t("col.created_at")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(intents.data?.intents ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              intents.data!.intents.map((pi) => (
                <TableRow key={pi.id}>
                  <TableCell className="max-w-[12rem] truncate font-mono text-caption" title={pi.provider_txn_ref}>
                    {pi.provider_txn_ref}
                  </TableCell>
                  <TableCell>
                    <AppLink href={paths.admin.organization(pi.organization_id)} className="text-body hover:underline">
                      {pi.org_name || pi.org_slug}
                    </AppLink>
                  </TableCell>
                  <TableCell>
                    <UserCell name={pi.user_display_name} email={pi.user_email} />
                  </TableCell>
                  <TableCell>{pi.plan_code}</TableCell>
                  <TableCell>{formatMoney(pi.amount, pi.currency, i18n.language)}</TableCell>
                  <TableCell>{pi.status}</TableCell>
                  <TableCell className="text-caption">{formatWhen(pi.created_at, i18n.language)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {pager}
        </>
      )}
    </>
  );
}
