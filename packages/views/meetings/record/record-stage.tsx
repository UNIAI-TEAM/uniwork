"use client";
import { useState } from "react";
import { Check, MicOff, Pause, Play, Settings, Square, Sun, UsersRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatVoiceCallDuration } from "@uniwork/core/chat/voice-call-duration";
import type { RecorderState } from "@uniwork/core/meetings/recorder";
import type { Meeting } from "@uniwork/core/types";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { useMediaQuery } from "@uniwork/ui/hooks/use-media-query";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../../navigation";
import { IconControl, MEETING_CHIP, MenuControl } from "../meeting-control";
import { MEETING_DARK_BAR } from "../meeting-dark-bar";
import { formatMeetingWindow, meetingLocale } from "../meeting-datetime";
import type { MediaDevice } from "../meeting-media-controls";
import { NARROW, RecordWave } from "./record-wave";
import { useMicLevels } from "./use-mic-levels";

/** Pause / resume is the bar's main control: a lighter fill than the device chip beside it (board 13). */
const PRIMARY_CHIP = "bg-meeting-bar-chip-hover hover:brightness-125";
const CHIP = "inline-flex h-7 items-center gap-1.5 rounded-full bg-meeting-bar-chip-bg px-2.5 text-caption font-medium text-meeting-bar-foreground";

/**
 * Recording an in-person meeting (board 5, 13 right): the live room's stage
 * frame, header and control bar, with the camera tile replaced by the clock
 * and the wave. An interruption takes the tile's place with the way forward.
 */
