import { describe, expect, it } from "vitest";
import type { MeetingInviteLink } from "@uniwork/core/types/meeting";
import {
  defaultInviteLinkLabel,
  formatInviteLinkTimestamp,
  inviteLinkDisplayName,
  inviteLinkMetaParts,
  shortInviteLinkCode,
} from "./invite-link-display";

const baseLink: MeetingInviteLink = {
  id: "01M1K3Z2K4WNHTBCNV58PXESN2",
  meeting_id: "m1",
  name: "Liên kết mời",
  access_mode: "AUTO_ADMIT",
  expires_at: "2026-09-10T08:00:00.000Z",
  used_count: 0,
  created_at: "2026-09-03T07:46:00.000Z",
};

describe("invite-link-display", () => {
  it("formats timestamps and short codes for list labels", () => {
    expect(shortInviteLinkCode(baseLink.id)).toBe("PXESN2");
    expect(formatInviteLinkTimestamp(baseLink.created_at!, "vi")).toMatch(/46/);
    expect(inviteLinkDisplayName(baseLink, "vi")).toContain("#PXESN2");
    expect(inviteLinkDisplayName(baseLink, "vi")).toContain("Liên kết");
  });

  it("repairs stored i18n key names and builds metadata parts", () => {
    const broken = { ...baseLink, name: "meetings.linkDefaultName" };
    expect(inviteLinkDisplayName(broken, "vi")).toContain("Liên kết");
    expect(inviteLinkDisplayName(broken, "vi")).not.toContain("meetings.");
    const meta = inviteLinkMetaParts(broken, "vi");
    expect(meta.join(" · ")).toContain("Tự động cho phép");
    expect(meta.join(" · ")).toContain("Tạo");
    expect(meta.join(" · ")).toContain("Hết hạn");
    expect(meta.join(" · ")).not.toContain("meetings.");
  });

  it("keeps custom names and default labels for create", () => {
    const custom = { ...baseLink, name: "Khách VIP" };
    expect(inviteLinkDisplayName(custom, "vi")).toBe("Khách VIP · #PXESN2");
    expect(defaultInviteLinkLabel(baseLink.created_at!, "vi")).toMatch(/^Liên kết /);
  });

  it("formats English labels and metadata", () => {
    expect(defaultInviteLinkLabel(baseLink.created_at!, "en")).toMatch(/^Link /);
    const meta = inviteLinkMetaParts(
      { ...baseLink, access_mode: "REQUEST_APPROVAL", max_uses: 5, used_count: 2 },
      "en",
    );
    expect(meta.join(" · ")).toContain("Host must approve");
    expect(meta.join(" · ")).toContain("Created");
    expect(meta.join(" · ")).toContain("Expires");
    expect(meta.join(" · ")).toContain("2/5 uses");
  });

  it("handles invalid timestamps and short link codes", () => {
    expect(formatInviteLinkTimestamp("not-a-date", "vi")).toBe("");
    expect(shortInviteLinkCode(" abc ")).toBe("ABC");
    expect(shortInviteLinkCode("01ABC")).toBe("01ABC");
  });

  it("treats blank and legacy i18n names as generic", () => {
    const blank = { ...baseLink, name: "   " };
    expect(inviteLinkDisplayName(blank, "vi")).toContain("Liên kết");
    const legacy = { ...baseLink, name: "meetings.linkFoo", created_at: undefined };
    expect(inviteLinkDisplayName(legacy, "vi")).toMatch(/Liên kết .* · #PXESN2/);
    const meta = inviteLinkMetaParts({ ...baseLink, created_at: undefined, used_count: 3 }, "vi");
    expect(meta.join(" · ")).toContain("3 lượt dùng");
  });
});
