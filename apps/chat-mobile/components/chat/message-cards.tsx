// What a message shows inside its row, by kind (spec §4): text with its
// mentions, stickers and GIFs, images and files (open with the OS), voice
// (listen), poll results, note, post, reminder and call cards (read-only), and
// an "Open on the web" row for a kind this build does not know.
import { Ionicons } from "@expo/vector-icons";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { deepLinkHref } from "@/lib/deep-link";
import { parseChatMediaMessageBody } from "@/lib/media-body";
import {
  formatFileSize,
  formatVoiceCallDuration,
  isReminderDue,
  messageView,
  pollResults,
  voiceCallLogLabel,
} from "@/lib/message-display";
import { mentionSegments } from "@/lib/mentions";
import { THEME } from "@/lib/theme";
import { formatMessageDateTime } from "@/lib/timeline-display";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";
import { useChatMediaSrc, useFreshChatMediaUrl } from "./use-chat-media";

export interface MessageCardContext {
  wsId: string;
  orgSlug: string;
  wsSlug: string;
  roomId: string;
  userId: string;
  onOpenImage: (url: string, name: string) => void;
}

/** The views whose card is a button of its own (the row then is not one accessible element). */
export const INTERACTIVE_VIEWS = new Set(["image", "file", "voice", "unsupported"]);

/** A card's own button still opens the message's actions on a long-press, for touch and for VoiceOver/TalkBack. */
function useLongPressProps(onLongPress: () => void) {
  const { t } = useTranslation();
  return {
    onLongPress,
    accessibilityActions: [{ name: "longpress", label: t("chat.message_actions_aria") }],
    onAccessibilityAction: () => onLongPress(),
  };
}

function useIconColor(own: boolean) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return own ? theme.primaryForeground : theme.mutedForeground;
}

/** Text with @mentions set apart; a mention of the reader stands out more. */
function MessageText({ body, own, userId }: { body: string; own: boolean; userId: string }) {
  return (
    <Text className={cn("text-base", own ? "text-primary-foreground" : "text-foreground")}>
      {mentionSegments(body).map((segment, index) =>
        segment.mention ? (
          <Text
            key={index}
            className={cn(
              "font-semibold",
              own ? "text-primary-foreground underline" : segment.userId?.toUpperCase() === userId.toUpperCase() || segment.mention === "all" ? "text-primary" : "text-foreground",
            )}
          >
            {segment.text}
          </Text>
        ) : (
          segment.text
        ),
      )}
    </Text>
  );
}

