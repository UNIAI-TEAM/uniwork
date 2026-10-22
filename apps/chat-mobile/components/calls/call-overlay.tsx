// The call screen (spec M3 §2): one full-screen layer over the app, drawn
// from the call engine's state, so a call outlives any screen under it. Dark
// in both app themes (canvas MobileCall / MobCallStates, call-surface.tsx).
// Incoming: answer or decline. Ringing and connecting: hang up. Active: the
// LiveKit room (call-room.tsx). Ended: why, then close or call again, as the
// web's voice-call-ended-panel.tsx. Mounted once in (app)/_layout.tsx. A plain
// view, not a Modal: iOS will not present a modal over one already open (an
// action sheet, the picker), and a call must show whatever is open. A live
// call lifts the app lock's screen (components/app/privacy-guard.tsx), so
// while the lock is engaged the call cannot shrink: shrunk, it would leave
// every chat usable past the lock; already shrunk, it takes the screen again.
// The phone's own lock likewise: a call answered over it shrinks only after
// Android's unlock (nativeCalls.leaveLockScreen); cancelled, it stays whole.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BackHandler, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppLockEngaged } from "@/components/app/app-lock-state";
import { haptics } from "@/components/ui/haptics";
import { ensureCallPermissions } from "@/components/ui/permission-gate";
import { Text } from "@/components/ui/text";
import { callEngine, useVoiceCall } from "@/data/calls/call-store";
import { nativeCalls } from "@/data/calls/native-calls";
import { callRecordingOptions, roomsOptions } from "@/data/queries/chat";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import type { CallRoom as CallRoomComponent } from "./call-room";
import { ringtoneFor } from "@/lib/call-ringtone";
import { voiceCallEndedMessage } from "@/lib/voice-call";
import { isMultiPartyVoiceCall } from "@uniwork/core/chat/voice-call-kind";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";
import { CALL, CallButton, CallerHero } from "./call-surface";
import { useCallRingtone } from "./use-call-ringtone";

/**
 * The LiveKit room, WebRTC and their globals (call-room.tsx sets them when it loads) load the first time a
 * call shows, not at app start (audit P2 Perf): a launch that never calls never evaluates them. Metro runs
 * a module when it is first required; a ringing or connecting call requires it, so going live does not wait.
 */
function loadCallRoom(): typeof CallRoomComponent {
  // A static import would run LiveKit with the app shell: this require is the lazy load (no dynamic import()
  // on purpose, Jest's runtime cannot run one); Metro still bundles ./call-room from the literal path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("./call-room") as typeof import("./call-room")).CallRoom;
}

function CallRoom(props: Parameters<typeof CallRoomComponent>[0]) {
  const Room = loadCallRoom();
  return <Room {...props} />;
}

