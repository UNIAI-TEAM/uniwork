"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Check, Download, FileDown } from "lucide-react";
import { toast } from "sonner";
import {
  useAuditExports,
  useAuditRetention,
  useCreateAuditExport,
  useSetAuditRetention,
} from "@uniwork/core/audit";
import type { AuditExport } from "@uniwork/core/types";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button, ButtonLink } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { DateField } from "../../common/date-field";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { EventTime } from "../../audit/event-presenter";
import { dayEnd, dayStart } from "./audit-log";
import { SettingsCard, SettingsRow, SettingsSection } from "./settings-layout";

export function AuditRetention({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit" });
  const retention = useAuditRetention(orgId);
  const setRetention = useSetAuditRetention(orgId);
  const [draft, setDraft] = useState("");
  const value = draft || String(retention.data ?? "");
  const dirty = draft !== "" && Number(draft) !== retention.data;

  return (
    <SettingsSection title={t("retention.title")} description={t("retention.description")}>
      <SettingsCard>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setRetention.mutate(Number(draft), {
              onSuccess: () => {
                setDraft("");
                toast.success(t("retention.saved"));
              },
              onError: () => toast.error(t("error_title")),
            });
          }}
        >
          <SettingsRow
            label={<Label htmlFor="audit-retention">{t("retention.label")}</Label>}
            description={canManage ? t("retention.hint") : t("retention.owner_only")}
            size="none"
          >
            <div className="flex items-center gap-2">
              <Input
                id="audit-retention"
                type="number"
                inputMode="numeric"
                min={30}
                max={730}
                className="w-24"
                value={value}
                disabled={!canManage}
                onChange={(e) => setDraft(e.target.value)}
              />
              <span className="text-caption text-muted-foreground">{t("retention.unit")}</span>
              <Button type="submit" disabled={!canManage || !dirty || setRetention.isPending}>
                {setRetention.isPending ? <Spinner data-icon="inline-start" aria-label={t("loading")} /> : null}
                {t("retention.save")}
              </Button>
            </div>
          </SettingsRow>
        </form>
      </SettingsCard>
    </SettingsSection>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit.export.status" });
  const label = t(status, { defaultValue: t("unknown") });
  if (status === "pending" || status === "running") {
    return (
      <Badge variant="outline">
        <Spinner aria-label={label} />
        {label}
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive">
        <AlertCircle aria-hidden />
        {label}
      </Badge>
    );
  }
  if (status === "done") {
    return (
      <Badge variant="secondary">
        <Check aria-hidden />
        {label}
      </Badge>
    );
  }
  return <Badge variant="outline">{label}</Badge>;
}

function ExportRow({ job }: { job: AuditExport }) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.audit.export" });
  const day = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);
  return (
    <SettingsRow
      label={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono text-caption uppercase text-muted-foreground">{job.format}</span>
          {day(job.from_at)} – {day(job.to_at)}
          <StatusBadge status={job.status} />
        </span>
      }
      description={
        <span className="inline-flex flex-wrap gap-x-2">
          <EventTime iso={job.created_at} />
          {job.status === "done" ? <span>· {t("rows", { count: job.row_count })}</span> : null}
          {job.download_url && job.expires_at ? <span>· {t("expires")} <EventTime iso={job.expires_at} /></span> : null}
          {job.error ? <span className="text-destructive">· {job.error}</span> : null}
        </span>
      }
    >
      {job.download_url ? (
        <ButtonLink variant="outline" size="sm" href={job.download_url}>
          <Download data-icon="inline-start" aria-hidden />
          {t("download")}
        </ButtonLink>
      ) : null}
    </SettingsRow>
  );
}

export function AuditExports({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit" });
  const exports = useAuditExports(orgId);
  const createExport = useCreateAuditExport(orgId);
  const [range, setRange] = useState({ format: "csv", from: "", to: "" });
  const running = exports.data?.some((e) => e.status === "pending" || e.status === "running") ?? false;

  return (
    <SettingsSection title={t("export.title")} description={t("export.description")}>
      <SettingsCard>
        <form
          className="flex flex-wrap items-end gap-3 px-4 py-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            createExport.mutate(
              {
                format: range.format === "json" ? "json" : "csv",
                from: dayStart(range.from),
                to: dayEnd(range.to),
              },
              {
                onSuccess: () => toast.success(t("export.queued")),
                onError: () => toast.error(t("error_title")),
              },
            );
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="audit-export-format">{t("export.format")}</Label>
            <Select
              id="audit-export-format"
              value={range.format}
              disabled={!canManage}
              onValueChange={(v) => setRange({ ...range, format: v ?? "csv" })}
              items={[
                { value: "csv", label: "CSV" },
                { value: "json", label: t("export.format_jsonl") },
              ]}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-export-from">{t("export.from")}</Label>
            <DateField
              id="audit-export-from"
              className="w-40"
              value={range.from}
              max={range.to || undefined}
              disabled={!canManage}
              onChange={(from) => setRange({ ...range, from })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-export-to">{t("export.to")}</Label>
            <DateField
              id="audit-export-to"
              className="w-40"
              value={range.to}
              min={range.from || undefined}
              disabled={!canManage}
              onChange={(to) => setRange({ ...range, to })}
            />
          </div>
          <Button
            type="submit"
            disabled={!canManage || !range.from || !range.to || createExport.isPending || running}
          >
            {createExport.isPending ? (
              <Spinner data-icon="inline-start" aria-label={t("loading")} />
            ) : (
              <FileDown data-icon="inline-start" aria-hidden />
            )}
            {t("export.submit")}
          </Button>
          <p className="basis-full text-caption text-muted-foreground">
            {!canManage ? t("export.owner_only") : running ? t("export.one_at_a_time") : t("export.hint")}
          </p>
        </form>
        {exports.data && exports.data.length > 0 ? (
          exports.data.map((job) => <ExportRow key={job.id} job={job} />)
        ) : (
          <p className="px-4 py-3.5 text-caption text-muted-foreground">{t("export.empty")}</p>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
