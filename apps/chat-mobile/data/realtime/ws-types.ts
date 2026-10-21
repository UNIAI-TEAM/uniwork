// Transport envelope of a realtime frame. A local copy: @uniwork/core/api/ws-types
// is not on the mobile allowlist (ADR 0011). What a payload holds is frames.ts's.

export interface WSMessage<T = unknown> {
  /** A catalogue event, or a transport frame (subscribe_ack, subscribe_error, …). */
  type: string;
  payload: T;
  actor_id?: string;
  actor_type?: string;
}
