"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CreditCard, Pencil, Plus } from "lucide-react";
import {
  useAdminPlans,
  useCreateAdminPlan,
  useUpdateAdminPlan,
  useUpdateAdminPlanFeature,
} from "@uniwork/core/admin";
import type { AdminPlan, AdminPlanFeature, PlanCreateInput, PlanUpsertInput } from "@uniwork/core/types/admin";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@uniwork/ui/components/ui/table";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { ReasonDialog } from "./reason-dialog";

const BYTES_PER_GIB = 1024 ** 3;

function isStorageQuota(feature: AdminPlanFeature): boolean {
  return feature.feature_key === "storage.bytes" || feature.unit === "bytes";
}

function quotaToInputValue(feature: AdminPlanFeature): string {
  if (feature.quota_limit == null) return "";
  if (isStorageQuota(feature)) {
    const gb = feature.quota_limit / BYTES_PER_GIB;
    return Number.isInteger(gb) ? String(gb) : gb.toFixed(2).replace(/\.?0+$/, "");
  }
  return String(feature.quota_limit);
}

function parseQuotaForSave(featureKey: string, unit: string, raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  if (featureKey === "storage.bytes" || unit === "bytes") {
    return Math.round(n * BYTES_PER_GIB);
  }
  return Math.round(n);
}

function formatPrice(amount: number | null, currency: string): string {
  if (amount == null) return "—";
  if (amount === 0) return "0";
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: currency || "VND", maximumFractionDigits: 0 }).format(
    amount,
  );
}

function CreatePlanDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.plans" });
  const mutation = useCreateAdminPlan();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [billingPeriod, setBillingPeriod] = useState("month");
  const [price, setPrice] = useState("");
  const [sortOrder, setSortOrder] = useState("10");
  const [isActive, setIsActive] = useState(true);

  const bodyBase = useMemo((): Omit<PlanCreateInput, "reason"> | null => {
    const c = code.trim().toLowerCase();
    const n = name.trim();
    if (!c || !n) return null;
    return {
      code: c,
      name: n,
      description: description.trim(),
      billing_period: billingPeriod.trim() || "month",
      price_amount: price.trim() === "" ? null : Number(price),
      price_currency: "VND",
      is_active: isActive,
      sort_order: Number(sortOrder) || 0,
    };
  }, [code, name, description, billingPeriod, price, isActive, sortOrder]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCode("");
      setName("");
      setDescription("");
      setBillingPeriod("month");
      setPrice("");
      setSortOrder("10");
      setIsActive(true);
    }
    onOpenChange(next);
  };

  return (
    <ReasonDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("create_title")}
      description={t("create_description")}
      submitDisabled={!bodyBase}
      pending={mutation.isPending}
      onSubmit={(reason) => {
        if (!bodyBase) return;
        void mutation.mutateAsync({ ...bodyBase, reason }).then(() => handleOpenChange(false));
      }}
    >
      <div className="flex flex-col gap-3 py-2">
        <div className="grid gap-1.5">
          <Label htmlFor="plan-create-code">{t("field.code")}</Label>
          <Input id="plan-create-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="enterprise" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="plan-create-name">{t("field.name")}</Label>
          <Input id="plan-create-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="plan-create-desc">{t("field.description")}</Label>
          <Input id="plan-create-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="plan-create-period">{t("field.billing_period")}</Label>
            <Input id="plan-create-period" value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="plan-create-price">{t("field.price")}</Label>
            <Input id="plan-create-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="plan-create-sort">{t("field.sort_order")}</Label>
            <Input id="plan-create-sort" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 pt-6 text-body">
            <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(v === true)} />
            {t("field.is_active")}
          </label>
        </div>
      </div>
    </ReasonDialog>
  );
}

function PlanEditDialog({
  plan,
  open,
  onOpenChange,
}: {
  plan: AdminPlan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.plans" });
  const mutation = useUpdateAdminPlan(plan.code);
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description);
  const [billingPeriod, setBillingPeriod] = useState(plan.billing_period);
  const [price, setPrice] = useState(plan.price_amount != null ? String(plan.price_amount) : "");
  const [sortOrder, setSortOrder] = useState(String(plan.sort_order));
  const [isActive, setIsActive] = useState(plan.is_active);

  const bodyBase = useMemo(
    (): Omit<PlanUpsertInput, "reason"> => ({
      name: name.trim(),
      description: description.trim(),
      billing_period: billingPeriod.trim() || "none",
      price_amount: price.trim() === "" ? null : Number(price),
      price_currency: plan.price_currency || "VND",
      is_active: isActive,
      sort_order: Number(sortOrder) || 0,
    }),
    [name, description, billingPeriod, price, plan.price_currency, isActive, sortOrder],
  );

  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("edit_title", { code: plan.code })}
      description={t("edit_description")}
      submitDisabled={!bodyBase.name}
      pending={mutation.isPending}
      onSubmit={(reason) => {
        void mutation.mutateAsync({ ...bodyBase, reason }).then(() => onOpenChange(false));
      }}
    >
      <div className="flex flex-col gap-3 py-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`plan-name-${plan.code}`}>{t("field.name")}</Label>
          <Input id={`plan-name-${plan.code}`} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`plan-desc-${plan.code}`}>{t("field.description")}</Label>
          <Input id={`plan-desc-${plan.code}`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`plan-period-${plan.code}`}>{t("field.billing_period")}</Label>
            <Input id={`plan-period-${plan.code}`} value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`plan-price-${plan.code}`}>{t("field.price")}</Label>
            <Input id={`plan-price-${plan.code}`} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`plan-sort-${plan.code}`}>{t("field.sort_order")}</Label>
            <Input id={`plan-sort-${plan.code}`} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 pt-6 text-body">
            <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(v === true)} disabled={plan.is_default} />
            {t("field.is_active")}
          </label>
        </div>
        {plan.is_default ? <p className="text-caption text-muted-foreground">{t("default_hint")}</p> : null}
      </div>
    </ReasonDialog>
  );
}

