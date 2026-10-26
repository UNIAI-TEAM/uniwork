"use client";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  useMeetingCapabilities,
  useOlderTranscript,
  useSetMeetingAISharing,
  useSetMeetingScribe,
  useTranscript,
} from "@uniwork/core/meetings";
import { scribePolicyOf } from "@uniwork/core/types";
import { FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { toastApiError } from "../../../toast-api-error";
import { useDetail } from "../detail-context";
import { RailProp } from "../ui/rail";
import { isLive } from "./rail-model";
import { RailPopover, useRailPopover } from "./rail-popover";
import { ScribeGlyph } from "@uniwork/ui/brand/scribe-mark";

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
    <div className="flex min-h-11 items-start justify-between gap-3 py-1.5">
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

/** "● Đang nghe · 15 câu": the count only once the whole transcript is in the window. */
function Listening() {
  const { t } = useTranslation();
  const { meeting, aiReadable } = useDetail();
  const { data: lines } = useTranscript(meeting.id, aiReadable);
  const { hasOlder } = useOlderTranscript(meeting.id, aiReadable);
  const count = aiReadable && lines && !hasOlder ? lines.length : 0;
  return (
    <>
      <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full bg-success align-[2px]" />
      {count > 0 ? t("meetings.detail.rail.aiListeningCount", { count }) : t("meetings.detail.rail.aiListening")}
    </>
  );
}

/**
 * The rail's "Thư ký UNI" row (UNI-1995 access). Before and after the meeting
 * it reads "Bật · chỉ người dự họp" and, for whoever may flip something —
 * the host's scribe switch before the end, a clerk's sharing switch — opens
 * a popover with the switches. While live it says the scribe is listening.
 */
export function RailAiRow() {
  const { t } = useTranslation();
  const id = useId();
  const { workspaceId, meeting, displayStatus, canHost, isClerk } = useDetail();
  const popover = useRailPopover();
  const { data: caps } = useMeetingCapabilities(workspaceId);
  const setScribe = useSetMeetingScribe(meeting.id);
  const setShared = useSetMeetingAISharing(meeting.id);
  const policyOff = scribePolicyOf(caps?.scribe_policy) === "off";
  const scribeOn = meeting.scribe_enabled !== false && !policyOff;
  const live = isLive(displayStatus);
  const open = displayStatus === "SCHEDULED" || live;
  const showScribe = canHost && open && (caps?.scribe === true || policyOff);
  const canShare = isClerk && scribeOn;
  const opens = !live && (showScribe || canShare);
  const failed = (err: unknown) => toastApiError(err, t("meetings.aiAccess.saveFailed"));

  const audience = t(meeting.ai_content_shared === true ? "meetings.detail.rail.aiWorkspace" : "meetings.detail.rail.aiMembers");
  const value = !scribeOn ? (
    <span className="text-muted-foreground">{t("meetings.detail.rail.aiOff")}</span>
  ) : live ? (
    <Listening />
  ) : (
    t("meetings.detail.rail.aiOn", { audience })
  );

  return (
    <div ref={popover.anchor}>
      <RailProp
        icon={ScribeGlyph}
        label={t("meetings.detail.rail.ai")}
        value={value}
        onClick={opens ? popover.toggle : undefined}
        ariaLabel={
          opens
            ? t(scribeOn ? "meetings.detail.rail.aiAriaOn" : "meetings.detail.rail.aiAriaOff", { audience })
            : undefined
        }
      />
      {opens ? (
        <RailPopover state={popover} title={t("meetings.aiAccess.title")}>
          {showScribe && policyOff ? (
            <p className="py-1.5 text-caption text-muted-foreground" data-testid="meeting-scribe-off-by-policy">
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
          {canShare ? (
            <SwitchRow
              id={`${id}-share`}
              label={t("meetings.aiAccess.shareLabel")}
              hint={t("meetings.aiAccess.shareHint")}
              checked={meeting.ai_content_shared === true}
              busy={setShared.isPending}
              onChange={(next) => setShared.mutate(next, { onError: failed })}
            />
          ) : null}
        </RailPopover>
      ) : null}
    </div>
  );
}
