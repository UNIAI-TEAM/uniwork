// A room's full member list (components/chat/room-info/room-members-screen.tsx):
// every member named as the room reads them, the viewer as "Bạn", admins
// marked, and a search over names and emails with accents and case folded. A
// default channel holds the whole workspace (up to a thousand people), so the
// names come from one map of the room's name context, not a search of it per
// member.
import { foldedIncludes } from "@uniwork/core/chat/search-fold";
import { senderLabelFor, type NameContextEntry } from "./people-display";
import { userKey } from "./user-id";

export interface RoomMemberListRow {
  userId: string;
  name: string;
  email: string;
  admin: boolean;
  /** The viewer: no menu on their own row. */
  self: boolean;
}

interface Member {
  user_id: string;
  email: string;
  role: string;
}

export function roomMemberRows(
  members: readonly Member[],
  currentUserId: string,
  youLabel: string,
  nameContext: readonly NameContextEntry[],
): RoomMemberListRow[] {
  const byId = new Map(nameContext.map((entry) => [userKey(entry.user_id), entry]));
  return members.map((member) => {
    const entry = byId.get(userKey(member.user_id));
    return {
      userId: member.user_id,
      name: senderLabelFor({ sender: member.user_id }, currentUserId, youLabel, entry ? [entry] : []),
      email: member.email,
      admin: member.role === "admin",
      self: userKey(member.user_id) === userKey(currentUserId),
    };
  });
}

/** The rows whose name or email holds `query`; all of them (the same array) for a blank one. */
export function filterRoomMembers(rows: RoomMemberListRow[], query: string): RoomMemberListRow[] {
  const q = query.trim();
  if (!q) return rows;
  return rows.filter((row) => foldedIncludes(row.name, q) || foldedIncludes(row.email, q));
}
