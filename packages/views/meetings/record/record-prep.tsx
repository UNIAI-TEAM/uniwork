"use client";
import { useEffect, useId, useState } from "react";
import { ArrowLeft, Check, Mic, MicOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Field, FieldLabel } from "@uniwork/ui/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { useMediaQuery } from "@uniwork/ui/hooks/use-media-query";
import { MeetingCanvas } from "../meeting-canvas";
import { formatMeetingWindow, meetingLocale } from "../meeting-datetime";
import { MeetingDeviceField } from "../meeting-device-field";
import { MeetingMediaToggle, type MediaDevice } from "../meeting-media-controls";
import { MeetingMediaPermissionAction, MeetingMicLevel } from "../meeting-room-mic-check";
import { NARROW, RecordWave } from "./record-wave";
import { useMicLevels } from "./use-mic-levels";

export type RecordLanguage = "vi" | "en";

/**
 * Before recording an in-person meeting (board 4): the pre-join screen with
 * the camera swapped for the microphone. The chosen microphone is heard live,
 * the language and device are fixed when recording starts, and it cannot
 * start until the person confirms the attendees were told.
 */
export function RecordPrep({
  meeting,
  mics,
  onDevicesGranted,
  deviceId,
  onDeviceChange,
  language,
  onLanguageChange,
  failed = false,
  ready = true,
  liveElsewhere = false,
  onStart,
  onBack,
}: {
  meeting?: Meeting;
  mics: MediaDevice[];
  /** The browser granted the microphone: device labels can be listed now. */
  onDevicesGranted: () => void;
  /** The microphone chosen, or the first one listed. */
  deviceId?: string;
  onDeviceChange: (deviceId: string) => void;
  language: RecordLanguage;
  onLanguageChange: (language: RecordLanguage) => void;
  /** The last start could not open the microphone. */
  failed?: boolean;
  /** Recordings already on this device are known: starting before then would restart their offsets at 0. */
  ready?: boolean;
  /** Another tab of this device is recording this meeting: a second recording would overlap it. */
  liveElsewhere?: boolean;
  onStart: () => void;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [consent, setConsent] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const stream = usePreviewStream(micOn, deviceId, onDevicesGranted);
  // 38 bars fill the frame on a desk; a phone's frame holds 30.
  const levels = useMicLevels(stream, useMediaQuery(NARROW) ? 30 : 38);
  const track = stream?.getAudioTracks()[0];

  return (
    <MeetingCanvas className="overflow-y-auto">
      <header className="flex h-14 shrink-0 items-center gap-3 px-3 sm:px-4">
        <Button type="button" variant="ghost" onClick={onBack} className="gap-1.5 px-2 text-muted-foreground">
          <ArrowLeft aria-hidden className="size-4" />
          {t("common.back")}
        </Button>
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-stretch gap-6 px-4 pb-8 lg:my-auto lg:flex-none lg:flex-row lg:items-start lg:gap-8">
        <div className="w-full min-w-0 rounded-2xl bg-meeting-stage p-3 ring-1 ring-surface-border lg:flex-1">
          <div className="dark flex aspect-video min-h-[22rem] w-full flex-col items-center justify-center gap-[26px] overflow-hidden rounded-xl text-foreground">
            <div aria-hidden className="relative grid size-[184px] shrink-0 place-items-center">
              <span className="absolute inset-0 rounded-full bg-primary/10" />
              <span className="absolute inset-[26px] rounded-full bg-primary/20" />
              {/* White in both modes, as board 4: the dark scheme's primary-foreground is near black. */}
              <span className="relative grid size-24 place-items-center rounded-full bg-primary text-on-solid">
                <Mic className="size-10" />
              </span>
            </div>
            <RecordWave levels={levels} min={8} span={52} className="h-[60px] gap-1" barClassName="w-[5px]" />
            {track ? (
              <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-meeting-bar-chip-bg px-3 text-label font-medium text-meeting-bar-foreground">
                <Check aria-hidden className="size-4 text-success" />
                {t("meetings.record.micOk")}
              </span>
            ) : null}
          </div>
          <div className="mt-3 flex justify-center">
            <MeetingMediaToggle
              on={micOn}
              label={t("meetings.deviceMic")}
              tooltip={micOn ? t("meetings.micOff") : t("meetings.micOn")}
              onClick={() => setMicOn((on) => !on)}
            >
              {micOn ? <Mic aria-hidden /> : <MicOff aria-hidden />}
            </MeetingMediaToggle>
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-surface lg:mx-0 lg:w-80">
          <div aria-busy={!meeting || undefined}>
            <p className="text-overline text-muted-foreground">{t("meetings.record.ready")}</p>
            {meeting ? (
              <>
                <h1 className="mt-1 text-pretty text-title font-semibold text-foreground">{meeting.title}</h1>
                <p className="mt-1 text-label tabular-nums text-muted-foreground">
                  {formatMeetingWindow(meeting.starts_at, meeting.ends_at, meetingLocale(i18n.language), t)}
                </p>
              </>
            ) : (
              <>
                <Skeleton className="mt-2 h-6 w-4/5" />
                <Skeleton className="mt-2 h-4 w-3/5" />
                <span className="sr-only">{t("common.loading")}</span>
              </>
            )}
          </div>
          <MeetingDeviceField
            id={`${id}-mic`}
            label={t("meetings.deviceMic")}
            devices={mics}
            value={deviceId ?? ""}
            onValueChange={onDeviceChange}
            emptyDescription={t("meetings.deviceMicNeedsPermission")}
            emptyAction={
              <MeetingMediaPermissionAction
                label={t("meetings.micAllow")}
                icon={Mic}
                deniedMessage={t("meetings.micAllowDenied")}
                onGranted={onDevicesGranted}
              />
            }
          >
            {track ? <MeetingMicLevel track={track} className="mt-1" /> : null}
          </MeetingDeviceField>
          <Field>
            <FieldLabel id={`${id}-language`}>{t("meetings.transcription.languageLabel")}</FieldLabel>
            <RadioGroup
              aria-labelledby={`${id}-language`}
              value={language}
              onValueChange={(v) => onLanguageChange(v === "en" ? "en" : "vi")}
              className="flex gap-4"
            >
              {(["vi", "en"] as const).map((l) => (
                <label key={l} className="flex items-center gap-2 text-body text-foreground">
                  <RadioGroupItem value={l} />
                  {t(`meetings.transcription.language_${l}`)}
                </label>
              ))}
            </RadioGroup>
          </Field>
          <label className="flex items-start gap-2 text-body text-foreground">
            <Checkbox
              checked={consent}
              onCheckedChange={(next) => setConsent(next === true)}
              aria-required
              aria-describedby={`${id}-consent-hint`}
            />
            <span>
              {t("meetings.transcription.consent")}
              <span id={`${id}-consent-hint`} className="mt-0.5 block text-caption text-muted-foreground">
                {t("meetings.transcription.consentHint")}
              </span>
            </span>
          </label>
          <Button
            type="button"
            variant="brand"
            className="h-11 w-full"
            aria-disabled={!consent || !ready || liveElsewhere || undefined}
            aria-busy={!ready || undefined}
            aria-describedby={[consent ? "" : `${id}-reason`, liveElsewhere ? `${id}-live` : ""].join(" ").trim() || undefined}
            onClick={onStart}
          >
            <Mic aria-hidden />
            {t("meetings.venue.startRecording")}
          </Button>
          {failed ? (
            <p role="alert" className="-mt-2 text-caption text-destructive">
              {t("meetings.micAllowDenied")}
            </p>
          ) : null}
          {consent ? null : (
            <p id={`${id}-reason`} className="-mt-2 text-caption text-muted-foreground">
              {t("meetings.record.consentFirst")}
            </p>
          )}
          {liveElsewhere ? (
            <p id={`${id}-live`} className="-mt-2 text-caption text-muted-foreground">
              {t("meetings.record.liveElsewhere")}
            </p>
          ) : null}
          <p className="text-caption text-muted-foreground">{t("meetings.record.placementHint")}</p>
        </div>
      </div>
    </MeetingCanvas>
  );
}

/** The chosen microphone, opened for the level meter and the wave while `on`; released on change. */
function usePreviewStream(on: boolean, deviceId: string | undefined, onGranted: () => void): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(null);
  useEffect(() => {
    const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!on || !md?.getUserMedia) return;
    let cancelled = false;
    let opened: MediaStream | null = null;
    md.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true }).then(
      (s) => {
        opened = s;
        if (cancelled) return void s.getTracks().forEach((track) => track.stop());
        setStream(s);
        onGranted();
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      opened?.getTracks().forEach((track) => track.stop());
      setStream(null);
    };
  }, [on, deviceId, onGranted]);
  return stream;
}
