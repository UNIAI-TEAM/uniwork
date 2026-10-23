import { describe, expect, it } from "vitest";
import { chatKeys } from "./chat-keys";

type Factory = (...args: never[]) => readonly unknown[];

// Distinct sample arguments, so a prefix found below is a real one and not two ids that happen to match.
const SAMPLE: Record<string, unknown[]> = {
  roomLinks: ["w1", "a1", ["m1", "m2"]],
  expressions: ["w1", "stickers", "q"],
};
const keyOf = (name: string, factory: Factory): readonly unknown[] =>
  (factory as (...args: unknown[]) => readonly unknown[])(...(SAMPLE[name] ?? ["w1", "a1", "a2", "a3"].slice(0, factory.length)));

const keys = Object.entries(chatKeys as unknown as Record<string, Factory>).map(([name, factory]) => ({ name, key: keyOf(name, factory) }));

const isPrefix = (short: readonly unknown[], long: readonly unknown[]) =>
  short.length < long.length && short.every((part, i) => part === long[i]);

/**
 * The prefixes some code patches or invalidates as a whole, and the only keys
 * allowed under each. Every key under a prefix has that family's data shape:
 * a key added under one (the long-press preview once sat under room-messages)
 * would be patched as if it were a room timeline.
 */
const FAMILIES: Record<string, string[]> = {
  roomMessagesRoot: ["roomMessages"],
  roomAroundRoot: ["roomMessagesAround"],
  roomThreads: ["threadMessages"],
  threadsRoot: ["roomThreads", "threadMessages"],
  roomLinksRoot: ["roomLinks"],
};

describe("chatKeys", () => {
  it("puts every key under ['chat', wsId] except the account-wide unread summary", () => {
    for (const { name, key } of keys) {
      expect(key[0], name).toBe("chat");
      if (name === "unreadSummary") expect(key).toEqual(["chat", "unread-summary"]);
      else expect(key[1], name).toBe("w1");
    }
  });

  it("nests a key under another only inside a declared family", () => {
    const nested: Record<string, string[]> = {};
    for (const outer of keys) {
      const inside = keys.filter((inner) => isPrefix(outer.key, inner.key)).map((inner) => inner.name).sort();
      if (inside.length > 0) nested[outer.name] = inside;
    }
    expect(nested).toEqual(Object.fromEntries(Object.entries(FAMILIES).map(([name, members]) => [name, [...members].sort()])));
  });

  it("gives two factories two different keys", () => {
    const seen = new Set(keys.map(({ key }) => JSON.stringify(key)));
    expect(seen.size).toBe(keys.length);
  });
});
