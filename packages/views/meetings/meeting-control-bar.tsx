"use client";
import { useState, type MouseEventHandler, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  Captions,
  Circle,
  Hand,
  LayoutGrid,
  Mic,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  PhoneOff,
  Settings2,
  SmilePlus,
  Square,
  Video,
  VideoOff,
} from "lucide-react";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";
import { useStartRecording, useStopRecording } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingAdjustViewDialog } from "./meeting-adjust-view-dialog";
import { MeetingDevicesDialog } from "./meeting-devices-dialog";
import { REACTIONS } from "./meeting-signals";
import { useMeetingSignals } from "./use-meeting-signals";

/** Filled destructive — overrides outline/destructive variant tints on the bar. */
const SOLID_DESTRUCTIVE =
  "border-destructive !bg-destructive text-brand-foreground hover:!bg-destructive/90 focus-visible:border-destructive focus-visible:ring-destructive/30";

/** Idle icon chip — secondary fill in dark clears 3:1 on the muted bar. */
const MEETING_CONTROL_ICON =
  "size-11 shrink-0 rounded-xl border-input bg-background text-foreground hover:bg-muted hover:text-foreground dark:bg-secondary dark:hover:bg-surface-hover";

const MEETING_CONTROL_BAR =
  "pointer-events-auto flex items-center gap-2 rounded-2xl border border-surface-border bg-surface p-2 shadow-[var(--floating-shadow)] dark:border-input dark:bg-muted sm:p-2.5";

