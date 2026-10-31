// The invitations an account without a workspace answers on the phone (spec §5.2): what the web's invitation pages
// do not say because the phone lays them out differently, or ends somewhere else (the switch to another organization
// is the web's). Everything else is the web's copy, synced by sync-i18n.mjs (INVITATION_PATHS). Merged into
// `mobile.invitations`; keep vi and en aligned (lib/i18n.test.ts compares the keys).
export const INVITATIONS_ONLY = {
  vi: {
    invitations: {
      none: "Chưa có lời mời nào gửi tới {{email}}.",
      none_hint: "Khi một tổ chức mời địa chỉ này, lời mời sẽ hiện ở đây.",
      create_org: "Tạo tổ chức trên web",
      joining: "Đang tham gia…",
      joined_no_workspace: "Đã vào {{org}}. Quản trị viên sẽ thêm bạn vào workspace.",
      continue_on_web: "Tiếp tục trên web",
      switch_hint: "Bạn hoàn tất việc chuyển tổ chức trên web, rồi quay lại UniChat.",
    },
  },
  en: {
    invitations: {
      none: "No invitations have been sent to {{email}} yet.",
      none_hint: "When an organization invites this address, the invitation shows up here.",
      create_org: "Create an organization on the web",
      joining: "Joining…",
      joined_no_workspace: "You've joined {{org}}. An admin will add you to a workspace.",
      continue_on_web: "Continue on the web",
      switch_hint: "You finish switching organizations on the web, then come back to UniChat.",
    },
  },
};
