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
import { cn } from "@/lib/utils";

/** One round control: a 64 pt target, its state in its label for VoiceOver/TalkBack. */
export function CallButton(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: "default" | "danger" | "accept";
  active?: boolean;
  testID?: string;
}) {
  const { tone = "default", active } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={active === undefined ? undefined : { selected: active }}
      testID={props.testID}
      onPress={props.onPress}
      className={cn(
        "h-16 w-16 items-center justify-center rounded-full",
        tone === "danger" ? "bg-destructive" : tone === "accept" ? "bg-success-solid" : active ? "bg-white" : "bg-white/20",
      )}
    >
      <Ionicons name={props.icon} size={28} color={tone === "default" && active ? "black" : "white"} />
    </Pressable>
  );
}

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

function RoomStage({ peerName, connected }: { peerName: string; connected: boolean }) {
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

  return (
    <View className="flex-1" testID="call-active">
      {remote && isTrackReference(remote) ? (
        <VideoTrack trackRef={remote} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} objectFit="cover" />
      ) : null}
      {local && isTrackReference(local) && isCameraEnabled ? (
        <View className="absolute right-4 top-16 overflow-hidden rounded-xl" style={{ width: 110, height: 160 }}>
          <VideoTrack trackRef={local} style={{ width: 110, height: 160 }} objectFit="cover" mirror />
        </View>
      ) : null}
      <View className="flex-1 items-center justify-center gap-2 px-6">
        {remote ? null : (
          <Text className="text-center text-2xl font-semibold text-white" numberOfLines={2}>
            {peerName}
          </Text>
        )}
        <Text className="text-white/80">
          {connected ? t("chat.voice_call_connected_duration", { duration: formatVoiceCallDuration(elapsed) }) : t("chat.voice_call_connecting")}
        </Text>
      </View>
      <View className="flex-row items-center justify-evenly pb-12 pt-6">
        <CallButton
          icon={isMicrophoneEnabled ? "mic" : "mic-off"}
          label={t("chat.voice_call_mic")}
          active={!isMicrophoneEnabled}
          testID="call-mute"
          onPress={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        />
        <CallButton
          icon={isCameraEnabled ? "videocam" : "videocam-off"}
          label={t("chat.voice_call_camera")}
          active={isCameraEnabled}
          testID="call-video"
          onPress={() => void localParticipant.setCameraEnabled(!isCameraEnabled)}
        />
        <CallButton icon="volume-high" label={t("chat.mobile.call_speaker")} active={speaker} testID="call-speaker" onPress={toggleSpeaker} />
        <CallButton icon="call" label={t("chat.voice_call_end")} tone="danger" testID="call-hangup" onPress={() => void callEngine.hangUp()} />
      </View>
    </View>
  );
}

export function CallRoom({ url, token, peerName, withCamera }: { url: string; token: string; peerName: string; withCamera: boolean }) {
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
      <RoomStage peerName={peerName} connected={connected} />
    </LiveKitRoom>
  );
}
