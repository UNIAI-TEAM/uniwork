#!/usr/bin/env node
// Copies the subtrees UniChat mobile uses from packages/core/i18n/locales into
// apps/chat-mobile/locales/{vi,en}.json, plus the few mobile-only strings
// below. The app never imports core's bundles (ADR 0011: types and pure
// functions only); lib/i18n.test.ts runs this with --check so a stale copy
// fails the suite. Run: node apps/chat-mobile/scripts/sync-i18n.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CALLS_NATIVE_ONLY } from "./i18n-calls.mjs";
import { COMPLIANCE_ONLY } from "./i18n-compliance.mjs";
import { INVITATIONS_ONLY } from "./i18n-invitations.mjs";
import { SECURITY_ONLY } from "./i18n-security.mjs";
import { SIGN_IN_ONLY } from "./i18n-sign-in.mjs";
import { UX_ONLY } from "./i18n-ux.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const coreLocales = path.resolve(here, "../../../packages/core/i18n/locales");
const outDir = path.resolve(here, "../locales");

// Dotted paths into the core bundle; a path may name a subtree or one leaf.
const PATHS = [
  "auth.desktop",
  "auth.logout",
  "common",
  "nav",
  "settings.preferences",
  // UNI-2053 S2: deleting the account on the phone says what the web's dialog says.
  "settings.security.delete",
  "workspace.pickTitle",
  // The whole web chat copy: the mobile chat tab speaks with the web's words.
  "chat",
];

// M2b (UNI-1833): the calls, contacts and settings tabs say what the web says.
const TABS_PATHS = [
  ...["voice", "video"].flatMap((kind) =>
    ["completed", "missed", "declined_outgoing", "declined_incoming", "cancelled", "unknown"].map(
      (outcome) => `chat.${kind}_call_log_${outcome}`,
    ),
  ),
  "chat.presence_online",
  "chat.member_search_placeholder",
  "settings.profile.email",
  "settings.security.sessions.revoke",
  "settings.security.sessions.revokeFailed",
  "settings.notifications.push_section",
  // M3 (UNI-1834): a task card under a message names its status as the tasks do.
  ...["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"].map((status) => `tasks.status_${status}`),
];

// ADR 0049 (spec §5.3): the phone's own sign-in screens say what the web's do — the provider buttons and their
// errors, the choice screen, the second factor, email verification, the fields of the form, and Settings' sign-in
// methods and "Xác nhận là bạn". What only the phone says is scripts/i18n-sign-in.mjs.
const SIGN_IN_PATHS = [
  "auth.social",
  "auth.continue",
  "auth.apple",
  "auth.mfa",
  "auth.verify",
  ...[
    "email",
    "password",
    "displayName",
    "login",
    "noAccount",
    "hasAccount",
    "signingIn",
    "registering",
    "emailPlaceholder",
    "passwordMinHint",
    "forgotPassword",
    "emailRequired",
    "emailInvalid",
    "passwordRequired",
  ].map((leaf) => `auth.${leaf}`),
  "settings.security.signInMethods",
  "settings.security.stepUp",
];

// Spec §5.2: an account without a workspace answers its invitations on the phone, in the web's words: the list,
// the preview a link opens, why one no longer works, and the roles. What only the phone says is
// scripts/i18n-invitations.mjs.
const INVITATION_PATHS = [
  ...["list_title", "invitedBy", "invited", "place", "join", "load_error", "expires_soon"].map((leaf) => `invitations.${leaf}`),
  "invitations.preview",
  "invitations.gone",
  "invitations.switch.description",
  "invitations.switch.busy",
  "workspace.acceptInviteError",
  ...["owner", "admin", "member"].map((role) => `people.role_${role}`),
];

