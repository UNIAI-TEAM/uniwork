// An erased account (Settings › Delete account, Nghị định 13) keeps its messages under one name the server writes
// in Vietnamese for every reader (server/internal/service/account_deletion.go › deletedDisplayName). The app reads
// it in its own language: every `display_name` / `…_display_name` field of a chat answer that holds that name is
// relabelled once, where the answer arrives (data/chat-api.ts), so every screen that shows a name agrees.

/** The server's name for an erased account; data/server-contract.test.ts holds it to the Go constant. */
export const ERASED_ACCOUNT_NAME = "Người dùng đã xóa";

const isNameKey = (key: string): boolean => key === "display_name" || key.endsWith("_display_name");

/** `value` with every name field that names an erased account read as `label`; the same reference when none does. */
export function relabelErasedAccounts(value: unknown, label: string): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const relabelled = relabelErasedAccounts(item, label);
      changed ||= relabelled !== item;
      return relabelled;
    });
    return changed ? next : value;
  }
  if (value === null || typeof value !== "object") return value;
  let out: Record<string, unknown> | null = null;
  for (const [key, field] of Object.entries(value)) {
    const relabelled = isNameKey(key) && field === ERASED_ACCOUNT_NAME ? label : relabelErasedAccounts(field, label);
    if (relabelled !== field) {
      out ??= { ...value };
      out[key] = relabelled;
    }
  }
  return out ?? value;
}
