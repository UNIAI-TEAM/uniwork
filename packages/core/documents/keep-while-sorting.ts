import type { QueryKey } from "@tanstack/react-query";

// The key fragment of a filtered list is `JSON.stringify([[name, value], ...])`
// (documentFilterKey / sourcesFilterKey). Dropping the `sort`/`order` pairs
// gives the list's identity apart from its order.
function withoutSort(key: QueryKey): string {
  return JSON.stringify(
    key.map((part) => {
      if (typeof part !== "string" || !part.startsWith("[[")) return part;
      try {
        const pairs: unknown = JSON.parse(part);
        return Array.isArray(pairs) ? pairs.filter((pair) => !(Array.isArray(pair) && (pair[0] === "sort" || pair[0] === "order"))) : part;
      } catch {
        return part;
      }
    }),
  );
}

/**
 * `placeholderData` for the sortable lists (UNI-2038): when the key changed
 * only in `sort`/`order`, the previous answer stays on screen until the
 * re-ordered page 1 arrives, so a header click does not swap the table for a
 * skeleton (and drop keyboard focus with the button). Any other change of key
 * (chip, filter, workspace) still starts from nothing.
 */
export function keepWhileSorting<K extends QueryKey>(key: K) {
  return <T>(previous: T | undefined, previousQuery: { queryKey: K } | undefined): T | undefined =>
    previousQuery && withoutSort(previousQuery.queryKey) === withoutSort(key) ? previous : undefined;
}
