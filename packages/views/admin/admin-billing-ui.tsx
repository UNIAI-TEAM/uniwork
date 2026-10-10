"use client";

import type { ReactNode } from "react";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";
import { vnpayBankLabel } from "@uniwork/core/billing/vnpay-bank-label";
import { paths } from "@uniwork/core/paths";
import { AppLink } from "../navigation";

export function AdminBillingTableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto px-4 pb-2">
      <div className="min-w-[62rem] overflow-hidden rounded-lg border border-border">{children}</div>
    </div>
  );
}

export function adminBillingTableHeadClass() {
  return "bg-muted/50 text-caption font-medium text-muted-foreground";
}

export function adminBillingTableCellClass() {
  return "py-3 align-top";
}

export function AdminInvoiceStatusBadge({ status, label }: { status: string; label: string }) {
  const variant =
    status === "paid" || status === "completed"
      ? "secondary"
      : status === "refund_pending" || status === "partial_refund_pending" || status === "pending" || status === "open"
        ? "outline"
        : status === "refunded" || status === "failed" || status === "expired"
          ? "destructive"
          : "outline";
  return (
    <Badge variant={variant} className="max-w-[11rem] truncate font-normal" title={label}>
      {label}
    </Badge>
  );
}

export function AdminIntentStatusBadge({ status, label }: { status: string; label: string }) {
  return <AdminInvoiceStatusBadge status={status} label={label} />;
}

export function AdminOrgCell({ orgId, name, slug }: { orgId: string; name: string; slug: string }) {
  return (
    <div className="min-w-[8rem] max-w-[14rem]">
      <AppLink href={paths.admin.organization(orgId)} className="line-clamp-2 font-medium text-primary hover:underline">
        {name || slug}
      </AppLink>
      {slug ? <p className="mt-0.5 truncate font-mono text-caption text-muted-foreground">{slug}</p> : null}
    </div>
  );
}

export function AdminUserCell({ name, email }: { name: string; email: string }) {
  if (!name && !email) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="min-w-[9rem] max-w-[14rem]">
      {name ? <p className="truncate font-medium">{name}</p> : null}
      {email ? <p className="truncate text-caption text-muted-foreground">{email}</p> : null}
    </div>
  );
}

export function AdminPlanCell({ code, name }: { code: string; name?: string }) {
  if (!code) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="min-w-[5rem]">
      <p className="truncate text-body">{name || code}</p>
      <Badge variant="outline" className="mt-1 font-mono text-caption">
        {code}
      </Badge>
    </div>
  );
}

export function AdminBankCell({ code }: { code: string }) {
  if (!code) return <span className="text-muted-foreground">—</span>;
  const label = vnpayBankLabel(code);
  return (
    <span className="line-clamp-2 text-body" title={code}>
      {label}
    </span>
  );
}

export function AdminMonoCell({ value, maxWidth = "9.5rem" }: { value: string; maxWidth?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <code
      className="block truncate rounded-md bg-muted/50 px-1.5 py-0.5 font-mono text-caption"
      style={{ maxWidth }}
      title={value}
    >
      {value}
    </code>
  );
}

export function AdminMoneyCell({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap font-medium tabular-nums">{children}</span>;
}

export function AdminProviderBadge({ provider }: { provider: string }) {
  if (!provider) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className="uppercase">
      {provider}
    </Badge>
  );
}

export function AdminBillingFiltersPanel({
  children,
  dateHint,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  fromLabel,
  toLabel,
  rangeInvalid,
  rangeInvalidMessage,
}: {
  children: ReactNode;
  dateHint: string;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  fromLabel: string;
  toLabel: string;
  rangeInvalid: boolean;
  rangeInvalidMessage: string;
}) {
  return (
    <div className="space-y-3 border-b border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <div className="flex flex-wrap items-end gap-3">
        <p className="w-full text-caption text-muted-foreground sm:w-auto sm:flex-1">{dateHint}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="admin-billing-from" className="text-caption text-muted-foreground">
              {fromLabel}
            </Label>
            <Input
              id="admin-billing-from"
              type="date"
              variant="subtle"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              className="h-9 w-[10.5rem]"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="admin-billing-to" className="text-caption text-muted-foreground">
              {toLabel}
            </Label>
            <Input
              id="admin-billing-to"
              type="date"
              variant="subtle"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              className={cn("h-9 w-[10.5rem]", rangeInvalid && "border-destructive")}
            />
          </div>
        </div>
      </div>
      {rangeInvalid ? (
        <p className="text-caption text-destructive" role="alert">
          {rangeInvalidMessage}
        </p>
      ) : null}
    </div>
  );
}
