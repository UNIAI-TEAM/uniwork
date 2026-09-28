import { defaultStorage } from "../platform/storage";
import type { SessionStatus } from "./store";

// Not the session (that is the HttpOnly refresh cookie script cannot read),
// only whether this browser held one last time. Pages that skip the start-up
// refresh read it to decide whether asking is worth a request, so an
// anonymous visitor is still never answered with a 401.
const SESSION_HINT_KEY = "uniwork_session_hint";

export function hasSessionHint(): boolean {
  return defaultStorage.getItem(SESSION_HINT_KEY) === "1";
}

export function syncSessionHint(status: SessionStatus): void {
  if (status === "authed") defaultStorage.setItem(SESSION_HINT_KEY, "1");
  else if (status === "anon") defaultStorage.removeItem(SESSION_HINT_KEY);
}
