import { describe, expect, it } from "vitest";
import { filterRoomMembers, roomMemberRows } from "./room-member-list";

const members = [
  { user_id: "ME", email: "me@acme.vn", role: "member" },
  { user_id: "u2", email: "binh@acme.vn", role: "admin" },
  { user_id: "U3", email: "chi.le@acme.vn", role: "member" },
  { user_id: "U4", email: "", role: "member" },
];
const nameContext = [
  { user_id: "U2", display_name: "Bình Trần", email: "binh@acme.vn" },
  { user_id: "u3", display_name: "", email: "chi.le@acme.vn" },
];

describe("roomMemberRows", () => {
  it("names each member as the room reads them, marks the viewer and the admins, keeping the order", () => {
    expect(roomMemberRows(members, "me", "Bạn", nameContext)).toEqual([
      { userId: "ME", name: "Bạn", email: "me@acme.vn", admin: false, self: true },
      { userId: "u2", name: "Bình Trần", email: "binh@acme.vn", admin: true, self: false },
      { userId: "U3", name: "chi.le", email: "chi.le@acme.vn", admin: false, self: false },
      { userId: "U4", name: "U4", email: "", admin: false, self: false },
    ]);
  });
});

describe("filterRoomMembers", () => {
  const rows = roomMemberRows(members, "ME", "Bạn", nameContext);

  it("keeps everyone for an empty query and matches a name or an email, accents and case folded", () => {
    expect(filterRoomMembers(rows, "  ")).toBe(rows);
    expect(filterRoomMembers(rows, "binh").map((r) => r.userId)).toEqual(["u2"]);
    expect(filterRoomMembers(rows, "TRẦN").map((r) => r.userId)).toEqual(["u2"]);
    expect(filterRoomMembers(rows, "chi.le@").map((r) => r.userId)).toEqual(["U3"]);
    expect(filterRoomMembers(rows, "nobody")).toEqual([]);
  });
});
