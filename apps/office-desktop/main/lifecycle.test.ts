import { expect, it, vi } from "vitest";
import { assertRecoveryActionAllowed, createDesktopLifecycleCoordinator, recoverDraft } from "./lifecycle";

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

it("maps a thrown Save to a typed stay result and blocks byte escape actions", async () => {
  const lifecycle = createDesktopLifecycleCoordinator({ save: async () => { throw new Error("secret path"); }, checkpoint: async () => undefined, discard: async () => undefined });
  await expect(lifecycle.resolve("close", true, "save")).resolves.toEqual({ status: "stay", reason: "close", code: "save_failed" });
  expect(() => assertRecoveryActionAllowed({ status: "blocked", metadata: {} as never, reason: "edit_acl_missing" }, "clipboard")).toThrowError("draft operation refused");
});

it("passes the main-bound session and base pair through the shared recovery adapter", async () => {
  const adapter = { recover: vi.fn(async () => ({ status: "missing" as const })) } as never;
  const session = { sessionId: "session", deploymentId: "dep", accountId: "account", generation: 1 };
  const lookup = { deploymentId: "dep", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc" };
  await expect(recoverDraft({ adapter, session, lookup, currentBase: { revision: "1", version: "v1" }, liveAccess: "edit" })).resolves.toEqual({ status: "missing" });
});
