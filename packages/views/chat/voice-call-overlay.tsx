"use client";

import { useEffect, useState } from "react";
import { Phone, PhoneOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useCallRingtone } from "./use-call-ringtone";
import { VoiceCallLabeledAction, type VoiceCallPanelMode } from "./voice-call-floating-panel";
import {
  ActiveVoiceCallSession,
  PreConnectFloatingCall,
} from "./voice-call-overlay-session";
import type { VoiceCallOverlayState } from "./voice-call-overlay-types";

export type { VoiceCallKind, VoiceCallOverlayState } from "./voice-call-overlay-types";

export function VoiceCallOverlay({
  state,
  onAccept,
  onDecline,
  onLeave,
  onEndForAll,
  onConnected,
}: {
  state: VoiceCallOverlayState;
  onAccept: () => void;
  onDecline: () => void;
  onLeave: () => void;
  onEndForAll: () => void;
  onConnected: () => void;
}) {
  const { t } = useTranslation();
  const [panelMode, setPanelMode] = useState<VoiceCallPanelMode>("expanded");

  const handleConnectFailed = () => {
    toast.error(t("chat.voice_call_connect_failed"));
    onLeave();
  };

  const cancelPreConnect = () => {
    if (state.status === "connecting" || state.status === "ringing") {
      if (state.callKind === "group" && state.outgoing) {
        onEndForAll();
        return;
      }
      if (state.callKind === "dm") {
        onEndForAll();
        return;
      }
    }
    onLeave();
  };

  useEffect(() => {
    if (state.status === "idle") {
      setPanelMode("expanded");
    }
  }, [state.status]);

  const ringtoneKind =
    state.status === "incoming" ? "incoming" : state.status === "ringing" ? "outgoing" : null;
  useCallRingtone(ringtoneKind);

  if (state.status === "incoming") {
    const statusLabel =
      state.callKind === "group"
        ? t("chat.voice_call_incoming_group", {
            caller: state.callerName ?? state.peerName,
            group: state.peerName,
          })
        : t("chat.voice_call_incoming_label");
    return (
      <PreConnectFloatingCall peerName={state.peerName} statusLabel={statusLabel} pulse>
        <VoiceCallLabeledAction
          label={t("chat.voice_call_decline")}
          ariaLabel={t("chat.voice_call_decline")}
          tone="decline"
          onClick={onDecline}
          icon={<PhoneOff aria-hidden className="size-5" />}
          compact
        />
        <VoiceCallLabeledAction
          label={t("chat.voice_call_accept")}
          ariaLabel={t("chat.voice_call_accept")}
          tone="accept"
          onClick={onAccept}
          icon={<Phone aria-hidden className="size-5" />}
          compact
        />
      </PreConnectFloatingCall>
    );
  }

  if (state.status === "ringing") {
    const statusLabel =
      state.callKind === "group"
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
      state.callKind === "group" && state.outgoing
        ? t("chat.voice_call_end_for_all")
        : state.callKind === "group"
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
    <ActiveVoiceCallSession
      peerName={state.peerName}
      callKind={state.callKind}
      isCaller={state.outgoing}
      url={state.url}
      token={state.token}
      panelMode={panelMode}
      onTogglePanelMode={() => setPanelMode((current) => (current === "expanded" ? "minimized" : "expanded"))}
      onLeave={onLeave}
      onEndForAll={onEndForAll}
      onConnected={onConnected}
      onConnectFailed={handleConnectFailed}
    />
  );
}
