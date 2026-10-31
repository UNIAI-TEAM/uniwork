"use client";
import { useEffect, useId, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Lock, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { errorCode } from "@uniwork/core/api/http";
import { useAuthStore } from "@uniwork/core/auth";
import { calendarKeys } from "@uniwork/core/calendar";
import { meetingKeys, useMeetingCapabilities } from "@uniwork/core/meetings";
import { useMembers } from "@uniwork/core/workspaces";
import type { Meeting, MeetingInviteLink } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { ConfirmDialog } from "../../common/form-dialog";
import { defaultInviteLinkLabel } from "../invite-link-display";
import { kitButton } from "../meeting-detail/ui/kit-buttons";
import { useNow } from "../use-now";
import type { MeetingDraft } from "./draft-model";
import { validateDraft } from "./draft-validation";
import type { Rsvp } from "./person-role-row";
import { ResultPanelBody, ResultPanelHead } from "./result-panel";
import { dropRun, linksPending, retryRows, runProgress, runRows, startSubmitRun, useSubmitRun, type SubmitRun } from "./run-submit-plan";
import { scribeAvailability, scribePolicyDefault } from "./scribe-block";
import { SheetFields } from "./sheet-fields";
import { SheetFooter } from "./sheet-footer";
import { buildCreatePlan, buildEditPlan } from "./submit-plan";
import { useMeetingDraft } from "./use-meeting-draft";
import { seriesShortTitle } from "./carried-over-block";
import { footerLine, focusIssue, headCaption, outcomeToast, resultCaption } from "./sheet-copy";

export type EditorSetup =
  | {
      mode: "create";
      initial: MeetingDraft;
      /** What the discard question compares against; the initial draft when unset. */
      baseline?: MeetingDraft;
      /** The quick card's key, so a create it may already have made is never made twice. */
      idempotencyKey?: string;
    }
  | {
      mode: "followUp";
      initial: MeetingDraft;
      previous: Meeting;
      swap: { from: number; to: number } | null;
      previousSecretaryId?: string;
      previousLabel: string;
      questions: string[];
      carried: ReactNode;
    }
  | {
      mode: "edit";
      initial: MeetingDraft;
      meeting: Meeting;
      existingLinks: readonly MeetingInviteLink[];
      rsvp: ReadonlyMap<string, Rsvp>;
      quorumLocked: boolean;
      /** People removed earlier: the server refuses to invite them again. */
      removedUserIds: ReadonlySet<string>;
      stale: boolean;
      reseed: () => MeetingDraft;
    };

/**
 * The open sheet: header, fields, foot, the discard question and — once a
 * submit ran into a failure or made a guest link — the result panel. One
 * `requestClose()` serves ×, Esc, Hủy and the scrim (AUDIT AB-02).
 */
export function SheetEditor({
  workspaceId,
  setup,
  guardRef,
  onClose,
  onDone,
  initialRunId,
  onReopen,
}: {
  workspaceId: string;
  setup: EditorSetup;
  guardRef: MutableRefObject<(() => void) | null>;
  onClose: () => void;
  onDone?: (meetingId: string) => void;
  initialRunId?: string | null;
  onReopen: (runId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const idPrefix = useId().replace(/:/g, "");
  const formId = `${idPrefix}-form`;
  const qc = useQueryClient();
  const state = useMeetingDraft(setup.initial, setup.mode === "create" ? setup.baseline : undefined);
  const { draft, snapshot, changes, submitted, setSubmitted, reset } = state;
  const nowMs = useNow(30_000);
  const { data: caps } = useMeetingCapabilities(workspaceId);
  const { data: members = [] } = useMembers(workspaceId);
  const user = useAuthStore((s) => s.user);
  const ws = useOptionalWorkspace();
  const [idempotencyKey] = useState(
    () => (setup.mode === "create" && setup.idempotencyKey) || (globalThis.crypto?.randomUUID?.() ?? `k${Date.now()}${Math.random()}`),
  );
  const [runId, setRunId] = useState<string | null>(initialRunId ?? null);
  const run = useSubmitRun(runId);
  const attached = useRef(true);
  // A run that outlives the sheet reports by toast (finish reads this).
  useEffect(() => {
    attached.current = true;
    return () => {
      attached.current = false;
    };
  }, []);
  const [confirm, setConfirm] = useState<"discard" | "reload" | null>(null);
  // The meeting exists and the primary shows its ✓; the sheet closes LANDING_MS later.
  const [landed, setLanded] = useState(false);

  const meeting = setup.mode === "edit" ? setup.meeting : null;
  const ended = meeting ? meeting.status === "ENDED" || meeting.status === "CANCELED" : false;
  const live = meeting?.status === "IN_PROGRESS" ? { startsAt: meeting.starts_at, endsAt: meeting.ends_at } : undefined;
  const phase1Busy = Boolean(run && run.phase === "phase1" && !run.phase1Error);
  const phase2 = run?.phase === "phase2";
  const panelNow = Boolean(run && run.phase === "done" && !run.phase1Error && needsPanel(run));
  // Once shown, the panel stays through its own retries (they put the run back in phase 2).
  const [panelRunId, setPanelRunId] = useState<string | null>(null);
  if (panelNow && panelRunId !== run!.id) setPanelRunId(run!.id);
  const showResult = Boolean(run && !run.phase1Error && (panelNow || panelRunId === run.id));
  const readOnly = phase1Busy || phase2 || ended || landed;
  const timeTouched = (["date", "start", "end", "timezone"] as const).some((k) => draft[k] !== snapshot[k]);
  const issues = validateDraft(draft, { nowMs, checkPast: setup.mode !== "edit" || timeTouched, timeLocked: Boolean(live) });
  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.display_name ?? t("meetings.formerMember");
  const hostId = meeting?.host_user_id ?? user?.id ?? "";
  const hostMember = members.find((m) => m.user_id === hostId);
  const host = { userId: hostId, name: hostMember?.display_name ?? user?.display_name ?? "", avatarUrl: hostMember?.avatar_url };
  const workspaceName = ws?.workspace.name ?? "";
  const linkPlaceholder = defaultInviteLinkLabel(new Date(nowMs).toISOString(), i18n.language, t);

  const invalidate = (meetingId: string) => {
    for (const key of [meetingKeys.list(workspaceId), meetingKeys.stats(workspaceId), calendarKeys.all(workspaceId)]) void qc.invalidateQueries({ queryKey: key });
    for (const key of [meetingKeys.detail, meetingKeys.participants, meetingKeys.invitations, meetingKeys.inviteLinks, meetingKeys.motions, meetingKeys.attendance, meetingKeys.activity]) {
      void qc.invalidateQueries({ queryKey: key(meetingId) });
    }
  };

  const finish = (done: SubmitRun) => {
    if (done.phase1Error) {
      if (!attached.current) toast.error(t("meetings.sheet.unknownOutcome"), { position: "bottom-center" });
      return;
    }
    const failed = runRows(done).some((r) => r.status === "failed");
    if (attached.current) {
      if (needsPanel(done)) return;
      if (done.plan.mode === "create") {
        // The primary lands on its ✓ (drawn in 300 ms, held 600) before the sheet goes.
        setLanded(true);
        setTimeout(() => {
          dropRun(done.id);
          onClose();
          report(done, failed);
        }, LANDING_MS);
        return;
      }
      dropRun(done.id);
      onClose();
    }
    report(done, failed);
  };

  const report = (done: SubmitRun, failed: boolean) => {
    const id = done.meetingId!;
    const toastOf = outcomeToast(done, failed, t);
    if (failed) {
      toast.warning(toastOf, { position: "bottom-center", duration: Infinity, action: { label: t("meetings.sheet.seeResult"), onClick: () => onReopen(done.id) } });
    } else {
      toast.success(toastOf, {
        position: "bottom-center",
        ...(onDone && done.plan.mode === "create" && !attached.current ? { action: { label: t("meetings.sheet.open"), onClick: () => onDone(id) } } : {}),
      });
      if (attached.current && done.plan.mode === "create") onDone?.(id);
    }
  };

  const submit = () => {
    if (phase1Busy || phase2 || confirm || landed) return;
    if (ended) return onClose();
    if (setup.mode === "edit" && changes.length === 0) return onClose();
    const now = Date.now();
    const found = validateDraft(draft, { nowMs: now, checkPast: setup.mode !== "edit" || timeTouched, timeLocked: Boolean(live) });
    if (found.length) {
      setSubmitted(true);
      requestAnimationFrame(() => focusIssue(idPrefix, found[0]!));
      return;
    }
    const ctx = {
      scribeDefault: scribePolicyDefault(caps),
      scribeOffered: scribeAvailability(caps) === "on",
      defaultLinkName: defaultInviteLinkLabel(new Date(now).toISOString(), i18n.language, t),
      previousMeetingId: setup.mode === "followUp" ? setup.previous.id : undefined,
    };
    const plan =
      setup.mode === "edit"
        ? buildEditPlan(setup.meeting, draft, snapshot, { ...ctx, timeLocked: Boolean(live) })
        : buildCreatePlan(draft, ctx);
    attached.current = true;
    // A failed create is built again from the fields as they are now, under the same key.
    if (run) dropRun(run.id);
    setRunId(startSubmitRun(plan, { workspaceId, idempotencyKey, invalidate, onDone: finish }));
  };

  const requestClose = () => {
    if (confirm || landed) return;
    if (run && run.phase !== "done" && !run.phase1Error) {
      // Phase 1 holds the sheet until it answers or turns slow; phase 2 only while a link's secret is still to come.
      if ((phase1Busy && !run.slow) || (phase2 && linksPending(run))) return;
      attached.current = false;
      return onClose();
    }
    if (showResult) {
      dropRun(run!.id);
      return onClose();
    }
    if (changes.length > 0 && !ended) return setConfirm("discard");
    onClose();
  };
  guardRef.current = requestClose;

  const pending = changes.length > 0 || phase1Busy || phase2;
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  // ⌘/Ctrl+Enter submits from anywhere in the sheet; never mid-composition (IME).
  const root = useRef<HTMLDivElement>(null);
  const submitRef = useRef(submit);
  submitRef.current = showResult ? () => {} : submit;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      submitRef.current();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  const xLocked = landed || Boolean(run && ((phase1Busy && !run.slow) || (phase2 && linksPending(run))));
  const title = t(setup.mode === "edit" ? "meetings.edit" : setup.mode === "followUp" ? "meetings.sheet.followUpTitle" : "meetings.new");
  const caption = setup.mode === "followUp" ? headCaption(setup.previous, seriesShortTitle(setup.previous.title), nowMs, t) : null;
  const failures = run ? runRows(run).filter((r) => r.status === "failed") : [];
  // On a phone, create is a page (CreatePhone: × left, one primary); follow-up and edit keep the sheet's head and foot.
  const phonePage = setup.mode === "create";

  // data-mode lets a part take its board's spacing (EditScheduled draws a looser sheet than CreateFull).
  return (
    // data-fresh: the untouched create sheet (CreateDefault draws it a little tighter than CreateFull).
    <div
      ref={root}
      data-mode={live ? "live" : setup.mode}
      data-fresh={setup.mode === "create" && changes.length === 0 && !submitted ? "" : undefined}
      data-phone-sheet={phonePage ? undefined : ""}
      className="group/sheet flex h-full min-h-0 flex-col"
    >
      <div
        className={cn(
          "flex min-h-14 flex-none items-center gap-3 border-b border-border py-2 pr-3 pl-6",
          phonePage ? "max-sm:min-h-12 max-sm:gap-0 max-sm:px-1" : cn("max-sm:pr-1 max-sm:pl-4", caption ? "max-sm:min-h-15 max-sm:py-2.5" : "max-sm:py-1.5"),
          caption && "min-h-17 py-3.5",
          showResult && "min-h-17 items-start py-4",
          phonePage && !caption && !showResult && "max-sm:py-0",
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(kitButton.icon, "order-2 ml-auto max-sm:size-11", phonePage && "max-sm:order-0 max-sm:ml-0", showResult && "-mt-0.75")}
          aria-label={t("common.close")}
          aria-disabled={xLocked || undefined}
          onClick={requestClose}
        >
          <X aria-hidden />
        </Button>
        {showResult && run ? (
          <>
            <SheetTitle className="sr-only">{t("meetings.created")}</SheetTitle>
            <ResultPanelHead run={run} caption={resultCaption(run, draft, nowMs, t)} />
          </>
        ) : (
          <div className={cn("min-w-0", phonePage && "max-sm:flex-1 max-sm:text-center")}>
            <SheetTitle className="truncate text-title-sm font-semibold">{title}</SheetTitle>
            {caption ? <p className="mt-0.5 truncate text-caption text-muted-foreground">{caption}</p> : null}
          </div>
        )}
        {phonePage ? <span aria-hidden className="order-3 hidden w-11 max-sm:block" /> : null}
      </div>

      {showResult && run ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-4 max-sm:px-4">
            <ResultPanelBody run={run} nameOf={nameOf} workspaceName={workspaceName} onRetry={(keys) => void retryRows(run.id, keys, finish)} />
          </div>
          <SheetFooter
            line={failures.length ? { tone: "muted", text: t("meetings.sheet.resultPending", { count: failures.length }) } : null}
            primaryType="button"
            primaryLabel={setup.mode === "edit" || !onDone ? t("common.close") : t("meetings.sheet.openMeeting")}
            kbd={false}
            busy={xLocked}
            onPrimary={() => {
              // Mid-retry the run reports by toast once the sheet is gone; the meeting still opens.
              if (run.phase === "done") dropRun(run.id);
              else attached.current = false;
              onClose();
              if (setup.mode !== "edit" && run.meetingId) onDone?.(run.meetingId);
            }}
            extra={
              failures.length >= 2 ? (
                <Button variant="ghost" size="lg" className={cn(kitButton.base, kitButton.ghost)} onClick={() => void retryRows(run.id, failures.map((f) => f.key), finish)}>
                  {t("meetings.sheet.retryAll")}
                </Button>
              ) : null
            }
          />
        </>
      ) : (
        <form
          id={formId}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-8 group-data-[mode=followUp]/sheet:pb-7 max-sm:px-4 max-sm:pt-4 max-sm:pb-6" aria-busy={phase1Busy || undefined}>
            {ended ? (
              <p className="mb-4 flex items-center gap-2 text-body text-muted-foreground">
                <Lock aria-hidden className="size-4" />
                {t("meetings.sheet.endedLocked")}
              </p>
            ) : null}
            <SheetFields
              idPrefix={idPrefix}
              workspaceId={workspaceId}
              workspaceName={workspaceName}
              state={state}
              issues={issues}
              nowMs={nowMs}
              readOnly={readOnly}
              mode={setup.mode}
              host={host}
              viewerId={user?.id}
              caps={caps}
              linkPlaceholder={linkPlaceholder}
              live={live}
              existingLinks={setup.mode === "edit" ? setup.existingLinks : undefined}
              rsvp={setup.mode === "edit" ? setup.rsvp : undefined}
              quorumLocked={setup.mode === "edit" && setup.quorumLocked}
              removedUserIds={setup.mode === "edit" ? setup.removedUserIds : undefined}
              onManage={setup.mode === "edit" ? requestClose : undefined}
              titleSwap={setup.mode === "followUp" ? setup.swap : null}
              onKeepOldTitle={setup.mode === "followUp" && setup.swap ? () => state.patch({ title: setup.previous.title }) : undefined}
              previousDescription={
                setup.mode === "followUp"
                  ? { label: setup.previousLabel, text: setup.previous.description ?? "", questions: setup.questions }
                  : undefined
              }
              previousSecretaryId={setup.mode === "followUp" ? setup.previousSecretaryId : undefined}
              previousWeek={setup.mode === "followUp" ? (setup.swap?.from ?? null) : undefined}
              carried={setup.mode === "followUp" ? setup.carried : undefined}
              inviteCaption={inviteCaption(draft.people.map((p) => nameOf(p.userId)), t)}
            />
          </div>
          {setup.mode === "edit" && setup.stale && !readOnly ? (
            <div className="flex flex-none items-center gap-3 border-t border-border px-6 py-3 max-sm:px-4">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-body text-warning">
                  <TriangleAlert aria-hidden className="size-4" />
                  {t("meetings.editUpdatedElsewhere")}
                </p>
                <p className="text-caption text-muted-foreground">{t("meetings.sheet.staleKept")}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="default"
                className={cn(kitButton.sm, kitButton.outline)}
                onClick={() => (changes.length ? setConfirm("reload") : reset(setup.reseed()))}
              >
                <RefreshCw aria-hidden />
                {t("meetings.editReload")}
              </Button>
            </div>
          ) : null}
          <SheetFooter
            line={
              errorCode(run?.phase1Error) === "idempotency_payload_mismatch"
                ? { tone: "destructive", text: t("meetings.sheet.createMismatch") }
                : footerLine({ run, issues, submitted, setup: setup.mode, changes: changes.length, caption: inviteCaption(draft.people.map((p) => nameOf(p.userId)), t), progress: run ? runProgress(run) : null, t })
            }
            onCancel={ended ? undefined : requestClose}
            stacked={!phonePage}
            form={formId}
            primaryLabel={ended ? t("common.close") : t(setup.mode === "edit" ? "meetings.saveChanges" : setup.mode === "followUp" ? "meetings.sheet.followUpSubmit" : "meetings.createSubmit")}
            busy={phase1Busy || phase2}
            busyLabel={t(setup.mode === "edit" ? "meetings.saving" : "meetings.creating")}
            morph={setup.mode !== "edit"}
            landed={landed}
            doneLabel={t("meetings.created")}
          />
        </form>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        nested
        solid
        cancelVariant="ghost"
        title={t(confirm === "reload" ? "meetings.sheet.reloadTitle" : setup.mode === "edit" ? "meetings.sheet.discardEditTitle" : "meetings.sheet.discardTitle")}
        description={t(confirm === "reload" ? "meetings.sheet.reloadBody" : setup.mode === "edit" ? "meetings.sheet.discardEditBody" : "meetings.sheet.discardBody", { count: changes.length })}
        cancelLabel={t(confirm === "reload" ? "meetings.sheet.keepChanges" : setup.mode === "edit" ? "meetings.sheet.keepEditing" : "meetings.sheet.keepDrafting")}
        confirmLabel={t(confirm === "reload" ? "meetings.editReload" : setup.mode === "edit" ? "meetings.sheet.discardEdit" : "meetings.sheet.discard")}
        onConfirm={() => {
          if (confirm === "reload" && setup.mode === "edit") reset(setup.reseed());
          else onClose();
          setConfirm(null);
        }}
      />
    </div>
  );
}

/** The created ✓: drawn in 300 ms, then held 600 ms before the sheet closes (proposal C). */
const LANDING_MS = 900;

/** The result panel shows when a step failed or a guest link's secret must be seen once. */
function needsPanel(run: SubmitRun): boolean {
  return runRows(run).some((r) => r.status === "failed" || (r.key.startsWith("link:") && r.status === "ok"));
}

function inviteCaption(names: string[], t: ReturnType<typeof useTranslation>["t"]): string {
  return names.length ? t("meetings.sheet.willBeInvited", { names: names.join(", ") }) : t("meetings.sheet.pickPeople");
}

