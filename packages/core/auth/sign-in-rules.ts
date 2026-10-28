import type { SignInMethods, SignInProvider } from "../api/endpoints/sign-in-schemas";

/**
 * The rules Settings › Sign-in methods shows before the server would say
 * them (spec §3.7, §4.5), so a button that would only earn a 409 is
 * explained instead: the last way in is never removed, nor Apple from an
 * account whose address is Apple's relay. The server still decides. Pure,
 * shared by the web and the phone.
 */

export type SignInMethodKind = "password" | "google" | "apple";

/** The ways into the account, in the order the rows show them. */
export function signInMethodKinds(methods: SignInMethods): SignInMethodKind[] {
  const out: SignInMethodKind[] = [];
  if (methods.password.set) out.push("password");
  if (methods.google.linked) out.push("google");
  if (methods.apple.linked) out.push("apple");
  return out;
}

/** The ways that would remain once `provider` is unlinked. */
export function remainingAfterUnlink(methods: SignInMethods, provider: SignInProvider): SignInMethodKind[] {
  return signInMethodKinds(methods).filter((kind) => kind !== provider);
}

export type UnlinkVerdict =
  | { allowed: true }
  /** last: the only way in (409 sign_in_method_last); relay: the account's address is Apple's relay (409 sign_in_method_relay_email). */
  | { allowed: false; reason: "not_linked" | "last" | "relay"; key: string | null };

const REASON_KEYS = {
  last: "settings.security.signInMethods.reasons.last",
  relay: "settings.security.signInMethods.reasons.relay",
} as const;

/** Whether "Gỡ liên kết" may run for `provider`, and when not, the i18n key of why (null: nothing to unlink). */
export function unlinkVerdict(methods: SignInMethods, provider: SignInProvider): UnlinkVerdict {
  if (!methods[provider].linked) return { allowed: false, reason: "not_linked", key: null };
  if (provider === "apple" && methods.account_email_is_relay) return { allowed: false, reason: "relay", key: REASON_KEYS.relay };
  if (remainingAfterUnlink(methods, provider).length === 0) return { allowed: false, reason: "last", key: REASON_KEYS.last };
  return { allowed: true };
}

/** Apple's Hide My Email domain, exactly, after the last "@" (as the server's identity_resolve.go). */
export const APPLE_RELAY_DOMAIN = "privaterelay.appleid.com";

export function isAppleRelayEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  return at > 0 && email.slice(at + 1).trim().toLowerCase() === APPLE_RELAY_DOMAIN;
}

/**
 * How to show an address: Apple's relay reads as "Email ẩn của Apple"
 * (auth.apple.relayEmail) rather than a random string the person never saw;
 * `relay` also when the server flagged it (private_relay). `none` for an
 * empty one.
 */
export type EmailDisplay = { kind: "relay"; email: string } | { kind: "address"; email: string } | { kind: "none" };

export function emailDisplay(email: string | null | undefined, opts: { privateRelay?: boolean } = {}): EmailDisplay {
  const value = email?.trim() ?? "";
  if (!value) return { kind: "none" };
  return opts.privateRelay || isAppleRelayEmail(value) ? { kind: "relay", email: value } : { kind: "address", email: value };
}

/**
 * An address masked as the server masks the holder of a taken identity
 * (maskEmail in sign_in_methods.go): the first character, "•••", the domain.
 * For a line that names an account to someone who may not own it.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  const first = at < 0 ? undefined : email.codePointAt(0);
  const domain = email.slice(at + 1);
  // at 0: no local part; the first code point, so an emoji or a surrogate pair is never cut in half.
  if (first === undefined || at === 0 || !domain) return "•••";
  return `${String.fromCodePoint(first)}•••@${domain}`;
}

/** The masked address a 409 or a link result carries; null when absent or not a plausible one. */
export function maskedEmailOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const masked = value.trim();
  return masked && masked.length <= 254 && masked.includes("@") && !/[\s<>]/.test(masked) ? masked : null;
}
