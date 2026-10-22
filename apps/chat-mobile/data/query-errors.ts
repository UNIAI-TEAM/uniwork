// QueryCache / MutationCache onError: a failed query or mutation
// anywhere in the app reaches crash reporting once, named by the first
// segment of its key (never the ids after it). data/report.ts drops what is
// expected — offline, timeouts, 401/403/404/429, a code the command handles
// (its `meta.handledCodes`, data/mutations/command.ts) — reports any other 4xx
// as contract drift at warning level, and server faults and bugs (a 5xx, a
// schema the code could not handle, a TypeError) as errors.
import { reportError } from "./report";

interface KeyedQuery {
  queryKey: readonly unknown[];
}
interface KeyedMutation {
  options: { mutationKey?: readonly unknown[]; meta?: Record<string, unknown> };
}

const rootOf = (key: readonly unknown[] | undefined): string => (typeof key?.[0] === "string" ? key[0] : "unkeyed");

export function reportQueryError(error: unknown, query: KeyedQuery): void {
  reportError(error, { source: "query", tags: { query: rootOf(query.queryKey) } });
}

export function reportMutationError(error: unknown, _variables: unknown, _context: unknown, mutation: KeyedMutation): void {
  const handled = mutation.options.meta?.handledCodes;
  const handledCodes = Array.isArray(handled) ? handled.filter((code): code is string => typeof code === "string") : [];
  reportError(error, { source: "mutation", tags: { mutation: rootOf(mutation.options.mutationKey) }, handledCodes });
}
