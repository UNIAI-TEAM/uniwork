"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { adminKeys, useAdminConfirmInvoiceRefund, useAdminRefundInvoice } from "@uniwork/core/admin";
import { ApiError } from "@uniwork/core/api";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { ReasonDialog } from "./reason-dialog";

export type InvoiceRefundTarget = {
  id: string;
  number: string;
  amount_paid: number;
  currency: string;
};

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

export function AdminInvoiceRefundDialogs({
  refundTarget,
  onRefundTargetChange,
  confirmTarget,
  onConfirmTargetChange,
}: {
  refundTarget: InvoiceRefundTarget | null;
  onRefundTargetChange: (v: InvoiceRefundTarget | null) => void;
  confirmTarget: { id: string; number: string } | null;
  onConfirmTargetChange: (v: { id: string; number: string } | null) => void;
}) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "admin.invoices" });
  const qc = useQueryClient();
  const refundInFlight = useRef(false);
  const refund = useAdminRefundInvoice();
  const confirmRefund = useAdminConfirmInvoiceRefund();
  const [providerRef, setProviderRef] = useState("");
  const [refundMode, setRefundMode] = useState<"full" | "partial">("full");
  const [partialAmount, setPartialAmount] = useState("");

  const resetRefundForm = () => {
    setProviderRef("");
    setRefundMode("full");
    setPartialAmount("");
  };

  return (
    <>
      <ReasonDialog
        open={refundTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            onRefundTargetChange(null);
            resetRefundForm();
          }
        }}
        title={t("refund_title", { number: refundTarget?.number ?? "" })}
        description={t("refund_description")}
        destructive
        pending={refund.isPending}
        onSubmit={(reason) => {
          if (!refundTarget || refundInFlight.current || refund.isPending) return;
          let refundAmount: number | undefined;
          if (refundMode === "partial") {
            const raw = partialAmount.trim().replace(/\s/g, "").replace(/\./g, "");
            const n = Number(raw);
            if (!Number.isFinite(n) || n <= 0 || n > refundTarget.amount_paid) {
              toast.error(t("refund_partial_invalid"));
              return;
            }
            refundAmount = Math.round(n);
          }
          refundInFlight.current = true;
          void refund
            .mutateAsync({
              invoiceId: refundTarget.id,
              reason,
              provider_reference: providerRef.trim() || undefined,
              refund_amount: refundAmount,
            })
            .then(
              (row) => {
                const partial = refundMode === "partial";
                let msg = t("refund_success");
                if (partial && row?.status === "partial_refund_pending") msg = t("refund_partial_success");
                else if (row?.status === "refund_pending") msg = t("refund_requested_success");
                toast.success(msg);
                onRefundTargetChange(null);
                resetRefundForm();
              },
              (err: unknown) => {
                if (err instanceof ApiError && err.code === "vnpay_refund_pending") {
                  void qc.invalidateQueries({ queryKey: adminKeys.invoicesRoot });
                  toast.success(t("refund_requested_success"));
                  onRefundTargetChange(null);
                  resetRefundForm();
                  return;
                }
                if (err instanceof ApiError && err.code === "invoice_not_refundable") {
                  void qc.invalidateQueries({ queryKey: adminKeys.invoicesRoot });
                  toast.success(t("refund_requested_success"));
                  onRefundTargetChange(null);
                  resetRefundForm();
                  return;
                }
                let msg = t("refund_failed");
                if (err instanceof ApiError) {
                  if (err.code === "payment_intent_not_found") msg = t("refund_no_intent");
                  else if (err.code === "invalid_refund_amount") msg = t("refund_partial_invalid");
                  else if (
                    err.code === "vnpay_refund_failed" ||
                    err.code === "vnpay_query_failed" ||
                    err.code === "billing_provider_unavailable"
                  ) {
                    msg = err.message.trim() || t("refund_vnpay_failed");
                  }
                }
                toast.error(msg);
              },
            )
            .finally(() => {
              refundInFlight.current = false;
            });
        }}
      >
        {refundTarget ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <p className="text-caption text-muted-foreground">{t("refund_invoice_number")}</p>
              <p className="font-mono text-body font-medium">{refundTarget.number}</p>
            </div>
            <p className="text-body">
              {t("refund_amount_label")}{" "}
              <span className="font-medium tabular-nums">
                {formatMoney(refundTarget.amount_paid, refundTarget.currency, i18n.language)}
              </span>
            </p>
            <RadioGroup
              value={refundMode}
              onValueChange={(v) => {
                if (v === "full" || v === "partial") setRefundMode(v);
              }}
              className="gap-2"
            >
              <label className="flex cursor-pointer items-center gap-2 text-body">
                <RadioGroupItem value="full" />
                {t("refund_mode_full")}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-body">
                <RadioGroupItem value="partial" />
                {t("refund_mode_partial")}
              </label>
            </RadioGroup>
            {refundMode === "partial" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="refund-partial-amount">{t("refund_partial_amount")}</Label>
                <Input
                  id="refund-partial-amount"
                  inputMode="numeric"
                  value={partialAmount}
                  onChange={(e) => setPartialAmount(e.target.value)}
                  placeholder={t("refund_partial_placeholder")}
                />
                <p className="text-caption text-muted-foreground">{t("refund_partial_hint")}</p>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="refund-provider-ref">{t("refund_provider_ref")}</Label>
          <Input
            id="refund-provider-ref"
            value={providerRef}
            onChange={(e) => setProviderRef(e.target.value)}
            placeholder={t("refund_provider_ref_placeholder")}
          />
          <p className="text-caption text-muted-foreground">{t("refund_provider_ref_hint")}</p>
        </div>
      </ReasonDialog>
      <ReasonDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) onConfirmTargetChange(null);
        }}
        title={t("confirm_refund_title", { number: confirmTarget?.number ?? "" })}
        description={t("confirm_refund_description")}
        pending={confirmRefund.isPending}
        onSubmit={(reason) => {
          if (!confirmTarget) return;
          void confirmRefund
            .mutateAsync({ invoiceId: confirmTarget.id, reason })
            .then(
              () => {
                toast.success(t("confirm_refund_success"));
                onConfirmTargetChange(null);
              },
              (err: unknown) => {
                let msg = t("refund_failed");
                if (err instanceof ApiError && err.code === "invoice_not_refundable") {
                  msg = t("refund_not_allowed");
                } else if (err instanceof ApiError && err.message.trim()) {
                  msg = err.message.trim();
                }
                toast.error(msg);
              },
            );
        }}
      />
    </>
  );
}
