"use client";

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { CircleDot, Phone, PhoneOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getActiveChatVoiceRecording } from "@uniwork/core/api/endpoints/chat-voice";
import { Notice } from "../common/notice";
import { useCallRingtone } from "./use-call-ringtone";
import { voiceCallDeviceMessage, voiceCallEndedMessage } from "./voice-call-copy";
import { VoiceCallEndedPanel } from "./voice-call-ended-panel";
import { VoiceCallLabeledAction, type VoiceCallPanelMode } from "./voice-call-floating-panel";
import { PreConnectFloatingCall } from "./voice-call-pre-connect";
import type {
  VoiceCallDeviceError,
  VoiceCallEndInit,
  VoiceCallOverlayState,
} from "./voice-call-overlay-types";
import { isMultiPartyVoiceCall } from "./voice-call-kind-utils";

// livekit-client is 130 KB gzip and only a connected call needs it, so it
// loads on the transition to "active" rather than with the chat route
// (scripts/bundle-budget.mjs). Ringing and incoming render without it: the
// pre-connect panel is a sibling module that imports no SDK.
const ActiveVoiceCallSession = lazy(() =>
  import("./voice-call-overlay-session").then((m) => ({ default: m.ActiveVoiceCallSession })),
);

export type { VoiceCallKind, VoiceCallOverlayState } from "./voice-call-overlay-types";

/**
 * A group call someone is asked to join may already be recording. The
 * invite says so before they answer, not after their microphone is on.
 */
function useIncomingRecording(workspaceId: string, state: VoiceCallOverlayState): boolean {
  const [recordingCallId, setRecordingCallId] = useState<string | null>(null);
  const incoming = state.status === "incoming" && isMultiPartyVoiceCall(state.callKind) ? state : null;
  const roomId = incoming?.roomId;
  const callId = incoming?.callId;
  useEffect(() => {
    if (!roomId || !callId) return;
    let cancelled = false;
    void getActiveChatVoiceRecording(workspaceId, roomId, callId)
      .then((rec) => {
        if (!cancelled && rec?.status === "ACTIVE") setRecordingCallId(callId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceId, roomId, callId]);
  return callId != null && recordingCallId === callId;
}

/**
 * Focus goes back where it was before the call panel appeared (the call
 * button, the message box) once the call is gone, instead of to <body>.
 */
function useReturnFocus(open: boolean) {
  const returnToRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      if (!returnToRef.current && document.activeElement instanceof HTMLElement) {
        returnToRef.current = document.activeElement;
      }
      return;
    }
    const target = returnToRef.current;
    returnToRef.current = null;
    const active = document.activeElement;
    if (target?.isConnected && (!active || active === document.body)) target.focus();
  }, [open]);
}

