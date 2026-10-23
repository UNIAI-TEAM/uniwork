"use client";
import { useId } from "react";
import { Lock, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingCapabilities, useSetMeetingAISharing, useSetMeetingScribe } from "@uniwork/core/meetings";
import { scribePolicyOf, type Meeting } from "@uniwork/core/types";
import { FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { PanelCard } from "../common/panel-card";
import { toastApiError } from "../toast-api-error";

function SwitchRow({
  id,
  label,
  hint,
  checked,
  busy,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex min-h-11 items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <FieldLabel id={`${id}-label`} htmlFor={id}>
          {label}
        </FieldLabel>
        <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>
      </div>
      <Switch
        id={id}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        className="mt-0.5 shrink-0 aria-busy:opacity-60"
        checked={checked}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        onCheckedChange={(next) => {
          // One write at a time.
          if (!busy) onChange(next === true);
        }}
      />
    </div>
  );
}

/**
 * The meeting page's AI controls (UNI-1995 access): the host's "Thư ký AI"
 * switch before and during the meeting (the room chip's switch, reachable
 * without joining), and a clerk's switch that shares the AI content with the
 * whole workspace. Nothing for anyone who can flip neither.
 */
export function MeetingAIAccessCard({
  workspaceId,
  meeting,
  canHost,
  canClerk,
}: {
  workspaceId: string;
  meeting: Meeting;
  /** Host or workspace admin: the scribe switch (PUT /scribe). */
  canHost: boolean;
  /** Host, secretary or workspace admin: the sharing switch. */
  canClerk: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { data: caps } = useMeetingCapabilities(workspaceId);
  const setScribe = useSetMeetingScribe(meeting.id);
  const setShared = useSetMeetingAISharing(meeting.id);
  const policyOff = scribePolicyOf(caps?.scribe_policy) === "off";
  const open = !meeting.status || meeting.status === "SCHEDULED" || meeting.status === "IN_PROGRESS";
  const showScribe = canHost && open && (caps?.scribe === true || policyOff);
  if (!showScribe && !canClerk) return null;
  const failed = (err: unknown) => toastApiError(err, t("meetings.aiAccess.saveFailed"));
  return (
    <PanelCard title={t("meetings.aiAccess.title")} icon={Sparkles}>
      <div className="flex flex-col gap-4">
        {showScribe && policyOff ? (
          <p className="text-caption text-muted-foreground" data-testid="meeting-scribe-off-by-policy">
            {t("meetings.aiAccess.scribeOffByPolicy")}
          </p>
        ) : null}
        {showScribe && !policyOff ? (
          <SwitchRow
            id={`${id}-scribe`}
            label={t("meetings.aiAccess.scribeLabel")}
            hint={t("meetings.aiAccess.scribeHint")}
            checked={meeting.scribe_enabled !== false}
            busy={setScribe.isPending}
            onChange={(next) => setScribe.mutate(next, { onError: failed })}
          />
        ) : null}
        {canClerk ? (
          <SwitchRow
            id={`${id}-share`}
            label={t("meetings.aiAccess.shareLabel")}
            hint={t("meetings.aiAccess.shareHint")}
            checked={meeting.ai_content_shared === true}
            busy={setShared.isPending}
            onChange={(next) => setShared.mutate(next, { onError: failed })}
          />
        ) : null}
      </div>
    </PanelCard>
  );
}

/** What a workspace member outside the meeting sees where the summary and the transcript would be. */
export function MeetingAIRestrictedNotice() {
  const { t } = useTranslation();
  return (
    <PanelCard title={t("meetings.aiAccess.restrictedTitle")} icon={Lock}>
      <p className="text-body text-muted-foreground" data-testid="meeting-ai-restricted">
        {t("meetings.aiAccess.restrictedBody")}
      </p>
    </PanelCard>
  );
}
