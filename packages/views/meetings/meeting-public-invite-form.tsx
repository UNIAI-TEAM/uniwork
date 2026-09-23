"use client";

import { Suspense, lazy, useCallback, useEffect, useId, useRef, useState } from "react";
import { CalendarDays, Loader2, ShieldCheck, Video, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldError, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import { CameraPreviewFrame, CameraPreviewPlaceholder } from "./meeting-camera-placeholder";
import type { CameraPreviewStatus } from "./meeting-camera-preview";
import { formatMeetingStart, meetingLocale } from "./meeting-datetime";
import { MeetingInviteShell } from "./meeting-invite-shell";
import { MeetingMediaControlBar, useMediaDevices } from "./meeting-media-controls";
import type { PreJoinChoice } from "./meeting-prejoin";

// Camera preview pulls livekit-client (~130 KB gzip). Lazy-load it so the public
// invite entry chunk stays under the route budget (scripts/bundle-budget.mjs).
// The placeholder comes from its own module for the same reason, and the
// preview only mounts once the guest turns the camera on.
const MeetingCameraPreview = lazy(() =>
  import("./meeting-camera-preview").then((m) => ({ default: m.MeetingCameraPreview })),
);

// Device pickers use the Select primitive, which once pushed this entry chunk
// from 52.8 to 81 KB. They only matter after the browser has named a device,
// so they load on their own, like the preview.
const MeetingInviteDevicePickers = lazy(() =>
  import("./meeting-invite-device-pickers").then((m) => ({ default: m.MeetingInviteDevicePickers })),
);

// A phone opens its keyboard on focus and hides half the page; only a
// fine pointer (mouse, trackpad) gets the name field focused on arrival.
function prefersAutoFocus(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: fine)").matches);
}

// pb-16 keeps the placeholder text and actions clear of the overlaid mic/camera bar.
const PREVIEW_CLASS = "aspect-video min-h-52 rounded-2xl pb-16 shadow-floating sm:min-h-60";

