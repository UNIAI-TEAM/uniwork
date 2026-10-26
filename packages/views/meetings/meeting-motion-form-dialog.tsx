"use client";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import {
  MOTION_DESCRIPTION_MAX_LENGTH,
  MOTION_TITLE_MAX_LENGTH,
  canSubmitMotion,
  useCreateMotion,
  useUpdateMotion,
} from "@uniwork/core/meetings/motions";
import type {
  BallotMode,
  MeetingMotion,
  MotionBase,
  MotionDraftInput,
  MotionThreshold,
} from "@uniwork/core/types/meeting";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import { MotionRuleRows, MotionRuleSummary, type MotionRules } from "./meeting-motion-rules";

const MODES: readonly BallotMode[] = ["PUBLIC", "SECRET"];
const THRESHOLDS: readonly MotionThreshold[] = ["MAJORITY", "TWO_THIRDS"];
const BASES: readonly MotionBase[] = ["PRESENT", "ALL_MEMBERS"];

function pick<T extends string>(all: readonly T[], value: unknown, fallback: T): T {
  return all.find((v) => v === value) ?? fallback;
}

/** The counter shows only near the limit: an empty "0/200" is noise. */
function Counter({ id, length, max }: { id: string; length: number; max: number }) {
  if (length < max * 0.9) return null;
  return (
    <span id={id} className="text-caption tabular-nums text-muted-foreground">
      {length}/{max}
    </span>
  );
}

/** Mounted per opening (the dialog unmounts its popup), so each opening starts from the motion. */
function MotionForm({ meetingId, motion, onDone }: { meetingId: string; motion?: MeetingMotion; onDone: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const create = useCreateMotion(meetingId);
  const update = useUpdateMotion(meetingId);
  const [title, setTitle] = useState(motion?.title ?? "");
  const [description, setDescription] = useState(motion?.description ?? "");
  const [rules, setRules] = useState<MotionRules>(() => ({
    ballot_mode: pick(MODES, motion?.ballot_mode, "PUBLIC"),
    threshold: pick(THRESHOLDS, motion?.threshold, "MAJORITY"),
    base: pick(BASES, motion?.base, "PRESENT"),
  }));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;
  const canSubmit = canSubmitMotion(title, description);

  const submit = () => {
    if (!canSubmit || pending) return;
    setSubmitError(null);
    const body: MotionDraftInput = {
      title: title.trim(),
      description: description.trim(),
      ...rules,
    };
    const saved = motion ? update.mutateAsync({ motionId: motion.id, ...body }) : create.mutateAsync(body);
    saved.then(
      () => {
        toast.success(motion ? t("meetings.governance.motionUpdated") : t("meetings.governance.motionCreated"));
        onDone();
      },
      (err: unknown) => setSubmitError(apiErrorMessage(err) ?? t("common.error")),
    );
  };

  return (
    <>
      <FormDialogHeader
        title={motion ? t("meetings.governance.motionEditTitle") : t("meetings.governance.motionCreateTitle")}
        description={t("meetings.governance.motionFormDescription")}
      />
      <FormDialogBody className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor={titleId}>{t("meetings.governance.motionTitleLabel")}</Label>
            <Counter id={`${titleId}-count`} length={title.length} max={MOTION_TITLE_MAX_LENGTH} />
          </div>
          <Textarea
            id={titleId}
            value={title}
            maxLength={MOTION_TITLE_MAX_LENGTH}
            rows={2}
            placeholder={t("meetings.governance.motionTitlePlaceholder")}
            aria-describedby={title.length >= MOTION_TITLE_MAX_LENGTH * 0.9 ? `${titleId}-count` : undefined}
            onChange={(event) => setTitle(event.target.value)}
            className="min-h-0 resize-none"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor={descriptionId}>{t("meetings.governance.motionDescriptionLabel")}</Label>
            <Counter id={`${descriptionId}-count`} length={description.length} max={MOTION_DESCRIPTION_MAX_LENGTH} />
          </div>
          <Textarea
            id={descriptionId}
            value={description}
            maxLength={MOTION_DESCRIPTION_MAX_LENGTH}
            rows={2}
            aria-describedby={description.length >= MOTION_DESCRIPTION_MAX_LENGTH * 0.9 ? `${descriptionId}-count` : undefined}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-0 resize-none"
          />
        </div>
        {/* The three rules as one compact card; its last line says in words what they add up to. */}
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          <MotionRuleRows value={rules} onChange={(patch) => setRules((r) => ({ ...r, ...patch }))} />
          <MotionRuleSummary value={rules} className="bg-muted px-3 py-2.5" />
        </div>
      </FormDialogBody>
      <FormDialogFooter
        onCancel={onDone}
        submitLabel={motion ? t("meetings.governance.motionSave") : t("meetings.governance.motionCreate")}
        submittingLabel={t("meetings.governance.motionSaving")}
        submitting={pending}
        submitDisabled={!canSubmit}
        onSubmit={submit}
        leading={
          submitError ? (
            <span role="alert" className="text-destructive">
              {submitError}
            </span>
          ) : undefined
        }
      />
    </>
  );
}

/**
 * Draft or edit one item to vote on. Defaults are the common case — open
 * ballot, simple majority of members present — so most items need a title only.
 */
export function MeetingMotionFormDialog({
  meetingId,
  open,
  onOpenChange,
  motion,
}: {
  meetingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent to create; a DRAFT motion to edit. */
  motion?: MeetingMotion;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="lg">
        <MotionForm key={motion?.id ?? "new"} meetingId={meetingId} motion={motion} onDone={() => onOpenChange(false)} />
      </FormDialogContent>
    </Dialog>
  );
}
