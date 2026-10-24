"use client";
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, CircleAlert, CircleCheck, Eye, FileText, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDocument } from "@uniwork/core/documents/hooks";
import {
  useCreateMeetingMinutes,
  useFinalizeMeetingMinutes,
  useMeetingMinutes,
  useRefreshMeetingMinutes,
  useReopenMeetingMinutes,
} from "@uniwork/core/meetings/minutes";
import { useMeetingSummary } from "@uniwork/core/meetings/summary";
import { paths } from "@uniwork/core/paths";
import type { MeetingEvidenceRef } from "@uniwork/core/types/meeting";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { apiErrorCopy } from "../../../api-error-copy";
import { useOptionalWorkspace } from "../../../layout/workspace-context";
import { AppLink, useNavigation } from "../../../navigation";
import { splitIsoLocal } from "../../meeting-datetime";
import { useDetail } from "../detail-context";
import { clock } from "../format";
import { kitButton } from "../ui/kit-buttons";
import { NoticeLine } from "../ui/notice-line";
import { TextButton } from "../ui/text-button";
import { FinalizeDialog } from "./finalize-dialog";
import { MinutesDocument, type MinutesEvidence } from "./minutes-document";
import { sameText } from "./minutes-model";

// The editor-backed version preview loads only when someone asks for it.
const VersionPreviewDialog = lazy(() =>
  import("../../../documents/version-preview-dialog").then((mod) => ({ default: mod.VersionPreviewDialog })),
);

const GHOST_SM = cn(buttonVariants({ variant: "ghost", size: "default" }), kitButton.sm, kitButton.ghost);
const TOAST = { position: "bottom-center" } as const;

/**
 * The Biên bản tab (AfterMinutes): the page's title and state bar with its
 * quiet actions, then a read-only preview of the UniNote page. Finalizing
 * starts from the strip's [Chốt biên bản] (`?finalize=1` opens the confirm
 * here); a page edited after finalizing is finalized again from the state
 * bar. Reopening, refreshing the facts and the finalized version stay with a
 * clerk who can edit the page (spec meeting follow-through §9.2 item 4, D12).
 */
