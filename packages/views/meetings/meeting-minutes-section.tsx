"use client";
import { lazy, Suspense, useState } from "react";
import { CircleAlert, ExternalLink, Eye, TriangleAlert } from "lucide-react";
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
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toast } from "sonner";
import { Notice } from "../common/notice";
import { PanelCard } from "../common/panel-card";
import { MODULE_ICONS } from "../layout/module-icons";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { AppLink, useNavigation } from "../navigation";
import { apiErrorCopy } from "../api-error-copy";
import { formatMeetingDay, meetingDayKey, meetingLocale } from "./meeting-datetime";
import { MeetingSectionError, MeetingSectionLoading } from "./meeting-section-state";
import { ToneBadge } from "./meeting-status-badge";
import { useMemberIndex } from "./use-member-index";

// The preview brings the editor; only a click on "view the finalized
// version" pays for it, never the meeting page's first load.
const VersionPreviewDialog = lazy(() =>
  import("../documents/version-preview-dialog").then((mod) => ({ default: mod.VersionPreviewDialog })),
);

/**
 * The finalized version, once its page has loaded: the button that asked for
 * it shows the wait, and a page that cannot be read is said in the card, not
 * in a dialog opened only to say so.
 */
function FinalizedVersionPreview({
  workspaceId,
  doc,
  versionNo,
  onClose,
}: {
  workspaceId: string;
  doc: NonNullable<ReturnType<typeof useDocument>["data"]>;
  versionNo?: number;
  onClose: () => void;
}) {
  return (
    <Suspense fallback={null}>
      <VersionPreviewDialog
        open
        onOpenChange={(open) => !open && onClose()}
        wsId={workspaceId}
        doc={doc}
        versionNo={versionNo}
      />
    </Suspense>
  );
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
  const { memberOf, loaded: membersLoaded } = useMemberIndex(workspaceId);
  const workspace = useOptionalWorkspace()?.workspace;
  const wsPaths = workspace ? paths.workspace(workspace.organization_slug, workspace.slug) : null;
  const navigation = useNavigation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewDoc = useDocument(workspaceId, previewOpen ? (minutes?.document_id ?? "") : "", { retry: false });
  const previewLoading = previewOpen && previewDoc.isPending;
  const busy = create.isPending || finalize.isPending || reopen.isPending;
  // A failed make/finalize/reopen is said under its buttons until the next try, not in a toast
  // that fades, and only while the minutes stay as they were (another clerk finalized first).
  const minutesState = minutes ? `${minutes.document_id}:${minutes.finalized}:${minutes.finalized_version ?? ""}` : "";
  const [actionError, setActionError] = useState<{ text: string; state: string } | null>(null);
  const onError = (err: unknown) => setActionError({ text: apiErrorCopy(err) ?? t("common.error"), state: minutesState });

  let body;
  if (isPending) {
    body = (
      <MeetingSectionLoading>
        <Skeleton className="h-4 w-48" />
      </MeetingSectionLoading>
    );
  } else if (isError) {
    body = <MeetingSectionError message={t("meetings.minutes.loadFailed")} onRetry={() => void refetch()} />;
  } else if (!minutes) {
    // The same left edge as the card once it has minutes: the button does not jump sides.
    body = (
      <div className="flex flex-col items-start gap-3">
        <p className="text-label text-muted-foreground">
          {t(canClerk ? "meetings.minutes.emptyClerk" : "meetings.minutes.empty")}
        </p>
        {canClerk ? (
          <Button
            size="sm"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (busy) return;
              setActionError(null);
              create.mutate(i18n.language?.startsWith("en") ? "en" : "vi", {
                onSuccess: (made) => {
                  toast.success(t("meetings.minutes.createdToast"));
                  // The page is where the minutes are read and corrected (spec §9.2 item 4).
                  if (made?.document_id && wsPaths) navigation.push(wsPaths.document(made.document_id));
                },
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
    const documentId = minutes.document_id;
    // No name until the members arrive: never a "former member" flash.
    const finalizerName = membersLoaded
      ? (memberOf(minutes.finalized_by)?.display_name ?? t("meetings.formerMember"))
      : null;
    const finalizedDate = minutes.finalized_at
      ? formatMeetingDay(meetingDayKey(minutes.finalized_at), meetingLocale(i18n.language))
      : "";
    const canChange = canClerk && minutes.can_edit && Boolean(documentId);
    body = (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* A soft state chip, not the loudest thing on the card. */}
          <ToneBadge tone={minutes.finalized ? "success" : "muted"}>
            {t(minutes.finalized ? "meetings.minutes.finalized" : "meetings.minutes.draft")}
          </ToneBadge>
          {minutes.finalized ? (
            <span className="text-caption text-muted-foreground">
              {finalizerName
                ? t("meetings.minutes.finalizedBy", { date: finalizedDate, name: finalizerName })
                : t("meetings.minutes.finalizedOn", { date: finalizedDate })}
            </span>
          ) : null}
        </div>
        {minutes.finalized && minutes.edited_since_finalized ? (
          <Notice tone="warning" icon={TriangleAlert} layout="inline">
            {t("meetings.minutes.editedSince")}
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {!documentId ? (
            <p className="text-caption text-muted-foreground">{t("meetings.minutes.noAccess")}</p>
          ) : null}
          {wsPaths && documentId ? (
            <AppLink
              href={wsPaths.document(documentId)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ExternalLink aria-hidden />
              {t("meetings.minutes.open")}
            </AppLink>
          ) : null}
          {canChange && (!minutes.finalized || minutes.edited_since_finalized) ? (
            <Button
              size="sm"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (busy) return;
                setActionError(null);
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
          {minutes.finalized && minutes.finalized_version ? (
            <Button
              size="sm"
              variant="ghost"
              aria-busy={previewLoading || undefined}
              onClick={() => {
                if (previewLoading) return;
                if (previewDoc.isError) void previewDoc.refetch();
                setPreviewOpen(true);
              }}
            >
              {previewLoading ? <Spinner /> : <Eye aria-hidden />}
              {t("meetings.minutes.viewFinalized", { no: minutes.finalized_version })}
            </Button>
          ) : null}
          {/* Reopening undoes the finalize: the quietest button on the card. */}
          {canChange && minutes.finalized ? (
            <Button
              size="sm"
              variant="ghost"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (busy) return;
                setActionError(null);
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
        {canClerk && documentId && !minutes.can_edit ? (
          <p className="text-caption text-muted-foreground">{t("meetings.minutes.editRequired")}</p>
        ) : null}
        {previewOpen && previewDoc.isError ? (
          <Notice tone="destructive" icon={CircleAlert} layout="inline" live="assertive">
            {t("meetings.minutes.previewFailed")}
          </Notice>
        ) : null}
        {previewOpen && previewDoc.data ? (
          <FinalizedVersionPreview
            workspaceId={workspaceId}
            doc={previewDoc.data}
            versionNo={minutes.finalized_version ?? undefined}
            onClose={() => setPreviewOpen(false)}
          />
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
      <div className="flex flex-col gap-3">
        {body}
        {actionError && actionError.state === minutesState ? (
          <Notice tone="destructive" icon={CircleAlert} layout="inline" live="assertive">
            {actionError.text}
          </Notice>
        ) : null}
      </div>
    </PanelCard>
  );
}
