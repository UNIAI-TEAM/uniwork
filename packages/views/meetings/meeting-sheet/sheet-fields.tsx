"use client";
import type { ChangeEvent, ReactNode } from "react";
import { CircleAlert, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingCapabilities, MeetingInviteLink } from "@uniwork/core/types/meeting";
import { useMediaQuery } from "@uniwork/ui/hooks/use-media-query";
import { cn } from "@uniwork/ui/lib/utils";
import { clock } from "../meeting-detail/format";
import { TextButton } from "../meeting-detail/ui/text-button";
import { scheduleWindowIso } from "../meeting-datetime";
import type { DraftIssue } from "./draft-validation";
import type { MeetingDraftState } from "./use-meeting-draft";
import { GuestLinkDrafts } from "./guest-link-drafts";
import { MoreOptions, QuorumSection, moreSummary } from "./more-options";
import { MotionDrafts } from "./motion-drafts";
import { PeopleField } from "./people-field";
import type { Rsvp } from "./person-role-row";
import { PropertyChips } from "./property-chips";
import { ScribeBlock, scribePolicyDefault } from "./scribe-block";
import { CONTROL, FIELD_LABEL } from "./sheet-styles";
import { TimeRow } from "./time-row";
import { WordClip } from "./word-clip";

export type SheetFieldsProps = {
  idPrefix: string;
  workspaceId: string;
  workspaceName: string;
  state: MeetingDraftState;
  issues: DraftIssue[];
  nowMs: number;
  readOnly: boolean;
  mode: "create" | "followUp" | "edit";
  host: { userId: string; name: string; avatarUrl?: unknown };
  viewerId: string | undefined;
  caps: MeetingCapabilities | undefined;
  moreOpen: boolean;
  onMoreOpen: (open: boolean) => void;
  linkPlaceholder: string;
  /** Edit: the meeting is live, so its time is locked. */
  live?: { startsAt: string; endsAt: string };
  existingLinks?: readonly MeetingInviteLink[];
  rsvp?: ReadonlyMap<string, Rsvp>;
  quorumLocked?: boolean;
  onManage?: () => void;
  /** Follow-up extras. */
  titleSwap?: { from: number; to: number } | null;
  onKeepOldTitle?: () => void;
  previousDescription?: { label: string; text: string; questions: string[] };
  previousSecretaryId?: string;
  previousWeek?: number | null;
  carried?: ReactNode;
  inviteCaption: string;
};

