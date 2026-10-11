"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, ChevronLeft, ChevronRight, Receipt, Search } from "lucide-react";
import { useAdminInvoices, useAdminMe, useAdminPaymentIntents } from "@uniwork/core/admin";
import { useDebouncedValue } from "@uniwork/core/hooks";
import type { AdminInvoice, AdminPaymentIntent } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { PAGE_TOOLBAR } from "../layout/page-header";
import { AdminBillingDetailSheet, type AdminBillingDetail } from "./admin-billing-detail-sheet";
import { AdminBillingFiltersPanel } from "./admin-billing-ui";
import { AdminInvoicesTable, AdminPaymentIntentsTable } from "./admin-invoices-tables";
import { AdminInvoiceRefundDialogs, type InvoiceRefundTarget } from "./invoice-refund-dialogs";

const ALL = "all";
const PAGE_SIZE = 20;

type Tab = "invoices" | "intents";

function invoiceStatusLabel(t: (key: string) => string, status: string): string {
  const key = `status.${status}`;
  const out = t(key);
  return out === key ? status : out;
}

function intentStatusLabel(t: (key: string) => string, status: string): string {
  const key = `intent.${status}`;
  const out = t(key);
  return out === key ? status : out;
}

function filterByDateRange<T extends { paid_at?: string; created_at?: string; refund_requested_at?: string; refunded_at?: string }>(
  rows: T[],
  from: string,
  to: string,
  pickTime: (row: T) => string,
): T[] {
  if (!from && !to) return rows;
  const fromMs = from ? Date.parse(`${from}T00:00:00.000Z`) : Number.NEGATIVE_INFINITY;
  const toMs = to ? Date.parse(`${to}T23:59:59.999Z`) : Number.POSITIVE_INFINITY;
  return rows.filter((row) => {
    const raw = pickTime(row);
    if (!raw) return false;
    const ms = Date.parse(raw);
    return !Number.isNaN(ms) && ms >= fromMs && ms <= toMs;
  });
}

/** /admin/invoices — hóa đơn và giao dịch checkout trên toàn nền tảng. */
export function AdminInvoicesView() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "admin.invoices" });
  const me = useAdminMe();
  const canRefund = me.data === "admin";
  const [tab, setTab] = useState<Tab>("invoices");
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [offset, setOffset] = useState(0);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [detail, setDetail] = useState<AdminBillingDetail | null>(null);
  const [refundTarget, setRefundTarget] = useState<InvoiceRefundTarget | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; number: string } | null>(null);
  const search = useDebouncedValue(q.trim());

  const rangeInvalid = Boolean(dateFrom && dateTo && dateFrom > dateTo);

  useEffect(() => setOffset(0), [search, provider, status, tab, dateFrom, dateTo]);

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

  const invoiceRows = useMemo(() => {
    const base = invoices.data?.invoices ?? [];
    if (rangeInvalid) return base;
    return filterByDateRange(base, dateFrom, dateTo, (inv) =>
      inv.refund_requested_at || inv.refunded_at || inv.paid_at || inv.created_at,
    );
  }, [invoices.data?.invoices, dateFrom, dateTo, rangeInvalid]);

  const intentRows = useMemo(() => {
    const base = intents.data?.intents ?? [];
    if (rangeInvalid) return base;
    return filterByDateRange(base, dateFrom, dateTo, (pi) => pi.created_at);
  }, [intents.data?.intents, dateFrom, dateTo, rangeInvalid]);

  const rows = tab === "invoices" ? invoiceRows : intentRows;
  const total = tab === "invoices" ? (invoices.data?.total ?? 0) : (intents.data?.total ?? 0);

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
          { value: "refund_pending", label: t("status.refund_pending") },
          { value: "partial_refund_pending", label: t("status.partial_refund_pending") },
          { value: "refunded", label: t("status.refunded") },
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

  const statusLabel = (s: string) =>
    tab === "invoices" ? invoiceStatusLabel(t, s) : intentStatusLabel(t, s);

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
      <AdminBillingFiltersPanel
        dateHint={t("filter.date_hint")}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        fromLabel={t("filter.date_from")}
        toLabel={t("filter.date_to")}
        rangeInvalid={rangeInvalid}
        rangeInvalidMessage={t("filter.date_range_invalid")}
      >
        <div className={cn(PAGE_TOOLBAR, "border-0 p-0")}>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
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
      </AdminBillingFiltersPanel>
      {active.isPending ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : active.isError ? (
        <CollectionPageState
          icon={CircleAlert}
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
          <AdminInvoicesTable
            rows={invoiceRows}
            emptyLabel={t("empty")}
            canRefund={canRefund}
            locale={i18n.language}
            onDetail={(inv) => setDetail({ kind: "invoice", row: inv })}
            onRefund={(inv: AdminInvoice) =>
              setRefundTarget({
                id: inv.id,
                number: inv.number,
                amount_paid: inv.amount_paid,
                currency: inv.currency,
              })
            }
            onConfirmRefund={(inv: AdminInvoice) => setConfirmTarget({ id: inv.id, number: inv.number })}
          />
          {pager}
        </>
      ) : (
        <>
          <AdminPaymentIntentsTable
            rows={intentRows}
            emptyLabel={t("empty")}
            locale={i18n.language}
            onDetail={(pi: AdminPaymentIntent) => setDetail({ kind: "intent", row: pi })}
          />
          {pager}
        </>
      )}
      <AdminBillingDetailSheet
        detail={detail}
        onClose={() => setDetail(null)}
        statusLabel={statusLabel}
        onOpenPaymentIntent={(intentId) => {
          setDetail(null);
          setTab("intents");
          setQ(intentId);
          setOffset(0);
        }}
      />
      <AdminInvoiceRefundDialogs
        refundTarget={refundTarget}
        onRefundTargetChange={setRefundTarget}
        confirmTarget={confirmTarget}
        onConfirmTargetChange={setConfirmTarget}
      />
    </>
  );
}
