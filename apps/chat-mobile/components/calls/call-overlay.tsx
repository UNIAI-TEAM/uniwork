// The call screen (spec M3 §2): one full-screen layer over the app, drawn
// from the call engine's state, so a call outlives any screen under it.
// Incoming: answer or decline. Ringing and connecting: hang up. Active: the
// LiveKit room (call-room.tsx). Ended: why, then close or call again, as the
// web's voice-call-ended-panel.tsx. Mounted once in (app)/_layout.tsx. A plain
// view, not a Modal: iOS will not present a modal over one already open (an
// action sheet, the picker), and a call must show whatever is open.
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BackHandler, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Text } from "@/components/ui/text";
import { callEngine, useVoiceCall } from "@/data/calls/call-store";
import { ringtoneFor } from "@/lib/call-ringtone";
import { isMultiPartyVoiceCall, voiceCallEndedMessage, type VoiceCallState } from "@/lib/voice-call";
import { CallButton, CallRoom } from "./call-room";
import { useCallRingtone } from "./use-call-ringtone";

const RETRY_REASONS = new Set(["connect_failed", "start_failed"]);
const CALL_BACK_REASONS = new Set(["no_answer", "missed", "declined"]);

function Caller({ name, line }: { name: string; line: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-6">
      <PersonAvatar name={name} size={96} />
      <Text className="text-center text-2xl font-semibold text-white" numberOfLines={2}>
        {name}
      </Text>
      <Text className="text-center text-base text-white/80">{line}</Text>
    </View>
  );
}

function CallBody({ call }: { call: Exclude<VoiceCallState, { status: "idle" }> }) {
  const { t } = useTranslation();
  switch (call.status) {
    case "incoming":
      return (
        <View className="flex-1" testID="call-incoming">
          <Caller
            name={call.peerName}
            line={isMultiPartyVoiceCall(call.callKind) ? t("chat.voice_call_incoming_group", { caller: call.callerName, group: call.peerName }) : t("chat.voice_call_incoming_label")}
          />
          <View className="flex-row justify-evenly pb-12">
            <CallButton icon="close" label={t("chat.voice_call_decline")} tone="danger" testID="call-decline" onPress={() => void callEngine.hangUp()} />
            <CallButton icon="call" label={t("chat.voice_call_accept")} tone="accept" testID="call-accept" onPress={() => void callEngine.acceptCall()} />
          </View>
        </View>
      );
    case "ringing":
    case "connecting":
      return (
        <View className="flex-1" testID={`call-${call.status}`}>
          <Caller name={call.peerName} line={t(call.status === "ringing" ? "chat.voice_call_calling" : "chat.voice_call_connecting")} />
          <View className="items-center pb-12">
            <CallButton icon="call" label={t("chat.voice_call_end")} tone="danger" testID="call-hangup" onPress={() => void callEngine.hangUp()} />
          </View>
        </View>
      );
    case "active":
      return <CallRoom url={call.url} token={call.token} peerName={call.peerName} withCamera={call.withCamera ?? false} />;
    case "ended": {
      const again = RETRY_REASONS.has(call.reason) ? t("common.retry") : CALL_BACK_REASONS.has(call.reason) ? t("chat.voice_call_call_back") : null;
      return (
        <View className="flex-1" testID="call-ended">
          <Caller name={call.peerName} line={voiceCallEndedMessage(call, t)} />
          <View className="flex-row justify-evenly pb-12">
            <CallButton icon="close" label={t("common.close")} testID="call-dismiss" onPress={() => callEngine.dismissEnded()} />
            {again ? (
              <CallButton
                icon="call"
                label={again}
                tone="accept"
                testID="call-again"
                onPress={() => {
                  callEngine.dismissEnded();
                  void callEngine.startCall(call.roomId, call.peerName, call.callKind, { withCamera: call.withCamera });
                }}
              />
            ) : null}
          </View>
        </View>
      );
    }
  }
}

export function CallOverlay() {
  const call = useVoiceCall();
  const shown = call.status !== "idle";
  useCallRingtone(ringtoneFor(call.status));

  // Android's back button closes a finished call's panel; a live call stays until hung up.
  useEffect(() => {
    if (!shown) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      callEngine.dismissEnded();
      return true;
    });
    return () => sub.remove();
  }, [shown]);

  if (call.status === "idle") return null;
  return (
    <SafeAreaView style={StyleSheet.absoluteFill} className="bg-black" accessibilityViewIsModal>
      <CallBody call={call} />
    </SafeAreaView>
  );
}
