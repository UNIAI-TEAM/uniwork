// The in-call camera button. A voice call reaches the camera here, mid-call,
// not through ensureCallPermissions at the start: turning it on explains first
// and lets the system ask, or offers Settings once the camera is off for good
// (components/ui/permission-gate.ts). Turning it off asks nothing.
import { permissionGate } from "@/components/ui/permission-gate";

export async function toggleCamera(enabled: boolean, setCameraEnabled: (on: boolean) => Promise<unknown>): Promise<void> {
  if (enabled) {
    await setCameraEnabled(false);
    return;
  }
  if (!(await permissionGate.ensure("camera", "video"))) return;
  await setCameraEnabled(true);
}
