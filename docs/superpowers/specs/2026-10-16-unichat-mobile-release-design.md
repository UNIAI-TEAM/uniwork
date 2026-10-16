# UniChat — Phát hành mobile: EAS, TestFlight/Play internal, OTA, Maestro (lát M4)

> **Trạng thái:** in-progress — Đề xuất, chờ duyệt. Lát M4 của epic UNI-1826; issue UNI-1836.

**Ngày:** 2026-10-16 · **Spec cha:** `2026-10-16-chat-native-apps-design.md` §6 M4, §9, §10 · **Tiền lệ:** `multica/.github/workflows/mobile-verify.yml`, mục Build & release trong `multica/apps/mobile/CLAUDE.md`

## 1. Mục tiêu
Một tag `chat-mobile-v*` build iOS và Android qua EAS và đưa lên TestFlight và Play internal; sửa JS qua EAS Update; ba luồng vàng chạy Maestro hằng đêm trên simulator/emulator.

## 2. Thiết kế
- **EAS**: dự án `unichat`; `eas.json` profiles `development` (dev client), `internal` (TestFlight/Play internal, `APP_ENV=staging`), `production`; `runtimeVersion: {policy: "appVersion"}`; secrets trong EAS (`eas secret`) và GitHub Environment `chat-mobile-release` (`EXPO_TOKEN`, ASC API key, Play service account).
- **Workflow** `.github/workflows/chat-mobile-release.yml`: tag → `eas build --platform all --profile internal --non-interactive --auto-submit`; `chat-mobile-verify.yml` nightly: macOS runner, `expo prebuild`, build simulator, Maestro iOS; Android emulator (`reactivecircus/android-emulator-runner`), Maestro Android.
- **Maestro** (`apps/chat-mobile/maestro/`): (1) đăng nhập → đọc/gửi tin; (2) nhận push → mở đúng phòng (push giả qua `xcrun simctl push` / `adb shell am broadcast` hoặc thật từ server thử); (3) vào cuộc gọi (từ M3). Đăng nhập đi qua sheet trình duyệt hệ thống; nếu không ổn định, dev build nhận deep link phiên thử nghiệm chỉ khi `APP_ENV=dev` (builder quyết, ghi rõ không có trong bản khác).
- **OTA**: kênh `internal`, `production`; chỉ sửa JS; thay đổi native → bump `appVersion`.
- **Store**: ảnh chụp, mô tả vi/en, privacy labels (tên, email, nội dung tin, token push, chẩn đoán), chuỗi quyền, tài khoản demo cho review; runbook `docs/runbooks/unichat-mobile-release.md` (build, submit, OTA, rollback).

## 3. Tiêu chí hoàn thành và test
- Tag → hai bản trên TestFlight và Play internal; người thử cài qua link.
- Maestro ba luồng xanh 5 đêm liên tiếp trên cả hai nền tảng.
- OTA áp dụng ở lần mở sau; `runtimeVersion` chặn OTA sai bản native.
- Không bí mật trong repo; `gitleaks` sạch.

## 4. Rủi ro
Tài khoản Apple/Google chưa có (lát Q1) — tới đó dùng EAS internal distribution (link cài trực tiếp) cho pilot; review App Store với quyền mic/camera.

## 5. Để builder quyết
Cách giả push trong Maestro; có `preview` profile không; chính sách version/build number.