export function MeetingPublicInviteForm({
  title,
  startsAt,
  accessMode,
  displayName,
  onDisplayNameChange,
  joinPending,
  onJoin,
  onLogin,
}: {
  title: string;
  startsAt: string;
  accessMode: string;
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  joinPending: boolean;
  onJoin: (choice: PreJoinChoice) => void;
  onLogin: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [audio, setAudio] = useState(true);
  // A guest has not agreed to anything yet: no camera until they ask for it.
  const [video, setVideo] = useState(false);
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [nameError, setNameError] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameErrorId = useId();
  const { cameras, mics, refresh } = useMediaDevices();
  const onPreviewStatus = useCallback(
    (s: CameraPreviewStatus) => s === "live" && refresh(),
    [refresh],
  );
  const showMicPicker = audio && mics.length > 0;
  const showCameraPicker = video && cameras.length > 0;

  useEffect(() => {
    if (prefersAutoFocus()) nameRef.current?.focus();
  }, []);

  const needsApproval = accessMode === "REQUEST_APPROVAL";
  const accessModeLabel = needsApproval ? t("meetings.linkNeedApproval") : t("meetings.linkAutoAdmit");
  const accessHint = needsApproval ? t("meetings.linkNeedApprovalGuestHint") : t("meetings.linkAutoAdmitGuestHint");
  const joinLabel = needsApproval ? t("meetings.requestToJoin") : t("meetings.publicInviteJoin");
  const trimmedName = displayName.trim();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (joinPending) return;
    if (!trimmedName) {
      setNameError(true);
      nameRef.current?.focus();
      return;
    }
    onJoin({
      audio,
      video,
      audioDeviceId: audio && audioDeviceId ? audioDeviceId : undefined,
      videoDeviceId: video && videoDeviceId ? videoDeviceId : undefined,
    });
  };
  const formattedStart = formatMeetingStart(startsAt, meetingLocale(i18n.language));

  return (
    <MeetingInviteShell>
      <div className="grid w-full gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-12">
        <section aria-label={t("meetings.devicePreviewTitle")} className="min-w-0">
          <div className="relative">
            {video ? (
              <Suspense
                fallback={
                  <CameraPreviewFrame className={PREVIEW_CLASS}>
                    <CameraPreviewPlaceholder title={t("meetings.devicePreviewStarting")} />
                  </CameraPreviewFrame>
                }
              >
                <MeetingCameraPreview
                  active
                  deviceId={videoDeviceId || undefined}
                  className={PREVIEW_CLASS}
                  onStatusChange={onPreviewStatus}
                />
              </Suspense>
            ) : (
              <CameraPreviewFrame className={PREVIEW_CLASS}>
                <CameraPreviewPlaceholder
                  title={t("meetings.devicePreviewOff")}
                  action={
                    <Button type="button" variant="outline" size="sm" onClick={() => setVideo(true)}>
                      <Video aria-hidden />
                      {t("meetings.devicePreviewTurnOn")}
                    </Button>
                  }
                />
              </CameraPreviewFrame>
            )}
            {trimmedName ? (
              <span className="absolute top-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-lg bg-meeting-tile-name-bg px-3 py-1.5 text-label font-medium text-meeting-tile-name-foreground">
                {trimmedName}
              </span>
            ) : null}
            <MeetingMediaControlBar
              audio={audio}
              video={video}
              micLabel={t("meetings.deviceMic")}
              cameraLabel={t("meetings.deviceCamera")}
              onAudioToggle={() => setAudio((v) => !v)}
              onVideoToggle={() => setVideo((v) => !v)}
              className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-3"
            />
          </div>
          <p className="mt-3 text-center text-caption text-muted-foreground">{t("meetings.publicInviteDeviceHint")}</p>
          {showMicPicker || showCameraPicker ? (
            <Suspense fallback={null}>
              <MeetingInviteDevicePickers
                mics={showMicPicker ? mics : undefined}
                cameras={showCameraPicker ? cameras : undefined}
                audioDeviceId={audioDeviceId}
                videoDeviceId={videoDeviceId}
                onAudioDeviceChange={setAudioDeviceId}
                onVideoDeviceChange={setVideoDeviceId}
              />
            </Suspense>
          ) : null}
        </section>

        <form
          noValidate
          onSubmit={submit}
          className="mx-auto flex w-full max-w-md flex-col gap-5 lg:mx-0 lg:max-w-none"
        >
          <div className="space-y-2">
            <p className="text-overline text-muted-foreground">
              {t("meetings.publicInviteTitle")}
            </p>
            <h1 className="text-balance text-display-sm font-semibold tracking-tight text-foreground">{title}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <CalendarDays aria-hidden className="size-4 shrink-0" />
                {formattedStart}
              </span>
            </div>
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-caption font-medium",
                needsApproval ? "bg-info-soft text-info-soft-foreground" : "bg-success-soft text-success-soft-foreground",
              )}
            >
              {needsApproval ? (
                <ShieldCheck aria-hidden className="size-3.5 shrink-0" />
              ) : (
                <Zap aria-hidden className="size-3.5 shrink-0" />
              )}
              <span>{t("meetings.publicInviteAccessMode", { mode: accessModeLabel })}</span>
            </div>
            {/* Visible text, not a tooltip: a phone has no hover to reveal it. */}
            <p className="text-pretty text-caption text-muted-foreground">{accessHint}</p>
          </div>

          <Field data-invalid={nameError || undefined}>
            <FieldLabel htmlFor="guest-display-name">{t("meetings.publicInviteDisplayName")}</FieldLabel>
            <Input
              ref={nameRef}
              id="guest-display-name"
              name="name"
              value={displayName}
              onChange={(e) => {
                onDisplayNameChange(e.target.value);
                if (e.target.value.trim()) setNameError(false);
              }}
              placeholder={t("meetings.publicInviteDisplayNamePlaceholder")}
              autoComplete="name"
              required
              aria-invalid={nameError || undefined}
              aria-describedby={nameError ? nameErrorId : undefined}
              className="h-11"
            />
            {nameError ? <FieldError id={nameErrorId}>{t("meetings.publicInviteNameRequired")}</FieldError> : null}
          </Field>

          <Button
            type="submit"
            variant="brand"
            className="h-11 w-full text-body font-medium"
            disabled={joinPending}
          >
            {joinPending ? (
              <>
                <Loader2 aria-hidden className="animate-spin" />
                {t("meetings.joining")}
              </>
            ) : (
              joinLabel
            )}
          </Button>

          <p className="text-center text-caption text-muted-foreground">
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-caption"
              onClick={onLogin}
            >
              {t("meetings.publicInviteHaveAccount")}
            </Button>
          </p>
        </form>
      </div>
    </MeetingInviteShell>
  );
}
