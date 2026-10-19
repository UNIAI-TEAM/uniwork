# UniChat — báo cáo go/no-go (mẫu)

> **Trạng thái:** in-progress — mẫu lập 2026-10-17 trong Q1 (UNI-1838, spec §5). Người điền chép tệp này thành
> `go-no-go-<YYYY-MM-DD>.md` khi pilot kết thúc, điền mọi ô `…`, rồi gửi chủ sở hữu sản phẩm duyệt. Một trang: chi tiết
> ở bằng chứng được trỏ tới, không chép lại.

**Ngày:** … · **Người lập:** … · **Kỳ pilot:** … → … (… ngày làm việc liên tục) · **Phiên bản:** desktop `…`,
iOS `…` (build …), Android `…` (build …) · **Đề xuất:** GO / NO-GO / GO có điều kiện

## 1. Checklist trưởng thành

Mỗi dòng trỏ tới bằng chứng (bình luận UNI-1838, run CI, ảnh). Một dòng chưa đạt thì ghi lý do và việc bù ở §4.

| Mục | Đạt? | Bằng chứng |
| --- | --- | --- |
| Parity (test + chéo thiết bị K1) | ☐ | … |
| Realtime (K2 mất mạng 60 s, K3 hết hạn token) | ☐ | … |
| Push ≤ 10 s p95, preview đúng, không log (K4, K6, Maestro) | ☐ | p95 = … s trên … mẫu |
| Không push khi đang hoạt động (K5) | ☐ | … |
| Ổn định: crash-free ≥ 99,5 % 7 ngày cuối; desktop tự phục hồi | ☐ | iOS …%, Android …% |
| Bảo mật (`security-review-2026-10-17.md`, CI, UNI-1877 đã quyết) | ☐ | … |
| Trợ năng / i18n (K8, K9) | ☐ | … |
| Desktop: bản cài 3 hệ điều hành, tự cập nhật, smoke ký tên | ☐ | … |
| Mobile: TestFlight + Play internal; Maestro 5 đêm xanh | ☐ | … |
| Landing `/unichat` sống | ☐ | URL … |
| Tài liệu | ☐ | … |
| Tài khoản: Apple duyệt, tên app đã giữ (`…`), Play có app, ký Windows + notarization trong workflow | ☐ | … |

## 2. Số liệu pilot

| Số | Mục tiêu | Thực tế |
| --- | --- | --- |
| Ngày làm việc liên tục | ≥ 10 | … |
| Người dùng hằng ngày / người trong danh sách (thấp nhất, trung bình) | ≥ 80 % | … % / … % |
| Sự cố mất tin / trùng tin | 0 | … |
| Sự cố bảo mật | 0 | … |
| P1 mở / đóng trong 2 ngày làm việc | tất cả | … / … |
| P2 mở / đóng | — | … / … |
| Push bị bỏ (`uniwork_push_suppressed_total`) / push gửi, theo ngày | — | … |
| Phàn nàn "không nhận push khi desktop mở" | — | … (dự phòng idle timer: bật / không) |
| Phản hồi trong `#unichat-feedback` | — | … tin, … chủ đề chính |

## 3. Rủi ro còn lại

Điền rủi ro đã biết lúc lập mẫu, thêm rủi ro mới từ pilot; mỗi dòng có chủ và hướng xử lý.

| Rủi ro | Mức | Xử lý / chủ |
| --- | --- | --- |
| Tự cập nhật Windows/Linux chưa ký tin bất kỳ ai có quyền ghi release (UNI-1877) | medium | Quyết định: … |
| Ký Windows cần token/HSM, workflow mới ký bằng tệp (UNI-1879) | — | … |
| Các phát hiện bảo mật mức thấp (UNI-1878) | low | Làm trước phát hành store công khai |
| Nội dung tin đi qua Expo Push Service (bên thứ ba) | — | Ghi trong `apps/chat-mobile/store/listing.md`; chuyển APNs/FCM trực tiếp nếu cần |
| Tên "UniChat" đông đúc trên App Store | — | Tên đã giữ: … |
| … | … | … |

## 4. Đề xuất bước tiếp

- Phát hành store công khai (profile `production`, `docs/runbooks/unichat-mobile-release.md`) — quyết định riêng sau go.
- CallKit / VoIP push cho cuộc gọi khi khóa máy (ngoài phạm vi epic).
- Tùy chọn tắt preview push theo người dùng.
- Desktop: cắt kênh `stable` khi bản mac/Windows đã ký.
- …

## 5. Duyệt

- [ ] Chủ sở hữu sản phẩm duyệt (tên, ngày): …
- [ ] `docs/roadmap/FEATURE_ROADMAP.md` dòng C-19 → `CÓ` (ngày) — PR …
- [ ] UNI-1838 và epic UNI-1826 → `done` (người đặt)
