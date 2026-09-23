"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Check, Download, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useAuditExports,
  useAuditRetention,
  useCreateAuditExport,
  useSetAuditRetention,
} from "@uniwork/core/audit";
import type { AuditExport } from "@uniwork/core/types";
import { Button, ButtonLink } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { EventTime } from "../../audit/event-presenter";
import { DateField } from "../../common/date-field";
import { toastApiError } from "../../toast-api-error";
import { dayEnd, dayStart } from "./audit-log";
import {
  SettingsBadge,
  type SettingsBadgeTone,
  SettingsCard,
  SettingsEmpty,
  SettingsFieldError,
  SettingsList,
  SettingsListItem,
  SettingsLoadError,
  SettingsRow,
  SettingsSection,
  SettingsSkeletonRows,
} from "./settings-layout";

const RETENTION_MIN = 30;
const RETENTION_MAX = 730;

/** An empty draft is "unchanged"; anything else must be a whole day count in range. */
function retentionError(draft: string): boolean {
  if (draft === "") return false;
  const days = Number(draft);
  return !Number.isInteger(days) || days < RETENTION_MIN || days > RETENTION_MAX;
}

export function AuditRetention({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit" });
  const retention = useAuditRetention(orgId);
  const setRetention = useSetAuditRetention(orgId);
  const [draft, setDraft] = useState("");
  // The range is checked when the reader leaves the field or saves, not on
  // each digit: "3" on the way to "365" is not a mistake yet.
  const [checked, setChecked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const value = draft || String(retention.data ?? "");
  const invalid = retentionError(draft);
  const showError = checked && invalid;
  const dirty = draft !== "" && Number(draft) !== retention.data;

  if (retention.isLoading) {
    return (
      <SettingsSection title={t("retention.title")} description={t("retention.description")}>
        <SettingsSkeletonRows rows={1} />
      </SettingsSection>
    );
  }
  if (retention.isError) {
    return (
      <SettingsSection title={t("retention.title")} description={t("retention.description")}>
        <SettingsCard>
          <SettingsLoadError onRetry={() => void retention.refetch()}>{t("retention.load_error")}</SettingsLoadError>
        </SettingsCard>
      </SettingsSection>
    );
  }

  // Save is explicit (a number is typed digit by digit), so the result is a
  // toast; the range is said once, and the error sits under it when broken.
  return (
    <SettingsSection title={t("retention.title")} description={t("retention.description")}>
      <SettingsCard>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setChecked(true);
            if (invalid) {
              inputRef.current?.focus();
              return;
            }
            if (!dirty) return;
            setRetention.mutate(Number(draft), {
              onSuccess: () => {
                setDraft("");
                setChecked(false);
                toast.success(t("retention.saved"));
              },
              onError: (err) => toastApiError(err, t("retention.save_failed")),
            });
          }}
        >
          <SettingsRow
            label={<Label htmlFor="audit-retention">{t("retention.label")}</Label>}
            description={canManage ? t("retention.hint") : t("retention.owner_only")}
            descriptionId="audit-retention-hint"
            size="none"
          >
            <div className="grid gap-1.5">
              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  id="audit-retention"
                  type="number"
                  inputMode="numeric"
                  min={RETENTION_MIN}
                  max={RETENTION_MAX}
                  className="w-24"
                  value={value}
                  disabled={!canManage}
                  aria-invalid={showError || undefined}
                  aria-describedby={showError ? "audit-retention-hint audit-retention-error" : "audit-retention-hint"}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => setChecked(draft !== "")}
                />
                <span className="text-caption text-muted-foreground">{t("retention.unit")}</span>
                <Button type="submit" disabled={!canManage || !dirty || setRetention.isPending}>
                  {setRetention.isPending ? <Spinner data-icon="inline-start" aria-label={t("loading")} /> : null}
                  {t("retention.save")}
                </Button>
              </div>
              {showError ? (
                <SettingsFieldError id="audit-retention-error">{t("retention.out_of_range")}</SettingsFieldError>
              ) : null}
            </div>
          </SettingsRow>
        </form>
      </SettingsCard>
    </SettingsSection>
  );
}

