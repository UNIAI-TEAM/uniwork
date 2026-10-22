// The permission gate as the app builds it (permission-gate.ts): the real gate (data/permissions.ts) on the
// expo modules that own each permission, the primer store and Linking. Only the expo modules' native side is
// stood in for, so a module renamed or a status read from the wrong one fails here; the components that ask
// go through this same gate (test/jest-setup.ts no longer mocks it).
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import { getCameraPermissionsAsync, requestCameraPermissionsAsync } from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { Linking } from "react-native";
import { answerPrimer, usePrimerStore } from "@/data/stores/permission-primer-store";
import { ensureCallPermissions, permissionGate } from "./permission-gate";

jest.mock("expo-image-picker", () => ({
  getCameraPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
}));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
}));

const status = (granted: boolean, canAskAgain = true) => ({ granted, canAskAgain, status: granted ? "granted" : "denied", expires: "never" });

/** Lets the gate's awaits run until it has shown the primer (or finished). */
const settle = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  usePrimerStore.setState({ request: null });
  jest.clearAllMocks();
});

describe("permissionGate on the expo permission modules", () => {
  it("lets a granted microphone through without a primer or a system prompt", async () => {
    jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce(status(true) as never);
    await expect(permissionGate.ensure("microphone", "voice")).resolves.toBe(true);
    expect(usePrimerStore.getState().request).toBeNull();
    expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  });

  it("explains first, then asks the system only after Continue", async () => {
    jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce(status(false) as never);
    jest.mocked(requestRecordingPermissionsAsync).mockResolvedValueOnce(status(true) as never);
    const granted = permissionGate.ensure("microphone", "voice");
    await settle();
    expect(usePrimerStore.getState().request).toEqual({ kind: "microphone", reason: "voice", step: "prime" });
    expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
    answerPrimer(true);
    await expect(granted).resolves.toBe(true);
    expect(requestRecordingPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("keeps the system prompt for later on Not now", async () => {
    jest.mocked(getCameraPermissionsAsync).mockResolvedValueOnce(status(false) as never);
    const granted = permissionGate.ensure("camera", "video");
    await settle();
    expect(usePrimerStore.getState().request).toMatchObject({ kind: "camera", step: "prime" });
    answerPrimer(false);
    await expect(granted).resolves.toBe(false);
    expect(requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  it("offers the phone's Settings once the system will not ask again", async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce(status(false, false) as never);
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValueOnce(undefined);
    const granted = permissionGate.ensure("notifications", "notifications");
    await settle();
    expect(usePrimerStore.getState().request).toEqual({ kind: "notifications", reason: "notifications", step: "settings" });
    answerPrimer(true);
    await expect(granted).resolves.toBe(false);
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("falls back to the system prompt when the status cannot be read", async () => {
    jest.mocked(getRecordingPermissionsAsync).mockRejectedValueOnce(new Error("no activity"));
    jest.mocked(requestRecordingPermissionsAsync).mockResolvedValueOnce(status(false) as never);
    await expect(permissionGate.ensure("microphone", "call")).resolves.toBe(false);
    expect(usePrimerStore.getState().request).toBeNull();
  });
});

describe("ensureCallPermissions", () => {
  it("asks for the microphone, then the camera for a video call, for the call it names", async () => {
    const ensure = jest.spyOn(permissionGate, "ensure").mockResolvedValue(true);
    await ensureCallPermissions(true, "c-1");
    expect(ensure.mock.calls).toEqual([
      ["microphone", "call", { callId: "c-1" }],
      ["camera", "video", { callId: "c-1" }],
    ]);
    ensure.mockClear();
    await ensureCallPermissions(false);
    expect(ensure.mock.calls).toEqual([["microphone", "call", { callId: undefined }]]);
    ensure.mockRestore();
  });

  it("hands the call's id to the primer on the real gate, so its ringing leaves the primer open", async () => {
    jest.mocked(getRecordingPermissionsAsync).mockResolvedValueOnce(status(false) as never);
    const done = ensureCallPermissions(false, "c-2");
    await settle();
    expect(usePrimerStore.getState().request).toEqual({ kind: "microphone", reason: "call", step: "prime", callId: "c-2" });
    answerPrimer(false);
    await expect(done).resolves.toBeUndefined();
  });
});
