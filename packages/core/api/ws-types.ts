/**
 * Transport-level shape of a realtime message.
 *
 * `WSEventType` is a bare string here on purpose: the client below is
 * infrastructure — connect, back off, reconnect, fan out to subscribers — and
 * knows nothing about which events exist. The domain narrows it to a union of
 * its own event names where the events are defined, which keeps this file free
 * of business types and lets the client be tested without any.
 */
export type WSEventType = string;

export interface WSMessage<T = unknown> {
  type: WSEventType;
  payload: T;
  actor_id?: string;
  actor_type?: string;
}