/** Declining or ending a call: felt, then sent. */
function hangUp(): void {
  haptics.callEnd();
  void callEngine.hangUp();
}
const HIDDEN = { position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" } as const;

const RETRY_REASONS = new Set(["connect_failed", "start_failed"]);
const CALL_BACK_REASONS = new Set(["no_answer", "missed", "declined"]);

/** How often a live call asks whether it is being recorded ("Đang ghi"). */
const RECORDING_POLL_MS = 15_000;

function CallBody({
  call,
  recording,
  onMinimize,
  minimized,
  seed,
}: {
  call: Exclude<VoiceCallOverlayState, { status: "idle" }>;
  recording: boolean;
  onMinimize?: () => void;
  minimized: boolean;
  seed?: string;
}) {
  const { t } = useTranslation();
  switch (call.status) {
    case "incoming":
      return (
        <View className="flex-1" testID="call-incoming">
          <CallerHero
            name={call.peerName}
            line={
              isMultiPartyVoiceCall(call.callKind)
                ? t("chat.voice_call_incoming_group", { caller: call.callerName, group: call.peerName })
                : t("chat.voice_call_incoming_label")
            }
            rings={CALL.ringIncoming}
            seed={seed}
            room={isMultiPartyVoiceCall(call.callKind)}
          />
          <View className="flex-row justify-evenly px-6 pb-14">
            <CallButton icon="call" label={t("chat.voice_call_decline")} tone="danger" testID="call-decline" onPress={() => hangUp()} />
            <CallButton
              icon="call"
              label={t("chat.voice_call_accept")}
              tone="accept"
              ring={CALL.live}
              testID="call-accept"
              onPress={() => {
                haptics.callAccept();
                // The microphone is explained and asked before the call connects (an answered call starts with the camera off).
                // Only this call is answered: another may ring by the time the primer closes.
                const { callId } = call;
                void ensureCallPermissions(false, callId).then(() => callEngine.acceptCall(callId));
              }}
            />
          </View>
        </View>
      );
    case "ringing":
    case "connecting":
      return (
        <View className="flex-1" testID={`call-${call.status}`}>
          <CallerHero
            name={call.peerName}
            line={t(call.status === "ringing" ? "chat.voice_call_calling" : "chat.voice_call_connecting")}
            rings={call.status === "ringing" ? CALL.ringOutgoing : undefined}
            ringCount={1}
            seed={seed}
            room={isMultiPartyVoiceCall(call.callKind)}
          />
          <View className="items-center px-6 pb-14">
            <CallButton icon="call" label={t("chat.voice_call_end")} tone="danger" testID="call-hangup" onPress={() => hangUp()} />
          </View>
        </View>
      );
    case "active":
      return (
        <CallRoom
          url={call.url}
          token={call.token}
          peerName={call.peerName}
          withCamera={call.withCamera ?? false}
          recording={recording}
          onMinimize={onMinimize}
          minimized={minimized}
          seed={seed}
          roomFace={isMultiPartyVoiceCall(call.callKind)}
        />
      );
    case "ended": {
      const again = RETRY_REASONS.has(call.reason) ? t("common.retry") : CALL_BACK_REASONS.has(call.reason) ? t("chat.voice_call_call_back") : null;
      return (
        <View className="flex-1" testID="call-ended">
          <CallerHero name={call.peerName} line={voiceCallEndedMessage(call, t)} ended seed={seed} room={isMultiPartyVoiceCall(call.callKind)} />
          <View className="flex-row justify-evenly px-6 pb-14">
            <CallButton icon="close" label={t("common.close")} testID="call-dismiss" onPress={() => callEngine.dismissEnded()} />
            {again ? (
              <CallButton
                icon="call"
                label={again}
                tone="accept"
                testID="call-again"
                onPress={() => {
                  callEngine.dismissEnded();
                  void ensureCallPermissions(call.withCamera ?? false).then(() =>
                    callEngine.startCall(call.roomId, call.peerName, call.callKind, { withCamera: call.withCamera }),
                  );
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
  const { t } = useTranslation();
  const call = useVoiceCall();
  const shown = call.status !== "idle";
  useCallRingtone(ringtoneFor(call.status));
  const [minimized, setMinimized] = useState(false);
  const lockEngaged = useAppLockEngaged();
  const insets = useSafeAreaInsets();
  const live = call.status === "active";
  const wsId = useWorkspaceStore((s) => s.current?.wsId ?? "");
  // Asked only while the call is live: an empty room or call id turns the query off.
  const recording = useQuery(callRecordingOptions(wsId, live ? call.roomId : "", live ? call.callId : "", RECORDING_POLL_MS)).data === true;
  // The face takes the person's colour, as the list draws them: a DM's peer, else the room.
  const rooms = useQuery({ ...roomsOptions(wsId), enabled: shown && wsId !== "" }).data;
  const callRoomId = call.status === "idle" ? undefined : call.roomId;
  const callRoom = callRoomId ? rooms?.find((r) => r.id === callRoomId) : undefined;
  const faceSeed = callRoom?.kind === "dm" ? (callRoom.peer_user_id ?? callRoomId) : callRoomId;

  // Any call on screen loads the room's code (LiveKit, WebRTC) while it rings or connects, so going live does not wait for it.
  useEffect(() => {
    if (shown) loadCallRoom();
  }, [shown]);

  // Only a live call shrinks; ringing, connecting and ended always take the screen.
  useEffect(() => {
    if (!live) setMinimized(false);
  }, [live]);

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
  const small = minimized && live && !lockEngaged;
  // Over a locked phone the rest of the app shows only once the person unlocked it (Android asks for the PIN).
  const minimize = () => void nativeCalls.leaveLockScreen().then((left) => left && setMinimized(true));
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* Shrunk, the room stays mounted (unmounting would hang up) but takes no room and no touches. */}
      <SafeAreaView
        pointerEvents={small ? "none" : "auto"}
        style={small ? HIDDEN : [StyleSheet.absoluteFill, { backgroundColor: CALL.surface }]}
        accessibilityViewIsModal={!small}
        accessibilityElementsHidden={small}
        importantForAccessibility={small ? "no-hide-descendants" : "auto"}
        accessibilityLabel={call.peerName}
      >
        {/* Light status-bar glyphs over the dark call, whatever the app theme; unmounting hands back the root's. */}
        {small ? null : <StatusBar style="light" />}
        <CallBody call={call} recording={recording} onMinimize={lockEngaged ? undefined : minimize} minimized={small} seed={faceSeed} />
      </SafeAreaView>
      {small ? (
        // Just under a screen's 48 pt header, so its back button and title stay reachable; the status bar takes no touches.
        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: insets.top + 56 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("chat.mobile.call_back_to")}, ${call.peerName}`}
            testID="call-restore"
            hitSlop={{ top: 8, bottom: 8 }}
            onPress={() => setMinimized(false)}
            className="min-h-8 flex-row items-center gap-1.5 self-center rounded-full bg-success-solid px-3.5 py-1 shadow-lg active:opacity-80"
          >
            <Ionicons name="call" size={13} color={CALL.text} />
            <Text className="text-caption font-semibold" style={{ color: CALL.text }} numberOfLines={1}>
              {t("chat.mobile.call_back_to")}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
