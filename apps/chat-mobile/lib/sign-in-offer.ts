// Which ways in the sign-in screen offers besides email (spec §1, §5.2), from what the server takes (core's
// AuthProviders) and what this phone can do: Apple's sheet on an iPhone that has it, Google's where the build carries
// its client and, on Android, Google Play services runs. A provider the phone cannot open a sheet for goes through
// the browser instead (PKCE with the provider hint, spec §3.5) when the web offers it; null hides its button.
import type { AuthProviders } from "@uniwork/core/api/endpoints/sign-in-schemas";

export type ProviderWay = "native" | "browser" | null;

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
