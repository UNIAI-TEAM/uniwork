import type { ComposerReadOnlyReason } from "./chat-composer-parts";

type ComposerBlockState = {
  dmBlocked: boolean;
  chatSendMutedByModerator: boolean;
  chatSendRestricted: boolean;
};

function chatComposerPlaceholder(
  t: (key: string, options?: Record<string, string | number>) => string,
  opts: ComposerBlockState,
): string {
  if (opts.dmBlocked) return t("chat.block_composer_placeholder");
  if (opts.chatSendMutedByModerator) return t("chat.mute_composer_placeholder");
  if (opts.chatSendRestricted) return t("chat.room_send_forbidden_placeholder");
  return t("chat.message_placeholder");
}

/**
 * The placeholder and, when sending is closed, why — in the same order as the
 * placeholder, so the read-only line's icon always matches its words.
 */
export function chatComposerBlockProps(
  t: (key: string, options?: Record<string, string | number>) => string,
  opts: ComposerBlockState,
): { placeholder: string; readOnlyReason?: ComposerReadOnlyReason } {
  const placeholder = chatComposerPlaceholder(t, opts);
  if (opts.dmBlocked) return { placeholder, readOnlyReason: "blocked" };
  if (opts.chatSendMutedByModerator) return { placeholder, readOnlyReason: "muted" };
  if (opts.chatSendRestricted) return { placeholder, readOnlyReason: "restricted" };
  return { placeholder };
}
