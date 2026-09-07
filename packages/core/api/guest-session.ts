/** In-memory guest session for anonymous meeting invite flows. */
let guestSession: string | null = null;

export function getGuestSession(): string | null {
  return guestSession;
}

export function setGuestSession(value: string | null): void {
  const trimmed = value?.trim();
  guestSession = trimmed ? trimmed : null;
}

export const GUEST_SESSION_HEADER = "X-Guest-Session";
