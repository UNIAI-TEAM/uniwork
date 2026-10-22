// The media half of a call (spec M3 §2): LiveKit React Native in the room the
// engine minted a token for, the phone's version of the web's
// use-voice-call-room-connection.ts. Mic, camera, audio output and hang-up;
// the other side's video fills the screen and ours sits in a corner. The room
// letting go of us goes back to the engine — moved to another device of ours
// (DUPLICATE_IDENTITY) leaves the call alone there, anything else ends it here.
// A voice call starts on the earpiece, a video call on the speaker
// (lib/audio-outputs.ts); once connected, the call's foreground service is
// started again so it carries the microphone LiveKit now holds. The phone's own
// call answered meanwhile holds this one (use-cellular-hold.ts).
import { Ionicons } from "@expo/vector-icons";
import {
  AndroidAudioTypePresets,
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  isTrackReference,
  registerGlobals,
  useLocalParticipant,
  useTracks,
} from "@livekit/react-native";
import { DisconnectReason, Room, RoomEvent, Track } from "livekit-client";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { haptics } from "@/components/ui/haptics";
import { Text } from "@/components/ui/text";
import { nativeCallSync } from "@/data/calls/call-wiring";
import { callEngine } from "@/data/calls/call-store";
import { bestEffort } from "@/data/report";
import { preferredOutputs } from "@/lib/audio-outputs";
import { formatVoiceCallDuration } from "@uniwork/core/chat/voice-call-duration";
import { AudioOutputButton } from "./audio-output-button";
import { CALL, CallButton, CallerHero, SHADOW } from "./call-surface";
import { toggleCamera } from "./toggle-camera";
import { useCellularHold } from "./use-cellular-hold";

// WebRTC globals for LiveKit, once, when the call UI first loads (call-overlay.tsx loads this
// module when a call shows), not at app start: a launch that never calls never pays for them.
registerGlobals();

function useElapsed(running: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return seconds;
}

function RoomStage({
  peerName,
  connected,
  recording,
  held,
  onMinimize,
  minimized,
  seed,
  room,
  video,
}: {
  peerName: string;
  connected: boolean;
  recording: boolean;
  held: boolean;
  onMinimize?: () => void;
  minimized: boolean;
  seed?: string;
  room?: boolean;
  video: boolean;
}) {
  const { t } = useTranslation();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera]);
  const elapsed = useElapsed(connected);
  const remote = tracks.find((ref) => isTrackReference(ref) && !ref.participant.isLocal);
  const local = tracks.find((ref) => isTrackReference(ref) && ref.participant.isLocal);

  const clock = formatVoiceCallDuration(elapsed);
  // MobileCall board: "Cuộc gọi thoại · 04:12" under the face; over video the corner shows the clock alone.
  const status = connected ? (remote ? clock : t("chat.mobile.call_voice_duration", { duration: clock })) : t("chat.voice_call_connecting");

  return (
    <View className="flex-1" testID="call-active">
      {remote && isTrackReference(remote) ? (
        <VideoTrack trackRef={remote} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} objectFit="cover" />
      ) : null}
      {remote ? (
        <>
          {/* Scrims keep the corner text and the controls readable over the picture. */}
          <View pointerEvents="none" className="absolute inset-x-0 top-0 h-36" style={{ backgroundColor: CALL.scrim, opacity: 0.7 }} />
          <View pointerEvents="none" className="absolute inset-x-0 bottom-0 h-48" style={{ backgroundColor: CALL.scrim, opacity: 0.8 }} />
        </>
      ) : null}
      {/* The top bar (MobileCall board): shrink the call to a pill (not while the app lock is engaged), and say when it is being recorded. */}
      <View className="absolute left-0 right-0 top-1 z-10 min-h-11 flex-row items-center px-4">
        {onMinimize ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("chat.mobile.call_minimize")}
            testID="call-minimize"
            onPress={onMinimize}
            className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
            style={{ backgroundColor: CALL.fill }}
          >
            <Ionicons name="chevron-down" size={24} color={CALL.text} />
          </Pressable>
        ) : (
          <View className="w-11" />
        )}
        <View className="flex-1 items-center gap-1">
          {held ? (
            // The phone's own call has the line (use-cellular-hold.ts): our microphone and the other side are off.
            <View
              className="min-h-7 flex-row items-center gap-1.5 rounded-full px-2.5"
              style={{ backgroundColor: CALL.fill }}
              accessibilityRole="text"
              accessibilityLiveRegion="polite"
            >
              <Ionicons name="pause" size={12} color={CALL.text} />
              <Text className="text-footnote font-semibold" style={{ color: CALL.text }} numberOfLines={1}>
                {t("mobile.call_audio.held")}
              </Text>
            </View>
          ) : null}
          {recording ? (
            <View
              className="min-h-7 flex-row items-center gap-1.5 rounded-full px-2.5"
              style={{ backgroundColor: CALL.fill }}
              accessibilityRole="text"
            >
              <View className="h-2 w-2 rounded-full bg-destructive-solid" />
              <Text className="text-footnote font-semibold" style={{ color: CALL.text }}>
                {t("chat.mobile.call_recording")}
              </Text>
            </View>
          ) : null}
        </View>
        <View className="w-11" />
      </View>
      {/* Voice: the caller in the middle. Video: their picture is the screen, the name stays in a corner over it. */}
      {remote ? <View className="flex-1" /> : <CallerHero name={peerName} line={status} live={connected} seed={seed} room={room} />}
      {remote ? (
        <View className="absolute left-5 right-[140px] top-14 gap-0.5">
          <Text className="text-title3 font-display font-bold" style={[{ color: CALL.text }, SHADOW]} numberOfLines={1}>
            {peerName}
          </Text>
          <View className="flex-row items-center gap-1.5">
            {connected ? <View className="h-2 w-2 rounded-full" style={{ backgroundColor: CALL.live }} /> : null}
            <Text className="text-callout" style={[{ color: CALL.soft, fontVariant: ["tabular-nums"] }, SHADOW]} accessibilityRole="timer">
              {status}
            </Text>
          </View>
        </View>
      ) : null}
      {recording ? (
        <View className="mb-4 flex-row items-center gap-1.5 self-center rounded-full px-3 py-1.5" style={{ backgroundColor: CALL.fill }}>
          <Ionicons name="sparkles" size={14} color={CALL.text} />
          <Text className="text-footnote" style={{ color: CALL.soft }}>
            {t("chat.mobile.call_summary_hint")}
          </Text>
        </View>
      ) : null}
      {local && isTrackReference(local) && isCameraEnabled ? (
        <View
          className="absolute right-4 top-16 overflow-hidden rounded-[14px] border"
          style={{
            width: 110,
            height: 160,
            borderColor: CALL.fill,
            shadowColor: "#000",
            shadowOpacity: 0.35,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
          }}
        >
          <VideoTrack trackRef={local} style={{ width: 110, height: 160 }} objectFit="cover" mirror />
          <View className="absolute bottom-1.5 left-1.5 rounded-full px-2 py-0.5" style={{ backgroundColor: CALL.scrim }}>
            <Text className="text-caption font-semibold" style={{ color: CALL.text }}>
              {t("chat.you")}
            </Text>
          </View>
        </View>
      ) : null}
      {/* Loa · Camera · Micro · Kết thúc, as the MobileCall board orders them. */}
      <View className="flex-row items-start justify-evenly px-5 pb-[52px] pt-6">
        <AudioOutputButton video={video} connected={connected} onScreen={!minimized} />
        <CallButton
          icon={isCameraEnabled ? "videocam" : "videocam-off"}
          label={t("chat.voice_call_camera")}
          active={isCameraEnabled}
          testID="call-video"
          onPress={() => void toggleCamera(isCameraEnabled, (on) => localParticipant.setCameraEnabled(on))}
        />
        <CallButton
          icon={isMicrophoneEnabled ? "mic" : "mic-off"}
          label={t(isMicrophoneEnabled ? "chat.voice_call_mic" : "chat.voice_call_mic_off")}
          active={!isMicrophoneEnabled}
          testID="call-mute"
          onPress={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        />
        <CallButton
          icon="call"
          label={t("chat.voice_call_end")}
          tone="danger"
          testID="call-hangup"
          onPress={() => {
            haptics.callEnd();
            void callEngine.hangUp();
          }}
        />
      </View>
    </View>
  );
}

