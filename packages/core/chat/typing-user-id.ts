/** Normalize ULID user ids for typing comparisons. */
export function normalizeTypingUserId(userId: string): string {
  return userId.trim().toUpperCase();
}
