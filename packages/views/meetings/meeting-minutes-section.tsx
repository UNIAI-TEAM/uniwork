"use client";
import { lazy, Suspense, useState } from "react";
import { CircleAlert, ExternalLink, Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDocument } from "@uniwork/core/documents/hooks";
import {
  useCreateMeetingMinutes,
  useFinalizeMeetingMinutes,
  useMeetingMinutes,
  useReopenMeetingMinutes,
  type MeetingMinutes,
} from "@uniwork/core/meetings/minutes";
import { paths } from "@uniwork/core/paths";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toast } from "sonner";
import { Notice } from "../common/notice";
import { PanelCard } from "../common/panel-card";
import { MODULE_ICONS } from "../layout/module-icons";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { toastApiError } from "../toast-api-error";
import { meetingLocale } from "./meeting-datetime";
import { MeetingSectionLoading } from "./meeting-section-state";
import { useMemberIndex } from "./use-member-index";

// The preview brings the editor; only a click on "view the finalized
// version" pays for it, never the meeting page's first load.
const VersionPreviewDialog = lazy(() =>
  import("../documents/version-preview-dialog").then((mod) => ({ default: mod.VersionPreviewDialog })),
);

function FinalizedVersionPreview({
  workspaceId,
  minutes,
  onClose,
}: {
  workspaceId: string;
  minutes: MeetingMinutes;
  onClose: () => void;
}) {
  const doc = useDocument(workspaceId, minutes.document_id);
  if (!doc.data) return null;
  return (
    <Suspense fallback={null}>
      <VersionPreviewDialog
        open
        onOpenChange={(open) => !open && onClose()}
        wsId={workspaceId}
        doc={doc.data}
        versionNo={minutes.finalized_version ?? undefined}
      />
    </Suspense>
  );
}

function formatDay(iso: string | null | undefined, locale: string): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(ms);
}

/**
 * "Minutes" (spec meeting follow-through §9.2 item 4, D12): the meeting's
 * minutes are a UniNote page. A clerk makes them once the meeting has ended;
 * finalizing records a version of the page, and the chip says which one and
 * whether the page changed since. Finalizing and reopening also need edit on
 * the page. Exporting is the page's own menu (UNI-2004).
 */
export function MeetingMinutesSection({
  workspaceId,
  meetingId,
  canClerk,
}: {
  workspaceId: string;
  meetingId: string;
  canClerk: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data: minutes, isPending, isError, refetch } = useMeetingMinutes(meetingId);
  const create = useCreateMeetingMinutes(meetingId);
  const finalize = useFinalizeMeetingMinutes(meetingId);
  const reopen = useReopenMeetingMinutes(meetingId);
  const { memberOf } = useMemberIndex(workspaceId);
  const workspace = useOptionalWorkspace()?.workspace;
  const [previewOpen, setPreviewOpen] = useState(false);
  const busy = create.isPending || finalize.isPending || reopen.isPending;
  const onError = (err: unknown) => toastApiError(err, t("common.error"));

  let body;
  if (isPending) {
    body = (
      <MeetingSectionLoading>
        <Skeleton className="h-4 w-48" />
      </MeetingSectionLoading>
    );
  } else if (isError) {
    body = (
      <div className="flex items-center gap-3">
        <p role="alert" className="text-caption text-destructive">
          {t("meetings.minutes.loadFailed")}
        </p>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  } else if (!minutes) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-muted-foreground">
          {t(canClerk ? "meetings.minutes.emptyClerk" : "meetings.minutes.empty")}
        </p>
        {canClerk ? (
          <Button
            size="sm"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (busy) return;
              create.mutate(i18n.language?.startsWith("en") ? "en" : "vi", {
                onSuccess: () => toast.success(t("meetings.minutes.createdToast")),
                onError,
              });
            }}
          >
            {create.isPending ? <Spinner /> : null}
            {t("meetings.minutes.create")}
          </Button>
        ) : null}
      </div>
    );
  } else {
    const wsPaths = workspace ? paths.workspace(workspace.organization_slug, workspace.slug) : null;
    const finalizerName = memberOf(minutes.finalized_by)?.display_name ?? t("meetings.formerMember");
    const canChange = canClerk && minutes.can_edit;
    body = (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={minutes.finalized ? "default" : "secondary"}>
            {t(minutes.finalized ? "meetings.minutes.finalized" : "meetings.minutes.draft")}
          </Badge>
          {minutes.finalized ? (
            <span className="text-caption text-muted-foreground">
              {t("meetings.minutes.finalizedBy", {
                date: formatDay(minutes.finalized_at, meetingLocale(i18n.language)),
                name: finalizerName,
              })}
            </span>
          ) : null}
        </div>
        {minutes.finalized && minutes.edited_since_finalized ? (
          <Notice tone="warning" icon={CircleAlert} layout="inline">
            {t("meetings.minutes.editedSince")}
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {wsPaths ? (
            <AppLink
              href={wsPaths.document(minutes.document_id)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ExternalLink aria-hidden />
              {t("meetings.minutes.open")}
            </AppLink>
          ) : null}
          {minutes.finalized && minutes.finalized_version ? (
            <Button size="sm" variant="ghost" onClick={() => setPreviewOpen(true)}>
              <Eye aria-hidden />
              {t("meetings.minutes.viewFinalized", { no: minutes.finalized_version })}
            </Button>
          ) : null}
          {canChange && (!minutes.finalized || minutes.edited_since_finalized) ? (
            <Button
              size="sm"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (busy) return;
                finalize.mutate(undefined, {
                  onSuccess: () => toast.success(t("meetings.minutes.finalizedToast")),
                  onError,
                });
              }}
            >
              {finalize.isPending ? <Spinner /> : null}
              {t(minutes.finalized ? "meetings.minutes.refinalize" : "meetings.minutes.finalize")}
            </Button>
          ) : null}
          {canChange && minutes.finalized ? (
            <Button
              size="sm"
              variant="outline"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (busy) return;
                reopen.mutate(undefined, {
                  onSuccess: () => toast.success(t("meetings.minutes.reopenedToast")),
                  onError,
                });
              }}
            >
              {reopen.isPending ? <Spinner /> : null}
              {t("meetings.minutes.reopen")}
            </Button>
          ) : null}
        </div>
        {canClerk && !minutes.can_edit ? (
          <p className="text-caption text-muted-foreground">{t("meetings.minutes.editRequired")}</p>
        ) : null}
        {previewOpen ? (
          <FinalizedVersionPreview workspaceId={workspaceId} minutes={minutes} onClose={() => setPreviewOpen(false)} />
        ) : null}
      </div>
    );
  }

  return (
    <PanelCard
      id="meeting-minutes-heading"
      icon={MODULE_ICONS.documents}
      title={t("meetings.minutes.title")}
      description={t("meetings.minutes.description")}
    >
      {body}
    </PanelCard>
  );
}