function CardShell({ own, icon, title, children, label }: { own: boolean; icon: keyof typeof Ionicons.glyphMap; title: string; children?: React.ReactNode; label?: string }) {
  const color = useIconColor(own);
  return (
    <View className="gap-1.5 min-w-[200px]" accessible accessibilityLabel={label}>
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={18} color={color} />
        <Text className={cn("flex-1 text-sm font-semibold", own ? "text-primary-foreground" : "text-foreground")} numberOfLines={2}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

function ImageCard({ record, ctx, onLongPress }: { record: ChatMessageRecord; ctx: MessageCardContext; onLongPress: () => void }) {
  const { t } = useTranslation();
  const longPress = useLongPressProps(onLongPress);
  const file = record.file!;
  const src = useChatMediaSrc(ctx.wsId, ctx.roomId, record.id, file.thumb_url || file.url, file.url_expires_at);
  const freshUrl = useFreshChatMediaUrl(ctx.wsId, ctx.roomId);
  const open = () =>
    void freshUrl(record.id, { url: file.url, expiresAt: file.url_expires_at }, (m) => m.file?.url)
      .then((url) => ctx.onOpenImage(url, file.filename))
      .catch(() => Alert.alert(t("chat.media_unavailable", { name: file.filename })));
  return (
    <Pressable {...longPress} onPress={open} accessibilityRole="imagebutton" accessibilityLabel={t("chat.message_list.file_open_named", { name: file.filename || t("chat.media_image") })}>
      {src ? (
        <Image source={{ uri: src }} contentFit="cover" style={{ width: 220, height: 220, borderRadius: 12 }} />
      ) : (
        <View className="items-center justify-center rounded-xl bg-muted" style={{ width: 220, height: 220 }}>
          <Text className="text-xs text-muted-foreground">{t("chat.message_list.image_preview_loading")}</Text>
        </View>
      )}
    </Pressable>
  );
}

function FileCard({ record, ctx, own, onLongPress }: { record: ChatMessageRecord; ctx: MessageCardContext; own: boolean; onLongPress: () => void }) {
  const { t } = useTranslation();
  const longPress = useLongPressProps(onLongPress);
  const file = record.file!;
  const freshUrl = useFreshChatMediaUrl(ctx.wsId, ctx.roomId);
  const name = file.filename || t("chat.file_untitled");
  // The system browser opens a PDF, an image or an Office file itself and offers to save it.
  const open = () =>
    void freshUrl(record.id, { url: file.download_url || file.url, expiresAt: file.url_expires_at }, (m) => m.file?.download_url || m.file?.url)
      .then((url) => WebBrowser.openBrowserAsync(url))
      .catch(() => Alert.alert(t("chat.file_download_failed")));
  return (
    <Pressable {...longPress} onPress={open} accessibilityRole="button" accessibilityLabel={t("chat.message_list.file_open_named", { name })}>
      <CardShell own={own} icon="document-outline" title={name}>
        <Text className={cn("text-xs", own ? "text-primary-foreground/80" : "text-muted-foreground")}>
          {formatFileSize(file.size_bytes)} · {t("chat.file_open")}
        </Text>
      </CardShell>
    </Pressable>
  );
}

// iOS defaults to the ambient session, which the silent switch mutes; a voice message is meant to be heard.
let audioMode: Promise<void> | null = null;
const ensureAudioMode = () => (audioMode ??= setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined));

function VoiceCard({ record, ctx, own, onLongPress }: { record: ChatMessageRecord; ctx: MessageCardContext; own: boolean; onLongPress: () => void }) {
  const { t } = useTranslation();
  const longPress = useLongPressProps(onLongPress);
  const voice = record.voice!;
  const src = useChatMediaSrc(ctx.wsId, ctx.roomId, record.id, voice.url, voice.url_expires_at);
  const player = useAudioPlayer(src ? { uri: src } : null);
  const status = useAudioPlayerStatus(player);
  const color = useIconColor(own);
  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) void player.seekTo(0);
    void ensureAudioMode().then(() => player.play());
  };
  const total = formatVoiceCallDuration(voice.duration_ms / 1000);
  return (
    <Pressable
      {...longPress}
      onPress={toggle}
      disabled={!src}
      accessibilityRole="button"
      accessibilityLabel={`${status.playing ? t("chat.voice_pause") : t("chat.voice_play")}, ${total}`}
      className="flex-row items-center gap-3 min-h-11 min-w-[180px]"
    >
      <Ionicons name={status.playing ? "pause-circle" : "play-circle"} size={36} color={color} />
      <Text className={cn("text-sm", own ? "text-primary-foreground" : "text-foreground")}>
        {status.playing || status.currentTime > 0 ? `${formatVoiceCallDuration(status.currentTime)} / ${total}` : total}
      </Text>
    </Pressable>
  );
}

function PollCard({ poll, own }: { poll: NonNullable<ChatMessageRecord["poll"]>; own: boolean }) {
  const { t } = useTranslation();
  const results = pollResults(poll);
  return (
    <CardShell own={own} icon="stats-chart-outline" title={poll.question}>
      {results.options.map((option) => (
        <View key={option.id} className="gap-1" accessible accessibilityLabel={t("chat.poll_option_aria", { label: option.label, count: option.votes })}>
          <View className="flex-row justify-between gap-3">
            <Text className={cn("flex-1 text-sm", own ? "text-primary-foreground" : "text-foreground", option.mine && "font-semibold")}>{option.label}</Text>
            {results.hideCounts ? null : <Text className={cn("text-sm", own ? "text-primary-foreground" : "text-muted-foreground")}>{option.votes}</Text>}
          </View>
          {results.hideCounts ? null : (
            <View className={cn("h-1.5 rounded-full", own ? "bg-primary-foreground/30" : "bg-muted")}>
              <View className={cn("h-1.5 rounded-full", own ? "bg-primary-foreground" : "bg-primary")} style={{ width: `${option.percent}%` }} />
            </View>
          )}
        </View>
      ))}
    </CardShell>
  );
}

