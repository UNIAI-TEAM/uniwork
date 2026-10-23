// Native calls on Android (UNI-2053 S4, docs/adr/drafts/0038): the
// notification channels' names, the ringing and ongoing call notifications,
// the call's audio output, the full-screen permission row and the rows that
// let a call reach a closed app (battery, vendor autostart). Merged into
// `mobile` by sync-i18n.mjs; keep vi and en aligned (lib/i18n.test.ts compares
// the keys).
export const CALLS_NATIVE_ONLY = {
  vi: {
    notify: {
      channel_calls: "Cuộc gọi đến",
      channel_calls_hint: "Đổ chuông bằng nhạc chuông của máy khi có người gọi bạn.",
      channel_ongoing: "Cuộc gọi đang diễn ra",
      channel_ongoing_hint: "Giữ cuộc gọi khi bạn rời ứng dụng hoặc khóa màn hình.",
      channel_missed: "Cuộc gọi nhỡ",
      channel_missed_hint: "Cuộc gọi trực tiếp bạn chưa kịp nghe.",
      channel_mentions: "Lượt nhắc đến bạn",
      channel_mentions_hint: "Khi ai đó @nhắc đến bạn trong kênh hoặc nhóm.",
      channel_messages: "Tin nhắn",
      channel_messages_hint: "Tin nhắn trực tiếp và trả lời trong chủ đề bạn theo dõi.",
      channel_general: "Thông báo khác",
      channel_general_hint: "Công việc, tài liệu, nhắc hẹn và các cập nhật khác.",
      channel_quiet: "Tin nhắn liền sau",
      channel_quiet_hint: "Tin đến ngay sau một tin vừa báo trong cùng cuộc trò chuyện: hiện im lặng, không chuông, không rung.",
      full_screen_calls: "Hiện cuộc gọi đến toàn màn hình",
      full_screen_calls_hint: "Android đang chặn màn hình đổ chuông khi máy khóa, nên cuộc gọi chỉ hiện như một thông báo. Bật lại để không lỡ cuộc gọi.",
      background_battery: "Cho UniChat chạy nền",
      background_battery_hint:
        "Android đang tiết kiệm pin bằng cách hạn chế UniChat, nên cuộc gọi đến lúc bạn đã đóng app có thể không đổ chuông. Mở trang này, chọn Pin rồi chọn Không hạn chế.",
      background_autostart: "Bật tự khởi động cho UniChat",
      autostart_hint_xiaomi:
        "Máy Xiaomi, Redmi và POCO chặn cuộc gọi tới app đã đóng nếu app chưa được tự khởi động. Bật Tự khởi động cho UniChat, rồi trong Tiết kiệm pin của UniChat chọn Không hạn chế.",
      autostart_hint_oppo:
        "Máy OPPO, realme và OnePlus chặn cuộc gọi tới app đã đóng nếu app chưa được tự khởi động. Bật Cho phép tự khởi động cho UniChat, rồi trong Pin của UniChat cho phép chạy nền.",
      autostart_hint_vivo:
        "Máy vivo và iQOO chặn cuộc gọi tới app đã đóng nếu app chưa được khởi động nền. Bật Tự khởi động (hay Khởi động nền) cho UniChat, rồi cho phép UniChat dùng pin khi chạy nền.",
      autostart_hint_huawei:
        "Máy Huawei và Honor chặn cuộc gọi tới app đã đóng khi app do hệ thống quản lý. Trong Khởi chạy ứng dụng, tắt Quản lý tự động cho UniChat rồi bật cả Tự khởi chạy, Khởi chạy phụ và Chạy nền.",
      autostart_hint_oneplus:
        "Máy OnePlus chặn cuộc gọi tới app đã đóng nếu app chưa được tự khởi chạy. Bật Tự khởi chạy cho UniChat, rồi trong Tối ưu hóa pin chọn Không tối ưu hóa.",
      autostart_hint_asus:
        "Máy ASUS chặn cuộc gọi tới app đã đóng nếu app chưa được tự khởi động. Bật Tự khởi động cho UniChat trong Trình quản lý di động.",
    },
    call_notify: {
      incoming_voice: "Cuộc gọi thoại đến",
      incoming_video: "Cuộc gọi video đến",
      incoming_group: "Cuộc gọi nhóm · {{room}}",
      group_fallback: "Nhóm",
      unknown_caller: "Người gọi",
      ongoing_voice: "Cuộc gọi thoại · chạm để quay lại",
      ongoing_video: "Cuộc gọi video · chạm để quay lại",
    },
    call_audio: {
      title: "Âm thanh",
      bluetooth: "Bluetooth",
      headset: "Tai nghe có dây",
      earpiece: "Loa trong",
      in_use: "{{output}} · đang dùng",
      failed: "Không chuyển được âm thanh. Thử lại.",
      held: "Đang tạm giữ · bạn đang nghe cuộc gọi điện thoại",
      weak_self: "Mạng của bạn yếu",
      weak_peer: "Mạng của người kia yếu",
    },
  },
  en: {
    notify: {
      channel_calls: "Incoming calls",
      channel_calls_hint: "Rings with your phone's ringtone when someone calls you.",
      channel_ongoing: "Ongoing call",
      channel_ongoing_hint: "Keeps a call going when you leave the app or lock the screen.",
      channel_missed: "Missed calls",
      channel_missed_hint: "Direct calls you did not pick up.",
      channel_mentions: "Mentions",
      channel_mentions_hint: "When someone @mentions you in a channel or group.",
      channel_messages: "Messages",
      channel_messages_hint: "Direct messages and replies in threads you follow.",
      channel_general: "Other notifications",
      channel_general_hint: "Tasks, documents, reminders and other updates.",
      channel_quiet: "Follow-up messages",
      channel_quiet_hint: "Messages that arrive right after one that just alerted, in the same conversation: shown quietly, without sound or vibration.",
      full_screen_calls: "Show incoming calls full screen",
      full_screen_calls_hint: "Android is blocking the ringing screen on a locked phone, so calls only show as a notification. Turn it back on so you don't miss calls.",
      background_battery: "Let UniChat run in the background",
      background_battery_hint:
        "Android is saving battery by limiting UniChat, so calls may not ring once you close the app. Open this page, choose Battery, then Unrestricted.",
      background_autostart: "Turn on autostart for UniChat",
      autostart_hint_xiaomi:
        "Xiaomi, Redmi and POCO phones block calls to a closed app unless it may autostart. Turn on Autostart for UniChat, then set UniChat's Battery saver to No restrictions.",
      autostart_hint_oppo:
        "OPPO, realme and OnePlus phones block calls to a closed app unless it may autostart. Turn on Allow auto launch for UniChat, then allow background activity in UniChat's Battery settings.",
      autostart_hint_vivo:
        "vivo and iQOO phones block calls to a closed app unless it may start in the background. Turn on Autostart (or Background startup) for UniChat, then allow its background power use.",
      autostart_hint_huawei:
        "Huawei and Honor phones block calls to a closed app the system manages. In App launch, turn off Manage automatically for UniChat and turn on Auto-launch, Secondary launch and Run in background.",
      autostart_hint_oneplus:
        "OnePlus phones block calls to a closed app unless it may auto-launch. Turn on Auto-launch for UniChat, then set its Battery optimization to Don't optimize.",
      autostart_hint_asus:
        "ASUS phones block calls to a closed app unless it may autostart. Turn on Auto-start for UniChat in Mobile Manager.",
    },
    call_notify: {
      incoming_voice: "Incoming voice call",
      incoming_video: "Incoming video call",
      incoming_group: "Group call · {{room}}",
      group_fallback: "Group",
      unknown_caller: "Caller",
      ongoing_voice: "Voice call · tap to return",
      ongoing_video: "Video call · tap to return",
    },
    call_audio: {
      title: "Audio",
      bluetooth: "Bluetooth",
      headset: "Wired headset",
      earpiece: "Phone",
      in_use: "{{output}} · in use",
      failed: "Could not switch the audio. Try again.",
      held: "On hold · you're on a phone call",
      weak_self: "Your connection is weak",
      weak_peer: "Their connection is weak",
    },
  },
};