function FieldError({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} className={cn("mt-1.5 flex items-center gap-1.5 text-caption text-destructive", className)}>
      <CircleAlert aria-hidden className="size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** The sheet's fields in the brief's order (§3.2): title, time, people, agenda, chips, Thư ký UNI, Thêm tùy chọn. */
export function SheetFields(p: SheetFieldsProps) {
  const { t } = useTranslation();
  // A phone opens create unfocused (CreatePhone f1): autofocus would pop the keyboard over the page.
  const phone = useMediaQuery("(max-width: 639px)");
  const { draft, snapshot, patch, touched, touch, submitted } = p.state;
  const issueOf = (field: string) => p.issues.find((i) => i.field === field);
  const titleIssue = issueOf("title") && (submitted || touched.has("title"));
  const scribeOn = draft.scribe ?? scribePolicyDefault(p.caps);
  const endsAtMs = Date.parse(scheduleWindowIso(draft.date, draft.start, draft.end, draft.timezone).ends_at);
  const moreError = p.issues.some((i) => i.section === "more");
  const agenda = {
    id: `${p.idPrefix}-agenda`,
    value: draft.description,
    readOnly: p.readOnly,
    placeholder: t("meetings.sheet.agendaPlaceholder"),
    onChange: (e: ChangeEvent<HTMLTextAreaElement>) => patch({ description: e.target.value }),
  };
  const timeChecksPast = p.mode !== "edit" || (["date", "start", "end", "timezone"] as const).some((k) => draft[k] !== snapshot[k]);
  return (
    <>
      <div>
        <label htmlFor={`${p.idPrefix}-title`} className="sr-only">
          {t("meetings.meetingTitle")}
        </label>
        {/* A one-line title that wraps instead of scrolling sideways (CreatePhone): Enter never adds a line. */}
        <textarea
          id={`${p.idPrefix}-title`}
          rows={1}
          required
          autoFocus={p.mode === "create" && !phone}
          onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
          value={draft.title}
          readOnly={p.readOnly}
          aria-invalid={titleIssue ? true : undefined}
          aria-describedby={titleIssue ? `${p.idPrefix}-title-error` : p.titleSwap ? `${p.idPrefix}-title-swap` : undefined}
          placeholder={t("meetings.sheet.titlePlaceholder")}
          onChange={(e) => patch({ title: e.target.value.replace(/\s*\n\s*/g, " ") })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) e.preventDefault();
          }}
          onBlur={() => draft.title !== snapshot.title && touch("title")}
          className={cn(
            // Empty, the line sits in a taller box (CreateDefault 45, CreateValidation A 41); typed, it hugs the text (37).
            "field-sizing-content block min-h-9.25 w-full resize-none border-0 border-b border-border bg-transparent pb-2.5 font-display text-title-lg! font-bold text-foreground outline-none placeholder:text-muted-foreground placeholder-shown:min-h-11.25 placeholder-shown:pt-1.25 group-data-[mode=live]/sheet:min-h-11.25 group-data-[mode=live]/sheet:pt-1.25 group-data-[mode=followUp]/sheet:pt-0.5 group-data-[mode=followUp]/sheet:pb-2 max-sm:group-data-[mode=create]/sheet:pb-2 focus-visible:border-ring focus-visible:shadow-[0_1px_0_var(--ring)]",
            titleIssue &&
              "border-destructive placeholder-shown:min-h-10.25 placeholder-shown:pt-0.75 focus:rounded-sm focus:outline-2 focus:outline-solid focus:outline-offset-4 focus:outline-ring focus-visible:border-destructive focus-visible:shadow-[0_1px_0_var(--destructive)]",
          )}
        />
        {titleIssue ? (
          <FieldError id={`${p.idPrefix}-title-error`} className="mt-3.5">
            {t("meetings.titleRequired")}
          </FieldError>
        ) : null}
        {p.titleSwap ? (
          <p id={`${p.idPrefix}-title-swap`} className="mt-1.5 text-caption text-muted-foreground">
            {t("meetings.sheet.titleSwapped", p.titleSwap)}
            {p.onKeepOldTitle ? (
              <>
                {" "}
                <span aria-hidden className="mx-0.5">
                  ·
                </span>{" "}
                <TextButton className="py-0" onClick={p.onKeepOldTitle}>
                  {t("meetings.sheet.keepOldTitle")}
                </TextButton>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="mt-6">
        {p.live ? (
          <>
            <p className={FIELD_LABEL}>{t("meetings.sheet.time")}</p>
            <div className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3">
              <Lock aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
              <p className="text-body">{t("meetings.editScheduleLocked")}</p>
              <p className="col-start-2 mt-0.5 text-caption text-muted-foreground">
                {t("meetings.sheet.liveStarted")} <span className="font-mono font-medium">{clock(p.live.startsAt)}</span>
                {" · "}
                {t("meetings.sheet.liveEnds")} <span className="font-mono font-medium">{clock(p.live.endsAt)}</span>
                {t("meetings.sheet.liveEndsTail")}
                <br />
                {t("meetings.sheet.liveExtend")}
              </p>
            </div>
          </>
        ) : (
          <TimeRow
            idPrefix={p.idPrefix}
            value={draft}
            onChange={patch}
            nowMs={p.nowMs}
            checkPast={timeChecksPast}
            revealPast={submitted || touched.has("time")}
            onCommit={() => touch("time")}
            readOnly={p.readOnly}
            joinDot={p.mode === "edit"}
          />
        )}
      </div>

      <div className="mt-6 group-data-[mode=edit]/sheet:mt-7">
        <PeopleField
          idPrefix={p.idPrefix}
          workspaceId={p.workspaceId}
          host={p.host}
          viewerId={p.viewerId}
          people={draft.people}
          onChange={(people) => patch({ people })}
          readOnly={p.readOnly}
          edit={p.mode === "edit"}
          rsvp={p.rsvp}
          previousSecretaryId={p.previousSecretaryId}
          previousWeek={p.previousWeek}
        />
        {p.mode === "create" ? <p className="mt-1 text-caption text-muted-foreground sm:hidden">{p.inviteCaption}</p> : null}
      </div>

      <div className="mt-6">
        <label htmlFor={`${p.idPrefix}-agenda`} className={FIELD_LABEL}>
          {t("meetings.description")}
        </label>
        {p.live ? (
          // Live (EditLive): the field draws its box around a bare three-line textarea.
          <div className={cn(CONTROL, "h-auto px-3 py-2 max-sm:h-auto focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring")}>
            <textarea {...agenda} className="field-sizing-content block max-h-30 min-h-15 w-full resize-none bg-transparent text-pretty outline-none placeholder:text-muted-foreground max-sm:min-h-25" />
          </div>
        ) : (
          <textarea
            {...agenda}
            className={cn(CONTROL, "field-sizing-content block h-auto max-h-34 min-h-16 w-full resize-none py-2.5 max-sm:min-h-21 group-data-[fresh]/sheet:min-h-14.5 group-data-[fresh]/sheet:px-3 group-data-[fresh]/sheet:py-2", p.mode !== "create" && "min-h-14.5 py-2 max-sm:min-h-14.5")}
          />
        )}
        {p.previousDescription ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1 text-caption text-muted-foreground">
            {p.previousDescription.text ? (
              <>
                <WordClip className="max-w-64" text={t("meetings.sheet.previousAgenda", { label: p.previousDescription.label, text: p.previousDescription.text })} />
                <span aria-hidden>·</span>
                <TextButton className="py-0" onClick={() => patch({ description: p.previousDescription!.text })}>
                  {t("meetings.sheet.reuse")}
                </TextButton>
              </>
            ) : null}
            {p.previousDescription.questions.length ? (
              <>
                {p.previousDescription.text ? <span aria-hidden>·</span> : null}
                <TextButton
                  className="py-0"
                  onClick={() =>
                    patch({ description: [draft.description.trim(), ...p.previousDescription!.questions].filter(Boolean).join("\n") })
                  }
                >
                  {t("meetings.sheet.insertQuestions", { count: p.previousDescription.questions.length })}
                </TextButton>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      {p.carried}

      <PropertyChips
        workspaceId={p.workspaceId}
        projectId={draft.projectId}
        onProject={(projectId) => patch({ projectId })}
        allowJoin={draft.allowJoin}
        onAllowJoin={(allowJoin) => patch({ allowJoin })}
        readOnly={p.readOnly}
        className={p.carried ? "mt-6.5" : undefined}
      />

      <div className="mt-6">
        <ScribeBlock
          caps={p.caps}
          value={scribeOn}
          onChange={(scribe) => patch({ scribe })}
          shared={draft.aiShared}
          onShared={(aiShared) => patch({ aiShared })}
          workspaceName={p.workspaceName}
          live={Boolean(p.live)}
          readOnly={p.readOnly}
        />
      </div>

      <MoreOptions
        open={p.moreOpen}
        onOpenChange={p.onMoreOpen}
        summary={moreSummary(draft, p.existingLinks?.length ?? 0, t)}
        hasError={moreError && submitted}
      >
        <GuestLinkDrafts
          links={draft.links}
          existing={p.existingLinks}
          onChange={(links) => patch({ links })}
          placeholder={p.linkPlaceholder}
          nowMs={p.nowMs}
          endsAtMs={endsAtMs}
          showErrors={submitted}
          readOnly={p.readOnly}
          onManage={p.onManage}
          live={Boolean(p.live)}
        />
        <MotionDrafts motions={draft.motions} onChange={(motions) => patch({ motions })} showErrors={submitted} readOnly={p.readOnly} />
        <QuorumSection
          value={draft.quorum}
          onChange={(quorum) => patch({ quorum })}
          showError={submitted || touched.has("quorum")}
          onBlur={() => draft.quorum !== snapshot.quorum && touch("quorum")}
          locked={p.quorumLocked}
          readOnly={p.readOnly}
        />
      </MoreOptions>
    </>
  );
}
