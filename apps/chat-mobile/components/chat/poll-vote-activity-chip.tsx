// The notice a vote leaves on the wall, Zalo-style (packages/views/chat/chat-poll-vote-activity-row.tsx):
// "<name> joined the poll: <question>", centred like a call log, with a "View" that scrolls to the poll.
import { Ionicons } from "@expo/vector-icons";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { Trans, useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useTapTarget } from "@/components/ui/tap-target";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { THEME } from "@/lib/theme";

export function PollVoteActivityChip({
  pollVote,
  senderLabel,
  onJump,
}: {
  pollVote: NonNullable<ChatMessageRecord["poll_vote"]>;
  senderLabel: string;
  /** Scroll the conversation to the poll; without it the chip has no "View". */
  onJump?: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const tap = useTapTarget(32);
  return (
    <View className="max-w-full flex-row flex-wrap items-center gap-1.5 self-center rounded-full bg-chat-chip px-3 py-2">
      <Ionicons name="stats-chart-outline" size={15} color={THEME[colorScheme].tintGreenForeground} />
      <Text className="min-w-0 flex-1 text-footnote text-chat-chip-foreground">
        <Trans
          i18nKey="chat.poll_vote_activity_line"
          values={{ name: senderLabel, question: pollVote.question }}
          components={{ b: <Text className="font-semibold" /> }}
        />
      </Text>
      {onJump ? (
        <Pressable
          {...tap}
          accessibilityRole="button"
          accessibilityLabel={t("chat.poll_vote_activity_view")}
          onPress={() => onJump(pollVote.poll_message_id)}
          className="min-h-8 justify-center px-1"
        >
          <Text className="text-footnote font-semibold text-primary">{t("chat.poll_vote_activity_view")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
