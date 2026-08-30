import { displayNameForMatrixSender, matrixLocalpart } from "@uniwork/core/chat/matrix-users";

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/** Matrix-style typing line: one name, or a locale-aware list ("B và C đang nhập…"). */
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

export function resolveTypingDisplayName(
  matrixUserId: string,
  nameContext: Array<{ user_id: string; display_name: string; matrix_user_id?: string | null }>,
  matrixMemberName?: string | null,
): string {
  const label = displayNameForMatrixSender(matrixUserId, nameContext);
  const local = matrixLocalpart(matrixUserId);
  if (label !== local) return label;
  const roomName = matrixMemberName?.trim();
  if (roomName && roomName !== matrixUserId) return roomName;
  return label;
}