export function MinutesTab() {
  const { t, i18n } = useTranslation();
  const { workspaceId, meeting, isClerk, viewer, aiReadable, memberIndex, tabs } = useDetail();
  const { data: minutes, isPending, isError, refetch } = useMeetingMinutes(meeting.id);
  const create = useCreateMeetingMinutes(meeting.id);
  const finalize = useFinalizeMeetingMinutes(meeting.id);
  const reopen = useReopenMeetingMinutes(meeting.id);
  const refresh = useRefreshMeetingMinutes(meeting.id);
  const outsider = viewer === "outsider";
  const documentId = outsider ? "" : (minutes?.document_id ?? "");
  const doc = useDocument(workspaceId, documentId, { retry: false });
  const summary = useMeetingSummary(aiReadable && !outsider ? meeting.id : "");
  const workspace = useOptionalWorkspace()?.workspace;
  const wsPaths = workspace ? paths.workspace(workspace.organization_slug, workspace.slug) : null;
  const navigation = useNavigation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const busy = create.isPending || finalize.isPending || reopen.isPending || refresh.isPending;
  // A failed command is said under the state bar until the next try, and only while the minutes stay
  // as they were (another clerk may have finalized first).
  const minutesState = minutes ? `${minutes.document_id}:${minutes.finalized}:${minutes.finalized_version ?? ""}` : "";
  const [actionError, setActionError] = useState<{ text: string; state: string } | null>(null);
  const onError = (err: unknown) => setActionError({ text: apiErrorCopy(err) ?? t("common.error"), state: minutesState });

  const evidence = useMemo((): MinutesEvidence => {
    const map: Map<string, { refs: readonly MeetingEvidenceRef[]; more: boolean }> = new Map();
    const add = (list: readonly { text: string; evidence: MeetingEvidenceRef[] }[] | null | undefined, more: boolean) => {
      for (const d of list ?? []) if (d.evidence.length > 0) map.set(sameText(d.text), { refs: d.evidence, more });
    };
    add(summary.data?.decisions, true);
    add(summary.data?.open_questions, false);
    return map;
  }, [summary.data]);

  const canChange = isClerk && Boolean(minutes?.can_edit && minutes.document_id);
  const canFinalize = canChange && minutes?.finalized === false;
  // The strip's [Chốt biên bản] lands here with ?finalize=1: the param is the dialog's open state.
  const wantsFinalize = navigation.searchParams.get("finalize") === "1";
  const dropFinalizeParam = () => {
    if (!wantsFinalize) return;
    const params = new URLSearchParams(navigation.searchParams);
    params.delete("finalize");
    const qs = params.toString();
    navigation.replace(qs ? `${navigation.pathname}?${qs}` : navigation.pathname);
  };
  const doFinalize = () => {
    dropFinalizeParam();
    setActionError(null);
    finalize.mutate(undefined, { onSuccess: () => toast.success(t("meetings.minutes.finalizedToast"), TOAST), onError });
  };
  const run = (mutation: typeof reopen, done: string) => () => {
    if (busy) return;
    setActionError(null);
    mutation.mutate(undefined, { onSuccess: () => toast.success(t(done), TOAST), onError });
  };

  if (isPending) {
    return (
      <div role="status" aria-busy className="mt-8 flex flex-col gap-3">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-5 w-96 max-w-full" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <NoticeLine tone="destructive" icon={CircleAlert} role="alert" className="mt-8">
        {t("meetings.minutes.loadFailed")}{" "}
        <TextButton onClick={() => void refetch()}>{t("common.retry")}</TextButton>
      </NoticeLine>
    );
  }
  if (outsider) {
    return (
      <p className="mt-8 text-body text-muted-foreground">
        {t(minutes?.finalized ? "meetings.detail.minutes.outsiderFinalized" : "meetings.detail.minutes.outsiderDraft")}
      </p>
    );
  }

  const errorLine =
    actionError && actionError.state === minutesState ? (
      <NoticeLine tone="destructive" icon={CircleAlert} role="alert" className="mt-3">
        {actionError.text}
      </NoticeLine>
    ) : null;

  if (!minutes) {
    return (
      <section className="mt-8 flex flex-col items-start gap-3">
        <p className="text-body text-muted-foreground">{t(isClerk ? "meetings.minutes.emptyClerk" : "meetings.minutes.empty")}</p>
        {isClerk ? (
          <Button
            variant="brand"
            size="default"
            className={kitButton.sm}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (busy) return;
              setActionError(null);
              create.mutate(i18n.language?.startsWith("en") ? "en" : "vi", {
                onSuccess: (made) => {
                  toast.success(t("meetings.minutes.createdToast"), TOAST);
                  // The page is where the minutes are corrected (spec §9.2 item 4).
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
        {errorLine}
      </section>
    );
  }

  // No name until the members arrive: never a "former member" flash.
  const finalizer = memberIndex.loaded
    ? (memberIndex.memberOf(minutes.finalized_by)?.display_name ?? t("meetings.formerMember"))
    : null;
  const pending = minutes.finalized ? 0 : minutes.pending_items;
  let state: ReactNode;
  if (minutes.finalized) {
    state = (
      <p className="flex items-center gap-1.5">
        <CircleCheck aria-hidden className="size-3.5 shrink-0 text-success" />
        {[t("meetings.detail.minutes.finalizedState"), finalizer, minutes.finalized_version ? t("meetings.detail.minutes.version", { no: minutes.finalized_version }) : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
    );
  } else if (!isClerk) {
    state = <p>{t("meetings.detail.minutes.memberDraft")}</p>;
  } else {
    const made = summary.data?.created_at;
    const parts: ReactNode[] = [t("meetings.detail.minutes.draftState")];
    if (made && clock(made)) {
      const [, m, d] = splitIsoLocal(made).date.split("-");
      parts.push(t("meetings.detail.minutes.fromSummary", { time: clock(made), date: `${d}/${m}` }));
    }
    if (pending > 0) {
      parts.push(
        <AppLink
          key="pending"
          href={`${navigation.pathname}?section=action-items`}
          className="rounded-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          {t("meetings.detail.minutes.pendingLink", { count: pending })}
        </AppLink>,
      );
    }
    state = <p>{parts.flatMap((part, i) => (i === 0 ? [part] : [" · ", part]))}</p>;
  }

  const finalizedVersion = minutes.finalized ? minutes.finalized_version : null;
  return (
    <section aria-labelledby="meeting-minutes-heading" className="mt-10 scroll-mt-6 @max-[37.5rem]/meeting:mt-8">
      <div className="border-b border-border pb-4">
        <h2 id="meeting-minutes-heading" className="flex items-start gap-2.5 text-title-sm font-semibold">
          <FileText aria-hidden className="mt-0.75 size-4 shrink-0 text-muted-foreground" />
          <span>{doc.data?.title || t("meetings.minutes.title")}</span>
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pl-6.5 @max-[37.5rem]/meeting:pl-0">
          <div className="flex flex-col gap-1 text-caption text-muted-foreground">
            {state}
            {minutes.finalized && minutes.edited_since_finalized ? (
              <p className="flex flex-wrap items-center gap-1.5">
                <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-warning" />
                <span className="text-warning">{t("meetings.detail.minutes.editedSince")}</span>
                {canChange ? (
                  <>
                    <span aria-hidden>·</span>
                    <TextButton aria-disabled={busy || undefined} onClick={doFinalize}>
                      {finalize.isPending ? <Spinner /> : null}
                      {t("meetings.detail.minutes.refinalize", { no: (minutes.finalized_version ?? 0) + 1 })}
                    </TextButton>
                  </>
                ) : null}
              </p>
            ) : null}
            {!minutes.document_id ? <p>{t("meetings.minutes.noAccess")}</p> : null}
            {isClerk && minutes.document_id && !minutes.can_edit ? <p>{t("meetings.minutes.editRequired")}</p> : null}
          </div>
          {/* A coarse pointer keeps its 44px targets; the row still lays out at the board's 32. */}
          <div className="-mr-2.5 flex flex-wrap gap-1 pointer-coarse:-my-1.5 @max-[37.5rem]/meeting:mr-0 @max-[37.5rem]/meeting:-ml-2.5">
            {wsPaths && minutes.document_id ? (
              <AppLink href={wsPaths.document(minutes.document_id)} className={GHOST_SM}>
                {t("meetings.detail.minutes.openDocument")}
                <ArrowUpRight aria-hidden />
              </AppLink>
            ) : null}
            {canChange && !minutes.finalized ? (
              <button
                type="button"
                className={GHOST_SM}
                title={t("meetings.minutes.refreshHint")}
                aria-disabled={busy || undefined}
                onClick={run(refresh, "meetings.minutes.refreshedToast")}
              >
                {refresh.isPending ? <Spinner /> : <RefreshCw aria-hidden />}
                {t("meetings.detail.minutes.refreshFromSummary")}
              </button>
            ) : null}
            {/* Only a page changed since finalizing differs from what the preview below shows. */}
            {finalizedVersion && minutes.edited_since_finalized && doc.data ? (
              <button type="button" className={GHOST_SM} onClick={() => setPreviewOpen(true)}>
                <Eye aria-hidden />
                {t("meetings.minutes.viewFinalized", { no: finalizedVersion })}
              </button>
            ) : null}
            {canChange && minutes.finalized ? (
              <button type="button" className={GHOST_SM} aria-disabled={busy || undefined} onClick={run(reopen, "meetings.minutes.reopenedToast")}>
                {reopen.isPending ? <Spinner /> : <RotateCcw aria-hidden />}
                {t("meetings.minutes.reopen")}
              </button>
            ) : null}
          </div>
        </div>
        {errorLine}
      </div>

      {!minutes.document_id ? null : doc.isPending ? (
        <div role="status" aria-busy className="mt-6 flex max-w-150 flex-col gap-2">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ) : doc.isError || !doc.data ? (
        <NoticeLine tone="destructive" icon={CircleAlert} role="alert" className="mt-6">
          {t("meetings.detail.minutes.docFailed")}{" "}
          <TextButton onClick={() => void doc.refetch()}>{t("common.retry")}</TextButton>
        </NoticeLine>
      ) : (
        <MinutesDocument
          content={doc.data.content}
          finalized={minutes.finalized}
          meetingId={meeting.id}
          evidence={evidence}
          onTime={tabs.list.includes("transcript") ? () => tabs.set("transcript") : undefined}
          people={memberIndex.members}
        />
      )}

      <FinalizeDialog
        open={canFinalize && wantsFinalize}
        onOpenChange={(open) => !open && dropFinalizeParam()}
        pending={pending}
        busy={finalize.isPending}
        onConfirm={doFinalize}
      />
      {previewOpen && doc.data ? (
        <Suspense fallback={null}>
          <VersionPreviewDialog
            open
            onOpenChange={(open) => !open && setPreviewOpen(false)}
            wsId={workspaceId}
            doc={doc.data}
            versionNo={finalizedVersion ?? undefined}
          />
        </Suspense>
      ) : null}
    </section>
  );
}