export function VoiceCallOverlay({
  workspaceId,
  state,
  incomingDeviceError = null,
  onAccept,
  onDecline,
  onLeave,
  onDisconnected,
  onEndForAll,
  onConnected,
  onRetryEnded,
  onDismissEnded,
}: {
  workspaceId: string;
  state: VoiceCallOverlayState;
  /** The mic would not start while answering; the call keeps ringing. */
  incomingDeviceError?: VoiceCallDeviceError | null;
  onAccept: () => void;
  onDecline: () => void;
  onLeave: (init?: VoiceCallEndInit) => void;
  onDisconnected: () => void;
  onEndForAll: (init?: VoiceCallEndInit) => void;
  onConnected: () => void;
  onRetryEnded: () => void;
  onDismissEnded: () => void;
}) {
  const { t } = useTranslation();
  const [panelMode, setPanelMode] = useState<VoiceCallPanelMode>("expanded");
  const incomingRecording = useIncomingRecording(workspaceId, state);
  useReturnFocus(state.status !== "idle");

  const handleConnectFailed = useCallback(() => {
    const init: VoiceCallEndInit = { reason: "connect_failed" };
    if (
      state.status === "active" &&
      (state.callKind === "dm" || (isMultiPartyVoiceCall(state.callKind) && state.outgoing))
    ) {
      onEndForAll(init);
      return;
    }
    onLeave(init);
  }, [state, onEndForAll, onLeave]);

  const cancelPreConnect = () => {
    if (state.status === "connecting" || state.status === "ringing") {
      if (state.callKind === "dm" || (isMultiPartyVoiceCall(state.callKind) && state.outgoing)) {
        onEndForAll();
        return;
      }
    }
    onLeave();
  };

  useEffect(() => {
    if (state.status === "idle" || state.status === "ended") {
      setPanelMode("expanded");
    }
  }, [state.status]);

  const ringtoneKind =
    state.status === "incoming" ? "incoming" : state.status === "ringing" ? "outgoing" : null;
  useCallRingtone(ringtoneKind);

  const handleMinimize = useCallback(() => {
    setPanelMode((current) => {
      if (current === "fullscreen") return "expanded";
      if (current === "expanded") return "minimized";
      return current;
    });
  }, []);

  const handleMaximize = useCallback(() => {
    setPanelMode((current) => {
      if (current === "minimized") return "expanded";
      if (current === "expanded") return "fullscreen";
      return current;
    });
  }, []);

  // One always-mounted live region for how a call ended: the ended panel is
  // a fresh element, and text present at insertion is not reliably read.
  const endedAnnouncement = state.status === "ended" ? voiceCallEndedMessage(state, t) : "";

  return (
    <>
      <p role="status" className="sr-only" data-testid="voice-call-ended-announcer">
        {endedAnnouncement}
      </p>
      {renderPanel()}
    </>
  );

  function renderPanel() {
    if (state.status === "ended") {
      return <VoiceCallEndedPanel state={state} onRetry={onRetryEnded} onDismiss={onDismissEnded} />;
    }

    if (state.status === "incoming") {
      const statusLabel = isMultiPartyVoiceCall(state.callKind)
        ? t("chat.voice_call_incoming_group", {
            caller: state.callerName ?? state.peerName,
            group: state.peerName,
          })
        : t("chat.voice_call_incoming_label");
      const notice =
        incomingRecording || incomingDeviceError ? (
          <div className="mb-3 flex flex-col gap-2">
            {incomingRecording ? (
              <Notice tone="warning" icon={CircleDot} layout="inline" live="off">
                {t("chat.voice_call_recording_join_warning")}
              </Notice>
            ) : null}
            {incomingDeviceError ? (
              <Notice tone="destructive" icon={PhoneOff} layout="inline" live="assertive">
                {voiceCallDeviceMessage(incomingDeviceError, t)}
                {incomingDeviceError.failure === "denied" ? (
                  <span className="mt-0.5 block font-normal">{t("meetings.devicePreviewDeniedHint")}</span>
                ) : null}
              </Notice>
            ) : null}
          </div>
        ) : undefined;
      return (
        <PreConnectFloatingCall
          peerName={state.peerName}
          statusLabel={statusLabel}
          description={
            incomingRecording
              ? t("chat.voice_call_incoming_recorded_description", { status: statusLabel })
              : undefined
          }
          pulse
          alert
          notice={notice}
        >
          <VoiceCallLabeledAction
            label={t("chat.voice_call_decline")}
            ariaLabel={t("chat.voice_call_decline")}
            tone="decline"
            onClick={onDecline}
            icon={<PhoneOff aria-hidden className="size-5" />}
            compact
          />
          <VoiceCallLabeledAction
            label={incomingDeviceError ? t("common.retry") : t("chat.voice_call_accept")}
            ariaLabel={incomingDeviceError ? t("common.retry") : t("chat.voice_call_accept")}
            tone="accept"
            onClick={onAccept}
            icon={<Phone aria-hidden className="size-5" />}
            compact
          />
        </PreConnectFloatingCall>
      );
    }

    if (state.status === "ringing") {
      const statusLabel = isMultiPartyVoiceCall(state.callKind)
        ? t("chat.voice_call_group_calling")
        : t("chat.voice_call_calling");
      return (
        <PreConnectFloatingCall peerName={state.peerName} statusLabel={statusLabel} pulse>
          <VoiceCallLabeledAction
            label={t("chat.voice_call_end")}
            ariaLabel={t("chat.voice_call_end")}
            tone="decline"
            onClick={cancelPreConnect}
            icon={<PhoneOff aria-hidden className="size-5" />}
            compact
          />
        </PreConnectFloatingCall>
      );
    }

    if (state.status === "connecting") {
      const cancelLabel =
        isMultiPartyVoiceCall(state.callKind) && state.outgoing
          ? t("chat.voice_call_end_for_all")
          : isMultiPartyVoiceCall(state.callKind)
            ? t("chat.voice_call_leave")
            : t("chat.voice_call_end");
      return (
        <PreConnectFloatingCall peerName={state.peerName} statusLabel={t("chat.voice_call_connecting")}>
          <VoiceCallLabeledAction
            label={cancelLabel}
            ariaLabel={cancelLabel}
            tone="decline"
            onClick={cancelPreConnect}
            icon={<PhoneOff aria-hidden className="size-5" />}
            compact
          />
        </PreConnectFloatingCall>
      );
    }

    if (state.status !== "active") return null;

    return (
      <Suspense fallback={null}>
        <ActiveVoiceCallSession
          workspaceId={workspaceId}
          roomId={state.roomId}
          callId={state.callId}
          peerName={state.peerName}
          callKind={state.callKind}
          isCaller={state.outgoing}
          url={state.url}
          token={state.token}
          initialCameraEnabled={state.withCamera ?? false}
          panelMode={panelMode}
          onMinimize={handleMinimize}
          onMaximize={handleMaximize}
          onLeave={onLeave}
          onDisconnected={onDisconnected}
          onEndForAll={onEndForAll}
          onConnected={onConnected}
          onConnectFailed={handleConnectFailed}
        />
      </Suspense>
    );
  }
}
