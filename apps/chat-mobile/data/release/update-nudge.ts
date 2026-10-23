// Which "new version" banner the person closed (components/app/update-nudge.tsx), kept on the device so the nudge
// for one recommended version shows until it is dismissed and never again after; a newer recommendation shows anew
// (lib/build-info.ts › updateNudgeFor). Outside any account: it is about the app, not a person.
import { openDeviceStore, type DeviceStore } from "../storage/device-store";

export const NUDGE_DISMISSED_KEY = "update-nudge/dismissed";

/** The recommended version whose nudge was dismissed, or null. */
export async function readDismissedNudge(open: () => Promise<DeviceStore> = openDeviceStore): Promise<string | null> {
  return (await open()).getString(NUDGE_DISMISSED_KEY) ?? null;
}

export async function dismissNudge(version: string, open: () => Promise<DeviceStore> = openDeviceStore): Promise<void> {
  (await open()).set(NUDGE_DISMISSED_KEY, version);
}
