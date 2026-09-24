import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { canLeaveOrg, canTransferOwnership, type PermissionContext } from "@uniwork/core/permissions";
import { decisionReason } from "./permission-reason";

const i18n = initI18n();

const t = i18n.t.bind(i18n) as unknown as Parameters<typeof decisionReason>[0];
const owner: PermissionContext = { userId: "u1", orgRole: "owner", wsRole: null, orgMemberStatus: "active" };
const member: PermissionContext = { ...owner, orgRole: "member" };

describe("decisionReason", () => {
  it("says nothing for an allowed or still-loading decision", () => {
    expect(decisionReason(t, canLeaveOrg(member))).toBeNull();
    expect(decisionReason(t, { allowed: false, reason: "unknown", message: "" })).toBeNull();
  });

  it("renders the reason code through i18n, never the English message", () => {
    const leave = canLeaveOrg(owner);
    const text = decisionReason(t, leave, "leave");
    expect(text).toBe("Bạn là chủ sở hữu. Chuyển quyền chủ sở hữu cho người khác trước khi rời.");
    expect(text).not.toBe(leave.message);
    expect(decisionReason(t, canTransferOwnership(member))).toBe(
      "Chỉ chủ sở hữu tổ chức thực hiện được thao tác này.",
    );
    expect(decisionReason(t, canLeaveOrg({ ...member, orgMemberStatus: "deactivated" }))).toBe(
      "Tài khoản của bạn trong tổ chức này đang bị vô hiệu hóa.",
    );
  });
});
