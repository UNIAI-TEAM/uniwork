// QueryCache / MutationCache onError (audit P0-2): a failed query or mutation
// anywhere in the app reaches crash reporting once, named by the first
// segment of its key (never the ids after it). data/report.ts drops what is
// expected — offline, timeouts, any 4xx — so only server faults and bugs
// (a 5xx, a schema the code could not handle, a TypeError) are reported.
import { reportError } from "./report";

interface KeyedQuery {
  queryKey: readonly unknown[];
}
interface KeyedMutation {
  options: { mutationKey?: readonly unknown[] };
}

const rootOf = (key: readonly unknown[] | undefined): string => (typeof key?.[0] === "string" ? key[0] : "unkeyed");

export function reportQueryError(error: unknown, query: KeyedQuery): void {
  reportError(error, { source: "query", tags: { query: rootOf(query.queryKey) } });
}

export function reportMutationError(error: unknown, _variables: unknown, _context: unknown, mutation: KeyedMutation): void {
  reportError(error, { source: "mutation", tags: { mutation: rootOf(mutation.options.mutationKey) } });
}