export function CallRoom({
  url,
  token,
  peerName,
  withCamera,
  recording,
  onMinimize,
  minimized = false,
  seed,
  roomFace,
}: {
  url: string;
  token: string;
  peerName: string;
  withCamera: boolean;
  recording: boolean;
  /** Shrinks the call to a pill; absent while the app lock is engaged (only the call may show past the lock). */
  onMinimize?: () => void;
  /** Shrunk to a pill: the room stays mounted (unmounting would hang up) but its screen is not in front. */
  minimized?: boolean;
  seed?: string;
  /** A group or channel call: the face shows the room's letters. */
  roomFace?: boolean;
}) {
  const room = useMemo(() => new Room({ adaptiveStream: true, dynacast: true }), []);
  const [connected, setConnected] = useState(false);
  const held = useCellularHold(room, connected);

  useEffect(() => {
    // Phone audio routing for the length of the call; LiveKit's AudioSession owns it until then.
    void AudioSession.configureAudio({
      android: { preferredOutputList: preferredOutputs(withCamera), audioTypeOptions: AndroidAudioTypePresets.communication },
      ios: { defaultOutput: withCamera ? "speaker" : "earpiece" },
    })
      .catch(bestEffort("calls", "audio routing not configured", "report"))
      .then(() => AudioSession.startAudioSession());
    const onDisconnected = (reason?: DisconnectReason) =>
      callEngine.finalizeCallOnDisconnect({ movedElsewhere: reason === DisconnectReason.DUPLICATE_IDENTITY });
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
      void room.disconnect();
      void AudioSession.stopAudioSession();
    };
    // The route is chosen once per call; the room, not the camera button, decides it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  return (
    <LiveKitRoom
      room={room}
      serverUrl={url}
      token={token}
      connect
      audio
      video={withCamera}
      onConnected={() => {
        setConnected(true);
        callEngine.markConnected();
        nativeCallSync.refresh(callEngine.store.getState().call);
      }}
    >
      <RoomStage
        peerName={peerName}
        connected={connected}
        recording={recording}
        held={held}
        onMinimize={onMinimize}
        minimized={minimized}
        seed={seed}
        room={roomFace}
        video={withCamera}
      />
    </LiveKitRoom>
  );
}
