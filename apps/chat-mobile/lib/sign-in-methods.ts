// The rows of Settings › Sign-in methods on the phone (spec §4.5, §5.2), from the account's methods (core's
// SignInMethods) and what this phone can open (lib/sign-in-offer.ts): the password, then Google and Apple, each with
// what it shows and the one action it offers. A provider links with its own sheet where the phone has one, else on
// the web (Apple on Android; Google without Google Play services), and its row is hidden when it is neither linked
// nor offered here. Unlinking follows core's rules (the last way in, Apple of a relay account). Pure.
import type { SignInMethods, SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import {
  emailDisplay,
  remainingAfterUnlink,
  unlinkVerdict,
  type EmailDisplay,
  type SignInMethodKind,
  type UnlinkVerdict,
} from "@uniwork/core/auth/sign-in-rules";
import type { SignInOffer } from "./sign-in-offer";

export interface PasswordRow {
  kind: "password";
  set: boolean;
  changedAt: string | null;
}

export interface ProviderRow {
  kind: SignInProvider;
  linked: boolean;
  email: EmailDisplay;
  linkedAt: string | null;
  /** How a link starts here: the provider's own sheet, the web's Settings, or not at all (linked, or not offered). */
  link: "native" | "web" | null;
  unlink: UnlinkVerdict;
  /** What is left to sign in with once it is unlinked, in the rows' order. */
  remaining: SignInMethodKind[];
}

export type MethodRow = PasswordRow | ProviderRow;

const PROVIDERS: readonly SignInProvider[] = ["google", "apple"];

export function methodRows(methods: SignInMethods, offer: SignInOffer | undefined): MethodRow[] {
  const rows: MethodRow[] = [{ kind: "password", set: methods.password.set, changedAt: methods.password.changed_at }];
  for (const provider of PROVIDERS) {
    const state = methods[provider];
    const way = offer?.[provider];
    const link = state.linked ? null : way === "native" ? "native" : way === "browser" ? "web" : null;
    if (!state.linked && link === null) continue;
    rows.push({
      kind: provider,
      linked: state.linked,
      email: emailDisplay(state.email, { privateRelay: provider === "apple" && methods.apple.private_relay }),
      linkedAt: state.linked_at,
      link,
      unlink: unlinkVerdict(methods, provider),
      remaining: remainingAfterUnlink(methods, provider),
    });
  }
  return rows;
}

/**
 * Whether the account confirms with its second factor alone (the server lists `totp` only while it is on); the
 * account's own state decides while the list is not known.
 */
export function confirmsWithSecondFactor(methods: SignInMethods | null | undefined, mfaEnabled: boolean): boolean {
  return methods && methods.proofs.length > 0 ? methods.proofs.includes("totp") : mfaEnabled;
}
