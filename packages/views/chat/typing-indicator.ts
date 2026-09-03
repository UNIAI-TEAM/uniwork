type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/** Typing line: one name, or a locale-aware list ("B và C đang nhập…"). */
export function formatTypingLabel(
  names: string[],
  t: TranslateFn,
  locale: string,
): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return t("chat.typing_one", { name: names[0] });
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names);
  return t("chat.typing_list", { names: list });
}