function FeatureRow({ planCode, feature }: { planCode: string; feature: AdminPlanFeature }) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.plans" });
  const mutation = useUpdateAdminPlanFeature(planCode, feature.feature_key);
  const [enabled, setEnabled] = useState(feature.enabled);
  const [quota, setQuota] = useState(() => quotaToInputValue(feature));
  const [dialogOpen, setDialogOpen] = useState(false);
  const isQuota = feature.kind === "quota";
  const storageGb = isStorageQuota(feature);
  const savedQuota = parseQuotaForSave(feature.feature_key, feature.unit, quota);
  const dirty = enabled !== feature.enabled || (isQuota && savedQuota !== feature.quota_limit);

  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-caption">{feature.feature_key}</TableCell>
        <TableCell>{feature.name || feature.feature_key}</TableCell>
        <TableCell>{feature.kind}</TableCell>
        <TableCell>
          <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} aria-label={t("feature_enabled")} />
        </TableCell>
        <TableCell>
          {isQuota ? (
            storageGb ? (
              <div className="flex max-w-[10rem] items-center gap-1.5">
                <Input
                  className="min-w-0 flex-1"
                  inputMode="decimal"
                  placeholder={t("quota_storage_placeholder")}
                  aria-label={t("quota_storage_aria")}
                  value={quota}
                  onChange={(e) => setQuota(e.target.value)}
                />
                <span className="shrink-0 text-caption text-muted-foreground">{t("unit_gb")}</span>
              </div>
            ) : (
              <Input
                className="max-w-[8rem]"
                inputMode="numeric"
                placeholder={t("quota_unlimited")}
                value={quota}
                onChange={(e) => setQuota(e.target.value)}
              />
            )
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-right">
          <Button variant="outline" size="sm" disabled={!dirty} onClick={() => setDialogOpen(true)}>
            {t("save_feature")}
          </Button>
        </TableCell>
      </TableRow>
      <ReasonDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("feature_edit_title", { key: feature.feature_key })}
        pending={mutation.isPending}
        onSubmit={(reason) => {
          const quotaLimit = isQuota ? parseQuotaForSave(feature.feature_key, feature.unit, quota) : null;
          void mutation.mutateAsync({ enabled, quota_limit: quotaLimit, reason }).then(() => setDialogOpen(false));
        }}
      />
    </>
  );
}

function PlanSection({ plan }: { plan: AdminPlan }) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.plans" });
  const [editOpen, setEditOpen] = useState(false);

  return (
    <section className="border-b border-border px-4 py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-title font-medium">{plan.name}</h2>
            <Badge variant="outline" className="font-mono text-caption">
              {plan.code}
            </Badge>
            {!plan.is_active ? <Badge variant="secondary">{t("badge.inactive")}</Badge> : null}
            {plan.is_default ? <Badge>{t("badge.default")}</Badge> : null}
          </div>
          <p className="mt-1 text-body text-muted-foreground">{plan.description || t("no_description")}</p>
          <p className="mt-1 text-caption text-muted-foreground">
            {t("meta", {
              price: formatPrice(plan.price_amount, plan.price_currency),
              period: plan.billing_period,
              order: plan.sort_order,
            })}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil aria-hidden="true" className="size-4" />
          {t("edit_plan")}
        </Button>
        <PlanEditDialog plan={plan} open={editOpen} onOpenChange={setEditOpen} />
      </div>
      <Table className="mt-4">
        <TableHeader>
          <TableRow>
            <TableHead>{t("col.feature_key")}</TableHead>
            <TableHead>{t("col.name")}</TableHead>
            <TableHead>{t("col.kind")}</TableHead>
            <TableHead>{t("col.enabled")}</TableHead>
            <TableHead>{t("col.quota")}</TableHead>
            <TableHead className="text-right">{t("col.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plan.features.map((f) => (
            <FeatureRow key={f.feature_key} planCode={plan.code} feature={f} />
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

/** /admin/plans — billing catalog: metadata, entitlements and quotas per tier. */
export function AdminPlansView() {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.plans" });
  const plans = useAdminPlans();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <CollectionPageHeader
        icon={CreditCard}
        title={t("title")}
        count={plans.data?.length}
        description={t("description")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" className="size-4" />
            {t("create_action")}
          </Button>
        }
      />
      <CreatePlanDialog open={createOpen} onOpenChange={setCreateOpen} />
      {plans.isPending ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : plans.isError ? (
        <CollectionPageState
          icon={AlertCircle}
          tone="destructive"
          role="alert"
          title={t("error_title")}
          description={t("error_description")}
          actions={
            <Button variant="outline" onClick={() => void plans.refetch()}>
              {t("retry")}
            </Button>
          }
        />
      ) : (plans.data?.length ?? 0) === 0 ? (
        <CollectionPageState icon={CreditCard} title={t("empty_title")} description={t("empty_description")} role="status" />
      ) : (
        <div className="flex flex-col">
          {plans.data!.map((plan) => (
            <PlanSection key={plan.code} plan={plan} />
          ))}
        </div>
      )}
    </>
  );
}
