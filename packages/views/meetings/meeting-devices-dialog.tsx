"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocalParticipant, useMediaDeviceSelect, useRoomContext } from "@livekit/components-react";
import type { LucideIcon } from "lucide-react";
import {
  Mic,
  Play,
  RefreshCw,
  Video,
  Volume2,
} from "lucide-react";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import { IconTile, type Tint } from "@uniwork/ui/components/common/icon-tile";
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
  FieldLabel,
  FieldTitle,
} from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { MeetingBackgroundPicker } from "./meeting-background-picker";
import { MeetingCameraPreview, type CameraPreviewStatus } from "./meeting-camera-preview";
import { MeetingMediaPermissionAction, MeetingMicLevel } from "./meeting-room-mic-check";
import { playSpeakerTest } from "./meeting-speaker-test";

type MediaKind = "videoinput" | "audioinput" | "audiooutput";

/** Every row carries the Meetings identity: the icon says which device, the tint says where you are. */
const DEVICE_TONE = "violet" satisfies Tint;

function canPickOutput(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

/**
 * One device: its mark and name, then the picker (or why there is none) and
 * whatever proves the device works — a level meter, a test tone. With
 * `focusRequested` (access was just granted from this row) it takes focus:
 * the picker once the list arrives, the row itself until then.
 */
function DeviceRow({
  id,
  icon,
  label,
  value,
  devices,
  onValueChange,
  empty,
  focusRequested = false,
  onFocused,
  children,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  value: string;
  devices: Array<{ deviceId: string; label: string }>;
  onValueChange: (id: string) => void;
  /** Shown in place of the picker while the list is empty. */
  empty: ReactNode;
  focusRequested?: boolean;
  onFocused?: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const items = devices.map((device) => ({
    value: device.deviceId,
    label: device.label || t("meetings.deviceUnnamed"),
  }));
  // LiveKit reports "default" until a device is picked, and a camera list has
  // no such id: show the first real device rather than the raw value.
  const selected = items.some((item) => item.value === value) ? value : items[0]?.value;
  const hasItems = items.length > 0;

  useEffect(() => {
    if (!focusRequested) return;
    const picker = hasItems ? document.getElementById(id) : null;
    (picker ?? document.getElementById(`${id}-row`))?.focus();
    if (picker) onFocused?.();
  }, [focusRequested, hasItems, id, onFocused]);

  return (
    <Field id={`${id}-row`} tabIndex={-1} className="min-w-0 gap-3 px-4 py-4 outline-offset-[-2px]">
      <div className="flex min-w-0 items-center gap-2.5">
        <IconTile icon={icon} tone={DEVICE_TONE} size="sm" aria-hidden />
        {hasItems ? (
          <FieldLabel htmlFor={id} className="min-w-0 truncate text-label font-medium">
            {label}
          </FieldLabel>
        ) : (
          <FieldTitle className="min-w-0 truncate text-label">{label}</FieldTitle>
        )}
      </div>
      {hasItems && selected ? (
        <Select id={id} value={selected} onValueChange={(next) => next && onValueChange(next)} items={items} />
      ) : (
        <div className="space-y-2 text-caption text-muted-foreground">{empty}</div>
      )}
      {children}
    </Field>
  );
}

function PreferenceSwitch({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <Field orientation="horizontal" className="min-w-0 items-start gap-4">
      <FieldContent className="min-w-0">
        <FieldLabel htmlFor={id} className="text-label font-normal">
          {label}
        </FieldLabel>
        <FieldDescription id={`${id}-hint`} className="text-caption text-pretty group-has-data-horizontal/field:text-pretty">
          {description}
        </FieldDescription>
      </FieldContent>
      <Switch
        id={id}
        className="mt-0.5 shrink-0"
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-describedby={`${id}-hint`}
      />
    </Field>
  );
}

function SpeakerTestButton({ deviceId }: { deviceId?: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "playing" | "failed">("idle");
  const playing = state === "playing";

  const play = async () => {
    setState("playing");
    try {
      await playSpeakerTest(deviceId);
      setState("idle");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {/* aria-disabled, not disabled: the button keeps focus while it plays. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-disabled={playing || undefined}
        aria-busy={playing || undefined}
        onClick={() => void play()}
      >
        {playing ? (
          <Volume2 aria-hidden className="size-3.5 motion-safe:animate-pulse" />
        ) : (
          <Play aria-hidden className="size-3.5" />
        )}
        {playing ? t("meetings.deviceSpeakerTesting") : t("meetings.deviceSpeakerTest")}
      </Button>
      {state === "failed" ? (
        <p role="alert" className="text-caption text-destructive">
          {t("meetings.deviceSpeakerTestFailed")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The three pickers. Keyed by the refresh counter so "Reload" (or a granted
 * permission) re-lists them; the card header around them — and the Reload
 * button a keyboard user just pressed — stays mounted.
 */
function MediaDeviceRows({
  onGranted,
  focusRow,
  onFocused,
}: {
  onGranted: (rowId: string) => void;
  focusRow: string | null;
  onFocused: () => void;
}) {
  const { t } = useTranslation();
  const room = useRoomContext();
  const { isMicrophoneEnabled, microphoneTrack } = useLocalParticipant();
  const mirrorCamera = useMeetingRoomPreferencesStore((s) => s.mirrorCamera);
  const setMirrorCamera = useMeetingRoomPreferencesStore((s) => s.setMirrorCamera);

  const cameras = useMediaDeviceSelect({ kind: "videoinput", requestPermissions: true });
  const mics = useMediaDeviceSelect({ kind: "audioinput", requestPermissions: true });
  const speakers = useMediaDeviceSelect({ kind: "audiooutput", requestPermissions: true });

  const switchTo = (kind: MediaKind, select: typeof cameras) => (id: string) => {
    void select.setActiveMediaDevice(id);
    void room.switchActiveDevice(kind, id);
  };

  const publishedMic = microphoneTrack?.audioTrack?.mediaStreamTrack;
  const activeSpeaker = speakers.activeDeviceId || speakers.devices[0]?.deviceId;
  const permission = (kind: "audio" | "video", rowId: string) => (
    <MeetingMediaPermissionAction
      kind={kind}
      label={t("meetings.deviceAllow")}
      deniedMessage={t("meetings.deviceAllowDenied")}
      onGranted={() => onGranted(rowId)}
    />
  );
  const rowFocus = (rowId: string) => ({ focusRequested: focusRow === rowId, onFocused });

  return (
    <div className="divide-y divide-surface-border">
      <DeviceRow
        id="room-device-camera"
        icon={Video}
        label={t("meetings.deviceCamera")}
        value={cameras.activeDeviceId}
        devices={cameras.devices}
        onValueChange={switchTo("videoinput", cameras)}
        empty={
          <>
            <p>{t("meetings.deviceCameraNeedsPermission")}</p>
            {permission("video", "room-device-camera")}
          </>
        }
        {...rowFocus("room-device-camera")}
      >
        <PreferenceSwitch
          id="room-device-mirror"
          label={t("meetings.deviceMirror")}
          description={t("meetings.deviceMirrorHint")}
          checked={mirrorCamera}
          onCheckedChange={setMirrorCamera}
        />
      </DeviceRow>

      <DeviceRow
        id="room-device-mic"
        icon={Mic}
        label={t("meetings.deviceMic")}
        value={mics.activeDeviceId}
        devices={mics.devices}
        onValueChange={switchTo("audioinput", mics)}
        empty={
          <>
            <p>{t("meetings.deviceMicNeedsPermission")}</p>
            {permission("audio", "room-device-mic")}
          </>
        }
        {...rowFocus("room-device-mic")}
      >
        {mics.devices.length > 0 ? (
          // A muted viewer should not see a meter move: it would read as
          // "the others can hear me". Unmuted, it listens to the track the
          // room already hears rather than opening the mic a second time.
          isMicrophoneEnabled && publishedMic ? (
            <MeetingMicLevel track={publishedMic} className="mt-1" />
          ) : (
            <p className="text-caption text-muted-foreground">{t("meetings.deviceMicLevelOff")}</p>
          )
        ) : null}
      </DeviceRow>

      <DeviceRow
        id="room-device-speaker"
        icon={Volume2}
        label={t("meetings.deviceSpeaker")}
        value={speakers.activeDeviceId}
        devices={speakers.devices}
        onValueChange={switchTo("audiooutput", speakers)}
        empty={
          canPickOutput() ? (
            // Chrome lists outputs only once some media access is granted.
            <>
              <p>{t("meetings.deviceSpeakerNeedsPermission")}</p>
              {permission("audio", "room-device-speaker")}
            </>
          ) : (
            <p>{t("meetings.deviceSpeakerEmpty")}</p>
          )
        }
        {...rowFocus("room-device-speaker")}
      >
        <SpeakerTestButton deviceId={activeSpeaker} />
      </DeviceRow>
    </div>
  );
}

function MediaDevicesCard({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const { t } = useTranslation();
  const headingId = useId();
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const clearFocusRow = useCallback(() => setFocusRow(null), []);

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 overflow-hidden rounded-xl bg-surface ring-1 ring-surface-border"
    >
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-surface-border py-2 pr-2 pl-4">
        <h3 id={headingId} className="text-label font-semibold text-foreground">
          {t("meetings.deviceMediaTitle")}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          onClick={() => {
            void navigator.mediaDevices?.enumerateDevices();
            onRefresh();
          }}
        >
          <RefreshCw aria-hidden className="size-3.5" />
          {t("meetings.deviceReload")}
        </Button>
      </div>
      <MediaDeviceRows
        key={refreshKey}
        focusRow={focusRow}
        onFocused={clearFocusRow}
        onGranted={(rowId) => {
          setFocusRow(rowId);
          onRefresh();
        }}
      />
    </section>
  );
}

function MeetingDevicesPanel() {
  const { t } = useTranslation();
  const { isCameraEnabled } = useLocalParticipant();
  // Opening settings must not switch on a camera the viewer turned off.
  const [previewOn, setPreviewOn] = useState(isCameraEnabled);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  const mirrorCamera = useMeetingRoomPreferencesStore((s) => s.mirrorCamera);
  const showExpandedLabels = useMeetingRoomPreferencesStore((s) => s.showExpandedLabels);
  const background = useMeetingRoomPreferencesStore((s) => s.background);
  const customBackgroundDataUrl = useMeetingRoomPreferencesStore((s) => s.customBackgroundDataUrl);
  const setShowExpandedLabels = useMeetingRoomPreferencesStore((s) => s.setShowExpandedLabels);
  const cameras = useMediaDeviceSelect({ kind: "videoinput" });
  // The first live frame means the browser granted the camera: device labels
  // are readable now, so list them again.
  const onPreviewStatus = useCallback((status: CameraPreviewStatus) => {
    if (status === "live") refresh();
  }, [refresh]);

  // A camera that is not in the list ("default" before one is picked) would
  // be asked for by that exact id and fail; let the browser choose instead.
  const previewDeviceId = cameras.devices.some((d) => d.deviceId === cameras.activeDeviceId)
    ? cameras.activeDeviceId
    : undefined;

  return (
    // Blocks in the order that matters on a phone: the picture, the devices
    // (what the dialog is for), the background, then the room switch. A wide
    // screen keeps the devices on the right and stacks the rest under the
    // picture they change.
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr] lg:gap-x-8">
      <div className="min-w-0 rounded-2xl bg-meeting-stage p-2 ring-1 ring-surface-border lg:col-start-1 lg:row-start-1">
        <MeetingCameraPreview
          deviceId={previewDeviceId}
          active={previewOn}
          onRequestEnable={() => setPreviewOn(true)}
          onStatusChange={onPreviewStatus}
          background={background}
          customBackgroundDataUrl={customBackgroundDataUrl}
          mirrorCamera={mirrorCamera}
          // The stage already draws the edge; a second ring framed a frame.
          className="aspect-video min-h-44 rounded-xl ring-0"
        />
      </div>

      <div className="min-w-0 lg:col-start-2 lg:row-span-3 lg:row-start-1">
        <MediaDevicesCard refreshKey={refreshKey} onRefresh={refresh} />
      </div>

      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <MeetingBackgroundPicker />
      </div>

      <section className="min-w-0 self-start rounded-xl bg-surface px-4 py-4 ring-1 ring-surface-border lg:col-start-1 lg:row-start-3">
        <h3 className="mb-3 text-label font-semibold text-foreground">{t("meetings.deviceRoomTitle")}</h3>
        <PreferenceSwitch
          id="room-expanded-labels"
          label={t("meetings.deviceExpandedLabels")}
          description={t("meetings.deviceExpandedLabelsHint")}
          checked={showExpandedLabels}
          onCheckedChange={setShowExpandedLabels}
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      {/* Header stays put, only the body scrolls: the title and the close
          button are always one glance away on a short laptop screen. */}
      <DialogContent
        className="flex max-h-[min(92dvh,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
        closeLabel={t("common.close")}
      >
        <DialogHeader className="shrink-0 border-b border-surface-border px-5 pt-5 pb-4 pr-12">
          <DialogTitle>{t("meetings.devicesSettingsTitle")}</DialogTitle>
          <DialogDescription>{t("meetings.devicesSettingsDescription")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 pt-5 pb-6">
          {open ? <MeetingDevicesPanel /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

