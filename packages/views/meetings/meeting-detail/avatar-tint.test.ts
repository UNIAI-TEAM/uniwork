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

describe("meetingAvatarTint's member index", () => {
  it("reads a members list once, however many faces ask", () => {
    let reads = 0;
    const many = Array.from({ length: 1000 }, (_, i) => ({
      get user_id() {
        reads += 1;
        return `u${i}`;
      },
    }));
    for (let i = 0; i < 1000; i += 1) meetingAvatarTint(`u${i}`, many);
    expect(reads).toBe(1000);
    expect(meetingAvatarTint("u7", many)).toBe(MEETING_ORDER[7 % 5]);
  });
});

const MEETING_ORDER = ["blue", "pink", "teal", "orange", "green"];
