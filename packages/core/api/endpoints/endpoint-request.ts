/**
 * The one transport every pure endpoint factory takes (chat-*-api.ts,
 * sign-in-native-api.ts, sign-in-methods-api.ts): the web binds `request` of
 * ../http.ts (web-request.ts), the phone (apps/chat-mobile, ADR 0011) its own
 * client. A factory never builds a fetch itself, so both platforms send the
 * same path and body and read the same answer through the same schema.
 *
 * Type-only: nothing here runs, so the phone may import it freely.
 */

/** The method, JSON body and abort signal of one request. */
export interface EndpointRequestOpts {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** A JSON value; the transport serialises it. */
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Resolves to the parsed JSON body (undefined for a 204) and rejects on a
 * failed response with the transport's own error. auth/sign-in-errors.ts
 * reads the server's code and fields from it by name: top-level `code` and
 * `fields` (the web's ApiError), or the envelope kept as
 * `body.error.{code, fields}` (the app's bearer ApiError); `status` (0 for no
 * HTTP answer), the Retry-After as `retryAfterSeconds` or `retryAfterMs`, and
 * `fromServer: false` on a code only inferred from the status.
 */
export type EndpointRequest = (path: string, opts?: EndpointRequestOpts) => Promise<unknown>;
