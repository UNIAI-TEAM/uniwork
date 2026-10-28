import { defaultStorage } from "../platform/storage";

/**
 * "Quên mật khẩu?" on /login?link=1 (spec §4.4): the person asked for a reset
 * to get into the account a waiting Google or Apple sign-in should join. The
 * mailed link carries nothing of that, so this browser remembers who asked,
 * for as long as the pending sign-in itself lives (15 minutes).
 *
 * The reset page keeps a pending sign-in only behind this, and links it only
 * when the reset opened that very address: a reset link opened from a
 * mailbox in a browser where someone else left a provider sign-in waiting
 * must never walk the new session into linking that identity (the session
 * is newer than the ticket, so the server would ask no proof).
 */
const KEY = "uniwork:link-reset";
const LIFETIME_MS = 15 * 60_000;

export type LinkResetIntent = { email: string };

const normalize = (email: string) => email.trim().toLowerCase();

/** The forgot-password page in link mode sent a reset to `email`. */
export function rememberLinkReset(email: string, now = Date.now()): void {
  defaultStorage.setItem(KEY, JSON.stringify({ email: normalize(email), until: now + LIFETIME_MS }));
}

function read(raw: string, now: number): LinkResetIntent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { email, until } = parsed as Record<string, unknown>;
    return typeof email === "string" && email && typeof until === "number" && until > now ? { email } : null;
  } catch {
    return null;
  }
}

/**
 * The reset this browser asked for in link mode, while it can still matter;
 * null otherwise. A record past its fifteen minutes, or one this code did
 * not write, is removed as it is read: an address typed on a shared
 * computer does not stay in its storage for whoever opens it next.
 */
export function linkResetIntent(now = Date.now()): LinkResetIntent | null {
  const raw = defaultStorage.getItem(KEY);
  if (!raw) return null;
  const intent = read(raw, now);
  if (!intent) forgetLinkReset();
  return intent;
}

/** Whether the account a reset opened is the one the intent was for. */
export function linkResetServes(intent: LinkResetIntent | null, accountEmail: string | null | undefined): boolean {
  return intent !== null && typeof accountEmail === "string" && normalize(accountEmail) === intent.email;
}

export function forgetLinkReset(): void {
  defaultStorage.removeItem(KEY);
}
