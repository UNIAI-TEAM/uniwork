// A user id the way presence, typing and the stores key it: ULIDs compare
// case-insensitively and may arrive with a stray space. One helper instead of
// `trim().toUpperCase()` at every call site; the files copied from the web
// (people-display, rooms-display, mentions) keep the web's own spelling so
// their parity tests stay a line-for-line comparison.
import { normalizeTypingUserId } from "@uniwork/core/chat/typing-user-id";

export const userKey = (userId: string): string => normalizeTypingUserId(userId);

export const sameUser = (a: string, b: string): boolean => userKey(a) === userKey(b);
