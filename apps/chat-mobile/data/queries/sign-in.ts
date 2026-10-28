// What the sign-in screen offers besides email: Apple and Google, each by its native sheet or through the browser
// (lib/sign-in-offer.ts), from what the server takes and what this phone can open (data/auth/flow.ts › signInOffer);
// and, once signed in, how the account signs in and the proofs it takes on this phone (Settings › Sign-in methods).
import { queryOptions } from "@tanstack/react-query";
import { offersProvider } from "@/lib/sign-in-offer";
import { signInOffer } from "../auth/flow";
import { signInMethodsApi } from "../auth/methods-api";

export const signInKeys = {
  offer: () => ["sign-in", "offer"] as const,
  methods: () => ["sign-in", "methods"] as const,
};

/** An offer with a provider is kept a while; none (an older server, no network yet) is asked again on the next mount or reconnect. */
export const SIGN_IN_OFFER_STALE_MS = 5 * 60_000;

export const signInOfferOptions = () =>
  queryOptions({
    queryKey: signInKeys.offer(),
    queryFn: signInOffer,
    staleTime: (query) => (offersProvider(query.state.data) ? SIGN_IN_OFFER_STALE_MS : 0),
    // Asked whatever the reachability probe says (see workspaces.ts); a failure reads as "nothing offered".
    networkMode: "offlineFirst",
  });

/**
 * The account's sign-in methods (null when the answer did not parse: the section says it could not load them, never
 * a guess). Read again every time the app comes back to the front: a link finished in the browser, or a change made
 * on another device, shows at once. Dropped with the account at sign-out (data/remote-config.ts › clearAccountCache).
 */
export const signInMethodsOptions = () =>
  queryOptions({
    queryKey: signInKeys.methods(),
    queryFn: ({ signal }) => signInMethodsApi.getSignInMethods(signal),
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
