// Reading a value of unknown shape (a parsed push payload, a thrown error, a
// stored JSON blob) without a type assertion: lib/ narrows with these guards,
// so a drifted value reads as missing instead of lying to the compiler.

/** A plain object (not null, not an array), its keys readable as unknown. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value` as a record, or null when it is not one. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/** `value.a.b.c`, each step read only when the one before is a record; undefined when the path breaks. */
export function pathOf(value: unknown, ...keys: string[]): unknown {
  let at: unknown = value;
  for (const key of keys) {
    if (!isRecord(at)) return undefined;
    at = at[key];
  }
  return at;
}
