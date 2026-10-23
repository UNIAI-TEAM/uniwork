/** Realtime quota.threshold (spec F-02 / C-05): ids-only payload from the server. */
export type QuotaThresholdEvent = {
  organizationId: string;
  userId: string;
};

type Listener = (event: QuotaThresholdEvent) => void;

const listeners = new Set<Listener>();

export function emitQuotaThreshold(event: QuotaThresholdEvent): void {
  for (const listener of listeners) listener(event);
}

export function subscribeQuotaThreshold(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: drop every listener so cases do not leak. */
export function resetQuotaThresholdBusForTests(): void {
  listeners.clear();
}
