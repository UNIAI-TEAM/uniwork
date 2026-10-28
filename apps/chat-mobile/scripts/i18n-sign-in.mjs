// The app's own sign-in screens (ADR 0049, spec §5.2): what the web's sign-in pages do not say because the phone
// lays them out differently: the screen's title, the second factor's recovery-code switch, the register screen's
// title, the verify screen's way out, the browser fallback. Everything else they say is the web's copy, synced by
// sync-i18n.mjs (SIGN_IN_PATHS): a sentence that reads wrong on the phone is changed in packages/core, not forked
// here. Merged into `mobile.sign_in`, with the proof sheet's and Settings › Sign-in methods' own lines in `mobile.step_up` and
// `mobile.sign_in_methods`; keep vi and en aligned (lib/i18n.test.ts compares the keys).
export const SIGN_IN_ONLY = {
  vi: {
    sign_in: {
      title: "Đăng nhập UniChat",
      subtitle: "Dùng tài khoản UniWork của bạn.",
      create_account: "Tạo tài khoản",
      browser: "Đăng nhập bằng trình duyệt",
      browser_busy: "Đang mở trình duyệt…",
      sign_up_with_apple: "Đăng ký bằng Apple",
      mfa: {
        subtitle: "Đăng nhập vào {{email}}.",
        code_hint: "Mã 6 số trong ứng dụng xác thực của bạn.",
        use_recovery: "Dùng mã khôi phục",
        use_app: "Dùng mã từ ứng dụng xác thực",
        recovery_label: "Mã khôi phục",
        recovery_hint: "Dạng xxxxx-xxxxx. Mỗi mã chỉ dùng được một lần.",
        recovery_required: "Nhập mã khôi phục.",
      },
      register: {
        title: "Tạo tài khoản",
        subtitle: "Một tài khoản UniWork cho UniChat trên điện thoại, máy tính và web.",
        submit: "Tạo tài khoản",
      },
      verify: {
        wrong_email: "Sai email?",
        delete_in_settings: "Xóa tài khoản trong Cài đặt",
      },
      // "Tôi đã có tài khoản": the other provider tried there matched no account either; the identity still waits.
      link_unmatched: {
        apple: "Tài khoản Apple này chưa liên kết với tài khoản UniWork nào. Đăng nhập bằng cách bạn vẫn dùng.",
        google: "Tài khoản Google này chưa liên kết với tài khoản UniWork nào. Đăng nhập bằng cách bạn vẫn dùng.",
      },
    },
    step_up: {
      one_action_hint: "Mã này chỉ dùng được để {{action}}.",
      unavailable: "Điện thoại này chưa xác nhận được bằng cách tài khoản của bạn dùng. Mở UniWork trên web để tiếp tục.",
    },
    sign_in_methods: {
      link_named: "Liên kết {{provider}}",
      unlink_named: "Gỡ liên kết {{provider}}",
    },
  },
  en: {
    sign_in: {
      title: "Log in to UniChat",
      subtitle: "Use your UniWork account.",
      create_account: "Create an account",
      browser: "Log in with a browser",
      browser_busy: "Opening the browser…",
      sign_up_with_apple: "Sign up with Apple",
      mfa: {
        subtitle: "Logging in to {{email}}.",
        code_hint: "The 6-digit code from your authenticator app.",
        use_recovery: "Use a recovery code",
        use_app: "Use your authenticator app",
        recovery_label: "Recovery code",
        recovery_hint: "Looks like xxxxx-xxxxx. Each code works once.",
        recovery_required: "Enter a recovery code.",
      },
      register: {
        title: "Create your account",
        subtitle: "One UniWork account for UniChat on your phone, your computer and the web.",
        submit: "Create account",
      },
      verify: {
        wrong_email: "Wrong email?",
        delete_in_settings: "Delete the account in Settings",
      },
      link_unmatched: {
        apple: "This Apple account isn't linked to any UniWork account yet. Log in the way you usually do.",
        google: "This Google account isn't linked to any UniWork account yet. Log in the way you usually do.",
      },
    },
    step_up: {
      one_action_hint: "This code only lets you {{action}}.",
      unavailable: "This phone can't confirm it's you the way your account does. Open UniWork on the web to continue.",
    },
    sign_in_methods: {
      link_named: "Link {{provider}}",
      unlink_named: "Unlink {{provider}}",
    },
  },
};
