// The in-call camera button (call-room.tsx): turning the camera on in a call
// that started as voice goes through the permission primer first (audit P2:
// explain before the system prompt, Settings once it is off for good);
// turning it off asks nothing.
import { permissionGate } from "@/components/ui/permission-gate";
import { toggleCamera } from "./toggle-camera";

// The permission gate grants everything here: this test is about its caller. The gate itself, on the
// expo permission modules, is components/ui/permission-gate.test.tsx.
jest.mock("@/components/ui/permission-gate", () => ({
  permissionGate: { ensure: jest.fn(async () => true) },
  ensureCallPermissions: jest.fn(async () => undefined),
}));

describe("toggleCamera", () => {
  beforeEach(() => jest.mocked(permissionGate.ensure).mockClear());

  it("explains and asks before turning the camera on, then turns it on", async () => {
    const setCameraEnabled = jest.fn(async () => undefined);
    await toggleCamera(false, setCameraEnabled);
    expect(permissionGate.ensure).toHaveBeenCalledWith("camera", "video");
    expect(setCameraEnabled).toHaveBeenCalledWith(true);
  });

  it("leaves the camera off when the person says not now or the camera is off in Settings", async () => {
    jest.mocked(permissionGate.ensure).mockResolvedValueOnce(false);
    const setCameraEnabled = jest.fn(async () => undefined);
    await toggleCamera(false, setCameraEnabled);
    expect(setCameraEnabled).not.toHaveBeenCalled();
  });

  it("turns the camera off without asking anything", async () => {
    const setCameraEnabled = jest.fn(async () => undefined);
    await toggleCamera(true, setCameraEnabled);
    expect(permissionGate.ensure).not.toHaveBeenCalled();
    expect(setCameraEnabled).toHaveBeenCalledWith(false);
  });
});
