import type { NavigationAdapter } from "../navigation";

// Consumers that clean the address in the same commit (`?from=`, `?access=`)
// each hold their own snapshot of the query; replacing from a snapshot would
// put back what the other one just removed. Queue the names and replace once
// per microtask, from the first snapshot minus every queued name.
let queued: { nav: NavigationAdapter; names: Set<string> } | null = null;

export function dropSearchParams(nav: NavigationAdapter, names: readonly string[]): void {
  if (queued) {
    for (const name of names) queued.names.add(name);
    return;
  }
  const batch = { nav, names: new Set(names) };
  queued = batch;
  queueMicrotask(() => {
    queued = null;
    const rest = new URLSearchParams(batch.nav.searchParams);
    for (const name of batch.names) rest.delete(name);
    const query = rest.toString();
    batch.nav.replace(query ? `${batch.nav.pathname}?${query}` : batch.nav.pathname);
  });
}