export function RecordStage({
  meeting,
  workspaceLabel,
  meetingsHref,
  state,
  elapsedMs,
  stream,
  wakeLockHeld,
  people,
  mics,
  deviceId,
  onPause,
  onResume,
  onResumeAfterInterrupt,
  onDeviceChange,
  onEnd,
}: {
  meeting?: Meeting;
  workspaceLabel?: string;
  meetingsHref?: string;
  state: RecorderState;
  /** Recorded time, earlier parts on this device included. */
  elapsedMs: number;
  stream: MediaStream | null;
  wakeLockHeld: boolean;
  /** Attendees on the roster, when known. */
  people?: number;
  mics: MediaDevice[];
  deviceId?: string;
  onPause: () => void;
  onResume: () => void;
  onResumeAfterInterrupt: () => void;
  onDeviceChange: (deviceId: string) => void;
  onEnd: () => void;
}) {
  const { t, i18n } = useTranslation();
  const narrow = useMediaQuery(NARROW);
  const paused = state === "paused";
  const interrupted = state === "interrupted";
  const levels = useMicLevels(stream, narrow ? 34 : 64);
  const clock = formatVoiceCallDuration(elapsedMs / 1000);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-app-shell px-3 pt-2 pb-3">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-meeting-stage ring-1 ring-surface-border">
        <div className="dark flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="@container/stagehead relative z-20 shrink-0 border-b border-meeting-bar-border bg-meeting-stage px-3 py-2 sm:px-4 sm:py-2.5">
            <div className="grid gap-1.5 @2xl/stagehead:grid-cols-[minmax(14rem,1fr)_auto] @2xl/stagehead:items-center @2xl/stagehead:gap-x-3">
              <div className="min-w-0">
                {meetingsHref ? (
                  <nav aria-label={t("meetings.title")} className="mb-0.5 truncate text-caption text-meeting-bar-muted-foreground">
                    {workspaceLabel ? (
                      <>
                        <span>{workspaceLabel}</span>
                        <span aria-hidden className="mx-1.5 opacity-60">/</span>
                      </>
                    ) : null}
                    <AppLink href={meetingsHref} className="hover:text-meeting-bar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {t("meetings.title")}
                    </AppLink>
                  </nav>
                ) : null}
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <h1 data-stage-heading className="min-w-0 max-w-full truncate text-title-sm font-semibold text-meeting-bar-foreground">
                    {meeting?.title ?? t("meetings.title")}
                  </h1>
                  {meeting ? (
                    <time dateTime={`${meeting.starts_at}/${meeting.ends_at}`} className="min-w-0 truncate text-caption tabular-nums text-meeting-bar-muted-foreground">
                      {formatMeetingWindow(meeting.starts_at, meeting.ends_at, meetingLocale(i18n.language), t)}
                    </time>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 @2xl/stagehead:justify-end sm:gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-meeting-bar-border bg-background px-2.5 py-1 text-caption font-semibold text-foreground">
                  <Check aria-hidden className="size-3.5 shrink-0 text-success" />
                  {t("meetings.record.saved")}
                </span>
                <Button type="button" variant="destructiveSolid" size="sm" className="h-8 px-2.5 font-semibold" onClick={onEnd}>
                  {t("meetings.record.end")}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 pb-2 sm:px-4">
            {/* Sized against its own box: 16:9 at the largest that fits, the whole box on a phone. */}
            <div className="grid min-h-0 flex-1 place-items-center [container-type:size]">
              <div
                className="flex size-full flex-col items-center justify-center gap-5 overflow-hidden rounded-2xl text-meeting-stage-foreground ring-1 ring-meeting-bar-border min-[600px]:aspect-video min-[600px]:h-auto min-[600px]:w-[min(100cqw,calc(100cqh*16/9))] min-[600px]:gap-7"
              >
                {interrupted ? (
                  <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
                    <IconTile icon={MicOff} size="lg" tone="destructive" />
                    {/* The message alone is announced; the buttons are what to do about it. */}
                    <div role="alert" className="flex flex-col items-center gap-3">
                      <h2 className="text-title font-semibold">{t("meetings.record.interrupted")}</h2>
                      <p className="text-body text-meeting-bar-muted-foreground">{t("meetings.record.savedUpTo", { time: clock })}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap justify-center gap-2">
                      <Button type="button" variant="brand" onClick={onResumeAfterInterrupt}>
                        <Play aria-hidden />
                        {t("meetings.record.resume")}
                      </Button>
                      <Button type="button" variant="ghost" onClick={onEnd}>
                        {t("meetings.record.endAndSend")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p role="status" className={cn("flex items-center gap-2.5 text-body font-semibold", paused ? "text-warning" : "text-destructive")}>
                      {paused ? (
                        <Pause aria-hidden className="size-4" />
                      ) : (
                        <span aria-hidden className="size-2.5 rounded-full bg-destructive ring-[5px] ring-destructive/20" />
                      )}
                      {t(paused ? "meetings.record.paused" : "meetings.record.recording")}
                    </p>
                    <p
                      role="timer"
                      className={cn(
                        "font-heading text-[96px] leading-none font-bold tracking-[-0.045em] tabular-nums min-[600px]:text-[168px]",
                        paused && "text-warning",
                      )}
                    >
                      {clock}
                    </p>
                    <RecordWave
                      levels={levels}
                      flat={paused}
                      min={10}
                      span={narrow ? 70 : 110}
                      className={narrow ? "h-[90px] gap-1" : "h-[130px] gap-[5px]"}
                      barClassName={narrow ? "w-[5px]" : "w-1.5"}
                    />
                    <div className="flex flex-wrap justify-center gap-2 px-4">
                      <span className={CHIP}>
                        <Check aria-hidden className="size-3.5 text-success" />
                        {t("meetings.record.saved")}
                      </span>
                      {wakeLockHeld ? (
                        <span className={CHIP}>
                          <Sun aria-hidden className="size-3.5" />
                          {t("meetings.record.screenOn")}
                        </span>
                      ) : null}
                      {people ? (
                        <span className={CHIP}>
                          <UsersRound aria-hidden className="size-3.5" />
                          {t("meetings.record.people", { count: people })}
                        </span>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 justify-center pt-6 pb-3">
            <div className={MEETING_DARK_BAR}>
              {interrupted ? null : paused ? (
                <IconControl label={t("meetings.record.resume")} onClick={onResume} className={PRIMARY_CHIP}>
                  <Play aria-hidden />
                </IconControl>
              ) : (
                <IconControl label={t("meetings.record.pause")} onClick={onPause} className={PRIMARY_CHIP}>
                  <Pause aria-hidden />
                </IconControl>
              )}
              {/* A phone has one microphone to speak of; the room's bar drops its device control there too. */}
              {narrow ? null : <DeviceControl mics={mics} deviceId={deviceId} onDeviceChange={onDeviceChange} />}
              {interrupted && narrow ? null : <span aria-hidden className="mx-0.5 h-8 w-px shrink-0 bg-meeting-bar-border" />}
              <IconControl tone="off" label={t("meetings.record.end")} onClick={onEnd}>
                <Square aria-hidden className="size-3 fill-current" />
              </IconControl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeviceControl({ mics, deviceId, onDeviceChange }: { mics: MediaDevice[]; deviceId?: string; onDeviceChange: (deviceId: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = deviceId ?? mics[0]?.deviceId;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" size="icon-lg" variant="meetingChip" aria-label={t("meetings.record.device")} className={MEETING_CHIP} />}>
        <Settings aria-hidden />
      </PopoverTrigger>
      {/* `dark`: the popup portals to <body>, away from the dark stage it belongs to. */}
      <PopoverContent side="top" className="dark flex w-72 flex-col gap-1 p-1.5">
        {mics.map((mic) => (
          <MenuControl
            key={mic.deviceId}
            caption={mic.label || t("meetings.deviceUnnamed")}
            pressed={mic.deviceId === current}
            onClick={() => {
              setOpen(false);
              if (mic.deviceId !== current) onDeviceChange(mic.deviceId);
            }}
          >
            {mic.deviceId === current ? <Check aria-hidden /> : <span aria-hidden className="size-4" />}
          </MenuControl>
        ))}
      </PopoverContent>
    </Popover>
  );
}
