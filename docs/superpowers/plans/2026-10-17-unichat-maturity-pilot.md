# UniChat Q1 — Nghiệm thu trưởng thành, pilot nội bộ, tài khoản phát hành — Kế hoạch

> **Trạng thái:** in-progress — issue UNI-1838, nhánh `feature/UNI-1838-unichat-q1-nghiem-thu-truong-thanh-va-pi`. Phần mã và tài liệu xong trên nhánh (Task 1–7); phần cần người (Task 8–15) chưa bắt đầu.

**Goal:** Đưa checklist trưởng thành của epic UNI-1826 tới chỗ chỉ còn việc của người: trạng thái spec/plan đúng sự
thật, rà soát bảo mật có bản sửa, bảng bằng chứng, kịch bản kiểm thử tay, runbook pilot, danh sách tài khoản phát hành,
mẫu go/no-go.

**Spec:** `docs/superpowers/specs/2026-10-16-unichat-maturity-pilot-design.md`; spec cha
`2026-10-16-chat-native-apps-design.md` §4, §9–§12. **Duyệt:** chủ sở hữu 2026-10-17 ("làm tiếp đến khi hoàn thành
UNI-1826").

## Global Constraints

- Không đụng spec/plan M3 (`2026-10-16-unichat-mobile-calls-design.md`) và mã gọi của `apps/chat-mobile` — UNI-1834
  đang làm song song.
- Agent không đăng ký tài khoản, không đẩy tag phát hành, không đặt UniAI `done`, không đổi C-19 thành `CÓ`.
- Bản sửa bảo mật: chỉ high/medium nhỏ, trong vùng UniChat, có test đỏ trước xanh sau; phần còn lại thành sub-issue
  của UNI-1838.
- Kiểm hẹp: `node --test` các script test bị ảnh hưởng, vitest của app đã sửa, `go test -run` có mục tiêu trên một DB
  thử riêng. Không `make check`, không chạy cả bộ Go.

## Task (agent, trên nhánh này)

- [x] **1. Bắt đầu.** `make issue-start KEY=UNI-1838`; `pnpm install --frozen-lockfile`.
- [x] **2. Trạng thái spec/plan.** `shipped` kèm PR và squash SHA cho N1–N3 (#333, #334), D1 (#336, sửa dòng bị dính),
  M1 (#337), D2 (#339), M2b (#340), L1 (#341), M2a (#342); M4 `in-progress` (phase 1 #343); spec cha `in-progress` kèm
  tiến độ; spec Q1 `in-progress`; roadmap C-19 `CHƯA` → `MỘT PHẦN` kèm tiến độ (vẫn chưa `CÓ`).
- [x] **3. Rà soát bảo mật** desktop, mobile, server, workflow → `docs/evidence/unichat/security-review-2026-10-17.md`.
  Sửa trong PR này: push của thiết bị bị thu hồi (migration `session_id`, S-F1), token Expo trong lỗi (S-F3), cache và
  hàng gửi khi đăng xuất mobile (Mo-M3), keychain chỉ máy này (Mo-L1), artifact và secret của nightly Maestro (Mo-M2),
  xác nhận chia sẻ màn hình desktop (D-M2). Sub-issue: UNI-1877 (tự cập nhật chưa ký, chờ chủ sở hữu), UNI-1878 (các
  mục low), UNI-1879 (ký Windows bằng HSM). `pnpm audit --audit-level high` sạch; `govulncheck`, `gitleaks` không chạy
  ở máy (không cài) — CI chạy và xanh trên `aab341175`.
- [x] **4. Bằng chứng và go/no-go.** `docs/evidence/unichat/README.md` (checklist §2 thành bảng), `test-scripts.md`
  (K1–K9, smoke desktop, smoke mobile máy thật), `go-no-go-template.md`; runbook `docs/runbooks/unichat-pilot.md` đăng
  ký trong `OPERATOR_RUNBOOKS` và README runbook. Metric đúng là `uniwork_push_suppressed_total{kind}` (spec §2 sửa).
- [x] **5. Tài khoản phát hành.** `docs/evidence/unichat/release-accounts.md`: mỗi tài khoản → tên khoá chính xác → nơi
  đặt. Phát hiện kèm: Android cần `google-services.json` để có push token → `app.config.ts` đọc biến EAS kiểu file
  `GOOGLE_SERVICES_JSON` (có test); chứng chỉ Windows mua mới không còn `.pfx` (UNI-1879).
- [x] **6. Tài liệu.** Hai `CLAUDE.md` và hai runbook phát hành có và đúng; dòng Hệ quả ADR 0011 về Android cùng lúc đã
  có từ M1 (PR #337) — không sửa ADR đã `accepted`.
- [x] **7. Ổn định desktop.** `render-process-gone` → trang offline rồi tải lại app (`offline.ts`, có test) — mục
  "desktop tự phục hồi" của checklist không có mã nào giữ trước Q1.

## Phần chỉ người làm được (theo thứ tự)

- [ ] **8. Đăng ký tài khoản** (chủ sở hữu, bắt đầu ngay vì dài nhất): D-U-N-S → Apple Developer tổ chức → giữ tên
  "UniChat" (dự phòng "UniWork Chat") ngay ngày tài khoản mở; Expo tổ chức (cùng ngày); Google Play Console; chứng chỉ
  Windows + chọn dịch vụ ký (UNI-1879). Đặt khoá theo `release-accounts.md`.
- [ ] **9. Quyết định UNI-1877** (tự cập nhật Windows/Linux chưa ký): giữ và ghi rủi ro, hoặc Windows chưa ký chỉ
  thông báo.
- [ ] **10. EAS**: `eas init`, PR ghi `EAS_PROJECT_ID`; biến EAS `UNICHAT_API_URL`, `UNICHAT_APP_URL`,
  `GOOGLE_SERVICES_JSON`; khoá FCM V1, ASC API key; `EXPO_TOKEN` vào Environment `chat-mobile-release` (giới hạn tag).
- [ ] **11. Cắt bản**: tag `chat-desktop-v0.1.0-beta.1`, smoke desktop trên máy sạch ba hệ điều hành (`test-scripts.md`
  §2, ký tên); bản mobile `preview`/TestFlight/Play internal, smoke máy thật (§3) — lần đầu M2a/M2b/M3 chạy trên máy.
- [ ] **12. M3 (UNI-1834) và M4 phase 2** lên `develop`; đặt biến/secret `MAESTRO_*`, workflow lên `main`; Maestro xanh 5
  đêm liên tiếp.
- [ ] **13. Server production**: `UNICHAT_INSTALLER_*_URLS`, `UNICHAT_TESTFLIGHT_URL`, `UNICHAT_PLAY_INTERNAL_URL`,
  `UNICHAT_IOS_TEAM_ID`, `UNICHAT_ANDROID_SHA256`; chụp `/unichat` sống.
- [ ] **14. Pilot** ≥ 10 ngày làm việc liên tục theo `docs/runbooks/unichat-pilot.md`; kịch bản K1–K9; nhật ký `[pilot]`
  mỗi ngày trên UNI-1838; crash-free 7 ngày cuối từ App Store Connect / Play Console.
- [ ] **15. Go/no-go**: điền `go-no-go-template.md`, chủ sở hữu duyệt; C-19 → `CÓ` trong
  `docs/roadmap/FEATURE_ROADMAP.md`; người đặt UNI-1838 và UNI-1826 `done`; plan này và spec Q1 → `shipped`.
