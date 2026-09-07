"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Activity, AlertCircle, Building2, CheckCircle2, PauseCircle, Radio, RefreshCw, Send, XCircle } from "lucide-react";
import { useAdminOrganizations, useAdminSystem } from "@uniwork/core/admin";
import { paths } from "@uniwork/core/paths";
import type { AdminSystem } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { AppLink } from "../navigation";
import { UpdatedAt } from "./updated-at";

type Tone = "ok" | "warn" | "bad";

const toneRing: Record<Tone, string> = {
  ok: "border-border",
  warn: "border-warning/50",
  bad: "border-destructive/50",
};

const toneText: Record<Tone, string> = {
  ok: "text-foreground",
  warn: "text-warning",
  bad: "text-destructive",
};

interface SignalProps {
  icon: typeof Activity;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  href?: string;
  linkLabel?: string;
}

/** One number an on-call reads first, with the reason it is worth reading. */
function Signal({ icon: Icon, label, value, hint, tone = "ok", href, linkLabel }: SignalProps) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-lg border p-4", toneRing[tone])}>
      <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </span>
      <span className={cn("text-title font-medium tabular-nums", toneText[tone])}>{value}</span>
      {hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null}
      {href && linkLabel ? (
        <AppLink href={href} className="mt-1 w-fit text-caption text-muted-foreground underline-offset-2 hover:underline">
          {linkLabel}
        </AppLink>
      ) : null}
    </div>
  );
}

function OverviewBody({ system }: { system: AdminSystem }) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.overview" });
  const all = useAdminOrganizations({ limit: 1 });
  const suspended = useAdminOrganizations({ status: "suspended", limit: 1 });
  const failed = system.readiness.checks.filter((c) => !c.ok);
  const suspendedCount = suspended.data?.total ?? 0;
  const oldestSeconds = Math.round(system.outbox_oldest_pending_age_seconds);

  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
      <Signal
        icon={system.readiness.ready ? CheckCircle2 : XCircle}
        label={t("readiness")}
        value={system.readiness.ready ? t("ready_yes") : t("ready_no")}
        tone={system.readiness.ready ? "ok" : "bad"}
        hint={failed.length > 0 ? failed.map((c) => c.name).join(", ") : t("checks_ok", { n: system.readiness.checks.length })}
        href={paths.admin.system()}
        linkLabel={t("open_system")}
      />
      <Signal
        icon={Send}
        label={t("outbox_dead")}
        value={system.outbox_dead}
        tone={system.outbox_dead > 0 ? "bad" : "ok"}
        hint={t("outbox_dead_hint")}
      />
      <Signal
        icon={Send}
        label={t("outbox_pending")}
        value={system.outbox_pending}
        tone={oldestSeconds > 60 ? "warn" : "ok"}
        hint={t("outbox_oldest", { n: oldestSeconds })}
      />
      <Signal
        icon={Building2}
        label={t("organizations")}
        value={all.data?.total ?? 0}
        href={paths.admin.organizations()}
        linkLabel={t("open_organizations")}
      />
      <Signal
        icon={PauseCircle}
        label={t("suspended")}
        value={suspendedCount}
        tone={suspendedCount > 0 ? "warn" : "ok"}
        hint={t("suspended_hint")}
      />
      <Signal
        icon={Radio}
        label={t("realtime")}
        value={system.realtime_connections}
        hint={t("build", { version: system.version, commit: system.commit })}
      />
    </div>
  );
}

/**
 * /admin — the console's front door. F-11 asks that an incident go from alert
 * to trace in ten minutes, so what greets an on-call is the health of the
 * platform, not a directory they still have to interpret.
 */
export function AdminOverviewView() {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.overview" });
  const system = useAdminSystem();
  return (
    <>
      <CollectionPageHeader
        icon={Activity}
        title={t("title")}
        description={<UpdatedAt at={system.dataUpdatedAt} />}
        actions={
          <Button size="sm" variant="outline" disabled={system.isFetching} onClick={() => void system.refetch()}>
            <RefreshCw aria-hidden="true" className={cn("size-3.5", system.isFetching && "animate-spin")} />
            {t("refresh")}
          </Button>
        }
      />
      {system.isPending ? (
        <Skeleton className="m-4 h-40" />
      ) : system.isError || !system.data ? (
        <CollectionPageState
          icon={AlertCircle}
          tone="destructive"
          role="alert"
          title={t("error_title")}
          description={t("error_description")}
          actions={
            <Button variant="outline" onClick={() => void system.refetch()}>
              {t("retry")}
            </Button>
          }
        />
      ) : (
        <OverviewBody system={system.data} />
      )}
    </>
  );
}
