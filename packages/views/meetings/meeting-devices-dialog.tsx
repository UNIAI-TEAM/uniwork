"use client";

import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMediaDeviceSelect, useRoomContext } from "@livekit/components-react";
import {
  Ban,
  Check,
  Droplets,
  ImageIcon,
  RefreshCw,
  Upload,
} from "lucide-react";
import {
  useMeetingRoomPreferencesStore,
  type MeetingBackgroundPreset,
  MEETING_BACKGROUND_PRESETS,
  MEETING_BACKGROUND_IMAGE_PATHS,
} from "@uniwork/core/meetings/room-preferences";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingCameraPreview } from "./meeting-camera-preview";

const ACCEPTED_BACKGROUND_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_BACKGROUND_BYTES = 5 * 1024 * 1024;

function DeviceSelectField({
  id,
  label,
  value,
  onValueChange,
  devices,
  emptyLabel,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (id: string) => void;
  devices: Array<{ deviceId: string; label: string }>;
  emptyLabel: string;
}) {
  const { t } = useTranslation();
  const items = devices.map((device) => ({
    value: device.deviceId,
    label: device.label || t("meetings.deviceUnnamed"),
  }));

  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {items.length > 0 ? (
        <Select
          id={id}
          value={value}
          onValueChange={(next) => next && onValueChange(next)}
          items={items}
        />
      ) : (
        <p className="text-caption text-muted-foreground">{emptyLabel}</p>
      )}
    </Field>
  );
}

function PreferenceSwitchField({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <Field orientation="horizontal" className="min-w-0 items-start gap-3">
      <FieldContent className="min-w-0 flex-1">
        <FieldLabel className="font-normal">{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Switch
        className="mt-0.5 shrink-0"
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </Field>
  );
}

function BackgroundOption({
  selected,
  label,
  onSelect,
  children,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "relative flex w-24 shrink-0 cursor-pointer flex-col gap-1.5 rounded-xl p-1 text-left transition-[box-shadow,ring-color]",
        selected ? "ring-2 ring-brand" : "ring-1 ring-border hover:ring-border",
      )}
    >
      <span className="relative block aspect-[4/3] overflow-hidden rounded-lg bg-muted">{children}</span>
      <span className="truncate px-0.5 text-caption text-foreground">{label}</span>
      {selected ? (
        <span className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-brand text-brand-foreground">
          <Check aria-hidden className="size-3" />
        </span>
      ) : null}
    </button>
  );
}

