// What the sign-in screen offers besides email: Apple and Google, each by its native sheet or through the browser
// (lib/sign-in-offer.ts), from what the server takes and what this phone can open (data/auth/flow.ts › signInOffer).
import { queryOptions } from "@tanstack/react-query";
import { offersProvider } from "@/lib/sign-in-offer";
import { signInOffer } from "../auth/flow";

const signInKeys = {
  offer: () => ["sign-in", "offer"] as const,
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
