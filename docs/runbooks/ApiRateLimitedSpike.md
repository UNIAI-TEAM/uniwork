# ApiRateLimitedSpike — một route trả 429 liên tục

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · API* (panel **429 theo route**)

## Triệu chứng

- Alert `ApiRateLimitedSpike`: một route trả 429 trên 0,5 request/giây trong 5 phút. Riêng route webhook LiveKit (`/api/v1/integrations/livekit/webhook`) thì chỉ cần một 429 là alert bật, vì route này được miễn mọi limiter.
- Người dùng báo "thao tác quá nhanh", không vào được phòng họp, hoặc trang tải không hết. Cả văn phòng chung một IP NAT có thể bị chặn cùng lúc.
- `route="unmatched"` là limiter toàn cục (300 request/phút cho mỗi đường dẫn, tính theo người dùng hoặc IP), vì limiter này trả lời trước khi định tuyến.

## Kiểm tra

1. Route nào, và bắt đầu từ lúc nào?
   ```promql
   sum by (route) (rate(uniwork_http_requests_total{status="429"}[5m]))
   sum by (route) (rate(uniwork_http_requests_total[5m]))
   ```
   429 tăng cùng tổng request: tải thật tăng (cuộc họp đông, đầu giờ làm). 429 tăng mà tổng không tăng: một client đang gọi lặp.
2. Route webhook LiveKit có 429: đây là lỗi hồi quy, sự kiện của phòng họp đang mất. Kiểm tra `ExceptPaths` trong `server/internal/handler/router/router.go` và các limiter gắn vào route đó.
3. Ai bị chặn? Log truy cập cho biết đường dẫn:
   `kubectl -n uniwork logs deploy/uniwork-be --since=15m | grep 'status=429'`. Log này không ghi IP, và 429 của limiter toàn cục trả về trước bước xác thực nên không có `actor_id`. Đối tượng bị đếm nằm trong key Redis của limiter, dạng `uw:ratelimit:<ngân sách>:<đường dẫn>:<IP hoặc id:<user>>`:
   `redis-cli --scan --pattern 'uw:ratelimit:*' | head -50`. Một IP chiếm nhiều key là NAT văn phòng hoặc khách chưa đăng nhập. Một `id:<user>` lặp trên một đường dẫn là client lặp.
4. Redis có ổn không? Limiter chỉ chạy khi có Redis. Redis chậm làm request chờ, chứ không làm tăng 429.

## Khắc phục

- Client lặp (tab treo, retry không có backoff): tìm màn hình gây ra trong log theo `trace_id` rồi sửa phía client. Client gọi `/join` phải đợi theo `Retry-After`.
- Tải thật vượt ngân sách: ngân sách nằm ở `server/internal/handler/router/router.go` (toàn cục, đăng nhập, join phòng họp, chat, admin). Đổi bằng PR có lý do, không sửa nóng trên cluster.
- Nghi bị dò mật khẩu trên route đăng nhập: limiter đang làm đúng việc. Ghi IP vào issue bảo mật, không nới ngân sách.

## Leo thang

- Route webhook LiveKit trả 429, hoặc không ai vào được phòng họp: nâng sev 1, gọi on-call backend.
- 429 kéo dài trên route đăng nhập từ nhiều IP lạ: báo người phụ trách bảo mật.
