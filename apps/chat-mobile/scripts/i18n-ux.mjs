// UX, accessibility and permissions (UNI-2053 S6; audit U1–U3, P2 UX/i18n):
// what VoiceOver and TalkBack say about a message's state and about new
// messages, the image viewer's gestures, and the screens that explain a
// permission before the system asks for it. Merged into `mobile` by
// sync-i18n.mjs; keep vi and en aligned (lib/i18n.test.ts compares the keys).
// An English string with {{count}} is a `_one`/`_other` pair, the Vietnamese
// one a single key.
export const UX_ONLY = {
  vi: {
    conversation: {
      load_failed: "Không tải được tin nhắn",
      thread_load_failed: "Không tải được chủ đề này",
      load_failed_hint: "Lịch sử trò chuyện vẫn còn trên máy chủ. Kiểm tra kết nối rồi thử lại.",
      older_load_failed: "Không tải được tin cũ hơn",
    },
    a11y: {
      bubble_quote: "Trả lời {{sender}}: {{text}}",
      bubble_retry_hint: "Mở tùy chọn gửi lại hoặc xóa tin này",
      bubble_sending_hint: "Mở tùy chọn xóa tin đang gửi",
      new_messages: "{{count}} tin nhắn mới",
      image_viewer_hint: "Chụm hai ngón để phóng to, chạm hai lần để phóng to hoặc thu nhỏ, vuốt xuống để đóng",
      image_zoomed: "Đang phóng to",
    },
    permissions: {
      continue: "Tiếp tục",
      not_now: "Để sau",
      open_settings: "Mở Cài đặt",
      microphone_title: "Cho phép dùng micro",
      microphone_voice_body: "UniChat dùng micro để ghi tin thoại bạn gửi. Micro chỉ bật khi bạn đang ghi.",
      microphone_call_body: "UniChat dùng micro để mọi người nghe được bạn trong cuộc gọi. Micro chỉ bật khi bạn đang ở trong cuộc gọi.",
      microphone_denied: "Micro đang bị tắt cho UniChat trong cài đặt của máy. Mở Cài đặt và bật Micro để tiếp tục.",
      camera_title: "Cho phép dùng camera",
      camera_body: "UniChat dùng camera khi bạn gọi video. Bạn tắt camera được bất cứ lúc nào trong cuộc gọi.",
      camera_denied: "Camera đang bị tắt cho UniChat trong cài đặt của máy. Mở Cài đặt và bật Camera để gọi video.",
      notifications_title: "Bật thông báo",
      notifications_body: "Nhận tin nhắn, lượt nhắc tên và cuộc gọi đến cả khi UniChat đang đóng. Bạn chọn loại thông báo trong Cài đặt của ứng dụng.",
      notifications_denied: "Thông báo đang bị tắt cho UniChat trong cài đặt của máy. Mở Cài đặt và bật Thông báo để nhận tin và cuộc gọi.",
    },
  },
  en: {
    conversation: {
      load_failed: "Couldn't load messages",
      thread_load_failed: "Couldn't load this thread",
      load_failed_hint: "Your conversation history is still on the server. Check your connection and try again.",
      older_load_failed: "Couldn't load older messages",
    },
    a11y: {
      bubble_quote: "Replying to {{sender}}: {{text}}",
      bubble_retry_hint: "Opens options to send it again or delete it",
      bubble_sending_hint: "Opens the option to delete it while it sends",
      new_messages_one: "{{count}} new message",
      new_messages_other: "{{count}} new messages",
      image_viewer_hint: "Pinch to zoom, double-tap to zoom in or out, swipe down to close",
      image_zoomed: "Zoomed in",
    },
    permissions: {
      continue: "Continue",
      not_now: "Not now",
      open_settings: "Open Settings",
      microphone_title: "Allow the microphone",
      microphone_voice_body: "UniChat uses the microphone to record the voice messages you send. It is only on while you record.",
      microphone_call_body: "UniChat uses the microphone so people can hear you on a call. It is only on while you are in a call.",
      microphone_denied: "The microphone is off for UniChat in system settings. Open Settings and turn on Microphone to continue.",
      camera_title: "Allow the camera",
      camera_body: "UniChat uses the camera for video calls. You can turn it off at any time during the call.",
      camera_denied: "The camera is off for UniChat in system settings. Open Settings and turn on Camera for video calls.",
      notifications_title: "Turn on notifications",
      notifications_body: "Get messages, mentions and incoming calls even when UniChat is closed. You choose which ones in the app's Settings.",
      notifications_denied: "Notifications are off for UniChat in system settings. Open Settings and turn on Notifications to get messages and calls.",
    },
  },
};
