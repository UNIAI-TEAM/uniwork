import { expect, it, vi } from "vitest";
import { createDesktopLifecycleCoordinator } from "./lifecycle";

it("requires confirmed durability before allowing keep-draft close", async () => {
  const checkpoint = vi.fn(async () => ({ status: "stored" as const, metadata: {} as never }));
  const lifecycle = createDesktopLifecycleCoordinator({ save: async () => ({ accepted: false, reason: "network" }), checkpoint, discard: vi.fn() });
  await expect(lifecycle.resolve("close", true, "keep-draft")).resolves.toEqual({ status: "proceed", choice: "keep-draft", reason: "close" });
  expect(checkpoint).toHaveBeenCalledOnce();
});

it("keeps the editor open when Save is refused or a concurrent lifecycle action runs", async () => {
  let release!: () => void;
  const save = vi.fn(() => new Promise<{ accepted: boolean }>((resolve) => { release = () => resolve({ accepted: true }); }));
  const lifecycle = createDesktopLifecycleCoordinator({ save, checkpoint: async () => undefined, discard: async () => undefined });
  const first = lifecycle.resolve("logout", true, "save");
  await expect(lifecycle.resolve("close", true, "save")).resolves.toEqual({ status: "stay", reason: "close", code: "save_in_progress" });
  release();
  await expect(first).resolves.toEqual({ status: "proceed", choice: "save", reason: "logout" });
});

it("does not call save or discard for stay and clean lifecycle", async () => {
  const save = vi.fn(async () => ({ accepted: true }));
  const discard = vi.fn(async () => undefined);
  const lifecycle = createDesktopLifecycleCoordinator({ save, checkpoint: async () => undefined, discard });
  await expect(lifecycle.resolve("update", false, "stay")).resolves.toEqual({ status: "proceed", choice: "stay", reason: "update" });
  await expect(lifecycle.resolve("update", true, "stay")).resolves.toEqual({ status: "stay", reason: "update" });
  expect(save).not.toHaveBeenCalled();
  expect(discard).not.toHaveBeenCalled();
});