function MeetingDevicesPanel({ onReload }: { onReload: () => void }) {
  const { t } = useTranslation();
  const room = useRoomContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mirrorCamera = useMeetingRoomPreferencesStore((s) => s.mirrorCamera);
  const showExpandedLabels = useMeetingRoomPreferencesStore((s) => s.showExpandedLabels);
  const background = useMeetingRoomPreferencesStore((s) => s.background);
  const customBackgroundDataUrl = useMeetingRoomPreferencesStore((s) => s.customBackgroundDataUrl);
  const setMirrorCamera = useMeetingRoomPreferencesStore((s) => s.setMirrorCamera);
  const setShowExpandedLabels = useMeetingRoomPreferencesStore((s) => s.setShowExpandedLabels);
  const setBackground = useMeetingRoomPreferencesStore((s) => s.setBackground);
  const setCustomBackgroundDataUrl = useMeetingRoomPreferencesStore((s) => s.setCustomBackgroundDataUrl);

  const cameras = useMediaDeviceSelect({
    kind: "videoinput",
    requestPermissions: true,
  });
  const mics = useMediaDeviceSelect({
    kind: "audioinput",
    requestPermissions: true,
  });
  const speakers = useMediaDeviceSelect({
    kind: "audiooutput",
    requestPermissions: true,
  });

  const reloadDevices = () => {
    void navigator.mediaDevices.enumerateDevices();
    onReload();
  };

  const selectBackground = (preset: MeetingBackgroundPreset) => {
    setBackground(preset);
  };

  const selectCustomBackground = () => {
    if (customBackgroundDataUrl && background === "custom") {
      fileInputRef.current?.click();
      return;
    }
    if (customBackgroundDataUrl) {
      setBackground("custom");
      return;
    }
    fileInputRef.current?.click();
  };

  const onUploadBackground = (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_BACKGROUND_TYPES.includes(file.type as (typeof ACCEPTED_BACKGROUND_TYPES)[number])) {
      return;
    }
    if (file.size > MAX_BACKGROUND_BYTES) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) return;
      setCustomBackgroundDataUrl(result);
      setBackground("custom");
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="min-w-0 space-y-6">
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="min-w-0 space-y-2">
          <h3 className="text-label text-foreground">{t("meetings.devicePreviewTitle")}</h3>
          <MeetingCameraPreview
            deviceId={cameras.activeDeviceId}
            active
            background={background}
            customBackgroundDataUrl={customBackgroundDataUrl}
            mirrorCamera={mirrorCamera}
          />
        </section>

        <section className="min-w-0 space-y-4">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h3 className="text-label text-foreground">{t("meetings.deviceMediaTitle")}</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={reloadDevices}
            >
              <RefreshCw aria-hidden className="size-3.5" />
              {t("meetings.deviceReload")}
            </Button>
          </div>

          <FieldGroup className="min-w-0 gap-4">
            <DeviceSelectField
              id="room-device-camera"
              label={t("meetings.deviceCamera")}
              value={cameras.activeDeviceId}
              devices={cameras.devices}
              emptyLabel={t("meetings.deviceListEmpty")}
              onValueChange={(id) => {
                void cameras.setActiveMediaDevice(id);
                void room.switchActiveDevice("videoinput", id);
              }}
            />
            <DeviceSelectField
              id="room-device-mic"
              label={t("meetings.deviceMic")}
              value={mics.activeDeviceId}
              devices={mics.devices}
              emptyLabel={t("meetings.deviceListEmpty")}
              onValueChange={(id) => {
                void mics.setActiveMediaDevice(id);
                void room.switchActiveDevice("audioinput", id);
              }}
            />
            <DeviceSelectField
              id="room-device-speaker"
              label={t("meetings.deviceSpeaker")}
              value={speakers.activeDeviceId}
              devices={speakers.devices}
              emptyLabel={t("meetings.deviceSpeakerEmpty")}
              onValueChange={(id) => {
                void speakers.setActiveMediaDevice(id);
                void room.switchActiveDevice("audiooutput", id);
              }}
            />
          </FieldGroup>

          <div className="min-w-0 space-y-4 border-t border-border pt-4">
            <PreferenceSwitchField
              label={t("meetings.deviceMirror")}
              description={t("meetings.deviceMirrorHint")}
              checked={mirrorCamera}
              onCheckedChange={setMirrorCamera}
            />
            <PreferenceSwitchField
              label={t("meetings.deviceExpandedLabels")}
              description={t("meetings.deviceExpandedLabelsHint")}
              checked={showExpandedLabels}
              onCheckedChange={setShowExpandedLabels}
            />
          </div>
        </section>
      </div>

      <section className="min-w-0 space-y-3 border-t border-border pt-4">
        <h3 className="text-label text-foreground">{t("meetings.deviceBackgroundTitle")}</h3>
        <div className="-mx-1 flex min-w-0 gap-3 overflow-x-auto px-1 pb-1">
          <BackgroundOption
            selected={background === "none"}
            label={t("meetings.deviceBackgroundNone")}
            onSelect={() => selectBackground("none")}
          >
            <span className="flex size-full items-center justify-center text-muted-foreground">
              <Ban aria-hidden className="size-6" />
            </span>
          </BackgroundOption>
          <BackgroundOption
            selected={background === "blur"}
            label={t("meetings.deviceBackgroundBlur")}
            onSelect={() => selectBackground("blur")}
          >
            <span className="flex size-full items-center justify-center bg-gradient-to-br from-muted to-rail text-muted-foreground">
              <Droplets aria-hidden className="size-6" />
            </span>
          </BackgroundOption>
          <BackgroundOption
            selected={background === "classroom"}
            label={t("meetings.deviceBackgroundClassroom")}
            onSelect={() => selectBackground("classroom")}
          >
            <img
              src={MEETING_BACKGROUND_IMAGE_PATHS.classroom}
              alt=""
              className="size-full object-cover"
            />
          </BackgroundOption>
          <BackgroundOption
            selected={background === "nature"}
            label={t("meetings.deviceBackgroundNature")}
            onSelect={() => selectBackground("nature")}
          >
            <img
              src={MEETING_BACKGROUND_IMAGE_PATHS.nature}
              alt=""
              className="size-full object-cover"
            />
          </BackgroundOption>
          <BackgroundOption
            selected={background === "custom"}
            label={t("meetings.deviceBackgroundUpload")}
            onSelect={selectCustomBackground}
          >
            {customBackgroundDataUrl ? (
              <img src={customBackgroundDataUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
                <Upload aria-hidden className="size-5" />
                <ImageIcon aria-hidden className="size-4 opacity-70" />
              </span>
            )}
          </BackgroundOption>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          aria-label={t("meetings.deviceBackgroundUpload")}
          accept={ACCEPTED_BACKGROUND_TYPES.join(",")}
          className="sr-only"
          onChange={(event) => {
            onUploadBackground(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </section>
    </div>
  );
}

export function MeetingDevicesDialog({
  open,
  onOpenChange,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
}) {
  const { t } = useTranslation();
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent className="max-h-[min(92dvh,44rem)] overflow-x-hidden overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle>{t("meetings.devicesSettingsTitle")}</DialogTitle>
          <DialogDescription>{t("meetings.devicesSettingsDescription")}</DialogDescription>
        </DialogHeader>
        {open ? (
          <MeetingDevicesPanel onReload={() => setRefreshKey((value) => value + 1)} key={refreshKey} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export { MEETING_BACKGROUND_PRESETS };
