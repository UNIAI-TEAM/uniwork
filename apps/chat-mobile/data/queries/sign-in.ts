// What the sign-in screen offers besides the browser: Sign in with Apple on an iPhone whose server takes it (ADR 0041).
import { queryOptions } from "@tanstack/react-query";
import { appleSignInOffered } from "../auth/flow";

const signInKeys = {
  apple: () => ["sign-in", "apple"] as const,
};

/** A yes is kept a while; a no (an older server, no network yet) is asked again on the next mount or reconnect. */
export const APPLE_OFFERED_STALE_MS = 5 * 60_000;

export const appleSignInOfferedOptions = () =>
  queryOptions({
    queryKey: signInKeys.apple(),
    queryFn: appleSignInOffered,
    staleTime: (query) => (query.state.data === true ? APPLE_OFFERED_STALE_MS : 0),
    // Asked whatever the reachability probe says (see workspaces.ts); a failure reads as "not offered".
    networkMode: "offlineFirst",
  });