function IconControl({
  label,
  pressed,
  tone,
  onClick,
  disabled,
  children,
  accent,
}: {
  label: string;
  pressed?: boolean;
  tone?: "off" | "active" | "copilot";
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-lg"
            variant={
              tone === "off"
                ? "outline"
                : tone === "active"
                  ? "brand"
                  : tone === "copilot"
                    ? "default"
                    : pressed
                      ? "secondary"
                      : "outline"
            }
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            className={cn(
              "size-11 shrink-0 rounded-xl",
              tone === "off" && SOLID_DESTRUCTIVE,
              !tone &&
                "border-input bg-background text-foreground hover:bg-muted dark:bg-secondary dark:hover:bg-surface-hover",
              accent && "bg-brand text-brand-foreground hover:bg-brand/90",
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function MenuControl({
  caption,
  pressed,
  onClick,
  disabled,
  children,
}: {
  caption: string;
  pressed?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={pressed ? "secondary" : "ghost"}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="h-11 w-full justify-start gap-3"
    >
      {children}
      {caption}
    </Button>
  );
}

function DeviceSettingsControl({ inMenu = false }: { inMenu?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = t("meetings.devices");

  if (inMenu) {
    return (
      <MeetingDevicesDialog
        open={open}
        onOpenChange={setOpen}
        trigger={
          <DialogTrigger
            render={
              <Button type="button" variant="ghost" className="h-11 w-full justify-start gap-3" />
            }
          >
            <Settings2 aria-hidden />
            {label}
          </DialogTrigger>
        }
      />
    );
  }

  return (
    <MeetingDevicesDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Tooltip>
          <TooltipTrigger
            render={
              <DialogTrigger
                render={
                  <Button
                    type="button"
                    size="icon-lg"
                    variant="outline"
                    aria-label={label}
                    className={MEETING_CONTROL_ICON}
                  />
                }
              />
            }
          >
            <Settings2 aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="top">{label}</TooltipContent>
        </Tooltip>
      }
    />
  );
}

function AdjustViewControl({ inMenu = false }: { inMenu?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = t("meetings.adjustView");

  if (inMenu) {
    return (
      <MeetingAdjustViewDialog
        open={open}
        onOpenChange={setOpen}
        trigger={
          <DialogTrigger
            render={
              <Button type="button" variant="ghost" className="h-11 w-full justify-start gap-3" />
            }
          >
            <LayoutGrid aria-hidden />
            {label}
          </DialogTrigger>
        }
      />
    );
  }

  return (
    <MeetingAdjustViewDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Tooltip>
          <TooltipTrigger
            render={
              <DialogTrigger
                render={
                  <Button
                    type="button"
                    size="icon-lg"
                    variant="outline"
                    aria-label={label}
                    className={MEETING_CONTROL_ICON}
                  />
                }
              />
            }
          >
            <LayoutGrid aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="top">{label}</TooltipContent>
        </Tooltip>
      }
    />
  );
}

function ReactionsControl({ inMenu = false }: { inMenu?: boolean }) {
  const { t } = useTranslation();
  const { react } = useMeetingSignals();
  const [open, setOpen] = useState(false);
  const label = t("meetings.react");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {inMenu ? (
        <PopoverTrigger
          render={
            <Button type="button" variant="ghost" className="h-11 w-full justify-start gap-3" />
          }
        >
          <SmilePlus aria-hidden />
          {label}
        </PopoverTrigger>
      ) : (
        <PopoverTrigger
          render={
            <Button
              type="button"
              size="icon-lg"
              variant="outline"
              aria-label={label}
              className={MEETING_CONTROL_ICON}
            />
          }
        >
          <SmilePlus aria-hidden />
        </PopoverTrigger>
      )}
      <PopoverContent side="top" className="flex w-auto gap-1 p-1.5">
        {REACTIONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-label={r}
            className="flex size-10 items-center justify-center rounded-full text-title hover:bg-muted"
            onClick={() => {
              react(r);
              setOpen(false);
            }}
          >
            {r}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function MeetingControlBar({
  className,
  onLeave,
  meetingId,
  canHost = false,
  recordingEnabled = false,
  recording = false,
  captionsOn = false,
  captionsAvailable = false,
  onToggleCaptions,
  floating = false,
}: {
  className?: string;
  onLeave: () => void;
  meetingId?: string;
  canHost?: boolean;
  recordingEnabled?: boolean;
  recording?: boolean;
  captionsOn?: boolean;
  captionsAvailable?: boolean;
  onToggleCaptions?: () => void;
  floating?: boolean;
}) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const [moreOpen, setMoreOpen] = useState(false);
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const screen = useTrackToggle({ source: Track.Source.ScreenShare });
  const { handRaised, toggleHand } = useMeetingSignals();
  const startRec = useStartRecording(meetingId ?? "");
  const stopRec = useStopRecording(meetingId ?? "");
  const recPending = startRec.isPending || stopRec.isPending;
  const showCaptions = captionsAvailable && Boolean(onToggleCaptions);
  const showRecord = canHost && recordingEnabled && Boolean(meetingId);
  const secondaryInMenu = mobile;

  const captionsControl = (inMenu: boolean) =>
    showCaptions ? (
      inMenu ? (
        <MenuControl caption={t("meetings.captions")} pressed={captionsOn} onClick={onToggleCaptions}>
          <Captions aria-hidden />
        </MenuControl>
      ) : (
        <IconControl
          label={t("meetings.captions")}
          pressed={captionsOn}
          tone={captionsOn ? "active" : undefined}
          onClick={onToggleCaptions}
        >
          <Captions aria-hidden />
        </IconControl>
      )
    ) : null;

  const toggleRecording = () => {
    const m = recording ? stopRec : startRec;
    m.mutate(undefined, { onError: (err) => toastApiError(err, t("common.error")) });
  };

  const recordControl = (inMenu: boolean) =>
    showRecord ? (
      inMenu ? (
        <MenuControl
          caption={t("meetings.record")}
          pressed={recording}
          disabled={recPending}
          onClick={toggleRecording}
        >
          {recording ? <Square aria-hidden /> : <Circle aria-hidden />}
        </MenuControl>
      ) : (
        <IconControl
          label={t("meetings.record")}
          pressed={recording}
          tone={recording ? "off" : undefined}
          disabled={recPending}
          onClick={toggleRecording}
        >
          {recording ? <Square aria-hidden /> : <Circle aria-hidden />}
        </IconControl>
      )
    ) : null;

  return (
    <footer
      className={cn(
        floating
          ? "pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3 sm:bottom-4"
          : "shrink-0 bg-app-shell px-3 py-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] sm:px-4",
        className,
      )}
    >
      <TooltipProvider delay={300}>
        <div
          className={cn(
            MEETING_CONTROL_BAR,
            floating ? "max-w-3xl" : "w-full max-w-none border-0 bg-transparent p-0 shadow-none dark:border-0 dark:bg-transparent",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center justify-center gap-1 sm:gap-1.5">
            <IconControl
              label={t("meetings.mic")}
              pressed={mic.enabled}
              tone={mic.enabled ? "active" : "off"}
              disabled={mic.pending}
              onClick={() => {
                void mic.toggle();
              }}
            >
              {mic.enabled ? <Mic aria-hidden /> : <MicOff aria-hidden />}
            </IconControl>
            <IconControl
              label={t("meetings.camera")}
              pressed={camera.enabled}
              tone={camera.enabled ? "active" : "off"}
              disabled={camera.pending}
              onClick={() => {
                void camera.toggle();
              }}
            >
              {camera.enabled ? <Video aria-hidden /> : <VideoOff aria-hidden />}
            </IconControl>
            {!secondaryInMenu ? <DeviceSettingsControl /> : null}
            <IconControl
              label={t("meetings.share")}
              pressed={screen.enabled}
              tone={screen.enabled ? "active" : undefined}
              disabled={screen.pending}
              onClick={() => {
                void screen.toggle();
              }}
            >
              <MonitorUp aria-hidden />
            </IconControl>
            <IconControl
              label={t("meetings.hand")}
              pressed={handRaised}
              tone={handRaised ? "active" : undefined}
              onClick={toggleHand}
            >
              <Hand aria-hidden />
            </IconControl>
            {secondaryInMenu ? (
              <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <PopoverTrigger
                        render={
                          <Button
                            type="button"
                            size="icon-lg"
                            variant="outline"
                            aria-label={t("meetings.more")}
                            className={MEETING_CONTROL_ICON}
                          />
                        }
                      />
                    }
                  >
                    <MoreHorizontal aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent side="top">{t("meetings.more")}</TooltipContent>
                </Tooltip>
                <PopoverContent side="top" className="flex w-56 flex-col gap-0.5 p-1.5">
                  <DeviceSettingsControl inMenu />
                  <ReactionsControl inMenu />
                  <AdjustViewControl inMenu />
                  {captionsControl(true)}
                  {recordControl(true)}
                </PopoverContent>
              </Popover>
            ) : (
              <>
                <ReactionsControl />
                <AdjustViewControl />
                {captionsControl(false)}
                {recordControl(false)}
              </>
            )}
          </div>

          <span aria-hidden className="h-8 w-px shrink-0 bg-border dark:bg-input" />

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  onClick={onLeave}
                  aria-label={t("meetings.leave")}
                  className={cn(MEETING_CONTROL_ICON, SOLID_DESTRUCTIVE)}
                />
              }
            >
              <PhoneOff aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="top">{t("meetings.leave")}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </footer>
  );
}
