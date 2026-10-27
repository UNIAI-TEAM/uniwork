"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { useMeeting, useMeetingCapabilities, useParticipants } from "@uniwork/core/meetings";
import { useMeetingClerk } from "@uniwork/core/meetings/attendance";
import { formatVoiceCallDuration } from "@uniwork/core/chat/voice-call-duration";
import {
  useMeetingRecorder,
  useSendRecording,
  useUnsentRecordings,
  type RecordingStore,
} from "@uniwork/core/meetings/recorder";
import type { Meeting } from "@uniwork/core/types";
import { useCurrentMember } from "@uniwork/core/permissions";
import { useMediaDevices } from "../meeting-media-controls";
import { useInPersonStrip } from "../meeting-detail/use-in-person-strip";
import { ConfirmDialog } from "../../common/form-dialog";
import { useInertOutside } from "../use-inert-outside";
import { RecordPrep, type RecordLanguage } from "./record-prep";
import { RecordSendDialog } from "./record-send-dialog";
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
 * Sends what this device holds for the meeting as soon as it mounts, once.
 * Stopping or leaving it for later keeps the parts on the device.
 */
function RecordSend({
  workspaceId,
  meeting,
  userId,
  store,
  onSent,
  onBack,
}: {
  workspaceId: string;
  meeting: Meeting;
  userId: string;
  store?: RecordingStore;
  onSent: () => void;
  onBack: () => void;
}) {
  const sender = useSendRecording({ workspaceId, meeting, userId, store });
  const { phase, send } = sender;
  // StrictMode runs a mount effect twice: one send only.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send();
  }, [send]);

  const sent = useRef(onSent);
  sent.current = onSent;
  useEffect(() => {
    if (phase === "done") sent.current();
  }, [phase]);

  // Leaving now would strand an upload the server never queues: the browser asks first.
  const busy = phase === "holding" || phase === "uploading";
  useEffect(() => {
    if (!busy) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome before 119 only asks when returnValue is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [busy]);

  const leave = () => void sender.stop().then(onBack);
  return (
    <RecordSendDialog
      phase={phase}
      percent={sender.percent}
      sentBytes={sender.sentBytes}
      totalBytes={sender.totalBytes}
      seconds={sender.seconds}
      error={sender.error}
      onStop={leave}
      onRetry={sender.retry}
      onLater={leave}
    />
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
  onSent,
  workspaceLabel,
  meetingsHref,
  send = false,
  store,
}: {
  workspaceId: string;
  meetingId: string;
  /** Back to the meeting page. */
  onBack: () => void;
  /** The recording reached the server. */
  onSent: () => void;
  workspaceLabel?: string;
  meetingsHref?: string;
  /** Opened to send what this device holds (`?send=1`): straight to the send dialog, or back when it holds nothing. */
  send?: boolean;
  store?: RecordingStore;
}) {
  const { t, i18n } = useTranslation();
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
  // Fail closed (spec D5): a meeting, capability or roster that cannot be read is no permission to record.
  // Only before it was ever read: a failed refetch keeps its data and must never end a recording under way.
  const unreadable = [meetingQuery, caps, roster].some((q) => q.isError && q.data === undefined);
  const refused = unreadable || (settled && !canRecord && state === "idle");
  useEffect(() => {
    if (refused) back.current();
  }, [refused]);

  const [askEnd, setAskEnd] = useState(false);
  const [sending, setSending] = useState(false);
  // Every "Kết thúc" asks first; "Ghi tiếp" closes the question and the recording never stopped.
  const onEndRequested = () => setAskEnd(true);
  const endAndSend = () => {
    setAskEnd(false);
    void recorder.stop().then(() => setSending(true));
  };

  // `?send=1`: once the meeting and what this device holds are known, send it, or go back with nothing to send.
  const sendDecided = useRef(false);
  const sendReady = send && Boolean(meeting) && !unsent.isPending;
  const sendNothing = unsent.parts.length === 0;
  useEffect(() => {
    if (!sendReady || sendDecided.current) return;
    sendDecided.current = true;
    if (sendNothing) back.current();
    else setSending(true);
  }, [sendReady, sendNothing]);

  const sendDialog =
    sending && meeting ? (
      <RecordSend workspaceId={workspaceId} meeting={meeting} userId={userId} store={store} onSent={onSent} onBack={onBack} />
    ) : null;

  // Sending what an earlier visit left: no prep screen to start a new recording behind the dialog.
  if (send && state === "idle") return <RecordShell>{sendDialog}</RecordShell>;

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
      <ConfirmDialog
        open={askEnd}
        onOpenChange={setAskEnd}
        destructive={false}
        title={t("meetings.record.endTitle")}
        description={t("meetings.record.endBody", { duration: formatVoiceCallDuration((priorMs + activeMs) / 1000) })}
        confirmLabel={t("meetings.record.endAndSend")}
        cancelLabel={t("meetings.record.continue")}
        onConfirm={endAndSend}
      />
      {sendDialog}
    </RecordShell>
  );
}