// Chat strings only the phone needs (M2a), nested under chat.mobile so they
// cannot collide with a web key; keep vi and en aligned. An English string
// with {{count}} is a `_one`/`_other` pair, the Vietnamese one a single key,
// as in packages/core (lib/i18n.test.ts fails on a missing form).
const CHAT_MOBILE_ONLY = {
  vi: {
    open_on_web: "Mở trên web",
    unsupported_message: "Tin nhắn loại này chưa xem được trên điện thoại.",
    send_queued: "Chờ có mạng để gửi",
    send_sending: "Đang gửi…",
    unmute_notifications: "Bật thông báo",
    unpin_conversation: "Bỏ ghim hội thoại",
    room_info: "Thông tin cuộc trò chuyện",
    call_speaker: "Loa ngoài",
    follow_up_remove: "Bỏ khỏi danh sách theo dõi",
    // R4b (UNI-1916): the canvas's mobile-only lines.
    workspace_sheet_title: "Workspace",
    workspace_count: "{{org}} · {{count}} workspace bạn tham gia",
    workspace_open: "Đang mở",
    workspace_open_unread: "Đang mở · {{count}} tin chưa đọc",
    workspace_unread: "{{count}} tin chưa đọc",
    workspace_unread_mentions: "{{count}} tin chưa đọc · có tin nhắc bạn",
    workspace_no_new: "Không có tin mới",
    workspace_at: "Đang ở {{name}}",
    workspace_pill_aria: "Đổi workspace. Đang ở {{name}}, {{count}} tin chưa đọc ở workspace khác",
    workspace_pill_aria_quiet: "Đổi workspace. Đang ở {{name}}",
    search_placeholder: "Tìm kiếm",
    offline_banner: "Đang chờ mạng…",
    // UNI-2053 S3: the network is there, the workspace socket is not (yet).
    connecting_banner: "Đang kết nối…",
    catch_up_open: "Mở {{name}}",
    catch_up_summary: "Tóm tắt",
    catch_up_highlights: "Điểm chính",
    catch_up_actions: "Việc cần làm",
    call_voice_duration: "Cuộc gọi thoại · {{duration}}",
    call_video_duration: "Cuộc gọi video · {{duration}}",
    call_minimize: "Thu nhỏ cuộc gọi",
    call_recording: "Đang ghi",
    call_add_person: "Thêm người vào cuộc gọi",
    call_summary_hint: "UNI sẽ tóm tắt vào chat sau cuộc gọi",
    call_back_to: "Quay lại cuộc gọi",
    thread_reply_placeholder: "Trả lời trong chủ đề…",
    back_to_conversation: "Quay lại cuộc trò chuyện",
    cancel_reply: "Hủy trả lời",
    alphabet_index: "Chỉ mục chữ cái",
    channel_joined: "Đã tham gia",
    channel_open_aria: "Mở {{name}}, Đã tham gia",
    channel_joining_aria: "Đang tham gia… {{name}}",
    task_hint_link: "Giữ liên kết",
    follow_up_hint: "{{hours}} giờ nữa",
    react_label_like: "Thích",
    react_label_love: "Yêu thích",
    react_label_haha: "Haha",
    react_label_party: "Chúc mừng",
    react_label_wow: "Ngạc nhiên",
    react_label_thanks: "Cảm ơn",
    image_share: "Chia sẻ",
    pinned_bar: "Tin ghim {{index}}/{{total}}",
    shared_media_title: "Ảnh, tệp, liên kết",
    shared_notes_row: "Ghi chú, ghim, bình chọn",
    see_all: "Xem tất cả",
    forward_pick_room: "Chuyển tiếp tới",
    create_group_members: "Chọn thành viên",
    group_name_placeholder: "Tên nhóm",
    room_role_admin_short: "Quản trị",
    workspace_count_only: "{{count}} workspace bạn tham gia",
    catch_up_banner: "{{count}} tin chưa đọc · UNI tóm tắt giúp bạn",
    search_short: "Tìm",
    call_short: "Gọi",
    shared_title: "Đã chia sẻ",
    shared_kinds_aria: "Loại nội dung đã chia sẻ",
    shared_more_photos: "Xem tất cả {{count}} ảnh",
    shared_tab_hint: "{{count}} mục trong cuộc trò chuyện",
    shared_notes_counts: "{{pins}} tin ghim · {{notes}} ghi chú · {{polls}} bình chọn",
    tab_photos: "Ảnh {{count}}",
    tab_files: "Tệp {{count}}",
    tab_links: "Liên kết {{count}}",
    tab_voice: "Thoại {{count}}",
    group_members_hint: "Chọn ít nhất 2 người",
    group_selected: "Đã chọn {{count}}",
  },
  en: {
    open_on_web: "Open on the web",
    unsupported_message: "This kind of message can't be shown on the phone yet.",
    send_queued: "Waiting for a connection to send",
    send_sending: "Sending…",
    unmute_notifications: "Turn notifications on",
    unpin_conversation: "Unpin conversation",
    room_info: "Conversation details",
    call_speaker: "Speaker",
    follow_up_remove: "Remove from follow-ups",
    workspace_sheet_title: "Workspace",
    workspace_count_one: "{{org}} · {{count}} workspace you belong to",
    workspace_count_other: "{{org}} · {{count}} workspaces you belong to",
    workspace_open: "Open now",
    workspace_open_unread_one: "Open now · {{count}} unread",
    workspace_open_unread_other: "Open now · {{count}} unread",
    workspace_unread_one: "{{count}} unread",
    workspace_unread_other: "{{count}} unread",
    workspace_unread_mentions_one: "{{count}} unread · you were mentioned",
    workspace_unread_mentions_other: "{{count}} unread · you were mentioned",
    workspace_no_new: "Nothing new",
    workspace_at: "In {{name}}",
    workspace_pill_aria_one: "Switch workspace. In {{name}}, {{count}} unread in another workspace",
    workspace_pill_aria_other: "Switch workspace. In {{name}}, {{count}} unread in other workspaces",
    workspace_pill_aria_quiet: "Switch workspace. In {{name}}",
    search_placeholder: "Search",
    offline_banner: "Waiting for a connection…",
    connecting_banner: "Connecting…",
    catch_up_open: "Open {{name}}",
    catch_up_summary: "Summary",
    catch_up_highlights: "Highlights",
    catch_up_actions: "Action items",
    call_voice_duration: "Voice call · {{duration}}",
    call_video_duration: "Video call · {{duration}}",
    call_minimize: "Minimise the call",
    call_recording: "Recording",
    call_add_person: "Add someone to the call",
    call_summary_hint: "UNI will post a summary to the chat after the call",
    call_back_to: "Back to the call",
    thread_reply_placeholder: "Reply in thread…",
    back_to_conversation: "Back to the conversation",
    cancel_reply: "Cancel reply",
    alphabet_index: "Alphabetical index",
    channel_joined: "Joined",
    channel_open_aria: "Open {{name}}, joined",
    channel_joining_aria: "Joining… {{name}}",
    task_hint_link: "Keeps the link",
    follow_up_hint: "in {{hours}} hours",
    react_label_like: "Like",
    react_label_love: "Love",
    react_label_haha: "Haha",
    react_label_party: "Celebrate",
    react_label_wow: "Wow",
    react_label_thanks: "Thanks",
    image_share: "Share",
    pinned_bar: "Pinned {{index}}/{{total}}",
    shared_media_title: "Photos, files, links",
    shared_notes_row: "Notes, pins, polls",
    see_all: "See all",
    forward_pick_room: "Forward to",
    create_group_members: "Choose members",
    group_name_placeholder: "Group name",
    room_role_admin_short: "Admin",
    workspace_count_only_one: "{{count}} workspace you belong to",
    workspace_count_only_other: "{{count}} workspaces you belong to",
    catch_up_banner_one: "{{count}} unread · UNI sums it up for you",
    catch_up_banner_other: "{{count}} unread · UNI sums them up for you",
    search_short: "Search",
    call_short: "Call",
    shared_title: "Shared",
    shared_kinds_aria: "Kinds of shared content",
    shared_more_photos_one: "See the {{count}} photo",
    shared_more_photos_other: "See all {{count}} photos",
    shared_tab_hint_one: "{{count}} item in this conversation",
    shared_tab_hint_other: "{{count}} items in this conversation",
    shared_notes_counts: "{{pins}} pinned · {{notes}} notes · {{polls}} polls",
    tab_photos_one: "Photo {{count}}",
    tab_photos_other: "Photos {{count}}",
    tab_files_one: "File {{count}}",
    tab_files_other: "Files {{count}}",
    tab_links_one: "Link {{count}}",
    tab_links_other: "Links {{count}}",
    tab_voice_one: "Voice {{count}}",
    tab_voice_other: "Voice {{count}}",
    group_members_hint: "Pick at least 2 people",
    group_selected_one: "{{count}} selected",
    group_selected_other: "{{count}} selected",
  },
};

