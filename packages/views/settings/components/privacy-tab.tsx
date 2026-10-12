"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Check, CircleAlert, Download } from "lucide-react";
import { toast } from "sonner";
import { downloadPrivacyExport } from "@uniwork/core/api/endpoints/privacy";
import { useOrgMembership } from "@uniwork/core/organizations";
import { useCreatePrivacyExport, usePrivacyExports } from "@uniwork/core/privacy";
import type { PrivacyExport } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { CollectionPageState } from "../../layout/collection-page";
import { useWorkspace } from "../../layout/workspace-context";
import { EventTime } from "../../audit/event-presenter";
import { toastApiError } from "../../toast-api-error";
import {
  SettingsBadge,
  type SettingsBadgeTone,
  SettingsCard,
  SettingsEmpty,
  SettingsList,
  SettingsListItem,
  SettingsLoadError,
  SettingsSection,
  SettingsSkeletonRows,
  SettingsTab,
} from "./settings-layout";
import { PrivacyDelete } from "./privacy-delete";

const STATUS_TONE: Record<string, SettingsBadgeTone> = {
  pending: "info",
  running: "info",
  done: "success",
  failed: "destructive",
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.privacy.export.status" });
  const label = t(status, { defaultValue: t("unknown") });
  const icon =
    status === "pending" || status === "running" ? (
      <Spinner />
    ) : status === "failed" ? (
      <CircleAlert aria-hidden />
    ) : status === "done" ? (
      <Check aria-hidden />
    ) : null;
  return (
    <SettingsBadge tone={STATUS_TONE[status] ?? "muted"} icon={icon}>
      {label}
    </SettingsBadge>
  );
}

function exportErrorKey(error: string): string {
  return error.includes("100 MiB") ? "error_too_large" : "error_generic";
}

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ExportItem({ job, orgId }: { job: PrivacyExport; orgId: string }) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.privacy" });
  const [downloading, setDownloading] = useState(false);

  const onDownload = async () => {
    if (!job.download_url) return;
    setDownloading(true);
    try {
      saveFile(await downloadPrivacyExport(orgId, job.id), "organization-data.zip");
    } catch (err) {
      toastApiError(err, t("export.download_failed"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <SettingsListItem
      leading={<Archive aria-hidden className="size-4 text-muted-foreground" />}
      title={<EventTime iso={job.created_at} />}
      badge={<StatusBadge status={job.status} />}
      meta={
        <span className="inline-flex flex-wrap gap-x-2">
          {job.status === "done" ? <span>{t("export.rows", { count: job.row_count })}</span> : null}
          {job.download_url && job.expires_at ? (
            <span>
              {t("export.expires")} <EventTime iso={job.expires_at} />
            </span>
          ) : null}
          {job.error ? (
            <span className="text-destructive" title={job.error}>
              {t(`export.${exportErrorKey(job.error)}`)}
            </span>
          ) : null}
        </span>
      }
      actions={
        job.download_url ? (
          <Button variant="outline" size="sm" disabled={downloading} onClick={() => void onDownload()}>
            {downloading ? (
              <Spinner data-icon="inline-start" aria-label={i18n.t("settings.privacy.loading")} />
            ) : (
              <Download data-icon="inline-start" aria-hidden />
            )}
            {t("export.download")}
          </Button>
        ) : null
      }
    />
  );
}

function useExportAnnouncement(jobs: PrivacyExport[] | undefined): string {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.privacy.export" });
  const previous = useRef<Map<string, string> | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!jobs) return;
    const before = previous.current;
    previous.current = new Map(jobs.map((j) => [j.id, j.status]));
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

function PrivacyExports({ orgId }: { orgId: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.privacy" });
  const exports = usePrivacyExports(orgId);
  const createExport = useCreatePrivacyExport(orgId);
  const jobs = exports.data?.filter((job) => job.kind !== "delete");
  const running = exports.data?.some((e) => e.status === "pending" || e.status === "running") ?? false;
  const scheduledDelete = exports.data?.some((e) => e.kind === "delete" && e.status === "scheduled") ?? false;
  const announcement = useExportAnnouncement(jobs);

  return (
    <SettingsSection title={t("export.title")} description={t("export.description")}>
      <SettingsCard>
        <form
          className="flex flex-wrap items-center gap-3 px-4 py-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            createExport.mutate(undefined, {
              onSuccess: () => toast.success(t("export.queued")),
              onError: (err) => toastApiError(err, t("export.create_failed")),
            });
          }}
        >
          <Button type="submit" disabled={createExport.isPending || running || scheduledDelete}>
            {createExport.isPending ? (
              <Spinner data-icon="inline-start" aria-label={t("loading")} />
            ) : (
              <Archive data-icon="inline-start" aria-hidden />
            )}
            {t("export.submit")}
          </Button>
          <p className="text-caption text-muted-foreground">
            {scheduledDelete ? t("export.deletion_scheduled") : running ? t("export.one_at_a_time") : t("export.hint")}
          </p>
        </form>
      </SettingsCard>
      {exports.isLoading ? (
        <SettingsSkeletonRows rows={2} />
      ) : exports.isError ? (
        <SettingsCard>
          <SettingsLoadError onRetry={() => void exports.refetch()}>{t("export.load_error")}</SettingsLoadError>
        </SettingsCard>
      ) : jobs && jobs.length > 0 ? (
        <SettingsList aria-label={t("export.history_label")}>
          {jobs.map((job) => (
            <ExportItem key={job.id} job={job} orgId={orgId} />
          ))}
        </SettingsList>
      ) : (
        <SettingsCard>
          <SettingsEmpty icon={<Archive aria-hidden />}>{t("export.empty")}</SettingsEmpty>
        </SettingsCard>
      )}
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </SettingsSection>
  );
}

export function PrivacyTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.privacy" });
  const { workspace } = useWorkspace();
  const membership = useOrgMembership(workspace.organization_slug);

  if (membership.isLoading) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <SettingsSkeletonRows rows={3} />
      </SettingsTab>
    );
  }

  if (membership.isError) {
    return (
      <SettingsTab title={t("title")} description={t("description")}>
        <SettingsCard>
          <SettingsLoadError onRetry={() => void membership.refetch()}>{t("export.load_error")}</SettingsLoadError>
        </SettingsCard>
      </SettingsTab>
    );
  }

  if (membership.data?.role !== "owner") {
    return (
      <SettingsTab title={t("title")}>
        <CollectionPageState
          icon={Archive}
          title={t("forbidden_title")}
          description={t("forbidden_description")}
          role="status"
          headingLevel={3}
        />
      </SettingsTab>
    );
  }

  return (
    <SettingsTab title={t("title")} description={t("description")}>
      <PrivacyExports orgId={workspace.organization_id} />
      <PrivacyDelete orgId={workspace.organization_id} slug={workspace.organization_slug} />
    </SettingsTab>
  );
}
