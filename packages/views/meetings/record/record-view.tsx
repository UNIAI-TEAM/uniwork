"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { useMeeting, useMeetingCapabilities, useParticipants } from "@uniwork/core/meetings";
import { useMeetingClerk } from "@uniwork/core/meetings/attendance";
import { useMeetingRecorder, useUnsentRecordings, type RecordingStore } from "@uniwork/core/meetings/recorder";
import { useCurrentMember } from "@uniwork/core/permissions";
import { useMediaDevices } from "../meeting-media-controls";
import { useInPersonStrip } from "../meeting-detail/use-in-person-strip";
import { useInertOutside } from "../use-inert-outside";
import { RecordPrep, type RecordLanguage } from "./record-prep";
import { RecordStage } from "./record-stage";

function RecordShell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useInertOutside(ref);
  return (
    <div
      ref={ref}
      className="fixed inset-0 z-40 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      data-testid="meeting-record"
    >
      {children}
    </div>
  );
}

/**
 * Records an in-person meeting from this browser (UNI-2247): the prep screen,
 * then the recording. Only a clerk of an in-person meeting, where the
 * organization can transcribe, gets here; anyone else is sent back to the
 * meeting. Parts already on this device for the meeting continue: the clock
 * and the offsets carry on from them.
 */
export function MeetingRecordView({
  workspaceId,
  meetingId,
  onBack,
  workspaceLabel,
  meetingsHref,
  store,
}: {
  workspaceId: string;
  meetingId: string;
  /** Back to the meeting page. */
  onBack: () => void;
  /** The recording reached the server (the send step, Task 10). */
  onSent: () => void;
  workspaceLabel?: string;
  meetingsHref?: string;
  /** Opened to send what this device holds (`?send=1`); the send step reads it (Task 10). */
  send?: boolean;
  store?: RecordingStore;
}) {
  const { i18n } = useTranslation();
  const userId = useAuthStore((s) => s.user?.id) ?? "";
  const meetingQuery = useMeeting(meetingId);
  const meeting = meetingQuery.data ?? undefined;
  const { isClerk } = useMeetingClerk(meeting ?? null, workspaceId);
  const { canRecord } = useInPersonStrip(workspaceId, meeting, isClerk);
  const caps = useMeetingCapabilities(workspaceId);
  const member = useCurrentMember(workspaceId);
  const roster = useParticipants(meetingId);
  const unsent = useUnsentRecordings(userId || undefined, meetingId, store);
  const { mics, refresh } = useMediaDevices();
  const [deviceChoice, setDeviceChoice] = useState("");
  const deviceId = deviceChoice || mics[0]?.deviceId;
  const [languageChoice, setLanguage] = useState<RecordLanguage | null>(null);
  const language = languageChoice ?? unsent.parts[0]?.language ?? (i18n.language.startsWith("en") ? "en" : "vi");
  const { recorder, state, activeMs, wakeLockHeld } = useMeetingRecorder({
    userId,
    meetingId,
    language,
    baseStartedAt: unsent.parts[0]?.startedAt,
    store,
  });
  // What earlier parts on this device already hold, fixed when this recording starts.
  const [priorMs, setPriorMs] = useState(0);

  const back = useRef(onBack);
  back.current = onBack;
  const settled = Boolean(meeting && caps.data && !member.isLoading && roster.data);
  // Fail closed (spec D5): a capability or roster that cannot be read is no permission to record.
  const refused = meetingQuery.isError || caps.isError || roster.isError || (settled && !canRecord && state === "idle");
  useEffect(() => {
    if (refused) back.current();
  }, [refused]);

  // Task 10 turns this into the end confirm and the send dialog; for now what was recorded stays on the device.
  const onEndRequested = () => {
    void recorder.stop().then(() => back.current());
  };

  if (state === "idle" || state === "failed") {
    return (
      <RecordShell>
        <RecordPrep
          meeting={meeting}
          mics={mics}
          onDevicesGranted={refresh}
          deviceId={deviceId}
          onDeviceChange={setDeviceChoice}
          language={language}
          onLanguageChange={setLanguage}
          failed={state === "failed"}
          ready={!unsent.isPending}
          onStart={() => {
            setPriorMs(unsent.seconds * 1000);
            void recorder.start(deviceId);
          }}
          onBack={onBack}
        />
      </RecordShell>
    );
  }

  return (
    <RecordShell>
      <RecordStage
        meeting={meeting}
        workspaceLabel={workspaceLabel}
        meetingsHref={meetingsHref}
        state={state}
        elapsedMs={priorMs + activeMs}
        stream={recorder.stream}
        wakeLockHeld={wakeLockHeld}
        people={roster.data?.filter((p) => p.status === "ACTIVE").length}
        mics={mics}
        deviceId={deviceId}
        onPause={() => recorder.pause()}
        onResume={() => recorder.resume()}
        // Always the chosen microphone: with no id the recorder falls back to the default one.
        onResumeAfterInterrupt={() => void recorder.resumeAfterInterrupt(deviceId)}
        onDeviceChange={(id) => {
          setDeviceChoice(id);
          if (state === "recording" || state === "paused") void recorder.switchDevice(id);
        }}
        onEnd={onEndRequested}
      />
    </RecordShell>
  );
}
