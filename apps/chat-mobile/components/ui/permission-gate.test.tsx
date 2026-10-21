// ensureCallPermissions on the real gate (test/jest-setup.ts mocks the module
// for every other component test): the microphone first, the camera for a
// video call, and the call's id handed to the primer so its ringing leaves it open.
import { ensureCallPermissions, permissionGate } from "./permission-gate";

jest.unmock("@/components/ui/permission-gate");

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
  });
});
