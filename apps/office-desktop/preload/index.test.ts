import { expect, it, vi } from "vitest";
import { createPreloadBridge, exposePreloadBridge } from "./index";

it("exposes only the typed bridge and forwards an allowlisted call", async () => {
  const invoke = vi.fn().mockResolvedValue({ ok: true });
  const bridge = createPreloadBridge({ invoke });
  await expect(bridge.call("desktop:bootstrap", { sessionGeneration: "session_1234" })).resolves.toEqual({ ok: true });
  expect(invoke).toHaveBeenCalledWith("desktop:bootstrap", { sessionGeneration: "session_1234" });
  await expect(bridge.call("desktop:unknown" as never, {} as never)).rejects.toThrow(/allowlisted/);
});

it("uses context isolation's explicit main-world name", () => {
  const exposeInMainWorld = vi.fn();
  exposePreloadBridge({ exposeInMainWorld }, { invoke: vi.fn() });
  expect(exposeInMainWorld).toHaveBeenCalledWith("uniworkOffice", expect.objectContaining({ channels: expect.any(Array) }));
});
