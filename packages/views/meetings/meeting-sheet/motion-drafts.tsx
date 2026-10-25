"use client";
import { useState } from "react";
import { ChevronRight, CircleAlert, Ellipsis, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MOTION_DESCRIPTION_MAX_LENGTH, MOTION_TITLE_MAX_LENGTH } from "@uniwork/core/meetings/motions";
import type { BallotMode, MotionBase, MotionThreshold } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { kitButton } from "../meeting-detail/ui/kit-buttons";
import { SegmentedSm } from "../meeting-detail/ui/segmented";
import { TextButton } from "../meeting-detail/ui/text-button";
import { newMotion, type MotionDraft } from "./draft-model";
import { motionIssue } from "./draft-validation";
import { AddRow } from "./guest-link-drafts";
import { CONTROL } from "./sheet-styles";

const COUNTER_FROM = 180;

/** "Công khai · Quá bán · Trên số có mặt": a motion's rule in the existing labels. */
export function motionRule(m: Pick<MotionDraft, "ballot_mode" | "threshold" | "base">, t: ReturnType<typeof useTranslation>["t"]): string {
  return [
    t(`meetings.governance.ballotMode_${m.ballot_mode}`),
    t(`meetings.governance.threshold_${m.threshold}`),
    t(`meetings.governance.base_${m.base}`),
  ].join(" · ");
}

