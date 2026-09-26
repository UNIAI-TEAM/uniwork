// DOC-003 lab event delivery (UNI-667).
//
// The renderer host keeps real subscriptions for a small set of events (dirty,
// rename, deck changed, close/save requests). This module is the server side of
// that contract:
//
//   * every event is scoped to one view; another view never observes it;
//   * delivery is a bounded long-poll over the existing JSON transport rather
//     than a second protocol, and a caller that does not hold the view id cannot
//     read its queue;
//   * a closed view drops its queue, so a stale tab cannot keep receiving;
//   * an event that no renderer path requires is still delivered (never
//     silently swallowed), because a silent subscription is not evidence.
//
// Node 22 built-ins only. No production imports.

import { LabProtocolError } from './lab-storage.mjs';

const DEFAULT_CAPACITY = 256;

export class LabEventBus {
  constructor({ capacity = DEFAULT_CAPACITY } = {}) {
    this.capacity = capacity;
    this.queues = new Map();
    this.waiters = new Map();
    this.nextSeq = 1;
  }

  /** Creates the per-view queue when the server opens a view. */
  register(viewId) {
    if (!this.queues.has(viewId)) this.queues.set(viewId, []);
    return this;
  }

  /** Drops the queue and releases any waiting long-poll for that view. */
  close(viewId) {
    this.queues.delete(viewId);
    const waiter = this.waiters.get(viewId);
    if (waiter) {
      this.waiters.delete(viewId);
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve({ events: [], viewClosed: true, cursor: waiter.cursor });
    }
  }

  /** Publishes one event to exactly one view and wakes its long-poll. */
  emit(viewId, type, payload = {}) {
    const queue = this.queues.get(viewId);
    if (!queue) {
      throw new LabProtocolError(
        'unknown_view',
        'cannot emit "' + type + '": view ' + String(viewId) + ' has no event queue',
      );
    }
    const event = {
      seq: this.nextSeq++,
      viewId,
      type,
      at: new Date().toISOString(),
      payload,
    };
    queue.push(event);
    while (queue.length > this.capacity) queue.shift();
    const waiter = this.waiters.get(viewId);
    if (waiter) {
      this.waiters.delete(viewId);
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve({ events: queue.splice(0, queue.length), cursor: event.seq, viewClosed: false });
    }
    return event;
  }

  /** Non-blocking read of everything queued for a view from `cursor`. */
  drain(viewId, cursor = 0) {
    const queue = this.queues.get(viewId);
    if (!queue) {
      throw new LabProtocolError('unknown_view', 'no event queue for view ' + String(viewId));
    }
    const events = queue.filter((event) => event.seq > cursor);
    for (const event of events) queue.splice(queue.indexOf(event), 1);
    const last = events.length > 0 ? events[events.length - 1].seq : cursor;
    return { events, cursor: last, viewClosed: false };
  }

  /**
   * Waits up to `timeoutMs` for the view's first event. Returns an empty batch
   * on timeout, which is a normal bounded result rather than an error.
   */
  wait(viewId, cursor = 0, timeoutMs = 25000) {
    const queue = this.queues.get(viewId);
    if (!queue) {
      return Promise.reject(
        new LabProtocolError('unknown_view', 'no event queue for view ' + String(viewId)),
      );
    }
    const pending = queue.filter((event) => event.seq > cursor);
    if (pending.length > 0) return Promise.resolve(this.drain(viewId, cursor));
    return new Promise((resolve, reject) => {
      const waiter = {
        cursor,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(viewId);
          resolve({ events: [], cursor, viewClosed: false, timeout: true });
        }, Math.max(0, Math.min(timeoutMs, 60000))),
      };
      if (typeof waiter.timer.unref === 'function') waiter.timer.unref();
      this.waiters.set(viewId, waiter);
      void reject;
    });
  }

  /** Test/diagnostic view of one queue without consuming it. */
  peek(viewId) {
    return (this.queues.get(viewId) ?? []).slice();
  }
}

