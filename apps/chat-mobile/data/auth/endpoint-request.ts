// The auth routes as core's EndpointRequest (packages/core/api/endpoints/endpoint-request.ts), for the factories of
// the app's own sign-in doors (core's sign-in-native-api.ts, ADR 0049 §8): the same timeout, strict errors, no
// redirect and no cache as every auth route (transport.ts › createAuthRequest). A path that is not `/api/v1` + one of
// the auth routes, or a method other than GET and POST, is refused before anything is sent.
import type { EndpointRequest } from "@uniwork/core/api/endpoints/endpoint-request";
import { TransportError, createAuthRequest, type FetchLike, type Route } from "./transport";

/** Every Route, at run time: the record makes the compiler hold each one here. */
const ROUTES: Readonly<Record<Route, true>> = {
  "/auth/desktop/start": true,
  "/auth/desktop/exchange": true,
  "/auth/desktop/refresh": true,
  "/auth/desktop/logout": true,
  "/auth/providers": true,
  "/auth/native/password": true,
  "/auth/native/mfa": true,
  "/auth/native/google": true,
  "/auth/native/apple": true,
  "/auth/native/register": true,
  "/auth/native/sign-in-ticket/create": true,
  "/auth/native/sign-in-ticket/claim-email": true,
  "/auth/native/sign-in-ticket/claim-email/verify": true,
  "/auth/native/sign-in-ticket/discard": true,
};

const isRoute = (path: string): path is Route => Object.prototype.hasOwnProperty.call(ROUTES, path);

/** `/api/v1` + a route, no query: a regular expression, so the route catalogue reads the routes from Route alone */
const API_PATH = /^\/api\/v1(\/[^?#]*)$/;

export function createEndpointRequest(options: { fetch: FetchLike; timeoutMs?: number }): EndpointRequest {
  const request = createAuthRequest(options);
  return async (path, opts = {}) => {
    const route = API_PATH.exec(path)?.[1] ?? "";
    if (!isRoute(route)) throw new TransportError("invalid_request");
    const body = opts.body === undefined ? {} : { body: opts.body };
    // each method written out: the route catalogue reads a call's first argument as its method or path
    if (opts.method === undefined || opts.method === "GET") return request("GET", route, body);
    if (opts.method === "POST") return request("POST", route, body);
    throw new TransportError("invalid_request");
  };
}
