// The background module as the drain uses it: each call reaches the module with the module as `this`, a platform
// that lacks a function (iOS has no job, Android no grace) or a build without the module (Expo Go, tests) makes it a
// no-op, and a grace the system refused reads as none.
import { describe, expect, it, vi } from "vitest";
import type { UniChatBackgroundModule } from "@/modules/unichat-background";

vi.mock("@/modules/unichat-background", () => ({ UniChatBackground: null }));

const { nativeDrain, nativeDrainFrom } = await import("./native-drain");

describe("nativeDrainFrom", () => {
  it("hands every call to the module itself", async () => {
    const seen: unknown[] = [];
    const module: UniChatBackgroundModule = {
      async beginGrace(name) {
        seen.push(["begin", name, this === module]);
        return 7;
      },
      async endGrace(id) {
        seen.push(["end", id, this === module]);
      },
      scheduleDrain(expedite) {
        seen.push(["schedule", expedite, this === module]);
      },
      cancelDrain() {
        seen.push(["cancel", this === module]);
      },
      drainFinished(token, owed) {
        seen.push(["finished", token, owed, this === module]);
      },
    };
    const drain = nativeDrainFrom(module);
    await expect(drain.beginGrace("outbox")).resolves.toBe(7);
    await drain.endGrace(7);
    drain.scheduleDrain(true);
    drain.cancelDrain();
    drain.drainFinished("job-1", false);
    expect(seen).toEqual([
      ["begin", "outbox", true],
      ["end", 7, true],
      ["schedule", true, true],
      ["cancel", true],
      ["finished", "job-1", false, true],
    ]);
  });

  it("reads a grace the system refused (-1) as none", async () => {
    await expect(nativeDrainFrom({ beginGrace: vi.fn(async () => -1) }).beginGrace("outbox")).resolves.toBeNull();
  });

  it("is a no-op for what the platform's half lacks, and without the module", async () => {
    for (const drain of [nativeDrainFrom({}), nativeDrain]) {
      await expect(drain.beginGrace("outbox")).resolves.toBeNull();
      await expect(drain.endGrace(1)).resolves.toBeUndefined();
      expect(() => {
        drain.scheduleDrain(true);
        drain.cancelDrain();
        drain.drainFinished("job", true);
      }).not.toThrow();
    }
  });
});
