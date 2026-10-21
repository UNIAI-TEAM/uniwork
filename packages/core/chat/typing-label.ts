// The "… đang nhập" line: one name, or a locale-aware list ("B và C đang
// nhập…"). Pure, shared by the web's typing indicators and the phone's
// (ADR 0011). Hermes ships no Intl.ListFormat, so a comma list stands in there.
type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/** Typing line: one name, or a locale-aware list ("B và C đang nhập…"). */
export function formatTypingLabel(names: string[], t: TranslateFn, locale: string): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return t("chat.typing_one", { name: names[0] });
  const list =
    typeof Intl.ListFormat === "function"
      ? new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names)
      : names.join(", ");
  return t("chat.typing_list", { names: list });
}
