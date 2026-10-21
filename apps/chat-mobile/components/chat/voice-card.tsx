// A voice message in its bubble (audit UX P3 "voice-player-basic"): play and
// pause, a tap on the bars seeks there, and a speed chip cycles 1× / 1.5× /
// 2× (lib/voice-player.ts), as WhatsApp and Telegram offer. To a screen
// reader the player is one adjustable control: its value is where it is in
// the clip, swiping up or down seeks five seconds, a double tap plays or
// pauses, and it says when the clip cannot play yet. The bars stay a fixed
// shape: the server keeps no waveform of a clip.
import { Ionicons } from "@expo/vector-icons";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { formatVoiceCallDuration } from "@uniwork/core/chat/voice-call-duration";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View, type AccessibilityActionEvent, type GestureResponderEvent } from "react-native";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { bestEffort } from "@/data/report";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { nextVoiceRate, playedBars, seekBy, seekToTap, VOICE_SEEK_STEP_S, type VoiceRate } from "@/lib/voice-player";
import type { MessageCardContext } from "./message-cards";
import { useChatMediaSrc } from "./use-chat-media";

/** A voice message's bars (MobileChat): the server sends no waveform, so the shape is fixed and only the progress is real. */
const VOICE_BARS = [8, 14, 20, 12, 24, 18, 26, 16, 10, 22, 26, 14, 8, 18, 24, 12, 20, 26, 16, 10, 14, 22, 18, 8, 12, 24, 20, 14, 10, 8];

// iOS defaults to the ambient session, which the silent switch mutes; a voice message is meant to be heard.
let audioMode: Promise<void> | null = null;
const ensureAudioMode = () => (audioMode ??= setAudioModeAsync({ playsInSilentMode: true }).catch(bestEffort("chat", "audio mode not set", "breadcrumb")));

interface Props {
  record: ChatMessageRecord;
  voice: NonNullable<ChatMessageRecord["voice"]>;
  ctx: MessageCardContext;
  own: boolean;
  onLongPress: () => void;
}

export function VoiceCard({ record, voice, ctx, own, onLongPress }: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const src = useChatMediaSrc(ctx.wsId, ctx.roomId, record.id, voice.url, voice.url_expires_at);
  const player = useAudioPlayer(src ? { uri: src } : null);
  const status = useAudioPlayerStatus(player);
  const [rate, setRate] = useState<VoiceRate>(1);
  const [barsWidth, setBarsWidth] = useState(0);
  const duration = status.duration > 0 ? status.duration : voice.duration_ms / 1000;

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) void player.seekTo(0);
    void ensureAudioMode().then(() => player.play());
  };
  const seek = (to: number) => void player.seekTo(to).catch(bestEffort("chat", "voice seek failed", "breadcrumb"));
  const cycleRate = () => {
    const next = nextVoiceRate(rate);
    setRate(next);
    player.setPlaybackRate(next);
  };
  const onAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName;
    if (name === "increment") seek(seekBy(status.currentTime, VOICE_SEEK_STEP_S, duration));
    else if (name === "decrement") seek(seekBy(status.currentTime, -VOICE_SEEK_STEP_S, duration));
    else if (name === "activate") toggle();
    else onLongPress();
  };

  const total = formatVoiceCallDuration(voice.duration_ms / 1000);
  const position = formatVoiceCallDuration(status.currentTime);
  const played = playedBars(status.currentTime, status.duration, VOICE_BARS.length);
  const started = status.playing || status.currentTime > 0;
  return (
    <View className="min-h-11 min-w-[220px] flex-row items-center gap-2.5">
      <Pressable
        onPress={toggle}
        onLongPress={onLongPress}
        disabled={!src}
        accessibilityRole="adjustable"
        accessibilityLabel={`${status.playing ? t("chat.voice_pause") : t("chat.voice_play")}, ${total}`}
        accessibilityValue={{ text: t("chat.message_list.voice_position", { position, duration: total }) }}
        accessibilityState={{ disabled: !src }}
        accessibilityActions={[
          { name: "activate" },
          { name: "increment", label: t("mobile.voice.seek_forward", { seconds: VOICE_SEEK_STEP_S }) },
          { name: "decrement", label: t("mobile.voice.seek_back", { seconds: VOICE_SEEK_STEP_S }) },
          { name: "longpress", label: t("chat.message_actions_aria") },
        ]}
        onAccessibilityAction={onAction}
        testID="voice-play"
        className={cn("h-11 w-11 items-center justify-center rounded-full", own ? "bg-chat-bubble-own-foreground" : "bg-chat-bubble-own", !src && "opacity-50")}
      >
        <Ionicons name={status.playing ? "pause" : "play"} size={18} color={own ? theme.chatBubbleOwn : theme.chatBubbleOwnForeground} />
      </Pressable>
      <View className="flex-1 gap-1">
        {/* A tap on the bars seeks there; the player's adjustable actions do the same for a screen reader. */}
        <Pressable
          onPress={(event: GestureResponderEvent) => seek(seekToTap(event.nativeEvent.locationX, barsWidth, duration))}
          onLongPress={onLongPress}
          disabled={!src}
          onLayout={(event) => setBarsWidth(event.nativeEvent.layout.width)}
          accessibilityRole="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="voice-bars"
          className="h-[26px] flex-row items-center gap-0.5"
        >
          {VOICE_BARS.map((height, index) => (
            <View
              key={index}
              className={cn(
                "w-[3px] rounded-full",
                index < played ? (own ? "bg-chat-bubble-own-foreground" : "bg-chat-bubble-own") : own ? "bg-chat-bubble-own-foreground/40" : "bg-muted-foreground/40",
              )}
              style={{ height }}
            />
          ))}
        </Pressable>
        <Text className={cn("text-caption", own ? "text-chat-bubble-own-meta" : "text-muted-foreground")}>{started ? `${position} / ${total}` : total}</Text>
      </View>
      <Pressable
        onPress={cycleRate}
        accessibilityRole="button"
        accessibilityLabel={t("chat.voice_speed_label", { rate })}
        testID="voice-rate"
        hitSlop={8}
        className={cn("min-h-7 min-w-10 items-center justify-center rounded-full px-2", own ? "bg-chat-bubble-own-foreground/15" : "bg-muted")}
      >
        <Text className={cn("text-caption font-semibold", own ? "text-chat-bubble-own-foreground" : "text-foreground")} style={{ fontVariant: ["tabular-nums"] }}>
          {t("chat.voice_speed", { rate })}
        </Text>
      </Pressable>
    </View>
  );
}
