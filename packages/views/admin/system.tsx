"use client";

import { useTranslation } from "react-i18next";
import { AlertCircle, Activity, CheckCircle2, XCircle } from "lucide-react";
import { useAdminSystem } from "@uniwork/core/admin";
import type { AdminSystem } from "@uniwork/core/types";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-body text-muted-foreground">{label}</dt>
      <dd className="font-mono text-body tabular-nums">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1 border-b border-border px-4 py-4">
      <h2 className="text-caption font-medium text-muted-foreground">{title}</h2>
      <dl className="divide-y divide-border">{children}</dl>
    </section>
  );
}

function SystemBody({ system }: { system: AdminSystem }) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.system" });
  return (
    <div className="flex flex-col">
      <Section title={t("readiness")}>
        <Row label={t("ready")}>
          <Badge variant={system.readiness.ready ? "secondary" : "destructive"}>
            {system.readiness.ready ? t("ready_yes") : t("ready_no")}
          </Badge>
        </Row>
        {system.readiness.checks.map((c) => (
          <Row key={c.name} label={c.name}>
            <span className="inline-flex items-center gap-1.5">
              {c.ok ? (
                <CheckCircle2 aria-hidden="true" className="size-3.5 text-success" />
              ) : (
                <XCircle aria-hidden="true" className="size-3.5 text-destructive" />
              )}
              <span className="sr-only">{c.ok ? t("check_ok") : t("check_failed")}</span>
              {c.detail}
            </span>
          </Row>
        ))}
      </Section>
      <Section title={t("versions")}>
        <Row label={t("version")}>{system.version}</Row>
        <Row label={t("commit")}>{system.commit}</Row>
        <Row label={t("migration")}>{system.migration_embedded}</Row>
      </Section>
      <Section title={t("outbox")}>
        <Row label={t("outbox_pending")}>{system.outbox_pending}</Row>
        <Row label={t("outbox_dead")}>{system.outbox_dead}</Row>
        <Row label={t("outbox_oldest")}>{t("seconds", { n: Math.round(system.outbox_oldest_pending_age_seconds) })}</Row>
      </Section>
      <Section title={t("realtime")}>
        <Row label={t("connections")}>{system.realtime_connections}</Row>
      </Section>
      <Section title={t("providers")}>
        <Row label={t("provider_chain")}>{system.flag_providers.join(" → ") || t("none")}</Row>
      </Section>
    </div>
  );
}

/** /admin/system — readiness, versions, outbox, realtime, flag providers. */
export function AdminSystemView() {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.system" });
  const system = useAdminSystem();
  return (
    <>
      <CollectionPageHeader icon={Activity} title={t("title")} />
      {system.isPending ? (
        <Skeleton className="m-4 h-64" />
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
        <SystemBody system={system.data} />
      )}
    </>
  );
}