// Strings no web screen has; keep vi and en aligned.
const MOBILE_ONLY = {
  vi: {
    mobile: {
      tab_calls: "Cuộc gọi",
      calls: {
        empty: "Chưa có cuộc gọi nào. Cuộc gọi trong các cuộc trò chuyện của bạn sẽ hiện ở đây.",
        outgoing: "Gọi đi",
        incoming: "Gọi đến",
        filter_missed: "Cuộc gọi nhỡ",
        no_missed: "Không có cuộc gọi nhỡ nào.",
      },
      contacts: {
        empty: "Chưa có ai khác trong workspace này.",
        no_match: "Không tìm thấy ai khớp.",
        search: "Tìm theo tên hoặc email",
        count_one: "{{count}} người",
        count_other: "{{count}} người",
      },
      settings: {
        account: "Tài khoản",
        devices: "Thiết bị đã đăng nhập",
        devices_hint: "Thu hồi một thiết bị thì thiết bị đó bị đăng xuất trong vòng 1 phút.",
        this_device: "Thiết bị này",
        unnamed_device: "Thiết bị không tên",
        revoke_title: "Thu hồi {{device}}?",
        revoke_body: "Thiết bị đó bị đăng xuất và phải đăng nhập lại.",
        push_this_device: "Nhận thông báo trên thiết bị này",
        push_hint: "Khi bạn đang dùng UniWork hoặc UniChat ở nơi khác, thông báo không gửi tới điện thoại.",
        push_unavailable: "Thiết bị chưa cho phép thông báo. Bật trong cài đặt của máy rồi thử lại.",
        push_failed: "Không đổi được thông báo. Thử lại sau.",
        workspace: "Workspace",
        switch_workspace: "Chuyển workspace",
      },
    },
  },
  en: {
    mobile: {
      tab_calls: "Calls",
      calls: {
        empty: "No calls yet. Calls in your conversations show up here.",
        outgoing: "Outgoing",
        incoming: "Incoming",
        filter_missed: "Missed",
        no_missed: "No missed calls.",
      },
      contacts: {
        empty: "No one else is in this workspace yet.",
        no_match: "No one matches.",
        search: "Search by name or email",
        count_one: "{{count}} person",
        count_other: "{{count}} people",
      },
      settings: {
        account: "Account",
        devices: "Signed-in devices",
        devices_hint: "A revoked device is signed out within a minute.",
        this_device: "This device",
        unnamed_device: "Unnamed device",
        revoke_title: "Revoke {{device}}?",
        revoke_body: "That device is signed out and has to sign in again.",
        push_this_device: "Get notifications on this device",
        push_hint: "While you are using UniWork or UniChat elsewhere, notifications are not sent to this phone.",
        push_unavailable: "Notifications are not allowed on this device. Turn them on in system settings, then try again.",
        push_failed: "Could not change notifications. Try again later.",
        workspace: "Workspace",
        switch_workspace: "Switch workspace",
      },
    },
  },
};

