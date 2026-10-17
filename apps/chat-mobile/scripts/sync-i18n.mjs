#!/usr/bin/env node
// Copies the subtrees UniChat mobile uses from packages/core/i18n/locales into
// apps/chat-mobile/locales/{vi,en}.json, plus the few mobile-only strings
// below. The app never imports core's bundles (ADR 0011: types and pure
// functions only); lib/i18n.test.ts runs this with --check so a stale copy
// fails the suite. Run: node apps/chat-mobile/scripts/sync-i18n.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// Chat strings only the phone needs (M2a), nested under chat.mobile so they
// cannot collide with a web key; keep vi and en aligned.
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
  },
};

// Strings no web screen has; keep vi and en aligned.
const MOBILE_ONLY = {
  vi: {
    mobile: {
      tab_calls: "Cuộc gọi",
      login_hint: "Nhắn tin và gọi cho cả đội ngay trên điện thoại.",
      calls: {
        empty: "Chưa có cuộc gọi nào. Cuộc gọi trong các cuộc trò chuyện của bạn sẽ hiện ở đây.",
        outgoing: "Gọi đi",
        incoming: "Gọi đến",
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
        version: "Phiên bản {{version}}",
      },
    },
  },
  en: {
    mobile: {
      tab_calls: "Calls",
      login_hint: "Message and call your team, right from your phone.",
      calls: {
        empty: "No calls yet. Calls in your conversations show up here.",
        outgoing: "Outgoing",
        incoming: "Incoming",
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
        version: "Version {{version}}",
      },
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
  for (const dotted of [...PATHS, ...TABS_PATHS]) {
    const value = get(core, dotted);
    if (value === undefined) throw new Error(`${locale}.json has no ${dotted}`);
    set(out, dotted, value);
  }
  set(out, "chat.mobile", CHAT_MOBILE_ONLY[locale]);
  return { ...out, ...MOBILE_ONLY[locale] };
}

const check = process.argv.includes("--check");
let stale = false;
for (const locale of Object.keys(MOBILE_ONLY)) {
  const file = path.join(outDir, `${locale}.json`);
  const next = `${JSON.stringify(build(locale), null, 2)}\n`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current === next) continue;
  if (check) {
    stale = true;
    console.error(`${path.relative(process.cwd(), file)} is stale; run scripts/sync-i18n.mjs`);
  } else {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(file, next);
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
}
process.exit(stale ? 1 : 0);
