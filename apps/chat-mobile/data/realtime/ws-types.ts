// Transport envelope of a realtime frame. A local copy: @uniwork/core/api/ws-types
// is not on the mobile allowlist (ADR 0011); the event names are type-only imports.
import type { WSEventType } from "@uniwork/core/types/events";

export type { WSEventType };

export interface WSMessage<T = unknown> {
  /** A catalogue event, or a transport frame (subscribe_ack, subscribe_error, …). */
  type: string;
  payload: T;
  actor_id?: string;
  actor_type?: string;
}
