// The permission primer (audit P2 i18n/UX): UniChat says why before the
// system asks, never asks a question the system will not show again, and
// offers the phone's Settings once a permission is off for good.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPermissionGate, primerStep, type PermissionApi, type PrimerRequest } from "./permissions";
import { usePrimerStore, answerPrimer, presentPrimer } from "./stores/permission-primer-store";
import { memoryDeviceStore } from "./storage/device-store";

const undetermined = { granted: false, canAskAgain: true };
const granted = { granted: true, canAskAgain: true };
const blocked = { granted: false, canAskAgain: false };

function setup(initial = undetermined, after = granted) {
  const api: PermissionApi = { read: vi.fn(async () => initial), request: vi.fn(async () => after) };
  const present = vi.fn<(request: PrimerRequest) => Promise<boolean>>(async () => true);
  const openSettings = vi.fn(async () => undefined);
  const store = memoryDeviceStore();
  const gate = createPermissionGate({ api, present, openSettings, openStore: async () => store });
  return { api, present, openSettings, store, gate };
}

describe("primerStep", () => {
  it("goes straight on when granted, explains first while the system can still ask, and points at Settings after", () => {
    expect(primerStep(granted)).toBe("granted");
    expect(primerStep(undetermined)).toBe("prime");
    expect(primerStep(blocked)).toBe("settings");
  });
});

describe("createPermissionGate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks nothing when the permission is already there", async () => {
    const { gate, present, api } = setup(granted);
    await expect(gate.ensure("microphone", "voice")).resolves.toBe(true);
    expect(present).not.toHaveBeenCalled();
    expect(api.request).not.toHaveBeenCalled();
  });

  it("explains, then lets the system ask, and answers what the person chose there", async () => {
    const { gate, present, api } = setup(undetermined, granted);
    await expect(gate.ensure("camera", "video")).resolves.toBe(true);
    expect(present).toHaveBeenCalledWith({ kind: "camera", reason: "video", step: "prime" });
    expect(api.request).toHaveBeenCalledWith("camera");
    vi.mocked(api.request).mockResolvedValueOnce(blocked);
    await expect(gate.ensure("camera", "video")).resolves.toBe(false);
  });

  it("does not ask the system when the person said not now", async () => {
    const { gate, present, api } = setup(undetermined);
    present.mockResolvedValueOnce(false);
    await expect(gate.ensure("microphone", "call")).resolves.toBe(false);
    expect(api.request).not.toHaveBeenCalled();
  });

  it("offers the phone's Settings when the system will not ask again, and opens them on request", async () => {
    const { gate, present, openSettings } = setup(blocked);
    await expect(gate.ensure("microphone", "voice")).resolves.toBe(false);
    expect(present).toHaveBeenCalledWith({ kind: "microphone", reason: "voice", step: "settings" });
    expect(openSettings).toHaveBeenCalledTimes(1);
    present.mockResolvedValueOnce(false);
    await gate.ensure("microphone", "voice");
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("asks at launch only once: a 'not now' is remembered, and a refusal is not followed by Settings", async () => {
    const { gate, present, store } = setup(undetermined);
    present.mockResolvedValueOnce(false);
    await expect(gate.ensure("notifications", "notifications", { once: true })).resolves.toBe(false);
    expect(store.getString("permission_primer_dismissed:notifications")).toBe("1");
    await expect(gate.ensure("notifications", "notifications", { once: true })).resolves.toBe(false);
    expect(present).toHaveBeenCalledTimes(1);
    // Settings › Notifications asks again, on purpose.
    await expect(gate.ensure("notifications", "notifications")).resolves.toBe(true);
    expect(present).toHaveBeenCalledTimes(2);

    // A first launch where the person goes on: the system asks, its answer stands.
    const fresh = setup(undetermined, granted);
    await expect(fresh.gate.ensure("notifications", "notifications", { once: true })).resolves.toBe(true);
    expect(fresh.api.request).toHaveBeenCalledWith("notifications");

    const off = setup(blocked);
    await expect(off.gate.ensure("notifications", "notifications", { once: true })).resolves.toBe(false);
    expect(off.present).not.toHaveBeenCalled();
  });

  it("falls back to the system's own prompt when the status cannot be read", async () => {
    const { gate, api, present } = setup();
    vi.mocked(api.read).mockRejectedValueOnce(new Error("no module"));
    await expect(gate.ensure("microphone", "voice")).resolves.toBe(true);
    expect(present).not.toHaveBeenCalled();
    expect(api.request).toHaveBeenCalledWith("microphone");
  });
});

describe("the primer store", () => {
  it("shows one request at a time; a newer one answers the older with no", async () => {
    const first = presentPrimer({ kind: "microphone", reason: "voice", step: "prime" });
    expect(usePrimerStore.getState().request).toMatchObject({ kind: "microphone" });
    const second = presentPrimer({ kind: "camera", reason: "video", step: "prime" });
    await expect(first).resolves.toBe(false);
    answerPrimer(true);
    await expect(second).resolves.toBe(true);
    expect(usePrimerStore.getState().request).toBeNull();
    // An answer with nothing showing is ignored.
    answerPrimer(false);
    expect(usePrimerStore.getState().request).toBeNull();
  });
});