/** A row for what this build cannot show: say so, and open the message on the web. */
function UnsupportedCard({ record, ctx, onLongPress }: { record: Pick<ChatMessageRecord, "id">; ctx: MessageCardContext; onLongPress: () => void }) {
  const { t } = useTranslation();
  const longPress = useLongPressProps(onLongPress);
  const href = deepLinkHref({ orgSlug: ctx.orgSlug, wsSlug: ctx.wsSlug, roomId: ctx.roomId, messageId: record.id });
  return (
    <View className="gap-2">
      <Text className="text-sm italic text-muted-foreground">{t("chat.mobile.unsupported_message")}</Text>
      <Pressable
        {...longPress}
        accessibilityRole="link"
        className="min-h-11 justify-center"
        // The in-app browser does not follow universal links, so this stays on the web.
        onPress={() => void WebBrowser.openBrowserAsync(`${runtimeConfig().appUrl}${href}`)}
      >
        <Text className="text-sm font-semibold text-primary">{t("chat.mobile.open_on_web")}</Text>
      </Pressable>
    </View>
  );
}

/** The inside of a message row; null for a system line (the row draws those itself). */
export function MessageContent({ record, own, ctx, onLongPress }: { record: ChatMessageRecord; own: boolean; ctx: MessageCardContext; onLongPress: () => void }) {
  const { t, i18n } = useTranslation();
  const textClass = cn("text-sm", own ? "text-primary-foreground" : "text-foreground");
  switch (messageView(record)) {
    case "text":
      return <MessageText body={record.body} own={own} userId={ctx.userId} />;
    case "media": {
      const media = parseChatMediaMessageBody(record.body)!;
      return <Image source={{ uri: media.url }} contentFit="contain" style={{ width: 160, height: 160 }} accessibilityLabel={media.alt} />;
    }
    case "image":
      return <ImageCard record={record} ctx={ctx} onLongPress={onLongPress} />;
    case "file":
      return <FileCard record={record} ctx={ctx} own={own} onLongPress={onLongPress} />;
    case "voice":
      return <VoiceCard record={record} ctx={ctx} own={own} onLongPress={onLongPress} />;
    case "poll":
      return <PollCard poll={record.poll!} own={own} />;
    case "note":
      return (
        <CardShell own={own} icon="document-text-outline" title={t("chat.settings_notes")}>
          <Text className={textClass}>{record.note!.body}</Text>
        </CardShell>
      );
    case "post":
      return (
        <CardShell own={own} icon="newspaper-outline" title={record.post!.title}>
          <Text className={textClass}>{record.post!.body}</Text>
        </CardShell>
      );
    case "reminder": {
      const reminder = record.reminder!;
      const at = Date.parse(reminder.remind_at);
      return (
        <CardShell own={own} icon="alarm-outline" title={reminder.body}>
          <Text className={cn("text-xs", own ? "text-primary-foreground/80" : "text-muted-foreground")}>
            {isReminderDue(reminder.remind_at) ? t("chat.reminder_due_status") : `${t("chat.reminder_scheduled_label")} ${Number.isFinite(at) ? formatMessageDateTime(at, i18n.language) : ""}`}
          </Text>
        </CardShell>
      );
    }
    case "call-log":
      return <CardShell own={own} icon={record.voice_call?.video ? "videocam-outline" : "call-outline"} title={voiceCallLogLabel(record.voice_call, ctx.userId, t)} />;
    case "call-summary": {
      const summary = record.voice_call_summary!;
      return (
        <CardShell own={own} icon="sparkles-outline" title={summary.summary || t("chat.voice_call_summary_empty")}>
          {summary.highlights.map((line, index) => (
            <Text key={index} className={textClass}>
              • {line}
            </Text>
          ))}
        </CardShell>
      );
    }
    case "system":
      return null;
    case "unsupported":
      return <UnsupportedCard record={record} ctx={ctx} onLongPress={onLongPress} />;
  }
}
