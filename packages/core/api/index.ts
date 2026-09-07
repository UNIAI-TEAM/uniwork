// Public surface of the API layer.
//
//   http.ts      — transport: bearer header, 401 refresh-and-retry, ApiError
//   schema.ts    — parseWithFallback, the drift guard every endpoint uses
//   endpoints/*  — one module per domain; each function is path + method +
//                  schema + fallback + a greppable endpoint label
//   ws-client.ts — realtime transport
//
// Hooks import from ./endpoints; nothing outside this directory calls
// `request` directly, so the compiler is what keeps every response behind a
// schema.
export { ApiError, apiErrorMessage, correlationIdOf, errorCode, refreshSession } from "./http";
export { GUEST_SESSION_HEADER, getGuestSession, setGuestSession } from "./guest-session";
export type { RequestOpts } from "./http";
export { parseWithFallback, setSchemaLogger } from "./schema";
export type { ParseOptions } from "./schema";
export { WSClient } from "./ws-client";
export type { WSEventType as WSTransportEventType, WSMessage } from "./ws-types";

export * as auth from "./endpoints/auth";
export * as organizations from "./endpoints/organizations";
export * as workspaces from "./endpoints/workspaces";
export * as tasks from "./endpoints/tasks";
export * as meetings from "./endpoints/meetings";
