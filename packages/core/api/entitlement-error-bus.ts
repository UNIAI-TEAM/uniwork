import type { ApiErrorClass } from "./http";

/** Fired when the transport rejects with an entitlement or quota gate (C-05). */
export type EntitlementGateError = {
  code: "entitlement_required" | "quota_exceeded";
  fields?: Record<string, unknown>;
  errorClass?: ApiErrorClass;
};

type Listener = (event: EntitlementGateError) => void;

const listeners = new Set<Listener>();

export function emitEntitlementGateError(event: EntitlementGateError): void {
  for (const listener of listeners) listener(event);
}

export function subscribeEntitlementGateError(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetEntitlementGateErrorBusForTests(): void {
  listeners.clear();
}
