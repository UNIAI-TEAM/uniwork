import { describe, expect, it } from "vitest";
import {
  createDesktopOfficeEngine,
  desktopOpenNativeFile,
  type DesktopTransportOptions,
} from "../src/desktop/index";
import type { HostIpcPort } from "@uniwork/office-contracts";
import { HostCapabilityRefusal } from "@uniwork/office-contracts";
import { createFakeEngineTransport } from "./fake-transport";
import { runOfficeEngineContractSuite } from "./adapter-contract-suite";

function fakeIpc(): HostIpcPort {
  const engine = createFakeEngineTransport();
  return {
    async call(channel: string, body: unknown) {
      if (channel === "engine:submit") return engine.submit(body as Record<string, unknown>);
      if (channel === "engine:cancel") return engine.cancel!((body as { job_id: string }).job_id);
      throw new HostCapabilityRefusal(channel, "unsupported", "channel not bound");
    },
    send() {},
    subscribe() {
      return () => {};
    },
  };
}

const factory = (overrides: Partial<DesktopTransportOptions> = {}) =>
  createDesktopOfficeEngine({ ipc: fakeIpc(), ...overrides });

describe("desktop engine transport", () => {
  runOfficeEngineContractSuite("desktop", () => factory());

  it("an unbound native bridge is a typed refusal, not a fake path", async () => {
    await expect(desktopOpenNativeFile(undefined, "h1")).rejects.toMatchObject({
      name: "HostCapabilityRefusal",
      channel: "desktop:open-native-file",
      reason: "unbound",
    });
  });

  it("a bound native bridge returns bytes", async () => {
    const bytes = await desktopOpenNativeFile(
      { openNativeFile: async () => new Uint8Array([1, 2, 3]) },
      "h1",
    );
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});
