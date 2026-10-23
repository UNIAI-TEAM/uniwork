"use client";
import { useId, useRef, useState, type ReactElement } from "react";
import { Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCreateMeeting, useMeetingCapabilities } from "@uniwork/core/meetings";
import { scribePolicyOf } from "@uniwork/core/types";
import { useAuthStore } from "@uniwork/core/auth";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { toast } from "sonner";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
import { Notice } from "../common/notice";
import { toastApiError } from "../toast-api-error";
import {
  defaultScheduleDraft,
  scheduleDraftFromDefaults,
  scheduleWindowIso,
  type ScheduleDraft,
} from "./meeting-datetime";
import { ProjectSelect, useProjectsAvailable } from "../projects/components/project-select";
import { MemberMultiPicker } from "./member-multi-picker";
import { useNow } from "./use-now";
import {
  browserTimeZone,
  focusScheduleProblem,
  MeetingScheduleFields,
  scheduleProblems,
  scheduleReady,
} from "./meeting-schedule-fields";

export function NewMeetingDialog({
  workspaceId,
  onCreated,
  trigger,
  scheduleDefaults,
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: {
  workspaceId: string;
  onCreated?: (id: string) => void;
  trigger?: ReactElement;
  /** Local wall date/times; same shape as `defaultScheduleDraft`. */
  scheduleDefaults?: ScheduleDraft;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const userId = useAuthStore((s) => s.user?.id);
  const create = useCreateMeeting(workspaceId);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => scheduleDraftFromDefaults(scheduleDefaults).date);
  const [start, setStart] = useState(() => scheduleDraftFromDefaults(scheduleDefaults).start);
  const [end, setEnd] = useState(() => scheduleDraftFromDefaults(scheduleDefaults).end);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [allowJoin, setAllowJoin] = useState(true);
  // The "Thư ký AI" switch starts where the organization's policy starts a
  // meeting (opt_in: off) until the person touches it (UNI-1995 access).
  const { data: caps } = useMeetingCapabilities(workspaceId);
  const scribeOffered = caps?.scribe === true;
  const [scribeChoice, setScribeChoice] = useState<boolean | null>(null);
  const scribeOn = scribeChoice ?? scribePolicyOf(caps?.scribe_policy) !== "opt_in";
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const projectsAvailable = useProjectsAvailable();
  const [submitted, setSubmitted] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    const next = defaultScheduleDraft();
    setTitle("");
    setDescription("");
    setDate(next.date);
    setStart(next.start);
    setEnd(next.end);
    setAttendees([]);
    setAllowJoin(true);
    setScribeChoice(null);
    setProjectId(undefined);
    setSubmitted(false);
  };

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      const draft = scheduleDraftFromDefaults(scheduleDefaults);
      setDate(draft.date);
      setStart(draft.start);
      setEnd(draft.end);
    } else {
      reset();
    }
  };

  const titleMissing = !title.trim();
  const nowMs = useNow();
  const problems = scheduleProblems({ date, start, end, nowMs });
  // The action stays enabled: a disabled button explains nothing. Submitting
  // puts the reason on the field and moves focus there.
  const showTitleError = titleMissing && submitted;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {showTrigger ? (
        <DialogTrigger render={trigger ?? <Button size="sm">{t("meetings.new")}</Button>} />
      ) : null}
      <FormDialogContent size="lg">
        <FormDialogHeader title={t("meetings.new")} description={t("meetings.newDescription")} />
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            if (titleMissing) {
              titleRef.current?.focus();
              return;
            }
            // The render-time check can be a tick old: the start may have
            // slipped into the past while the dialog sat open.
            const atSubmit = scheduleProblems({ date, start, end, nowMs: Date.now() });
            if (!scheduleReady(date, atSubmit)) {
              focusScheduleProblem(id, atSubmit);
              return;
            }
            const slot = scheduleWindowIso(date, start, end);
            create.mutate(
              {
                title,
                description,
                starts_at: slot.starts_at,
                ends_at: slot.ends_at,
                timezone: browserTimeZone(),
                allow_join_request: allowJoin,
                attendee_user_ids: attendees,
                ...(projectId ? { project_id: projectId } : {}),
                ...(scribeOffered ? { scribe: scribeOn } : {}),
              },
              {
                onSuccess: (m) => {
                  if (!m) {
                    toast.error(t("common.error"));
                    return;
                  }
                  changeOpen(false);
                  toast.success(t("meetings.created"));
                  if (scribeOffered && (m.scribe_enabled !== false) !== scribeOn) {
                    toast.warning(t("meetings.scribe.createdScribeNotSet"));
                  }
                  onCreated?.(m.id);
                },
                onError: (err) => toastApiError(err, t("common.error")),
              },
            );
          }}
        >
          <FormDialogBody>
            <FieldGroup className="gap-4">
              <Field data-invalid={showTitleError || undefined}>
                <FieldLabel htmlFor={`${id}-title`}>{t("meetings.meetingTitle")}</FieldLabel>
                <Input
                  ref={titleRef}
                  id={`${id}-title`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  autoFocus
                  aria-invalid={showTitleError || undefined}
                  aria-describedby={showTitleError ? `${id}-title-error` : undefined}
                />
                {showTitleError ? <FieldError id={`${id}-title-error`}>{t("meetings.titleRequired")}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-desc`}>{t("meetings.description")}</FieldLabel>
                <Textarea
                  id={`${id}-desc`}
                  className="field-sizing-fixed max-h-24 resize-none"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </Field>
              {projectsAvailable ? (
                <Field>
                  <FieldLabel htmlFor={`${id}-project`}>{t("meetings.project")}</FieldLabel>
                  <ProjectSelect
                    id={`${id}-project`}
                    workspaceId={workspaceId}
                    value={projectId}
                    onChange={setProjectId}
                    noneLabel={t("meetings.projectNone")}
                    ariaLabel={t("meetings.project")}
                  />
                </Field>
              ) : null}
              <MeetingScheduleFields
                idPrefix={id}
                date={date}
                start={start}
                end={end}
                onDate={setDate}
                onStart={setStart}
                onEnd={setEnd}
              />
              <Field aria-labelledby={`${id}-attendees`}>
                <FieldLabel id={`${id}-attendees`}>{t("meetings.attendees")}</FieldLabel>
                <FieldDescription>{t("meetings.youAreHost")}</FieldDescription>
                <MemberMultiPicker
                  workspaceId={workspaceId}
                  value={attendees}
                  onChange={setAttendees}
                  excludeUserIds={userId ? [userId] : []}
                  searchable
                  autoFocusSearch={false}
                />
              </Field>
              <div className="flex min-h-11 items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <FieldLabel id={`${id}-allow-join-label`} htmlFor={`${id}-allow-join`}>
                    {t("meetings.allowJoinRequest")}
                  </FieldLabel>
                  <FieldDescription id={`${id}-allow-join-hint`}>
                    {t("meetings.allowJoinRequestHint")}
                  </FieldDescription>
                </div>
                <Switch
                  id={`${id}-allow-join`}
                  aria-labelledby={`${id}-allow-join-label`}
                  aria-describedby={`${id}-allow-join-hint`}
                  className="mt-0.5 shrink-0"
                  checked={allowJoin}
                  onCheckedChange={setAllowJoin}
                />
              </div>
              {scribeOffered ? (
                <div className="flex min-h-11 items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <FieldLabel id={`${id}-scribe-label`} htmlFor={`${id}-scribe`}>
                      {t("meetings.scribe.formLabel")}
                    </FieldLabel>
                    <FieldDescription id={`${id}-scribe-hint`}>{t("meetings.scribe.formHint")}</FieldDescription>
                  </div>
                  <Switch
                    id={`${id}-scribe`}
                    aria-labelledby={`${id}-scribe-label`}
                    aria-describedby={`${id}-scribe-hint`}
                    className="mt-0.5 shrink-0"
                    checked={scribeOn}
                    onCheckedChange={setScribeChoice}
                  />
                </div>
              ) : null}
              <Notice tone="info" icon={Link2} layout="inline" live="off">
                {t("meetings.externalGuestLinkAfterCreate")}
              </Notice>
            </FieldGroup>
          </FormDialogBody>
          <FormDialogFooter
            onCancel={() => changeOpen(false)}
            submitType="submit"
            submitLabel={t("meetings.createSubmit")}
            submittingLabel={t("meetings.creating")}
            submitting={create.isPending}
          />
        </form>
      </FormDialogContent>
    </Dialog>
  );
}
