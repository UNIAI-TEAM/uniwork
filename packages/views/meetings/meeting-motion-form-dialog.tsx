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
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";

const MODES: readonly BallotMode[] = ["PUBLIC", "SECRET"];
const THRESHOLDS: readonly MotionThreshold[] = ["MAJORITY", "TWO_THIRDS"];
const BASES: readonly MotionBase[] = ["PRESENT", "ALL_MEMBERS"];

function pick<T extends string>(all: readonly T[], value: unknown, fallback: T): T {
  return all.find((v) => v === value) ?? fallback;
}

/** Two side-by-side choices with an optional hint under one of them. */
function OptionGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: readonly { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  const all = options.map((o) => o.value);
  return (
    <div className="space-y-2">
      <p id={`${id}-legend`} className="text-label font-medium text-foreground">
        {legend}
      </p>
      <RadioGroup
        aria-labelledby={`${id}-legend`}
        value={value}
        onValueChange={(next) => onChange(pick(all, next, value))}
        className="gap-2 sm:grid-cols-2"
      >
        {options.map((o) => (
          <Label
            key={o.value}
            htmlFor={`${id}-${o.value}`}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 font-normal transition-colors duration-fast hover:bg-surface-hover has-[[data-checked]]:border-primary has-[[data-checked]]:bg-brand-subtle"
          >
            <RadioGroupItem
              value={o.value}
              id={`${id}-${o.value}`}
              aria-describedby={o.hint ? `${id}-${o.value}-hint` : undefined}
              className="mt-0.5"
            />
            <span className="min-w-0 space-y-0.5">
              <span className="block text-body font-medium text-foreground">{o.label}</span>
              {o.hint ? (
                <span id={`${id}-${o.value}-hint`} className="block text-caption text-pretty text-muted-foreground">
                  {o.hint}
                </span>
              ) : null}
            </span>
          </Label>
        ))}
      </RadioGroup>
    </div>
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
  const [mode, setMode] = useState<BallotMode>(() => pick(MODES, motion?.ballot_mode, "PUBLIC"));
  const [threshold, setThreshold] = useState<MotionThreshold>(() => pick(THRESHOLDS, motion?.threshold, "MAJORITY"));
  const [base, setBase] = useState<MotionBase>(() => pick(BASES, motion?.base, "PRESENT"));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;
  const canSubmit = canSubmitMotion(title, description);

  const submit = () => {
    if (!canSubmit || pending) return;
    setSubmitError(null);
    const body: MotionDraftInput = {
      title: title.trim(),
      description: description.trim(),
      ballot_mode: mode,
      threshold,
      base,
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
            <span id={`${titleId}-count`} className="text-caption tabular-nums text-muted-foreground">
              {title.length}/{MOTION_TITLE_MAX_LENGTH}
            </span>
          </div>
          <Textarea
            id={titleId}
            value={title}
            maxLength={MOTION_TITLE_MAX_LENGTH}
            rows={2}
            placeholder={t("meetings.governance.motionTitlePlaceholder")}
            aria-describedby={`${titleId}-count`}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor={descriptionId}>{t("meetings.governance.motionDescriptionLabel")}</Label>
            <span id={`${descriptionId}-count`} className="text-caption tabular-nums text-muted-foreground">
              {description.length}/{MOTION_DESCRIPTION_MAX_LENGTH}
            </span>
          </div>
          <Textarea
            id={descriptionId}
            value={description}
            maxLength={MOTION_DESCRIPTION_MAX_LENGTH}
            rows={3}
            aria-describedby={`${descriptionId}-count`}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <OptionGroup
          legend={t("meetings.governance.ballotModeLabel")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "PUBLIC", label: t("meetings.governance.ballotMode_PUBLIC") },
            {
              value: "SECRET",
              label: t("meetings.governance.ballotMode_SECRET"),
              hint: t("meetings.governance.secretHint"),
            },
          ]}
        />
        <OptionGroup
          legend={t("meetings.governance.thresholdLabel")}
          value={threshold}
          onChange={setThreshold}
          options={THRESHOLDS.map((v) => ({ value: v, label: t(`meetings.governance.threshold_${v}`) }))}
        />
        <OptionGroup
          legend={t("meetings.governance.baseLabel")}
          value={base}
          onChange={setBase}
          options={BASES.map((v) => ({ value: v, label: t(`meetings.governance.base_${v}`) }))}
        />
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
