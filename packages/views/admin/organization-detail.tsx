"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Building2 } from "lucide-react";
import { toast } from "sonner";
import {
  useAdminFlags,
  useAdminOrganization,
  useAllFlagOverrides,
  useChangeOrganizationPlan,
  useSuspendOrganization,
  useUnsuspendOrganization,
} from "@uniwork/core/admin";
import { apiErrorMessage } from "@uniwork/core/api";
import { usePlans } from "@uniwork/core/billing";
import { paths } from "@uniwork/core/paths";
import type { AdminAction, AdminEntitlement, AdminOrganizationDetail } from "@uniwork/core/types";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Progress } from "@uniwork/ui/components/ui/progress";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@uniwork/ui/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { EventTime, shortId } from "../audit/event-presenter";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import { CollectionPageState } from "../layout/collection-page";
import { AppLink } from "../navigation";
import { FlagOverrideRow } from "./flag-override-row";
import { ReasonDialog } from "./reason-dialog";
import { formatDateTime, OrganizationStatusBadge } from "./status-badge";

type Action = "suspend" | "unsuspend" | "plan";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-body">{children}</dd>
    </div>
  );
}

/** Where a quota sits between comfortable and out. */
function usageTone(pct: number): string {
  if (pct >= 100) return "[&_[data-slot=progress-indicator]]:bg-destructive";
  if (pct >= 80) return "[&_[data-slot=progress-indicator]]:bg-warning";
  return "[&_[data-slot=progress-indicator]]:bg-primary";
}

/**
 * A quota is read to answer "is this tenant about to hit the wall", and two
 * bare numbers make that a subtraction the reader has to do per row.
 */
function UsageMeter({ entitlement }: { entitlement: AdminEntitlement }) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.detail" });
  if (entitlement.limit === null || entitlement.limit === undefined) {
    return <span className="text-caption text-muted-foreground">{t("unlimited")}</span>;
  }
  const pct = entitlement.limit === 0 ? 100 : Math.min(100, Math.round((entitlement.current / entitlement.limit) * 100));
  return (
    <span className="flex flex-col gap-1">
      <Progress
        value={pct}
        className={usageTone(pct)}
        aria-label={t("usage_label", { key: entitlement.key, current: entitlement.current, limit: entitlement.limit })}
      />
      <span className="text-caption text-muted-foreground tabular-nums">{t("usage_percent", { n: pct })}</span>
    </span>
  );
}

