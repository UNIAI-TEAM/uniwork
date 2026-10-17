# UniChat — Nghiệm thu trưởng thành, pilot nội bộ và tài khoản phát hành (lát Q1)

> **Trạng thái:** in-progress — Đề xuất, chờ duyệt. Lát Q1 của epic UNI-1826; issue UNI-1838. Là lát đóng epic.

**Ngày:** 2026-10-16 · **Spec cha:** `2026-10-16-chat-native-apps-design.md` §4, §9, §10, §11 · **Quyết định:** tài khoản phát hành chưa có, đăng ký khi epic duyệt (chủ sở hữu, 2026-10-16)

## 1. Mục tiêu
Chứng minh bằng bằng chứng rằng UniChat đủ trưởng thành để nhân sự nội bộ dùng làm kênh chat chính, và có đủ tài khoản/chữ ký để ra khỏi nhóm pilot khi chủ sở hữu quyết.

## 2. Checklist trưởng thành (cách đo và bằng chứng)
| Mục | Cách đo | Bằng chứng |
|---|---|---|
| Parity | test `lib/*-display.ts` xanh; kịch bản chéo web + desktop + điện thoại cùng tài khoản (đọc/chưa đọc/nhắc đến) | log CI, ảnh ba màn hình |
| Realtime | tắt mạng 60 giây, bật lại; hết hạn token khi đang mở phòng | video/ảnh, log client không trùng tin |
| Push | Maestro hằng đêm đo từ gửi tới hiện ≤ 10 giây p95; không push khi đang hoạt động trên desktop; preview đúng, không trong log | báo cáo Maestro, metric `notification_push_suppressed_total` |
| Bỏ push | Đếm `uniwork_push_suppressed_total{kind}` theo ngày, đối chiếu phàn nàn pilot "không nhận push trên điện thoại" khi desktop mở nhưng người đó không ngồi máy; nếu phàn nàn lặp lại → dự phòng chỉ phía client: idle timer 60 s không chuột/bàn phím → `visible: false` trong `use-chat-presence-heartbeat` | biểu đồ metric, số phàn nàn trong `#unichat-feedback` |
| Ổn định | crash-free ≥ 99,5% 7 ngày cuối trên App Store Connect / Play Console; desktop `render-process-gone` tự phục hồi | ảnh console, log main |
| Bảo mật | `security-review` cho `apps/chat-*`; `pnpm audit --audit-level high`, `govulncheck`, `gitleaks`; kiểm `webPreferences`/IPC; refresh token không rời main/SecureStore | báo cáo, link CI |
| Trợ năng/i18n | VoiceOver/TalkBack qua tab bar và danh sách; chạm ≥ 44 px; sáng/tối; parity khóa vi/en | video, test |
| Desktop | smoke checklist D1 ký tên; bản cài ba hệ điều hành; auto-update Windows/Linux | checklist |
| Mobile | TestFlight + Play internal; Maestro xanh 5 đêm | link build, báo cáo |
| Landing | `/unichat` sống với catalogue và link store/TestFlight; SEO | URL |
| Tài liệu | `apps/chat-*/CLAUDE.md`, hai runbook phát hành, dòng Hệ quả ADR 0011 | PR |

## 3. Pilot nội bộ
Tổ chức nội bộ trên production; ≥ 10 ngày làm việc liên tục; mục tiêu ≥ 80% nhân sự dùng hằng ngày; kênh `#unichat-feedback` ngay trong UniChat; triage 15 phút mỗi sáng, P1 đóng trong 2 ngày; **dừng pilot** khi mất/trùng tin hoặc sự cố bảo mật; nhật ký pilot là bình luận trên issue này.

## 4. Tài khoản phát hành (chủ sở hữu đứng tên)
Bắt đầu ngay, song song với D1 (khảo sát 2026-10-17: ký số là điều kiện để desktop nhận `https` deep link và tự cập nhật macOS, nên không chờ epic đóng): Apple Developer Program cho tổ chức (D-U-N-S, 1–2 tuần) → giữ tên **UniChat** trên App Store Connect ngay ngày tài khoản mở (nếu không được: "UniWork Chat", id không đổi) → ASC API key cho EAS; Google Play Console (1–2 ngày) → app `com.uniworkos.chat`, service account; chứng chỉ ký Windows OV/EV (1–2 tuần); notarization đi cùng Apple; tài khoản EAS tổ chức. Tới khi có: desktop bản chưa ký, mobile EAS internal distribution.

## 5. Go/no-go
Báo cáo một trang: checklist §2 với bằng chứng, số liệu pilot, rủi ro còn lại, đề xuất bước tiếp (phát hành public store, CallKit, tùy chọn preview). Chủ sở hữu duyệt → `docs/roadmap/FEATURE_ROADMAP.md` C-19 → CÓ, epic `done` (người đặt).

## 6. Để builder quyết
Mẫu báo cáo; công cụ đo thời gian push; cách lưu bằng chứng (bình luận issue + thư mục `docs/evidence/unichat/` nếu cần).
