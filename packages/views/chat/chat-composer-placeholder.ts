export function chatComposerPlaceholder(
  t: (key: string, options?: Record<string, string | number>) => string,
  opts: {
    dmBlocked: boolean;
    chatSendMutedByModerator: boolean;
    chatSendRestricted: boolean;
  },
): string {
  if (opts.dmBlocked) return t("chat.block_composer_placeholder");
  if (opts.chatSendMutedByModerator) return t("chat.mute_composer_placeholder");
  if (opts.chatSendRestricted) return t("chat.room_send_forbidden_placeholder");
  return t("chat.message_placeholder");
}
