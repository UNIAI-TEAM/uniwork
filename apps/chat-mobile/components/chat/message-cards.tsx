// What a message shows inside its row, by kind (spec §4): text with its
// mentions, stickers and GIFs, images and files (open with the OS), voice
// (listen), a poll to vote in (M3), note, post, reminder and call cards
// (read-only), and an "Open on the web" row for a kind this build does not know.
// The look is the canvas's (MobileChat, WebCardKinds): a tinted tile and an
// overline head each card, inked for the bubble it sits in (`own`).
import { Ionicons } from "@expo/vector-icons";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { TINTS, TintTile } from "@/components/ui/tint-tile";
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
import { fileBadge, type Tint } from "@/lib/tint";
import { formatMessageDateTime, formatMessageTime } from "@/lib/timeline-display";
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
  /** A tap on a poll option (M3); the cache takes the answer. */
  onVotePoll: (messageId: string, optionId: string) => void;
}

/** The views whose card is a button of its own (the row then is not one accessible element). */
export const INTERACTIVE_VIEWS = new Set(["image", "file", "voice", "poll", "unsupported"]);

/** A voice message's bars (MobileChat): the server sends no waveform, so the shape is fixed and only the progress is real. */
const VOICE_BARS = [8, 14, 20, 12, 24, 18, 26, 16, 10, 22, 26, 14, 8, 18, 24, 12, 20, 26, 16, 10, 14, 22, 18, 8, 12, 24, 20, 14, 10, 8];

/** The text classes of a card in the brand bubble (own) or the other bubble. */
const ink = (own: boolean) => ({
  text: own ? "text-chat-bubble-own-foreground" : "text-foreground",
  meta: own ? "text-chat-bubble-own-meta" : "text-muted-foreground",
});

function useTheme() {
  const { colorScheme } = useColorScheme();
  return THEME[colorScheme];
}

/** A card's own button still opens the message's actions on a long-press, for touch and for VoiceOver/TalkBack. */
function useLongPressProps(onLongPress: () => void) {
  const { t } = useTranslation();
  return {
    onLongPress,
    accessibilityActions: [{ name: "longpress", label: t("chat.message_actions_aria") }],
    onAccessibilityAction: () => onLongPress(),
  };
}

