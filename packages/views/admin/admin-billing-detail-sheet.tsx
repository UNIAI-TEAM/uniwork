"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Building2, CreditCard, Receipt } from "lucide-react";
import type { AdminInvoice, AdminPaymentIntent } from "@uniwork/core/types";
import { vnpayBankLabel } from "@uniwork/core/billing/vnpay-bank-label";
import { paths } from "@uniwork/core/paths";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { formatDateTime } from "./status-badge";

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

function billingStatusVariant(status: string): "secondary" | "outline" | "destructive" {
  switch (status) {
    case "paid":
    case "completed":
      return "secondary";
    case "refund_pending":
    case "partial_refund_pending":
    case "pending":
      return "outline";
    case "failed":
    case "expired":
    case "refunded":
      return "destructive";
    default:
      return "outline";
  }
}

function EmptyValue({ label }: { label: string }) {
  return <span className="text-muted-foreground">{label}</span>;
}

function MonoBlock({ value }: { value: string }) {
  return (
    <code className="block rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-caption leading-snug break-all text-foreground">
      {value}
    </code>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-title-sm font-medium text-foreground">{title}</h3>
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-1">{children}</div>
    </section>
  );
}

function DetailField({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4", className)}>
      <dt className="shrink-0 text-body text-muted-foreground sm:max-w-[42%]">{label}</dt>
      <dd className="min-w-0 text-body text-foreground sm:text-end">{value}</dd>
    </div>
  );
}

function FieldDivider() {
  return <div className="h-px bg-border/80 last:hidden" aria-hidden />;
}

function BankValue({ code, emptyLabel }: { code: string; emptyLabel: string }) {
  if (!code) return <EmptyValue label={emptyLabel} />;
  const label = vnpayBankLabel(code);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5 sm:justify-end">
      <span>{label}</span>
      {label !== code ? (
        <Badge variant="outline" className="font-mono text-caption">
          {code}
        </Badge>
      ) : null}
    </span>
  );
}

function PayerValue({
  name,
  email,
  emptyLabel,
}: {
  name: string;
  email: string;
  emptyLabel: string;
}) {
  if (!name && !email) return <EmptyValue label={emptyLabel} />;
  return (
    <div className="flex flex-col items-start gap-0.5 sm:items-end">
      {name ? <span className="font-medium">{name}</span> : null}
      {email ? <span className="text-caption text-muted-foreground">{email}</span> : null}
    </div>
  );
}

export type AdminBillingDetail =
  | { kind: "invoice"; row: AdminInvoice }
  | { kind: "intent"; row: AdminPaymentIntent };