function MotionEditor({
  motion,
  showErrors,
  onChange,
  onDone,
}: {
  motion: MotionDraft;
  showErrors: boolean;
  onChange: (m: MotionDraft) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [tried, setTried] = useState(false);
  const issue = motionIssue(motion.title);
  const showIssue = issue && (tried || showErrors);
  const id = `motion-${motion.key}`;
  const set = (patch: Partial<MotionDraft>) => onChange({ ...motion, ...patch });
  return (
    <li className="mt-3 rounded-control border border-border p-3">
      <label htmlFor={id} className="mb-1.5 flex justify-between text-caption text-muted-foreground">
        {t("meetings.governance.motionTitleLabel")}
        {motion.title.length > COUNTER_FROM ? (
          <span className="tabular-nums">
            {motion.title.length}/{MOTION_TITLE_MAX_LENGTH}
          </span>
        ) : null}
      </label>
      <input
        id={id}
        value={motion.title}
        placeholder={t("meetings.governance.motionTitlePlaceholder")}
        aria-invalid={showIssue ? true : undefined}
        aria-describedby={showIssue ? `${id}-error` : undefined}
        onChange={(e) => set({ title: e.target.value })}
        className={cn(CONTROL, "w-full aria-invalid:border-destructive")}
      />
      {showIssue ? (
        <p id={`${id}-error`} className="mt-1.5 flex items-center gap-1 text-caption text-destructive">
          <CircleAlert aria-hidden className="size-3.5" />
          {t(issue === "motionEmpty" ? "meetings.sheet.motionEmpty" : "meetings.sheet.motionTooLong")}
        </p>
      ) : null}
      <label htmlFor={`${id}-desc`} className="mt-3 mb-1.5 block text-caption text-muted-foreground">
        {t("meetings.governance.motionDescriptionLabel")}
      </label>
      <textarea
        id={`${id}-desc`}
        value={motion.description}
        maxLength={MOTION_DESCRIPTION_MAX_LENGTH}
        onChange={(e) => set({ description: e.target.value })}
        className={cn(CONTROL, "field-sizing-content block h-auto max-h-34 min-h-11 w-full resize-none py-2.5")}
      />
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-3">
        <SegmentedSm<BallotMode>
          legend={t("meetings.governance.ballotModeLabel")}
          value={motion.ballot_mode}
          onChange={(v) => set({ ballot_mode: v })}
          options={(["PUBLIC", "SECRET"] as const).map((v) => ({ value: v, label: t(`meetings.governance.ballotMode_${v}`) }))}
        />
        <SegmentedSm<MotionThreshold>
          legend={t("meetings.governance.thresholdLabel")}
          value={motion.threshold}
          onChange={(v) => set({ threshold: v })}
          options={(["MAJORITY", "TWO_THIRDS"] as const).map((v) => ({ value: v, label: t(`meetings.governance.threshold_${v}`) }))}
        />
        <SegmentedSm<MotionBase>
          legend={t("meetings.governance.baseLabel")}
          value={motion.base}
          onChange={(v) => set({ base: v })}
          options={(["PRESENT", "ALL_MEMBERS"] as const).map((v) => ({ value: v, label: t(`meetings.governance.base_${v}`) }))}
        />
      </div>
      {motion.ballot_mode === "SECRET" ? <p className="mt-2 text-caption text-muted-foreground">{t("meetings.governance.secretHint")}</p> : null}
      <div className="mt-3 flex justify-end">
        <Button
          variant="outline"
          size="default"
          className={cn(kitButton.sm, kitButton.outline)}
          onClick={() => {
            setTried(true);
            if (!motionIssue(motion.title)) onDone();
            else document.getElementById(id)?.focus();
          }}
        >
          {t("meetings.sheet.motionDone")}
        </Button>
      </div>
    </li>
  );
}

/**
 * Biểu quyết (create brief §2.10): numbered rows with the rule under the
 * title; "Sửa ›" or a new row opens the editor in place; ⋯ moves or deletes.
 * A motion open or closed in the room is read-only here.
 */
export function MotionDrafts({
  motions,
  onChange,
  showErrors,
  readOnly,
}: {
  motions: readonly MotionDraft[];
  onChange: (motions: MotionDraft[]) => void;
  showErrors: boolean;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  // The Biểu quyết chip opens the part with one untitled motion: it starts in its editor.
  const [editing, setEditing] = useState<string | null>(() => motions.find((m) => !m.id && !m.title.trim())?.key ?? null);
  const isLocked = (m: MotionDraft | undefined) => Boolean(m?.status && m.status !== "DRAFT");
  const move = (index: number, by: number) => {
    const next = [...motions];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row!);
    onChange(next);
  };
  return (
    <>
      <ol>
        {motions.map((m, i) => {
          const locked = isLocked(m);
          const invalid = !locked && showErrors && motionIssue(m.title);
          if (!locked && !readOnly && (editing === m.key || invalid)) {
            return (
              <MotionEditor
                key={m.key}
                motion={m}
                showErrors={showErrors}
                onChange={(next) => onChange(motions.map((x) => (x.key === m.key ? next : x)))}
                onDone={() => setEditing(null)}
              />
            );
          }
          return (
            <li key={m.key} className="grid min-h-13 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 py-1.5">
              <span className="text-caption font-medium text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="min-w-0 text-body font-medium text-pretty">{m.title}</span>
              {/* Read-only while submitting keeps the row's actions drawn, inert (CreateValidation C). */}
              {locked ? (
                <span />
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={readOnly}
                    aria-label={t("meetings.governance.motionActions", { title: m.title })}
                    render={<Button variant="ghost" size="icon-sm" className={cn(kitButton.icon, "-mr-1.5 justify-self-end")} />}
                  >
                    <Ellipsis aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={i === 0 || isLocked(motions[i - 1])} onClick={() => move(i, -1)}>
                      {t("meetings.governance.motionMoveUp")}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={i === motions.length - 1 || isLocked(motions[i + 1])} onClick={() => move(i, 1)}>
                      {t("meetings.governance.motionMoveDown")}
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => onChange(motions.filter((x) => x.key !== m.key))}>
                      {t("meetings.governance.motionDelete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <span className="col-start-2 text-caption text-muted-foreground">
                {motionRule(m, t)}
                {locked ? (
                  <>
                    {" · "}
                    <span className={cn("inline-flex items-center gap-1", m.status === "OPEN" && "text-foreground")}>
                      {m.status === "OPEN" ? <Lock aria-hidden className="size-3" /> : null}
                      {t(m.status === "OPEN" ? "meetings.sheet.motionVoting" : "meetings.governance.motionStatus_CLOSED")}
                    </span>
                  </>
                ) : m.id ? (
                  ` · ${t("meetings.governance.motionStatus_DRAFT")}`
                ) : null}
              </span>
              {locked ? null : (
                <TextButton className="col-start-3 justify-self-end py-0" aria-disabled={readOnly || undefined} onClick={() => setEditing(m.key)}>
                  {t("meetings.governance.motionEdit")}
                  <ChevronRight aria-hidden />
                </TextButton>
              )}
            </li>
          );
        })}
      </ol>
      <AddRow
        label={t("meetings.governance.motionCreateTitle")}
        disabled={readOnly}
        onClick={() => {
          const m = newMotion();
          onChange([...motions, m]);
          setEditing(m.key);
          requestAnimationFrame(() => document.getElementById(`motion-${m.key}`)?.focus());
        }}
      />
    </>
  );
}
