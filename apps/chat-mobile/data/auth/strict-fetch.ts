// The fetch for requests that carry a credential: the API client's bearer and the sign-in routes. It keeps the
// promise that `redirect: "error"` makes. React Native's global fetch is whatwg-fetch over XMLHttpRequest, which
// ignores the redirect mode: the native stack follows a 3xx and, depending on the platform, takes the
// Authorization header along (audit "Security & privacy": "Bearer only to the app's own API" held for the first
// hop only). expo/fetch hands the mode to OkHttp (followRedirects(false)) and URLSession (its redirect delegate),
// so a redirect fails the request instead. No cookie jar either: the app authenticates with tokens only.
//
// Its failures come back in the shapes the callers already handle: a cancelled request is an AbortError, a
// request with no reply React Native's own network TypeError (data/api.ts reads it as offline), and a refused
// redirect a RedirectRefusedError, which data/report.ts reports as the fault it is. A multipart body stays on the
// global fetch, since expo/fetch cannot send React Native's { uri } file parts (data/api.ts).
import { fetch as expoFetch } from "expo/fetch";
import type { FetchLike } from "./transport";

/** A 3xx the native stack refused to follow: the API host or a proxy in front of it redirects, which it never should. */
export class RedirectRefusedError extends Error {
  override name = "RedirectRefusedError";
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

export const strictFetch: FetchLike = async (input, init) => {
  try {
    return await expoFetch(input, { ...init, redirect: "error", credentials: "omit" });
  } catch (error) {
    if (init.signal?.aborted) throw abortError();
    const message = error instanceof Error ? error.message : String(error);
    if (/redirect/i.test(message)) throw new RedirectRefusedError(message);
    const offline = new TypeError(message);
    offline.cause = error;
    throw offline;
  }
};
