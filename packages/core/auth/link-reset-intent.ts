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
 *
 * What is stored is the SHA-256 of the address and when it stops counting,
 * never the address: a guess typed on a shared computer is not left readable
 * in its storage. A record past its fifteen minutes goes the next time any
 * page of the app reads it (the auth store does on start).
 */
const KEY = "uniwork:link-reset";
const LIFETIME_MS = 15 * 60_000;

export type LinkResetIntent = { digest: string };

const normalize = (email: string) => email.trim().toLowerCase();

async function digestOf(email: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalize(email)));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The forgot-password page in link mode sent a reset to `email`. */
export async function rememberLinkReset(email: string, now = Date.now()): Promise<void> {
  const digest = await digestOf(email);
  defaultStorage.setItem(KEY, JSON.stringify({ digest, until: now + LIFETIME_MS }));
}

function read(raw: string, now: number): LinkResetIntent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { digest, until } = parsed as Record<string, unknown>;
    return typeof digest === "string" && digest && typeof until === "number" && until > now ? { digest } : null;
  } catch {
    return null;
  }
}

/**
 * The reset this browser asked for in link mode, while it can still matter;
 * null otherwise. A record past its fifteen minutes, or one this code did
 * not write (an address kept in the clear by an older build included), is
 * removed as it is read.
 */
export function linkResetIntent(now = Date.now()): LinkResetIntent | null {
  const raw = defaultStorage.getItem(KEY);
  if (!raw) return null;
  const intent = read(raw, now);
  if (!intent) forgetLinkReset();
  return intent;
}

/** Whether the account a reset opened is the one the intent was for. */
export async function linkResetServes(intent: LinkResetIntent | null, accountEmail: string | null | undefined): Promise<boolean> {
  if (intent === null || typeof accountEmail !== "string") return false;
  return (await digestOf(accountEmail)) === intent.digest;
}

export function forgetLinkReset(): void {
  defaultStorage.removeItem(KEY);
}
