// The app icon's badge: everything unread, set whenever the
// unread summary changes and cleared (0) without a signed-in person. iOS shows
// the number; Android launchers show a dot or the number as they choose.
import * as Notifications from "expo-notifications";

let shown: number | null = null;

export async function setAppBadge(count: number): Promise<void> {
  const next = Math.max(0, Math.floor(count));
  if (next === shown) return;
  shown = next;
  try {
    await Notifications.setBadgeCountAsync(next);
  } catch {
    // A launcher without badges: nothing to show, try again on the next change.
    shown = null;
  }
}
