import { describe, expect, it } from "vitest";
import { meetingAvatarTint } from "./avatar-tint";

// The demo workspace's join order (verified against GET /members): lan → ha → minh → tuan → bao.
const members = ["lan", "ha", "minh", "tuan", "bao", "sixth"].map((user_id) => ({ user_id }));

describe("meetingAvatarTint", () => {
  it("follows the boards: Lan blue, Hà pink, Minh teal, Tuấn orange, Bảo green", () => {
    expect(["lan", "ha", "minh", "tuan", "bao"].map((id) => meetingAvatarTint(id, members))).toEqual([
      "blue",
      "pink",
      "teal",
      "orange",
      "green",
    ]);
  });

  it("wraps past five members", () => {
    expect(meetingAvatarTint("sixth", members)).toBe("blue");
  });

  it("paints guests and former members gray", () => {
    expect(meetingAvatarTint("guest-1", members)).toBe("gray");
    expect(meetingAvatarTint(null, members)).toBe("gray");
    expect(meetingAvatarTint("lan", [])).toBe("gray");
  });
});