const STATUS_TONE: Record<string, SettingsBadgeTone> = {
  pending: "info",
  running: "info",
  done: "success",
  failed: "destructive",
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit.export.status" });
  const label = t(status, { defaultValue: t("unknown") });
  const icon =
    status === "pending" || status === "running" ? (
      <Loader2 aria-hidden className="animate-spin" />
    ) : status === "failed" ? (
      <AlertCircle aria-hidden />
    ) : status === "done" ? (
      <Check aria-hidden />
    ) : null;
  return (
    <SettingsBadge tone={STATUS_TONE[status] ?? "muted"} icon={icon}>
      {label}
    </SettingsBadge>
  );
}

/**
 * The worker stores its failure reason as a sentence in its own words
 * (AuditExportConsumer.fail in server/internal/service/audit_export.go), not
 * a code. The one reason it writes today maps to copy; anything else reads as
 * a plain failure, with the raw text kept as a tooltip for support.
 */
function exportErrorKey(error: string): string {
  return error.startsWith("khoảng thời gian quá lớn") ? "error_range_too_large" : "error_generic";
}

function ExportItem({ job }: { job: AuditExport }) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.audit.export" });
  const day = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);
  return (
    <SettingsListItem
      leading={<span className="font-mono text-caption uppercase text-muted-foreground">{job.format}</span>}
      title={<span className="tabular-nums">{day(job.from_at)} – {day(job.to_at)}</span>}
      badge={<StatusBadge status={job.status} />}
      meta={
        <span className="inline-flex flex-wrap gap-x-2">
          <EventTime iso={job.created_at} />
          {job.status === "done" ? <span>· {t("rows", { count: job.row_count })}</span> : null}
          {job.download_url && job.expires_at ? <span>· {t("expires")} <EventTime iso={job.expires_at} /></span> : null}
          {job.error ? (
            <span className="text-destructive" title={job.error}>
              · {t(exportErrorKey(job.error))}
            </span>
          ) : null}
        </span>
      }
      actions={
        job.download_url ? (
          <ButtonLink variant="outline" size="sm" href={job.download_url}>
            <Download data-icon="inline-start" aria-hidden />
            {t("download")}
          </ButtonLink>
        ) : null
      }
    />
  );
}

/**
 * What the reader hears when a job they are waiting on settles. Kept in a
 * region that stays mounted; the list itself changes silently under a poll.
 */
function useExportAnnouncement(jobs: AuditExport[] | undefined): string {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit.export" });
  const previous = useRef<Map<string, string> | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!jobs) return;
    const before = previous.current;
    previous.current = new Map(jobs.map((j) => [j.id, j.status]));
    // The first load is history, not news.
    if (!before) return;
    for (const job of jobs) {
      const was = before.get(job.id);
      if (was !== "pending" && was !== "running") continue;
      if (job.status === "done") setMessage(t("announce_done"));
      else if (job.status === "failed") setMessage(t("announce_failed"));
    }
  }, [jobs, t]);
  return message;
}

export function AuditExports({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.audit" });
  const exports = useAuditExports(orgId);
  const createExport = useCreateAuditExport(orgId);
  const [range, setRange] = useState({ format: "csv", from: "", to: "" });
  const running = exports.data?.some((e) => e.status === "pending" || e.status === "running") ?? false;
  const announcement = useExportAnnouncement(exports.data);

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
                onError: (err) => toastApiError(err, t("export.create_failed")),
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
      </SettingsCard>
      {exports.isLoading ? (
        <SettingsSkeletonRows rows={2} />
      ) : exports.isError ? (
        <SettingsCard>
          <SettingsLoadError onRetry={() => void exports.refetch()}>{t("export.load_error")}</SettingsLoadError>
        </SettingsCard>
      ) : exports.data && exports.data.length > 0 ? (
        <SettingsList aria-label={t("export.history_label")}>
          {exports.data.map((job) => <ExportItem key={job.id} job={job} />)}
        </SettingsList>
      ) : (
        <SettingsCard>
          <SettingsEmpty icon={<FileDown aria-hidden />}>{t("export.empty")}</SettingsEmpty>
        </SettingsCard>
      )}
      <span role="status" className="sr-only">{announcement}</span>
    </SettingsSection>
  );
}
