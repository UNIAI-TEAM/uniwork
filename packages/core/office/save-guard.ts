/**
 * Host-neutral, non-queueing Save gate. The same instance is passed to the
 * local-file and cloud coordinators so every entry point (button, menu,
 * shortcut and lifecycle dialog) observes one in-flight operation.
 */
export interface OfficeSaveGuard {
  readonly busy: boolean;
  tryAcquire(): (() => void) | undefined;
  subscribe(listener: (busy: boolean) => void): () => void;
}

export function createOfficeSaveGuard(): OfficeSaveGuard {
  let busy = false;
  const listeners = new Set<(busy: boolean) => void>();

  const publish = (next: boolean): void => {
    busy = next;
    for (const listener of listeners) listener(busy);
  };

  return {
    get busy() { return busy; },
    tryAcquire() {
      if (busy) return undefined;
      publish(true);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        publish(false);
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