/** The org's entitlement snapshot; also what the Quota screen shows. */
export function EntitlementsTable({ entitlements }: { entitlements: AdminEntitlement[] }) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.detail" });
  if (entitlements.length === 0) {
    return <p className="px-4 py-6 text-body text-muted-foreground">{t("no_entitlements")}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("col.key")}</TableHead>
          <TableHead>{t("col.kind")}</TableHead>
          <TableHead>{t("col.enabled")}</TableHead>
          <TableHead className="text-right">{t("col.current")}</TableHead>
          <TableHead className="text-right">{t("col.limit")}</TableHead>
          <TableHead className="w-40">{t("col.usage")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entitlements.map((e) => (
          <TableRow key={e.key}>
            <TableCell className="font-mono text-caption">{e.key}</TableCell>
            <TableCell>{e.kind}</TableCell>
            <TableCell>{e.enabled ? t("on") : t("off")}</TableCell>
            <TableCell className="text-right tabular-nums">{e.current}</TableCell>
            <TableCell className="text-right tabular-nums">{e.limit === null ? t("unlimited") : e.limit}</TableCell>
            <TableCell>
              <UsageMeter entitlement={e} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ActionsTable({ actions }: { actions: AdminAction[] }) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.detail" });
  if (actions.length === 0) {
    return <p className="px-4 py-6 text-body text-muted-foreground">{t("history_empty")}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("col.time")}</TableHead>
          <TableHead>{t("col.action")}</TableHead>
          <TableHead>{t("col.actor")}</TableHead>
          <TableHead>{t("col.reason")}</TableHead>
          <TableHead>{t("col.trace")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {actions.map((a) => (
          <TableRow key={a.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              <EventTime iso={a.created_at} />
            </TableCell>
            <TableCell className="font-mono text-caption">{a.action}</TableCell>
            <TableCell className="font-mono text-caption">{shortId(a.actor_id)}</TableCell>
            <TableCell className="max-w-sm truncate" title={a.reason}>
              {a.reason}
            </TableCell>
            <TableCell className="font-mono text-caption">
              {a.trace_id ? (
                <AppLink href={paths.admin.trace(a.trace_id)} className="underline underline-offset-2 hover:text-foreground">
                  {shortId(a.trace_id)}
                </AppLink>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function FlagsTab({ orgId }: { orgId: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.flags" });
  const flags = useAdminFlags();
  const overrides = useAllFlagOverrides();
  if (flags.isPending || overrides.isPending) return <Skeleton className="m-4 h-24" />;
  if (flags.isError || flags.data.length === 0) {
    return <p className="px-4 py-6 text-body text-muted-foreground">{t("empty_title")}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("col.key")}</TableHead>
          <TableHead>{t("col.description")}</TableHead>
          <TableHead>{t("col.organization")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {flags.data.map((flag) => (
          <FlagOverrideRow key={flag.key} flag={flag} scopeType="organization" scopeId={orgId} overrides={overrides.data ?? []} />
        ))}
      </TableBody>
    </Table>
  );
}

function Detail({ detail, orgId }: { detail: AdminOrganizationDetail; orgId: string }) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "admin.detail" });
  const org = detail.organization;
  const suspended = org.status === "suspended";
  const [action, setAction] = useState<Action | null>(null);
  const [planCode, setPlanCode] = useState("");
  const plans = usePlans();
  const suspend = useSuspendOrganization(orgId);
  const unsuspend = useUnsuspendOrganization(orgId);
  const changePlan = useChangeOrganizationPlan(orgId);
  const busy = suspend.isPending || unsuspend.isPending || changePlan.isPending;
  const planItems = (plans.data ?? []).map((p) => ({ value: p.code, label: `${p.name} (${p.code})` }));

  const submit = async (reason: string) => {
    try {
      if (action === "suspend") {
        await suspend.mutateAsync(reason);
        toast.success(t("suspended_toast"));
      } else if (action === "unsuspend") {
        await unsuspend.mutateAsync(reason);
        toast.success(t("unsuspended_toast"));
      } else if (action === "plan") {
        await changePlan.mutateAsync({ plan_code: planCode, reason });
        toast.success(t("plan_changed_toast", { code: planCode }));
      }
      setAction(null);
    } catch (err) {
      toast.error(apiErrorMessage(err) ?? t("error_write"));
    }
  };

  return (
    <>
      <BreadcrumbHeader
        segments={[{ href: paths.admin.root(), label: t("crumb") }]}
        leaf={
          <span className="flex items-center gap-2">
            {org.name}
            <OrganizationStatusBadge status={org.status} />
            <Badge variant="outline" className="font-mono">
              {org.plan_code}
            </Badge>
          </span>
        }
        actions={
          <>
            {suspended ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setAction("unsuspend")}>
                {t("unsuspend")}
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setAction("suspend")}>
                {t("suspend")}
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setAction("plan")}>
              {t("change_plan")}
            </Button>
          </>
        }
      />
      {suspended ? (
        <div role="status" className="border-b border-border bg-destructive/10 px-4 py-2 text-body text-destructive">
          {t("suspended_banner", { at: formatDateTime(detail.suspended_at, i18n.language) })}
          {detail.suspended_reason ? <span className="ml-1 text-foreground">{detail.suspended_reason}</span> : null}
        </div>
      ) : null}
      <Tabs defaultValue="overview" className="gap-0">
        <TabsList variant="line" className="px-4">
          <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
          <TabsTrigger value="flags">{t("tabs.flags")}</TabsTrigger>
          <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <dl className="grid grid-cols-2 gap-4 border-b border-border p-4 md:grid-cols-4">
            <Fact label={t("members")}>{org.member_count}</Fact>
            <Fact label={t("workspaces")}>{org.workspace_count}</Fact>
            <Fact label={t("created_at")}>{formatDateTime(org.created_at, i18n.language)}</Fact>
            <Fact label={t("last_activity")}>
              {org.last_activity_at ? formatDateTime(org.last_activity_at, i18n.language) : t("never")}
            </Fact>
          </dl>
          <h2 className="px-4 pt-4 text-caption font-medium text-muted-foreground">{t("entitlements")}</h2>
          <EntitlementsTable entitlements={detail.entitlements} />
        </TabsContent>
        <TabsContent value="flags">
          <FlagsTab orgId={orgId} />
        </TabsContent>
        <TabsContent value="history">
          <ActionsTable actions={detail.actions} />
        </TabsContent>
      </Tabs>
      <ReasonDialog
        open={action !== null}
        onOpenChange={(open) => !open && setAction(null)}
        title={action ? t(`${action}_title`, { name: org.name }) : ""}
        description={action ? t(`${action}_description`) : undefined}
        destructive={action === "suspend"}
        submitDisabled={action === "plan" && !planCode}
        pending={busy}
        onSubmit={(reason) => void submit(reason)}
      >
        {action === "plan" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-plan">{t("plan_label")}</Label>
            <Select items={planItems} value={planCode} onValueChange={(next) => setPlanCode(next ?? "")}>
              <SelectTrigger id="admin-plan" className="w-full" aria-label={t("plan_label")}>
                <SelectValue placeholder={t("plan_placeholder")}>
                  {planItems.find((p) => p.value === planCode)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {planItems.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </ReasonDialog>
    </>
  );
}

/** /admin/organizations/{id} */
export function AdminOrganizationDetailView({ orgId }: { orgId: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.detail" });
  const detail = useAdminOrganization(orgId);
  if (detail.isPending) {
    return (
      <>
        <BreadcrumbHeader segments={[{ href: paths.admin.root(), label: t("crumb") }]} leaf={<Skeleton className="h-4 w-32" />} />
        <Skeleton className="m-4 h-40" />
      </>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <>
        <BreadcrumbHeader segments={[{ href: paths.admin.root(), label: t("crumb") }]} leaf={t("not_found")} />
        <CollectionPageState
          icon={detail.isError ? AlertCircle : Building2}
          tone={detail.isError ? "destructive" : "muted"}
          role={detail.isError ? "alert" : "status"}
          title={detail.isError ? t("error_title") : t("not_found")}
          description={detail.isError ? t("error_description") : undefined}
          actions={
            detail.isError ? (
              <Button variant="outline" onClick={() => void detail.refetch()}>
                {t("retry")}
              </Button>
            ) : undefined
          }
        />
      </>
    );
  }
  return <Detail detail={detail.data} orgId={orgId} />;
}