// UNI-2053 (observability and release): the crash screen, toasts, the
// update gate, Settings › About and the calls kill switch; merged into
// `mobile` below. Keep vi and en aligned.
const RELEASE_ONLY = {
  vi: {
    app: {
      error_title: "Màn hình này gặp lỗi",
      error_body: "UniChat không mở được màn hình này. Thử lại; nếu vẫn lỗi, hãy đóng hẳn ứng dụng rồi mở lại.",
      error_retry: "Thử lại",
    },
    toast: {
      dismiss: "Đóng thông báo",
    },
    update: {
      title: "Cần cập nhật UniChat",
      body: "Phiên bản {{version}} không còn được hỗ trợ. Cập nhật lên bản {{min}} trở lên để tiếp tục nhắn tin và gọi.",
      open_store: "Cập nhật",
      no_store: "Bản mới chưa có trên cửa hàng ứng dụng. Hãy hỏi quản trị viên của tổ chức cách cài bản mới.",
      check_again: "Kiểm tra lại",
      nudge_title: "Đã có UniChat {{version}}",
      nudge_body: "Cập nhật để nhận các bản sửa lỗi và tính năng mới nhất.",
      nudge_dismiss: "Để sau",
    },
    about: {
      title: "Giới thiệu",
      version: "Phiên bản",
      build: "Bản dựng",
      channel: "Kênh cập nhật",
      update: "Bản cập nhật",
      embedded: "Bản cài sẵn trong ứng dụng",
      none: "Không có",
      copy: "Sao chép thông tin phiên bản",
      copied: "Đã sao chép thông tin phiên bản",
    },
    calls: {
      disabled: "Tính năng gọi đang tạm tắt trên điện thoại.",
    },
  },
  en: {
    app: {
      error_title: "This screen hit a problem",
      error_body: "UniChat could not open this screen. Try again; if it keeps happening, close the app fully and open it again.",
      error_retry: "Try again",
    },
    toast: {
      dismiss: "Dismiss notice",
    },
    update: {
      title: "Update UniChat to continue",
      body: "Version {{version}} is no longer supported. Update to {{min}} or later to keep messaging and calling.",
      open_store: "Update",
      no_store: "The new version is not in the app store yet. Ask your organization's admin how to install it.",
      check_again: "Check again",
      nudge_title: "UniChat {{version}} is out",
      nudge_body: "Update to get the latest fixes and features.",
      nudge_dismiss: "Not now",
    },
    about: {
      title: "About",
      version: "Version",
      build: "Build",
      channel: "Update channel",
      update: "Update",
      embedded: "Built into the app",
      none: "None",
      copy: "Copy version details",
      copied: "Version details copied",
    },
    calls: {
      disabled: "Calling is turned off on phones for now.",
    },
  },
};

