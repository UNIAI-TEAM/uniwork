"use client";

import { useTranslation } from "react-i18next";
import type { AdminInvoice, AdminPaymentIntent } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@uniwork/ui/components/ui/table";
import { cn } from "@uniwork/ui/lib/utils";
import {
  AdminBankCell,
  AdminBillingTableWrap,
  AdminIntentStatusBadge,
  AdminInvoiceStatusBadge,
  AdminMoneyCell,
  AdminMonoCell,
  AdminOrgCell,
  AdminPlanCell,
  AdminProviderBadge,
  AdminUserCell,
  adminBillingTableCellClass,
  adminBillingTableHeadClass,
} from "./admin-billing-ui";

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

/** Refund amount to show in the list: pending partial, full pending, or settled refunded. */
function invoiceRefundAmount(inv: AdminInvoice): number | null {
  switch (inv.status) {
    case "refund_pending":
      return inv.amount_paid > 0 ? inv.amount_paid : null;
    case "partial_refund_pending":
      return inv.partial_refund_amount > 0 ? inv.partial_refund_amount : null;
    case "refunded":
      if (inv.amount_refunded > 0) return inv.amount_refunded;
      return inv.amount_paid > 0 ? inv.amount_paid : null;
    default:
      return null;
  }
}

export function AdminInvoicesTable({
  rows,
  emptyLabel,
  canRefund,
  locale,
  onDetail,
  onRefund,
  onConfirmRefund,
}: {
  rows: AdminInvoice[];
  emptyLabel: string;
  canRefund: boolean;
  locale: string;
  onDetail: (row: AdminInvoice) => void;
  onRefund: (row: AdminInvoice) => void;
  onConfirmRefund: (row: AdminInvoice) => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.invoices" });
  const th = adminBillingTableHeadClass();
  const td = adminBillingTableCellClass();

  return (
    <AdminBillingTableWrap>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={th}>{t("col.number")}</TableHead>
            <TableHead className={th}>{t("col.organization")}</TableHead>
            <TableHead className={th}>{t("col.user")}</TableHead>
            <TableHead className={th}>{t("col.plan")}</TableHead>
            <TableHead className={th}>{t("col.amount")}</TableHead>
            <TableHead className={th}>{t("col.refund_amount")}</TableHead>
            <TableHead className={th}>{t("col.provider")}</TableHead>
            <TableHead className={th}>{t("col.bank")}</TableHead>
            <TableHead className={th}>{t("col.status")}</TableHead>
            <TableHead className={th}>{t("col.paid_at")}</TableHead>
            <TableHead className={cn(th, "w-[7.5rem]")}>{t("col.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11} className="py-10 text-center text-muted-foreground">
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((inv) => (
              <TableRow key={inv.id} className="odd:bg-muted/15">
                <TableCell className={td}>
                  <AdminMonoCell value={inv.number} maxWidth="10rem" />
                </TableCell>
                <TableCell className={td}>
                  <AdminOrgCell orgId={inv.organization_id} name={inv.org_name} slug={inv.org_slug} />
                </TableCell>
                <TableCell className={td}>
                  <AdminUserCell name={inv.user_display_name} email={inv.user_email} />
                </TableCell>
                <TableCell className={td}>
                  <AdminPlanCell code={inv.plan_code} name={inv.plan_name} />
                </TableCell>
                <TableCell className={td}>
                  <AdminMoneyCell>{formatMoney(inv.amount_paid, inv.currency, locale)}</AdminMoneyCell>
                </TableCell>
                <TableCell className={td}>
                  {(() => {
                    const refundAmt = invoiceRefundAmount(inv);
                    if (refundAmt == null) {
                      return <span className="text-muted-foreground">—</span>;
                    }
                    const partial = inv.status === "partial_refund_pending";
                    return (
                      <div className="flex flex-col gap-0.5">
                        <AdminMoneyCell>{formatMoney(refundAmt, inv.currency, locale)}</AdminMoneyCell>
                        {partial ? (
                          <span className="text-caption text-muted-foreground">{t("refund_amount_partial_hint")}</span>
                        ) : inv.status === "refund_pending" ? (
                          <span className="text-caption text-muted-foreground">{t("refund_amount_full_hint")}</span>
                        ) : null}
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell className={td}>
                  <AdminProviderBadge provider={inv.provider} />
                </TableCell>
                <TableCell className={td}>
                  <AdminBankCell code={inv.provider_bank_code} />
                </TableCell>
                <TableCell className={td}>
                  <AdminInvoiceStatusBadge
                    status={inv.status}
                    label={invoiceStatusLabel(t, inv.status)}
                  />
                </TableCell>
                <TableCell className={cn(td, "whitespace-nowrap text-caption text-muted-foreground")}>
                  {formatWhen(
                    inv.refund_requested_at || inv.refunded_at || inv.paid_at || inv.created_at,
                    locale,
                  )}
                </TableCell>
                <TableCell className={td}>
                  <div className="flex flex-col gap-1.5">
                    <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onDetail(inv)}>
                      {t("view_detail")}
                    </Button>
                    {canRefund && inv.status === "paid" ? (
                      <Button type="button" variant="secondary" size="sm" className="h-8" onClick={() => onRefund(inv)}>
                        {t("refund_action")}
                      </Button>
                    ) : null}
                    {canRefund &&
                    (inv.status === "refund_pending" || inv.status === "partial_refund_pending") ? (
                      <Button type="button" variant="secondary" size="sm" className="h-8" onClick={() => onConfirmRefund(inv)}>
                        {t("confirm_refund_action")}
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </AdminBillingTableWrap>
  );
}

export function AdminPaymentIntentsTable({
  rows,
  emptyLabel,
  locale,
  onDetail,
}: {
  rows: AdminPaymentIntent[];
  emptyLabel: string;
  locale: string;
  onDetail: (row: AdminPaymentIntent) => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.invoices" });
  const th = adminBillingTableHeadClass();
  const td = adminBillingTableCellClass();

  return (
    <AdminBillingTableWrap>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={th}>{t("col.txn_ref")}</TableHead>
            <TableHead className={th}>{t("col.organization")}</TableHead>
            <TableHead className={th}>{t("col.user")}</TableHead>
            <TableHead className={th}>{t("col.plan")}</TableHead>
            <TableHead className={th}>{t("col.amount")}</TableHead>
            <TableHead className={th}>{t("col.bank")}</TableHead>
            <TableHead className={th}>{t("col.status")}</TableHead>
            <TableHead className={th}>{t("col.created_at")}</TableHead>
            <TableHead className={cn(th, "w-[6.5rem]")}>{t("col.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((pi) => (
              <TableRow key={pi.id} className="odd:bg-muted/15">
                <TableCell className={td}>
                  <AdminMonoCell value={pi.provider_txn_ref} />
                </TableCell>
                <TableCell className={td}>
                  <AdminOrgCell orgId={pi.organization_id} name={pi.org_name} slug={pi.org_slug} />
                </TableCell>
                <TableCell className={td}>
                  <AdminUserCell name={pi.user_display_name} email={pi.user_email} />
                </TableCell>
                <TableCell className={td}>
                  <AdminPlanCell code={pi.plan_code} />
                </TableCell>
                <TableCell className={td}>
                  <AdminMoneyCell>{formatMoney(pi.amount, pi.currency, locale)}</AdminMoneyCell>
                </TableCell>
                <TableCell className={td}>
                  <AdminBankCell code={pi.provider_bank_code} />
                </TableCell>
                <TableCell className={td}>
                  <AdminIntentStatusBadge status={pi.status} label={intentStatusLabel(t, pi.status)} />
                </TableCell>
                <TableCell className={cn(td, "whitespace-nowrap text-caption text-muted-foreground")}>
                  {formatWhen(pi.created_at, locale)}
                </TableCell>
                <TableCell className={td}>
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onDetail(pi)}>
                    {t("view_detail")}
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </AdminBillingTableWrap>
  );
}