export function AdminBillingDetailSheet({
  detail,
  onClose,
  statusLabel,
  onOpenPaymentIntent,
}: {
  detail: AdminBillingDetail | null;
  onClose: () => void;
  statusLabel: (status: string) => string;
  onOpenPaymentIntent?: (intentId: string) => void;
}) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "admin.invoices" });
  const { t: tCommon } = useTranslation(undefined, { keyPrefix: "common" });
  const open = detail !== null;
  const empty = t("detail.empty");

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        closeLabel={tCommon("close")}
      >
        {detail?.kind === "invoice" ? (
          <>
            <SheetHeader className="shrink-0 border-b border-border bg-muted/15 px-4 py-4 pr-12">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Receipt aria-hidden className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="font-mono text-title-sm">{detail.row.number}</SheetTitle>
                  <SheetDescription className="mt-1">{t("detail.invoice_description")}</SheetDescription>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant={billingStatusVariant(detail.row.status)}>{statusLabel(detail.row.status)}</Badge>
                    {detail.row.provider ? (
                      <Badge variant="outline" className="uppercase">
                        {detail.row.provider}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
              <p className="mt-4 text-title font-semibold tabular-nums tracking-tight">
                {formatMoney(detail.row.amount_paid, detail.row.currency, i18n.language)}
              </p>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
              <DetailSection title={t("detail.section_overview")}>
                <dl>
                  <DetailField
                    label={t("col.organization")}
                    value={
                      <AppLink
                        href={paths.admin.organization(detail.row.organization_id)}
                        className="font-medium text-primary hover:underline"
                      >
                        {detail.row.org_name || detail.row.org_slug}
                      </AppLink>
                    }
                  />
                  <FieldDivider />
                  <DetailField label={t("detail.org_slug")} value={<MonoBlock value={detail.row.org_slug} />} />
                  <FieldDivider />
                  <DetailField
                    label={t("col.user")}
                    value={
                      <PayerValue
                        name={detail.row.user_display_name}
                        email={detail.row.user_email}
                        emptyLabel={empty}
                      />
                    }
                  />
                  <FieldDivider />
                  <DetailField
                    label={t("col.plan")}
                    value={
                      detail.row.plan_code ? (
                        <span>
                          {detail.row.plan_name || detail.row.plan_code}
                          <Badge variant="outline" className="ml-2 font-mono text-caption">
                            {detail.row.plan_code}
                          </Badge>
                        </span>
                      ) : (
                        <EmptyValue label={empty} />
                      )
                    }
                  />
                  <FieldDivider />
                  <DetailField
                    label={t("detail.period")}
                    value={
                      <span className="text-caption leading-relaxed">
                        {formatDateTime(detail.row.period_start, i18n.language) || empty}
                        <span className="mx-1 text-muted-foreground">→</span>
                        {formatDateTime(detail.row.period_end, i18n.language) || empty}
                      </span>
                    }
                  />
                  <FieldDivider />
                  <DetailField
                    label={t("col.paid_at")}
                    value={formatDateTime(detail.row.paid_at || detail.row.created_at, i18n.language) || empty}
                  />
                </dl>
              </DetailSection>

              <DetailSection title={t("detail.section_vnpay")}>
                <dl>
                  <DetailField
                    label={t("col.bank")}
                    value={<BankValue code={detail.row.provider_bank_code} emptyLabel={empty} />}
                  />
                  <FieldDivider />
                  <DetailField
                    label={t("detail.txn_ref")}
                    value={
                      detail.row.provider_txn_ref ? (
                        <MonoBlock value={detail.row.provider_txn_ref} />
                      ) : (
                        <EmptyValue label={empty} />
                      )
                    }
                  />
                  <FieldDivider />
                  <DetailField
                    label={t("detail.vnpay_txn_no")}
                    value={
                      detail.row.provider_transaction_no ? (
                        <MonoBlock value={detail.row.provider_transaction_no} />
                      ) : (
                        <EmptyValue label={empty} />
                      )
                    }
                  />
                  <FieldDivider />
                  <DetailField
                    label={t("detail.provider_invoice_id")}
                    value={
                      detail.row.provider_invoice_id ? (
                        <MonoBlock value={detail.row.provider_invoice_id} />
                      ) : (
                        <EmptyValue label={empty} />
                      )
                    }
                  />
                </dl>
              </DetailSection>

              {detail.row.refund_requested_at ||
              detail.row.refunded_at ||
              detail.row.refund_provider_ref ||
              detail.row.refund_reason ||
              detail.row.refund_confirm_reason ||
              detail.row.amount_refunded > 0 ||
              detail.row.partial_refund_amount > 0 ? (
                <DetailSection title={t("detail.section_refund")}>
                  <dl>
                    <DetailField
                      label={t("detail.refund_reason")}
                      value={
                        detail.row.refund_reason?.trim() ? (
                          <p className="whitespace-pre-wrap text-body">{detail.row.refund_reason.trim()}</p>
                        ) : (
                          <EmptyValue label={empty} />
                        )
                      }
                    />
                    <FieldDivider />
                    <DetailField
                      label={t("detail.refund_confirm_reason")}
                      value={
                        detail.row.refund_confirm_reason?.trim() ? (
                          <p className="whitespace-pre-wrap text-body">{detail.row.refund_confirm_reason.trim()}</p>
                        ) : (
                          <EmptyValue label={empty} />
                        )
                      }
                    />
                    <FieldDivider />
                    {detail.row.partial_refund_amount > 0 ? (
                      <>
                        <DetailField
                          label={t("detail.partial_refund_amount")}
                          value={formatMoney(
                            detail.row.partial_refund_amount,
                            detail.row.currency,
                            i18n.language,
                          )}
                        />
                        <FieldDivider />
                      </>
                    ) : null}
                    {detail.row.amount_refunded > 0 ? (
                      <>
                        <DetailField
                          label={t("detail.amount_refunded")}
                          value={formatMoney(detail.row.amount_refunded, detail.row.currency, i18n.language)}
                        />
                        <FieldDivider />
                      </>
                    ) : null}
                    {detail.row.refund_requested_at ? (
                      <>
                        <DetailField
                          label={t("detail.refund_requested_at")}
                          value={formatDateTime(detail.row.refund_requested_at, i18n.language)}
                        />
                        <FieldDivider />
                      </>
                    ) : null}
                    {detail.row.refunded_at ? (
                      <>
                        <DetailField
                          label={t("detail.refunded_at")}
                          value={formatDateTime(detail.row.refunded_at, i18n.language)}
                        />
                        <FieldDivider />
                      </>
                    ) : null}
                    {detail.row.refund_provider_ref ? (
                      <DetailField
                        label={t("detail.refund_provider_ref")}
                        value={<MonoBlock value={detail.row.refund_provider_ref} />}
                      />
                    ) : null}
                  </dl>
                </DetailSection>
              ) : null}

              <DetailSection title={t("detail.section_technical")}>
                <DetailField label={t("detail.internal_id")} value={<MonoBlock value={detail.row.id} />} />
                <FieldDivider />
                <DetailField
                  label={t("detail.payment_intent_id")}
                  value={
                    detail.row.payment_intent_id ? (
                      <div className="flex flex-col items-start gap-2 sm:items-end">
                        <MonoBlock value={detail.row.payment_intent_id} />
                        {onOpenPaymentIntent ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenPaymentIntent(detail.row.payment_intent_id)}
                          >
                            {t("detail.open_checkout_intent")}
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <EmptyValue label={empty} />
                    )
                  }
                />
              </DetailSection>
            </div>
          </>
        ) : null}

        {detail?.kind === "intent" ? (
          <>
            <SheetHeader className="shrink-0 border-b border-border bg-muted/15 px-4 py-4 pr-12">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CreditCard aria-hidden className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <SheetTitle>{t("detail.intent_title")}</SheetTitle>
                  <SheetDescription className="mt-1 line-clamp-2 font-mono text-caption">
                    {detail.row.provider_txn_ref}
                  </SheetDescription>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant={billingStatusVariant(detail.row.status)}>{statusLabel(detail.row.status)}</Badge>
                    {detail.row.provider ? (
                      <Badge variant="outline" className="uppercase">
                        {detail.row.provider}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
              <p className="mt-4 text-title font-semibold tabular-nums tracking-tight">
                {formatMoney(detail.row.amount, detail.row.currency, i18n.language)}
              </p>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
              <DetailSection title={t("detail.section_overview")}>
                <dl>
                  <DetailField
                    label={t("col.organization")}
                    value={
                      <span className="inline-flex items-center gap-1.5">
                        <Building2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                        <AppLink
                          href={paths.admin.organization(detail.row.organization_id)}
                          className="font-medium text-primary hover:underline"
                        >
                          {detail.row.org_name || detail.row.org_slug}
                        </AppLink>
                      </span>
                    }
                  />
                  <FieldDivider />
                  <DetailField
                    label={t("col.user")}
                    value={
                      <PayerValue
                        name={detail.row.user_display_name}
                        email={detail.row.user_email}
                        emptyLabel={empty}
                      />
                    }
                  />
                  <FieldDivider />
                  <DetailField
                    label={t("col.plan")}
                    value={
                      detail.row.plan_code ? (
                        <Badge variant="outline" className="font-mono">
                          {detail.row.plan_code}
                        </Badge>
                      ) : (
                        <EmptyValue label={empty} />
                      )
                    }
                  />
                  <FieldDivider />
                  <DetailField
                    label={t("col.created_at")}
                    value={formatDateTime(detail.row.created_at, i18n.language) || empty}
                  />
                  <FieldDivider />
                  <DetailField
                    label={t("detail.completed_at")}
                    value={formatDateTime(detail.row.completed_at, i18n.language) || empty}
                  />
                  <FieldDivider />
                  <DetailField
                    label={t("detail.expires_at")}
                    value={formatDateTime(detail.row.expires_at, i18n.language) || empty}
                  />
                </dl>
              </DetailSection>

              <DetailSection title={t("detail.section_vnpay")}>
                <dl>
                  <DetailField
                    label={t("col.bank")}
                    value={<BankValue code={detail.row.provider_bank_code} emptyLabel={empty} />}
                  />
                  <FieldDivider />
                  <DetailField label={t("col.txn_ref")} value={<MonoBlock value={detail.row.provider_txn_ref} />} />
                  <FieldDivider />
                  <DetailField
                    label={t("detail.vnpay_txn_no")}
                    value={
                      detail.row.provider_transaction_no ? (
                        <MonoBlock value={detail.row.provider_transaction_no} />
                      ) : (
                        <EmptyValue label={empty} />
                      )
                    }
                  />
                </dl>
              </DetailSection>

              <DetailSection title={t("detail.section_technical")}>
                <DetailField label={t("detail.internal_id")} value={<MonoBlock value={detail.row.id} />} />
              </DetailSection>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
