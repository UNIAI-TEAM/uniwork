// Whether one person is online, read per person: a row or an avatar redraws
// when that person comes or goes, not each time anyone's presence changes
// (lists used to subscribe to the whole set).
import { selectIsOnline, usePresenceStore } from "@/data/stores/chat-presence-store";

export function useIsOnline(userId: string | null | undefined): boolean {
  return usePresenceStore(selectIsOnline(userId));
}
