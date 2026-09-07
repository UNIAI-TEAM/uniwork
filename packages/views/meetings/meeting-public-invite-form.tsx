"use client";

import { useCallback, useState } from "react";
import { CalendarDays, Loader2, ShieldCheck, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { InfoHint } from "@uniwork/ui/components/common/info-hint";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import type { CameraPreviewStatus } from "./meeting-camera-preview";
import { MeetingCameraPreview } from "./meeting-camera-preview";
import { formatMeetingStart, meetingLocale } from "./meeting-datetime";
import { MeetingInviteShell } from "./meeting-invite-shell";
import { MeetingMediaControlBar, useMediaDevices } from "./meeting-media-controls";

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
  onJoin: () => void;
  onLogin: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [audio, setAudio] = useState(true);
  const [video, setVideo] = useState(true);
  const { refresh } = useMediaDevices();
  const onPreviewStatus = useCallback(
    (s: CameraPreviewStatus) => s === "live" && refresh(),
    [refresh],
  );

  const needsApproval = accessMode === "REQUEST_APPROVAL";
  const accessModeLabel = needsApproval ? t("meetings.linkNeedApproval") : t("meetings.linkAutoAdmit");
  const accessHint = needsApproval ? t("meetings.linkNeedApprovalGuestHint") : t("meetings.linkAutoAdmitGuestHint");
  const joinLabel = needsApproval ? t("meetings.requestToJoin") : t("meetings.publicInviteJoin");
  const trimmedName = displayName.trim();
  const formattedStart = formatMeetingStart(startsAt, meetingLocale(i18n.language));

  return (
    <MeetingInviteShell>
      <div className="grid w-full gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-12">
        <section aria-label={t("meetings.devicePreviewTitle")} className="min-w-0">
          <div className="relative">
            <MeetingCameraPreview
              active={video}
              className="aspect-video min-h-52 rounded-2xl shadow-[var(--floating-shadow)] sm:min-h-60"
              onStatusChange={onPreviewStatus}
            />
            {trimmedName ? (
              <span className="absolute top-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-lg bg-black/55 px-3 py-1.5 text-label font-medium text-white backdrop-blur-sm">
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
        </section>

        <section className="mx-auto flex w-full max-w-md flex-col gap-5 lg:mx-0 lg:max-w-none">
          <div className="space-y-2">
            <p className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
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
                needsApproval ? "bg-warning/10 text-warning" : "bg-success/10 text-success",
              )}
            >
              {needsApproval ? (
                <ShieldCheck aria-hidden className="size-3.5 shrink-0" />
              ) : (
                <Zap aria-hidden className="size-3.5 shrink-0" />
              )}
              <span>{t("meetings.publicInviteAccessMode", { mode: accessModeLabel })}</span>
              <InfoHint label={accessModeLabel}>{accessHint}</InfoHint>
            </div>
          </div>

          <Field>
            <FieldLabel htmlFor="guest-display-name">{t("meetings.publicInviteDisplayName")}</FieldLabel>
            <Input
              id="guest-display-name"
              value={displayName}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              placeholder={t("meetings.publicInviteDisplayNamePlaceholder")}
              autoComplete="name"
              autoFocus
              className="h-11"
              onKeyDown={(e) => {
                if (e.key === "Enter" && trimmedName && !joinPending) onJoin();
              }}
            />
          </Field>

          <Button
            type="button"
            variant="brand"
            className="h-11 w-full text-body font-medium"
            disabled={joinPending || !trimmedName}
            onClick={onJoin}
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
        </section>
      </div>
    </MeetingInviteShell>
  );
}
