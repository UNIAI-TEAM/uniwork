import type { Room } from "livekit-client";

type RoomTokenInternals = {
  engine?: { token?: string };
  regionUrlProvider?: { updateToken: (token: string) => void };
};

/** Update the in-memory LiveKit credential without calling room.connect() again. */
export function applyMeetingRoomToken(room: Room, token: string): void {
  const internals = room as unknown as RoomTokenInternals;
  if (internals.engine) {
    internals.engine.token = token;
  }
  internals.regionUrlProvider?.updateToken(token);
}
