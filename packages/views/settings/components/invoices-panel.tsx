"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, Receipt } from "lucide-react";
import { useInvoices } from "@uniwork/core/billing";
import type { Invoice } from "@uniwork/core/types";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageState } from "../../layout/collection-page";
import { CorrelationNote } from "./copyable-id";
import {
  SettingsBadge,
  SettingsCard,
  SettingsCardBody,
  SettingsEmpty,
  SettingsList,
  SettingsListItem,
  SettingsSection,
  type SettingsBadgeTone,
} from "./settings-layout";

const ZERO_DECIMAL = new Set(["VND", "JPY", "KRW"]);

function formatPaidAmount(amount: number, currency: string, locale: string): string {
  const code = currency.toUpperCase();
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      ...(ZERO_DECIMAL.has(code) ? { maximumFractionDigits: 0 } : {}),
    }).format(amount);
  } catch {
    return `${amount.toLocaleString(locale)} ${currency}`;
  }
}

function formatDate(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale);
}

function invoicePeriod(inv: Invoice, locale: string, t: (k: string, o?: Record<string, string>) => string): string {
  const start = formatDate(inv.period_start, locale);
  const end = formatDate(inv.period_end, locale);
  if (start && end) return t("period_range", { start, end });
  return start || end || "—";
}

function invoiceMeta(
  inv: Invoice,
  locale: string,
  t: (k: string, o?: Record<string, string>) => string,
): string {
  const parts = [invoicePeriod(inv, locale, t)];
  const paid = formatDate(inv.paid_at, locale);
  if (paid) parts.push(t("paid_at", { date: paid }));
  return parts.join(" · ");
}

function statusTone(status: string): SettingsBadgeTone {
  switch (status) {
    case "paid":
      return "success";
    case "open":
    case "draft":
      return "muted";
    default:
      return "info";
  }
}

function InvoicesSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-[4.5rem] w-full rounded-xl" />
        <Skeleton className="h-[4.5rem] w-full rounded-xl" />
      </div>
      <SettingsCard>
        <ul className="divide-y divide-border">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-8 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-4 w-24" />
            </li>
          ))}
        </ul>
      </SettingsCard>
    </div>
  );
}

function SummaryStat({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <SettingsCard className={className}>
      <SettingsCardBody className="space-y-1">
        <p className="text-caption text-muted-foreground">{label}</p>
        <p className="text-title font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
      </SettingsCardBody>
    </SettingsCard>
  );
}

export interface InvoicesPanelProps {
  orgId: string;
}

export function InvoicesPanel({ orgId }: InvoicesPanelProps) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.invoices" });
  const locale = i18n.language;
  const invoices = useInvoices(orgId);

  const summary = useMemo(() => {
    const rows = invoices.data ?? [];
    if (!rows.length) return null;
    const currency = rows[0]?.currency ?? "VND";
    const total = rows.reduce((sum, inv) => sum + inv.amount_paid, 0);
    return { count: rows.length, total, currency };
  }, [invoices.data]);

  let body: ReactNode;
  if (invoices.isLoading) {
    body = <InvoicesSkeleton />;
  } else if (invoices.isError) {
    body = (
      <CollectionPageState
        icon={CircleAlert}
        tone="destructive"
        role="alert"
        headingLevel={3}
        title={t("error_title")}
        description={
          <>
            {t("error_description")}
            <CorrelationNote error={invoices.error} />
          </>
        }
        actions={
          <Button variant="outline" onClick={() => void invoices.refetch()}>
            {t("retry")}
          </Button>
        }
      />
    );
  } else if (!invoices.data?.length) {
    body = (
      <SettingsCard>
        <SettingsEmpty icon={<Receipt aria-hidden />}>
          <span className="block font-medium text-foreground">{t("empty_title")}</span>
          <span className="mt-1 block text-caption">{t("empty_description")}</span>
        </SettingsEmpty>
      </SettingsCard>
    );
  } else {
    body = (
      <SettingsSection title={t("list_title")} description={t("list_description")}>
        {summary ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryStat label={t("summary_count")} value={summary.count.toLocaleString(locale)} />
            <SummaryStat
              label={t("summary_total")}
              value={formatPaidAmount(summary.total, summary.currency, locale)}
            />
          </div>
        ) : null}
        <SettingsList aria-label={t("list_aria")}>
          {invoices.data.map((inv) => (
            <SettingsListItem
              key={inv.id}
              leading={<IconTile icon={Receipt} size="sm" tone="brand" />}
              title={inv.number}
              badge={
                <SettingsBadge tone={statusTone(inv.status)}>
                  {t(`status.${inv.status}`, { defaultValue: inv.status })}
                </SettingsBadge>
              }
              meta={
                <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                  <span>{invoiceMeta(inv, locale, t)}</span>
                  <span className="text-muted-foreground/80" aria-hidden>
                    ·
                  </span>
                  <span className="text-muted-foreground">
                    {t(`provider.${inv.provider}`, { defaultValue: inv.provider.toUpperCase() })}
                  </span>
                </span>
              }
              actions={
                <span
                  className={cn(
                    "text-body font-semibold tabular-nums text-foreground",
                    "max-sm:w-full max-sm:text-end",
                  )}
                >
                  {formatPaidAmount(inv.amount_paid, inv.currency, locale)}
                </span>
              }
            />
          ))}
        </SettingsList>
      </SettingsSection>
    );
  }

  return body;
}
