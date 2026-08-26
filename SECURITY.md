# Báo lỗi bảo mật

**Đừng mở issue công khai cho lỗ hổng bảo mật.** Một issue công khai là bản mô
tả cách khai thác, gửi tới mọi người cùng lúc — kể cả người sẽ dùng nó.

Gửi về: **quangpd@unicomhub.com**

Nêu giúp: chỗ bị ảnh hưởng, cách tái hiện, và tác động bạn cho là lớn nhất.
Có proof-of-concept thì càng tốt. Chúng tôi phản hồi trong vòng 3 ngày làm việc.

## Phạm vi

Trong phạm vi: `server/`, `apps/web/`, `packages/`, cấu hình deploy trong repo
này.

Ngoài phạm vi: lỗ hổng của dependency đã có CVE công khai (báo lên upstream;
`govulncheck` và `pnpm audit` là chỗ chúng tôi theo dõi), và các báo cáo chỉ
dựa trên kết quả scanner mà không chứng minh được tác động thật.

## Những chỗ đã được cân nhắc kỹ — đọc trước khi báo

Các quyết định sau là cố ý và có test giữ chúng; nếu bạn cho rằng một trong số
đó sai, hãy nói rõ kịch bản tấn công cụ thể:

- Không có middleware `RealIP`; `r.RemoteAddr` không bao giờ bị ghi đè từ
  `X-Forwarded-For`. Mỗi nơi cần địa chỉ client tự áp dụng `TRUSTED_PROXIES`
  (`server/internal/handler/router_test.go`).
- Rate limit chỉ tồn tại khi có Redis, và fail-open khi Redis lỗi — đây là đánh
  đổi có chủ ý giữa khả dụng và chống lạm dụng.
- Không có foreign key ở tầng DB; quan hệ và dọn dẹp phụ thuộc nằm trong service
  code, trong transaction.
- Id là ULID dạng chuỗi mờ; handler không tiết lộ id có tồn tại hay không cho
  người ngoài workspace — service trả `ErrForbidden`/`ErrNotFound`.
- Cờ `Secure` của refresh cookie suy từ scheme của `FRONTEND_ORIGIN`.

## Bí mật bị lộ

Nếu bạn thấy credential thật trong repo hay trong log: báo theo địa chỉ trên và
coi như nó đã bị lộ — xoay khoá trước, dọn lịch sử sau.
