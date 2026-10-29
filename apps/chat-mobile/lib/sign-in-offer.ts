// Which ways in the sign-in screen offers besides email (spec §1, §5.2), from what the server takes (core's
// AuthProviders) and what this phone can do: Apple's sheet on an iPhone that has it, Google's where the build carries
// its client and, on Android, Google Play services runs. A provider the phone cannot open a sheet for goes through
// the browser instead (PKCE with the provider hint, spec §3.5) when the web offers it; null hides its button.
import type { NativeSignInIntent } from "@uniwork/core/api/endpoints/sign-in-native-api";
import type { AuthProviders, SignInProvider, StepUpProof } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { APP_PROOFS } from "@uniwork/core/auth/step-up";
import type { SignInRequest } from "@/data/auth/sign-in";

type ProviderWay = "native" | "browser" | null;

export interface SignInOffer {
  apple: ProviderWay;
  google: ProviderWay;
}

export function signInOfferOf(input: { os: string; providers: AuthProviders; appleNative: boolean; googleNative: boolean }): SignInOffer {
  const { providers } = input;
  // `apple` is the server's native Apple (the shipped iPhone app reads it), `apple_web` Apple in the browser.
  const apple: ProviderWay = input.os === "ios" && input.appleNative && providers.apple ? "native" : providers.apple_web ? "browser" : null;
  const google: ProviderWay = input.googleNative && providers.google_native ? "native" : providers.google ? "browser" : null;
  return { apple, google };
}

/** Whether the screen offers anything but email: a yes is kept a while, a no is asked again (data/queries/sign-in.ts). */
export function offersProvider(offer: SignInOffer | undefined): boolean {
  return Boolean(offer && (offer.apple || offer.google));
}

/**
 * The proofs this phone can present when it is asked to confirm it is you (core's APP_PROOFS): a fresh Apple or Google
 * token only where that provider's sheet opens here. The server still decides which it takes (SignInMethods.proofs).
 */
export function appProofs(offer: SignInOffer | undefined): StepUpProof[] {
  return APP_PROOFS.filter((proof) => (proof === "apple" || proof === "google" ? offer?.[proof] === "native" : true));
}

/**
 * The order the screen offers them in (spec §5.2): on an iPhone, Apple's button first (Apple's HIG, ADR 0041: never
 * below the other ways in); elsewhere Google first, the phone's own account.
 */
export function providerOrder(os: string): readonly SignInProvider[] {
  return os === "ios" ? ["apple", "google"] : ["google", "apple"];
}

/**
 * The sign-in a provider's button starts: its sheet where this phone opens one, else the browser with the provider
 * hint (spec §3.5); null when it is not offered. `intent` "sign_up" is the register screen's: no choice screen, an
 * account at once, through the browser too (the web starts the provider to sign up).
 */
export function providerRequest(provider: SignInProvider, offer: SignInOffer | undefined, intent?: NativeSignInIntent): SignInRequest | null {
  const way = offer?.[provider];
  if (way === "browser") return intent ? { method: "browser", provider, intent } : { method: "browser", provider };
  if (way !== "native") return null;
  return intent ? { method: provider, intent } : { method: provider };
}