function get(obj, dotted) {
  return dotted.split(".").reduce((node, key) => (node == null ? undefined : node[key]), obj);
}

function set(obj, dotted, value) {
  const keys = dotted.split(".");
  const leaf = keys.pop();
  const parent = keys.reduce((node, key) => (node[key] ??= {}), obj);
  parent[leaf] = value;
}

function build(locale) {
  const core = JSON.parse(fs.readFileSync(path.join(coreLocales, `${locale}.json`), "utf8"));
  const out = {};
  for (const dotted of [...PATHS, ...TABS_PATHS, ...SIGN_IN_PATHS, ...INVITATION_PATHS]) {
    const value = get(core, dotted);
    if (value === undefined) throw new Error(`${locale}.json has no ${dotted}`);
    set(out, dotted, value);
  }
  set(out, "chat.mobile", CHAT_MOBILE_ONLY[locale]);
  const mobile = MOBILE_ONLY[locale].mobile;
  return {
    ...out,
    mobile: { ...mobile, ...RELEASE_ONLY[locale], ...COMPLIANCE_ONLY[locale], ...CALLS_NATIVE_ONLY[locale], ...UX_ONLY[locale], ...SECURITY_ONLY[locale], ...SIGN_IN_ONLY[locale], ...INVITATIONS_ONLY[locale], calls: { ...mobile.calls, ...RELEASE_ONLY[locale].calls } },
  };
}

// The call channels' names as Android string resources of modules/unichat-calls, from the same copy: the module
// creates its channels from them when it rings before JavaScript has run once (CallNotifications.ensureChannelsExist),
// so a Vietnamese phone never sees English channel names (audit "native-channel-fallback-english"). `values` is
// English, as the app reads English for every language but Vietnamese (lib/i18n/singleton.ts › matchSupportedLocale).
const NATIVE_STRINGS = {
  unichat_calls_channel_calls: "mobile.notify.channel_calls",
  unichat_calls_channel_calls_hint: "mobile.notify.channel_calls_hint",
  unichat_calls_channel_ongoing: "mobile.notify.channel_ongoing",
  unichat_calls_channel_ongoing_hint: "mobile.notify.channel_ongoing_hint",
};
const nativeRes = path.resolve(here, "../modules/unichat-calls/android/src/main/res");
const NATIVE_DIRS = { en: "values", vi: "values-vi" };

/** Android's string resource escaping: XML's, plus the apostrophe, quote and a leading @ or ? Android reads specially. */
function androidString(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/^([@?])/, "\\$1");
}

function nativeStrings(bundle) {
  const lines = Object.entries(NATIVE_STRINGS).map(([name, key]) => {
    const value = get(bundle, key);
    if (typeof value !== "string" || value === "") throw new Error(`no ${key} for the native strings`);
    return `  <string name="${name}">${androidString(value)}</string>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>\n<!-- Generated by apps/chat-mobile/scripts/sync-i18n.mjs from the app's copy; do not edit. -->\n<resources>\n${lines.join("\n")}\n</resources>\n`;
}

const check = process.argv.includes("--check");
let stale = false;
function sync(file, next) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current === next) return;
  if (check) {
    stale = true;
    console.error(`${path.relative(process.cwd(), file)} is stale; run scripts/sync-i18n.mjs`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next);
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
}
for (const locale of Object.keys(MOBILE_ONLY)) {
  const bundle = build(locale);
  sync(path.join(outDir, `${locale}.json`), `${JSON.stringify(bundle, null, 2)}\n`);
  sync(path.join(nativeRes, NATIVE_DIRS[locale], "strings.xml"), nativeStrings(bundle));
}
process.exit(stale ? 1 : 0);
