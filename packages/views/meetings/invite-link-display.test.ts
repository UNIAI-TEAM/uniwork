import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
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

const i18n = initI18n();
const t = i18n.t.bind(i18n) as (key: string, options?: Record<string, unknown>) => string;
/** Echoes the key and its options, so the English path is checked without English resources. */
const echo = (key: string, options?: Record<string, unknown>) => `${key}${options ? JSON.stringify(options) : ""}`;

describe("invite-link-display", () => {
  it("formats timestamps and short codes for list labels", () => {
    expect(shortInviteLinkCode(baseLink.id)).toBe("PXESN2");
    expect(formatInviteLinkTimestamp(baseLink.created_at!, "vi")).toMatch(/46/);
    expect(inviteLinkDisplayName(baseLink, "vi", t)).toContain("#PXESN2");
    expect(inviteLinkDisplayName(baseLink, "vi", t)).toContain("Liên kết");
  });

  it("repairs stored i18n key names and builds metadata parts", () => {
    const broken = { ...baseLink, name: "meetings.linkDefaultName" };
    expect(inviteLinkDisplayName(broken, "vi", t)).toContain("Liên kết");
    expect(inviteLinkDisplayName(broken, "vi", t)).not.toContain("meetings.");
    const meta = inviteLinkMetaParts(broken, "vi", t);
    expect(meta.join(" · ")).toContain("Tự động cho phép");
    expect(meta.join(" · ")).toContain("Tạo");
    expect(meta.join(" · ")).toContain("Hết hạn");
    expect(meta.join(" · ")).not.toContain("meetings.");
  });

  it("keeps custom names and default labels for create", () => {
    const custom = { ...baseLink, name: "Khách VIP" };
    expect(inviteLinkDisplayName(custom, "vi", t)).toBe("Khách VIP · #PXESN2");
    expect(defaultInviteLinkLabel(baseLink.created_at!, "vi", t)).toMatch(/^Liên kết /);
  });

  it("builds every label from i18n keys, counting uses with plurals", () => {
    expect(defaultInviteLinkLabel(baseLink.created_at!, "en", echo)).toMatch(/^meetings\.linkDefaultName/);
    const meta = inviteLinkMetaParts(
      { ...baseLink, access_mode: "REQUEST_APPROVAL", max_uses: 5, used_count: 2 },
      "en",
      echo,
    );
    expect(meta[0]).toBe("meetings.linkNeedApproval");
    expect(meta.join(" · ")).toContain("meetings.linkMetaCreated");
    expect(meta.join(" · ")).toContain("meetings.linkMetaExpires");
    expect(meta.at(-1)).toBe('meetings.linkMetaUsesLimit{"used":2,"max":5}');
    expect(inviteLinkMetaParts({ ...baseLink, used_count: 1 }, "en", echo).at(-1)).toBe('meetings.linkMetaUsesCount{"count":1}');
  });

  it("handles invalid timestamps and short link codes", () => {
    expect(formatInviteLinkTimestamp("not-a-date", "vi")).toBe("");
    expect(shortInviteLinkCode(" abc ")).toBe("ABC");
    expect(shortInviteLinkCode("01ABC")).toBe("01ABC");
  });

  it("treats blank and legacy i18n names as generic", () => {
    const blank = { ...baseLink, name: "   " };
    expect(inviteLinkDisplayName(blank, "vi", t)).toContain("Liên kết");
    const legacy = { ...baseLink, name: "meetings.linkFoo", created_at: undefined };
    expect(inviteLinkDisplayName(legacy, "vi", t)).toMatch(/Liên kết .* · #PXESN2/);
    const meta = inviteLinkMetaParts({ ...baseLink, created_at: undefined, used_count: 3 }, "vi", t);
    expect(meta.join(" · ")).toContain("3 lượt dùng");
  });
});
