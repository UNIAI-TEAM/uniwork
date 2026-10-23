import { describe, expect, it } from "vitest";
import { z } from "zod";
import { migratePersisted, persistedField, readPersistedList } from "./persisted-records";

describe("readPersistedList", () => {
  it("keeps the entries that read and drops the rest alone", () => {
    expect(readPersistedList(z.object({ id: z.string() }), [{ id: "a" }, { id: 1 }, null, { id: "b", extra: true }])).toEqual([{ id: "a" }, { id: "b" }]);
    expect(readPersistedList(z.string(), "not a list")).toEqual([]);
  });
});

describe("migratePersisted", () => {
  const steps = {
    1: (state: unknown) => ({ ...(persistedField(state, "v1") ? { items: persistedField(state, "v1") } : {}), from: 1 }),
    // No step at 2: nothing changed in the shape between 2 and 3.
    3: (state: unknown) => ({ items: persistedField(state, "items"), at: 4 }),
  };

  it("runs every step from the stored version up, in order", () => {
    expect(migratePersisted({ v1: ["a"] }, 1, 4, steps)).toEqual({ items: ["a"], at: 4 });
    expect(migratePersisted({ items: ["b"] }, 3, 4, steps)).toEqual({ items: ["b"], at: 4 });
  });

  it("passes a state of the current or a newer version on untouched", () => {
    const state = { items: ["c"] };
    expect(migratePersisted(state, 4, 4, steps)).toBe(state);
    expect(migratePersisted(state, 7, 4, steps)).toBe(state);
  });
});

describe("persistedField", () => {
  it("reads one field of anything without trusting it", () => {
    expect(persistedField({ entries: [1] }, "entries")).toEqual([1]);
    expect(persistedField(null, "entries")).toBeUndefined();
    expect(persistedField("x", "entries")).toBeUndefined();
  });
});
