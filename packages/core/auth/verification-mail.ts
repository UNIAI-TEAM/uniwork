/**
 * When this browser last had a verification code mailed to an address (the
 * sign-up's own, a resend), in memory only: /verify waits out the server's
 * minute between two codes after one of those, and otherwise lets a code be
 * asked at once. An account opened days ago, whose first code ran out, is
 * not told to wait for nothing. A reload forgets it, and the server's 429
 * then names the wait. The phone keeps its own (apps/chat-mobile
 * data/auth/verification-mail.ts): module state is not a pure function, so
 * ADR 0011 keeps it out of the phone's core imports.
 */

/** The server's gap between two verification codes (POST /me/email/resend answers 429 within it). */
export const VERIFICATION_RESEND_GAP_MS = 60_000;

let mailed: { email: string; at: number } | null = null;

const normalized = (email: string): string => email.trim().toLowerCase();

/** A code went to `email` at `at`: a sign-up the server mails, or a resend. */
export function noteVerificationMailed(email: string, at: number): void {
  mailed = { email: normalized(email), at };
}

/** When a new code may be asked for `email`: a minute after the last one this browser had mailed there, else now. */
export function verificationResendAt(email: string, now: number): number {
  if (!mailed || mailed.email !== normalized(email)) return now;
  return Math.max(now, mailed.at + VERIFICATION_RESEND_GAP_MS);
}

/** On sign-out: the next account in this browser waits on nothing of this one's. */
export function forgetVerificationMail(): void {
  mailed = null;
}