/** Text with @mentions set apart; a mention of the reader stands out more. */
function MessageText({ body, own, userId }: { body: string; own: boolean; userId: string }) {
  return (
    <Text className={cn("text-base", ink(own).text)}>
      {mentionSegments(body).map((segment, index) =>
        segment.mention ? (
          <Text
            key={index}
            className={cn(
              "font-semibold",
              own
                ? "text-chat-bubble-own-foreground underline"
                : segment.userId?.toUpperCase() === userId.toUpperCase() || segment.mention === "all"
                  ? "text-primary"
                  : "text-foreground",
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

/** A small rounded label in a card's head ("Đã đóng", "Đã tới hạn", "Đã ghim"); neutral without a tint. */
function Pill({ label, tint, icon }: { label: string; tint?: Tint; icon?: keyof typeof Ionicons.glyphMap }) {
  const theme = useTheme();
  return (
    <View className={cn("h-[22px] flex-row items-center gap-1 rounded-full px-2", tint ? TINTS[tint].bg : "bg-muted")}>
      {icon && tint ? <Ionicons name={icon} size={12} color={theme[TINTS[tint].ink]} /> : null}
      <Text className={cn("text-[11px] font-semibold", tint ? TINTS[tint].text : "text-muted-foreground")}>{label}</Text>
    </View>
  );
}

/** The head of a card: its tinted tile, the kind as an overline, and an optional pill. */
function Card({ own, tint, icon, kind, badge, children }: { own: boolean; tint: Tint; icon: keyof typeof Ionicons.glyphMap; kind: string; badge?: ReactNode; children?: ReactNode }) {
  return (
    <View className="min-w-[230px] gap-1">
      <View className="mb-1 flex-row items-center gap-2.5">
        <TintTile tint={tint} icon={icon} size={28} iconSize={16} />
        <Text className={cn("flex-1 text-[11px] font-semibold uppercase tracking-wider", ink(own).meta)} numberOfLines={1}>
          {kind}
        </Text>
        {badge}
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
        <Image source={{ uri: src }} contentFit="cover" style={{ width: 230, height: 230, borderRadius: 14 }} />
      ) : (
        <View className="items-center justify-center rounded-[14px] bg-muted" style={{ width: 230, height: 230 }}>
          <Text className="text-xs text-muted-foreground">{t("chat.message_list.image_preview_loading")}</Text>
        </View>
      )}
    </Pressable>
  );
}

function FileCard({ record, ctx, own, onLongPress }: { record: ChatMessageRecord; ctx: MessageCardContext; own: boolean; onLongPress: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const longPress = useLongPressProps(onLongPress);
  const file = record.file!;
  const freshUrl = useFreshChatMediaUrl(ctx.wsId, ctx.roomId);
  const name = file.filename || t("chat.file_untitled");
  const badge = fileBadge(file.filename);
  // The system browser opens a PDF, an image or an Office file itself and offers to save it.
  const open = () =>
    void freshUrl(record.id, { url: file.download_url || file.url, expiresAt: file.url_expires_at }, (m) => m.file?.download_url || m.file?.url)
      .then((url) => WebBrowser.openBrowserAsync(url))
      .catch(() => Alert.alert(t("chat.file_download_failed")));
  return (
    <Pressable {...longPress} onPress={open} accessibilityRole="button" accessibilityLabel={t("chat.message_list.file_open_named", { name })} className="min-w-[240px] flex-row items-center gap-3">
      <View className={cn("h-12 w-12 items-center justify-center rounded-lg", TINTS[badge.tint].bg)}>
        {badge.label ? (
          <Text className={cn("text-[11px] font-extrabold", TINTS[badge.tint].text)}>{badge.label}</Text>
        ) : (
          <Ionicons name="document-outline" size={22} color={theme[TINTS[badge.tint].ink]} />
        )}
      </View>
      <View className="flex-1">
        <Text className={cn("text-sm font-semibold", ink(own).text)} numberOfLines={1}>
          {name}
        </Text>
        <Text className={cn("text-xs", ink(own).meta)}>
          {formatFileSize(file.size_bytes)} · {t("chat.file_open")}
        </Text>
      </View>
      <View className={cn("h-9 w-9 items-center justify-center rounded-full", own ? "bg-chat-bubble-own-foreground/15" : "bg-muted")}>
        <Ionicons name="download-outline" size={18} color={own ? theme.chatBubbleOwnForeground : theme.mutedForeground} />
      </View>
    </Pressable>
  );
}

// iOS defaults to the ambient session, which the silent switch mutes; a voice message is meant to be heard.
let audioMode: Promise<void> | null = null;
const ensureAudioMode = () => (audioMode ??= setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined));

function VoiceCard({ record, ctx, own, onLongPress }: { record: ChatMessageRecord; ctx: MessageCardContext; own: boolean; onLongPress: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const longPress = useLongPressProps(onLongPress);
  const voice = record.voice!;
  const src = useChatMediaSrc(ctx.wsId, ctx.roomId, record.id, voice.url, voice.url_expires_at);
  const player = useAudioPlayer(src ? { uri: src } : null);
  const status = useAudioPlayerStatus(player);
  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) void player.seekTo(0);
    void ensureAudioMode().then(() => player.play());
  };
  const total = formatVoiceCallDuration(voice.duration_ms / 1000);
  const played = status.duration > 0 ? Math.round((Math.min(status.currentTime, status.duration) / status.duration) * VOICE_BARS.length) : 0;
  return (
    <Pressable
      {...longPress}
      onPress={toggle}
      disabled={!src}
      accessibilityRole="button"
      accessibilityLabel={`${status.playing ? t("chat.voice_pause") : t("chat.voice_play")}, ${total}`}
      className="min-h-11 min-w-[210px] flex-row items-center gap-2.5"
    >
      <View className={cn("h-11 w-11 items-center justify-center rounded-full", own ? "bg-chat-bubble-own-foreground" : "bg-chat-bubble-own", !src && "opacity-50")}>
        <Ionicons name={status.playing ? "pause" : "play"} size={18} color={own ? theme.chatBubbleOwn : theme.chatBubbleOwnForeground} />
      </View>
      <View className="flex-1 gap-1">
        <View className="h-[26px] flex-row items-center gap-0.5">
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
        </View>
        <Text className={cn("text-xs", ink(own).meta)}>{status.playing || status.currentTime > 0 ? `${formatVoiceCallDuration(status.currentTime)} / ${total}` : total}</Text>
      </View>
    </Pressable>
  );
}

/** Each option is a vote button (chat-poll-message-row.tsx); your picks are marked, a closed poll only shows its results. */
function PollCard({ record, own, ctx, onLongPress }: { record: ChatMessageRecord; own: boolean; ctx: MessageCardContext; onLongPress: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const longPress = useLongPressProps(onLongPress);
  const poll = record.poll!;
  const results = pollResults(poll);
  const many = poll.settings.allow_multiple;
  const footer = [results.closed ? t("chat.poll_closed") : null, results.hideCounts ? null : t("chat.poll_vote_hint", { count: results.total })].filter(Boolean).join(" · ");
  return (
    <Card own={own} tint="blue" icon="stats-chart-outline" kind={t("chat.poll_message_badge")} badge={results.closed ? <Pill label={t("chat.poll_closed_status")} /> : null}>
      <Text className={cn("text-[15px] font-bold", ink(own).text)}>{poll.question}</Text>
      <Text className={cn("mb-1 text-xs", ink(own).meta)}>{t(many ? "chat.message_list.poll_pick_many" : "chat.message_list.poll_pick_one")}</Text>
      {results.options.map((option) => (
        <Pressable
          key={option.id}
          {...longPress}
          accessibilityRole="button"
          accessibilityState={{ selected: option.mine, disabled: results.closed }}
          disabled={results.closed}
          onPress={() => ctx.onVotePoll(record.id, option.id)}
          className="min-h-11 justify-center gap-1"
          accessibilityLabel={t("chat.poll_option_aria", { label: option.label, count: option.votes })}
        >
          <View className="flex-row items-center gap-2.5">
            <View
              className={cn(
                "h-5 w-5 items-center justify-center border-2",
                many ? "rounded-md" : "rounded-full",
                option.mine
                  ? own
                    ? "border-chat-bubble-own-foreground bg-chat-bubble-own-foreground"
                    : "border-primary bg-primary"
                  : own
                    ? "border-chat-bubble-own-foreground/60"
                    : "border-muted-foreground/50",
              )}
            >
              {option.mine ? <Ionicons name="checkmark" size={13} color={own ? theme.chatBubbleOwn : theme.primaryForeground} /> : null}
            </View>
            <Text className={cn("flex-1 text-sm", ink(own).text, option.mine && "font-semibold")}>{option.label}</Text>
            {results.hideCounts ? null : <Text className={cn("text-[13px] font-semibold", ink(own).meta)}>{option.percent}%</Text>}
          </View>
          {results.hideCounts ? null : (
            <View className={cn("ml-[30px] h-[5px] overflow-hidden rounded-full", own ? "bg-chat-bubble-own-foreground/25" : "bg-muted-foreground/20")}>
              <View
                className={cn("h-[5px] rounded-full", option.mine ? (own ? "bg-chat-bubble-own-foreground" : "bg-primary") : own ? "bg-chat-bubble-own-foreground/50" : "bg-muted-foreground/50")}
                style={{ width: `${option.percent}%` }}
              />
            </View>
          )}
        </Pressable>
      ))}
      {footer ? (
        <View className={cn("mt-1 border-t pt-2", own ? "border-chat-bubble-own-foreground/20" : "border-border")}>
          <Text className={cn("text-xs", ink(own).meta)}>{footer}</Text>
        </View>
      ) : null}
    </Card>
  );
}

function ReminderCard({ record, own }: { record: ChatMessageRecord; own: boolean }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const reminder = record.reminder!;
  const at = Date.parse(reminder.remind_at);
  const due = isReminderDue(reminder.remind_at);
  const when = Number.isFinite(at) ? formatMessageDateTime(at, i18n.language) : "";
  const repeat = reminder.repeat !== "none" ? t(`chat.reminder_repeat_${reminder.repeat}`, { defaultValue: "" }) : "";
  return (
    <Card
      own={own}
      tint="teal"
      icon="alarm-outline"
      kind={t("chat.reminder_message_badge")}
      badge={due ? <Pill tint="yellow" icon="alarm-outline" label={t("chat.reminder_due_status")} /> : null}
    >
      <Text className={cn("text-[15px] font-medium", ink(own).text)}>{reminder.body}</Text>
      <View className="flex-row items-center gap-1.5">
        <Ionicons name="time-outline" size={14} color={own ? theme.chatBubbleOwnMeta : theme.mutedForeground} />
        <Text className={cn("flex-1 text-[13px]", ink(own).meta)}>
          {[due ? when : `${t("chat.reminder_scheduled_label")} ${when}`, repeat].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </Card>
  );
}

/** A call log: a chip, red when the call rang for the reader and went unanswered (voice-call-log-row.tsx's `missed`). */
function CallLogChip({ record, ctx }: { record: ChatMessageRecord; ctx: MessageCardContext }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const call = record.voice_call;
  const missed = call?.outcome === "unanswered" && call.caller_id !== ctx.userId;
  const at = Date.parse(record.created_at);
  return (
    <View className={cn("min-h-8 flex-row items-center gap-1.5 self-center rounded-full px-3", missed ? "bg-tint-red" : "bg-chat-chip")}>
      <Ionicons name={call?.video ? "videocam-outline" : "call-outline"} size={15} color={missed ? theme.tintRedForeground : theme.chatChipForeground} />
      <Text className={cn("text-[13px]", missed ? "font-semibold text-tint-red-foreground" : "font-medium text-chat-chip-foreground")}>{voiceCallLogLabel(call, ctx.userId, t)}</Text>
      {Number.isFinite(at) ? <Text className={cn("text-[13px]", missed ? "text-tint-red-foreground" : "text-muted-foreground")}>· {formatMessageTime(at, i18n.language)}</Text> : null}
    </View>
  );
}

/** UNI's summary of a call: the summary, its highlights and the tasks it suggests (read-only here). */
function CallSummaryCard({ record, own }: { record: ChatMessageRecord; own: boolean }) {
  const { t } = useTranslation();
  const summary = record.voice_call_summary!;
  const heading = cn("mt-2 text-[11px] font-semibold uppercase tracking-wider", ink(own).meta);
  return (
    <Card own={own} tint="blue" icon="sparkles-outline" kind={t("chat.voice_call_summary_badge")}>
      <Text className={cn("text-[15px]", ink(own).text)}>{summary.summary || t("chat.voice_call_summary_empty")}</Text>
      {summary.highlights.length > 0 ? <Text className={heading}>{t("chat.ai.highlights")}</Text> : null}
      {summary.highlights.map((line, index) => (
        <View key={index} className="flex-row gap-2">
          <View className={cn("mt-2 h-1.5 w-1.5 rounded-full", own ? "bg-chat-bubble-own-meta" : "bg-muted-foreground")} />
          <Text className={cn("flex-1 text-[15px]", ink(own).text)}>{line}</Text>
        </View>
      ))}
      {summary.action_items.length > 0 ? <Text className={heading}>{t("chat.ai.action_items")}</Text> : null}
      {summary.action_items.map((item, index) => {
        const meta = [item.owner, item.due].filter(Boolean).join(" · ");
        return (
          <View key={index} className={cn("rounded-xl px-3 py-2", own ? "bg-chat-bubble-own-foreground/15" : "bg-muted")}>
            <Text className={cn("text-sm font-semibold", ink(own).text)}>{item.title}</Text>
            {meta ? <Text className={cn("text-xs", ink(own).meta)}>{meta}</Text> : null}
          </View>
        );
      })}
    </Card>
  );
}

/** A row for what this build cannot show: say so, and open the message on the web. */
function UnsupportedCard({ record, ctx, own, onLongPress }: { record: Pick<ChatMessageRecord, "id">; ctx: MessageCardContext; own: boolean; onLongPress: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const longPress = useLongPressProps(onLongPress);
  const href = deepLinkHref({ orgSlug: ctx.orgSlug, wsSlug: ctx.wsSlug, roomId: ctx.roomId, messageId: record.id });
  return (
    <View className="gap-1">
      <Text className={cn("text-sm italic", ink(own).meta)}>{t("chat.mobile.unsupported_message")}</Text>
      <Pressable
        {...longPress}
        accessibilityRole="link"
        className="min-h-11 flex-row items-center gap-1.5"
        // The in-app browser does not follow universal links, so this stays on the web.
        onPress={() => void WebBrowser.openBrowserAsync(`${runtimeConfig().appUrl}${href}`)}
      >
        <Ionicons name="open-outline" size={16} color={own ? theme.chatBubbleOwnForeground : theme.primary} />
        <Text className={cn("text-sm font-semibold", own ? "text-chat-bubble-own-foreground underline" : "text-primary")}>{t("chat.mobile.open_on_web")}</Text>
      </Pressable>
    </View>
  );
}

/**
 * The inside of a message row; null for a system line (the row draws those itself).
 * "call-log" is a centred chip with its own time, meant to stand on the wall
 * without a bubble.
 */
export function MessageContent({ record, own, ctx, onLongPress }: { record: ChatMessageRecord; own: boolean; ctx: MessageCardContext; onLongPress: () => void }) {
  const { t } = useTranslation();
  const body = cn("text-[15px]", ink(own).text);
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
      return <PollCard record={record} own={own} ctx={ctx} onLongPress={onLongPress} />;
    case "note":
      return (
        <Card
          own={own}
          tint="yellow"
          icon="document-text-outline"
          kind={t("chat.note_message_badge")}
          badge={record.pinned ? <Pill tint="blue" icon="pin-outline" label={t("chat.pinned_label")} /> : null}
        >
          <Text className={body}>{record.note!.body}</Text>
        </Card>
      );
    case "post":
      return (
        <Card own={own} tint="orange" icon="newspaper-outline" kind={t("chat.post_message_badge")}>
          <Text className={cn("text-[17px] font-bold", ink(own).text)}>{record.post!.title}</Text>
          <Text className={body}>{record.post!.body}</Text>
        </Card>
      );
    case "reminder":
      return <ReminderCard record={record} own={own} />;
    case "call-log":
      return <CallLogChip record={record} ctx={ctx} />;
    case "call-summary":
      return <CallSummaryCard record={record} own={own} />;
    case "system":
      return null;
    case "unsupported":
      return <UnsupportedCard record={record} ctx={ctx} own={own} onLongPress={onLongPress} />;
  }
}
