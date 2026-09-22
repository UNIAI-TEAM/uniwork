"use client";

import { useCallback, useEffect, useState } from "react";
import { Mic, MicOff, Video, VideoOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel, FieldTitle } from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";

type Device = { deviceId: string; label: string };

/**
 * Camera/mic inventory without a LiveKit room. Labels appear once a
 * permission is granted; `refresh` lets the caller re-list at that moment,
 * since not every browser fires `devicechange` for it.
 */
export function useMediaDevices(): {
  cameras: Device[];
  mics: Device[];
  refresh: () => void;
} {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const refresh = useCallback(() => {
    const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    md?.enumerateDevices?.().then(setDevices, () => undefined);
  }, []);
  useEffect(() => {
    const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    refresh();
    md.addEventListener?.("devicechange", refresh);
    return () => md.removeEventListener?.("devicechange", refresh);
  }, [refresh]);
  const pick = (kind: MediaDeviceKind): Device[] =>
    devices
      .filter((d) => d.kind === kind && d.deviceId)
      .map((d) => ({ deviceId: d.deviceId, label: d.label }));
  return { cameras: pick("videoinput"), mics: pick("audioinput"), refresh };
}

/**
 * Device picker for prejoin screens. Before the browser grants access every
 * device comes back with an empty id, so the list is empty — the field stays
 * and says why instead of vanishing.
 */
export function MeetingDeviceField({
  id,
  label,
  devices,
  value,
  onValueChange,
  emptyDescription,
}: {
  id: string;
  label: string;
  devices: Device[];
  value: string;
  onValueChange: (deviceId: string) => void;
  emptyDescription: string;
}) {
  const { t } = useTranslation();
  if (devices.length === 0) {
    return (
      <Field>
        <FieldTitle>{label}</FieldTitle>
        <FieldDescription className="text-caption">{emptyDescription}</FieldDescription>
      </Field>
    );
  }
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        id={id}
        value={value || devices[0]!.deviceId}
        onValueChange={(v) => v && onValueChange(v)}
        items={devices.map((d) => ({
          value: d.deviceId,
          label: d.label || t("meetings.deviceUnnamed"),
        }))}
      />
    </Field>
  );
}

/**
 * Toggle button: the name stays fixed, `aria-pressed` carries the state and
 * the tooltip names what a click will do.
 */
export function MeetingMediaToggle({
  on,
  label,
  tooltip,
  onClick,
  children,
}: {
  on: boolean;
  label: string;
  tooltip: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-lg"
            variant={on ? "outline" : "destructive"}
            aria-label={label}
            aria-pressed={on}
            onClick={onClick}
            className="rounded-full shadow-surface"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function MeetingMediaControlBar({
  audio,
  video,
  onAudioToggle,
  onVideoToggle,
  micLabel,
  cameraLabel,
  className,
}: {
  audio: boolean;
  video: boolean;
  onAudioToggle: () => void;
  onVideoToggle: () => void;
  micLabel: string;
  cameraLabel: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={className}>
      <MeetingMediaToggle
        on={audio}
        label={micLabel}
        tooltip={audio ? t("meetings.micOff") : t("meetings.micOn")}
        onClick={onAudioToggle}
      >
        {audio ? <Mic aria-hidden /> : <MicOff aria-hidden />}
      </MeetingMediaToggle>
      <MeetingMediaToggle
        on={video}
        label={cameraLabel}
        tooltip={video ? t("meetings.cameraOff") : t("meetings.cameraOn")}
        onClick={onVideoToggle}
      >
        {video ? <Video aria-hidden /> : <VideoOff aria-hidden />}
      </MeetingMediaToggle>
    </div>
  );
}
