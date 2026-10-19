// The media half of a call (spec M3 §2): LiveKit React Native in the room the
// engine minted a token for, the phone's version of the web's
// use-voice-call-room-connection.ts. Mic, camera, speaker and hang-up; the
// other side's video fills the screen and ours sits in a corner. The room
// letting go of us goes back to the engine — moved to another device of ours
// (DUPLICATE_IDENTITY) leaves the call alone there, anything else ends it here.
import { Ionicons } from "@expo/vector-icons";
import { AudioSession, LiveKitRoom, VideoTrack, isTrackReference, useLocalParticipant, useTracks } from "@livekit/react-native";
import { DisconnectReason, Room, RoomEvent, Track } from "livekit-client";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { callEngine } from "@/data/calls/call-store";
import { formatVoiceCallDuration } from "@/lib/message-display";
import { CALL, CallButton, CallerHero, SHADOW } from "./call-surface";

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

function RoomStage({ peerName, connected, recording, onMinimize, seed, room }: { peerName: string; connected: boolean; recording: boolean; onMinimize: () => void; seed?: string; room?: boolean }) {
  const { t } = useTranslation();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera]);
  const [speaker, setSpeaker] = useState(false);
  const elapsed = useElapsed(connected);
  const remote = tracks.find((ref) => isTrackReference(ref) && !ref.participant.isLocal);
  const local = tracks.find((ref) => isTrackReference(ref) && ref.participant.isLocal);

  const toggleSpeaker = () => {
    const next = !speaker;
    setSpeaker(next);
    // Android names its outputs; iOS can only force the speaker or go back to its own routing.
    void AudioSession.selectAudioOutput(Platform.OS === "ios" ? (next ? "force_speaker" : "default") : next ? "speaker" : "earpiece").catch(() => setSpeaker(!next));
  };

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
      {/* The top bar (MobileCall board): shrink the call to a pill, and say when it is being recorded. */}
      <View className="absolute left-0 right-0 top-1 z-10 h-11 flex-row items-center px-4">
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
        <View className="flex-1 items-center">
          {recording ? (
            <View className="h-7 flex-row items-center gap-1.5 rounded-full px-2.5" style={{ backgroundColor: CALL.fill }} accessibilityRole="text">
              <View className="h-2 w-2 rounded-full bg-destructive-solid" />
              <Text className="text-[13px] font-semibold" style={{ color: CALL.text }}>
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
          <Text className="text-lg font-display font-bold" style={[{ color: CALL.text }, SHADOW]} numberOfLines={1}>
            {peerName}
          </Text>
          <View className="flex-row items-center gap-1.5">
            {connected ? <View className="h-2 w-2 rounded-full" style={{ backgroundColor: CALL.live }} /> : null}
            <Text className="text-sm" style={[{ color: CALL.soft, fontVariant: ["tabular-nums"] }, SHADOW]} accessibilityRole="timer">
              {status}
            </Text>
          </View>
        </View>
      ) : null}
      {recording ? (
        <View className="mb-4 flex-row items-center gap-1.5 self-center rounded-full px-3 py-1.5" style={{ backgroundColor: CALL.fill }}>
          <Ionicons name="sparkles" size={14} color={CALL.text} />
          <Text className="text-[13px]" style={{ color: CALL.soft }}>
            {t("chat.mobile.call_summary_hint")}
          </Text>
        </View>
      ) : null}
      {local && isTrackReference(local) && isCameraEnabled ? (
        <View className="absolute right-4 top-16 overflow-hidden rounded-[14px] border" style={{ width: 110, height: 160, borderColor: CALL.fill, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }}>
          <VideoTrack trackRef={local} style={{ width: 110, height: 160 }} objectFit="cover" mirror />
          <View className="absolute bottom-1.5 left-1.5 rounded-full px-2 py-0.5" style={{ backgroundColor: CALL.scrim }}>
            <Text className="text-xs font-semibold" style={{ color: CALL.text }}>
              {t("chat.you")}
            </Text>
          </View>
        </View>
      ) : null}
      {/* Loa · Camera · Micro · Kết thúc, as the MobileCall board orders them. */}
      <View className="flex-row items-start justify-evenly px-5 pb-[52px] pt-6">
        <CallButton icon="volume-high" label={t("chat.mobile.call_speaker")} active={speaker} testID="call-speaker" onPress={toggleSpeaker} />
        <CallButton
          icon={isCameraEnabled ? "videocam" : "videocam-off"}
          label={t("chat.voice_call_camera")}
          active={isCameraEnabled}
          testID="call-video"
          onPress={() => void localParticipant.setCameraEnabled(!isCameraEnabled)}
        />
        <CallButton
          icon={isMicrophoneEnabled ? "mic" : "mic-off"}
          label={t(isMicrophoneEnabled ? "chat.voice_call_mic" : "chat.voice_call_mic_off")}
          active={!isMicrophoneEnabled}
          testID="call-mute"
          onPress={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        />
        <CallButton icon="call" label={t("chat.voice_call_end")} tone="danger" testID="call-hangup" onPress={() => void callEngine.hangUp()} />
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
  seed,
  roomFace,
}: {
  url: string;
  token: string;
  peerName: string;
  withCamera: boolean;
  recording: boolean;
  onMinimize: () => void;
  seed?: string;
  /** A group or channel call: the face shows the room's letters. */
  roomFace?: boolean;
}) {
  const room = useMemo(() => new Room({ adaptiveStream: true, dynacast: true }), []);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Phone audio routing for the length of the call; LiveKit's AudioSession owns it until then.
    void AudioSession.startAudioSession();
    const onDisconnected = (reason?: DisconnectReason) =>
      callEngine.finalizeCallOnDisconnect({ movedElsewhere: reason === DisconnectReason.DUPLICATE_IDENTITY });
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
      void room.disconnect();
      void AudioSession.stopAudioSession();
    };
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
      }}
    >
      <RoomStage peerName={peerName} connected={connected} recording={recording} onMinimize={onMinimize} seed={seed} room={roomFace} />
    </LiveKitRoom>
  );
}
