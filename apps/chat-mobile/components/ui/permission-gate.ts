// The app's permission gate (data/permissions.ts) on the native modules that
// own each permission: expo-audio for the microphone, expo-image-picker for
// the camera (the same system permission LiveKit's camera uses), and
// expo-notifications. The primer it shows is components/ui/permission-primer.tsx.
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import { getCameraPermissionsAsync, requestCameraPermissionsAsync } from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { Linking } from "react-native";
import { createPermissionGate, type PermissionKind, type PermissionState } from "@/data/permissions";
import { openDeviceStore } from "@/data/storage/device-store";
import { presentPrimer } from "@/data/stores/permission-primer-store";

type Ask = () => Promise<PermissionState>;

const READ: Record<PermissionKind, Ask> = {
  microphone: getRecordingPermissionsAsync,
  camera: getCameraPermissionsAsync,
  notifications: Notifications.getPermissionsAsync,
};

const REQUEST: Record<PermissionKind, Ask> = {
  microphone: requestRecordingPermissionsAsync,
  camera: requestCameraPermissionsAsync,
  notifications: () => Notifications.requestPermissionsAsync(),
};

const state = ({ granted, canAskAgain }: PermissionState): PermissionState => ({ granted, canAskAgain });

export const permissionGate = createPermissionGate({
  api: { read: async (kind) => state(await READ[kind]()), request: async (kind) => state(await REQUEST[kind]()) },
  present: presentPrimer,
  openSettings: () => Linking.openSettings(),
  openStore: openDeviceStore,
});

/** Before a call starts or is answered: the microphone, and the camera for a video call. The call goes on either way: a refused microphone still hears. */
export async function ensureCallPermissions(withCamera: boolean): Promise<void> {
  await permissionGate.ensure("microphone", "call");
  if (withCamera) await permissionGate.ensure("camera", "video");
}
