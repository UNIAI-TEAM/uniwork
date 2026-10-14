# Runbook: Office đồng bộ, offline và UniWork AI (G5/G6/G7)

> **Trạng thái:** shipped (G7-07, UNI-1381) · **Cập nhật:** 2026-10-14 · **Nguồn:** [spec §12](../superpowers/specs/2026-10-02-office-g5-g6-g7-design.md), [`contract-p0.md`](../office/g5g6g7/contract-p0.md), plan 2026-10-12 thẻ G7-07 · **Alert:** [`docs/runbooks/README.md`](../runbooks/README.md) (ngưỡng pending G7-D1)

Các mục vận hành của phase G5/G6/G7 mà **không có alert riêng** (hoặc là phần "làm gì tiếp" của một alert). Engine
Office, job và format: [`RUNBOOK_OFFICE_ENGINE.md`](RUNBOOK_OFFICE_ENGINE.md). AI nói chung, upstream, transcript, run
và usage: [`RUNBOOK_AI.md`](RUNBOOK_AI.md). Outbox: [`RUNBOOK_OUTBOX.md`](RUNBOOK_OUTBOX.md). Kênh/ma trận hỗ trợ:
[`support-matrix.md`](../office/g5g6g7/support-matrix.md).

Quy tắc chung: không ghi host/IP/cổng/khóa của upstream model vào đâu, không ghi tên hay email người dùng vào ticket
hoặc log (chỉ id và `correlation_id`), không xóa hàng bằng tay để "làm hết lỗi". Flag chỉ ẩn capability, không cấp quyền
và không tắt phục hồi hay xóa dữ liệu (spec §12). Rollback không bao giờ là down migration hay purge FileService.

## Cursor hết hạn và resync (`change_cursor_expired`)

**Triệu chứng.** Feed `GET /workspaces/{workspaceID}/documents/changes` trả `410 change_cursor_expired`; app/frame làm
một full resync (cold start mới). Không phải lỗi: đó là đường dẫn đúng khi snapshot hết hạn (`OFFICE_CHANGE_SNAPSHOT_TTL`,
mặc định 15 phút, giữa lúc đang nạp trang), cursor feed quá `DocumentChangeFeedTTL` (7 ngày), hoặc một lần purge có thể
đã chạm phần quyền mà cursor cần (feed không đoán removal, nó trả 410). Mốc cao nước (high-water) cũ hơn cột `xact_id`
(bảng `change_feed_epoch`) cũng trả 410.

**Kiểm tra.** Một vài 410 mỗi ngày là bình thường. Tăng vọt: có purge thùng rác vừa chạy không (retention thùng rác
30 ngày phải ≥ 7 ngày TTL cursor, `documentRetentionDays` ≥ `DocumentChangeFeedTTL`)? `OFFICE_CHANGE_SNAPSHOT_TTL` có bị
đặt quá ngắn so với thời gian nạp snapshot không? `uniwork_office_change_snapshot_rows_swept_total{table}` có tăng
nhanh không? Client không gửi lại cursor cũ trong vòng lặp (xem tỷ lệ 410 trên route feed bằng
`uniwork_http_requests_total{status="410"}`).

**Khắc phục.** Không cần sửa dữ liệu; client tự resync. Nếu TTL snapshot quá ngắn, nâng `OFFICE_CHANGE_SNAPSHOT_TTL`
và restart. Không bao giờ trả "mới nhất" thay cho resync và không bơm lại cursor cho client.

## Cursor và lease sau khi đổi khóa ký (`JWT_SECRET`)

**Triệu chứng.** Ngay sau khi đổi `JWT_SECRET`, **mọi** cursor feed đang lưu ở client không qua được kiểm MAC: feed trả
`400 change_cursor_invalid` (không phải 410; cursor sai MAC không phân biệt được với cursor giả và không lộ phạm vi).
Cùng lúc mọi lease offline hiện có không gia hạn được (`offline_lease_revoked`, `uniwork_office_offline_lease_blocked_total{reason="signature"}`).
Khóa của cursor, lease, frame token và access token đều suy từ `JWT_SECRET` dưới nhãn riêng.

**Kiểm tra.** Tỷ lệ 400 trên route feed tăng đột ngột đúng lúc deploy; `OfficeLeaseBlockedSpike` với `reason="signature"`.
Xác nhận có đổi `JWT_SECRET` trong lần deploy đó (token ký bằng khóa cũ mất hiệu lực: xem runbook xoay secret của hạ tầng).

**Khắc phục.** Hành vi mong đợi: client coi cursor không dùng được và nạp lại từ đầu (cold start); thiết bị xin lease mới
khi online. Đây là một đợt resync đồng thời của mọi client, nên có thể kéo tải feed và DB trong vài phút: chọn giờ đổi khóa
thấp tải, theo dõi `OfficeChangeFeedLagHigh` và `uniwork_http_in_flight_requests`. Không đổi khóa ký vì "lỗi cursor": chỉ
đổi vì lý do bảo mật.

## Queue `reconciling` kẹt

**Triệu chứng.** App (desktop) hiển thị lần Lưu ở `reconciling` lâu: phản hồi commit mất hoặc hủy sau khi bắt đầu commit
nên kết quả chưa rõ. App tra kết quả bằng `GET /documents/{documentID}/versions/commit` kèm `Idempotency-Key`
(trả `committed` | `not_committed` | `in_flight` | `unknown`); route tra đọc được cả khi `office_sync_write` tắt. Quy tắc
bất biến: không tạo khóa mới để "thử lại" khi chưa chứng minh được trạng thái.

**Kiểm tra.** `uniwork_office_intent_lookups_total{outcome}`: `in_flight` kéo dài = một attempt còn claim sống (claim
`DOCUMENT_COMMIT_INTENT_CLAIM_TTL`, mặc định 2 phút; sau đó `not_committed` chỉ trả khi không attempt nào còn commit
được); `unknown` = intent đã bị dọn (`OfficeIntentLookupUnknown`, retention `DOCUMENT_COMMIT_INTENT_RETENTION`, mặc định
168 giờ); `not_committed` = chắc chắn chưa commit, app được cấp attempt mới gắn cùng intent. `uniwork_office_idempotent_replays_total`
tăng = retry đã commit từ trước. Kết nối giữa app và server (`OfficeIdempotentReplaySpike`).

**Khắc phục.** `in_flight`: chờ claim hết hạn (≤ 2 phút) rồi để app tra lại. `unknown`: xem mục "Upload hết hạn" và
`OfficeIntentLookupUnknown`; người dùng giữ bản cục bộ và quyết định lưu như một lần Lưu mới sau khi kiểm lịch sử phiên bản.
Server không phân biệt khóa chưa từng nhận với khóa đã bị dọn: cả hai đều trả `unknown` và đi theo đường
`reconciling` kẹt này (quyết định G5-D2 (c), Advisor 2026-10-14: không tách); app tự gửi lại khóa chưa từng nhận là backlog
trong bản nháp G5-D2, không phải hành vi v1. Không xóa dòng `document_commit_intents`, không sửa `idempotency_keys`. Nếu app báo kẹt mà server đã `committed`:
đó là lỗi app, báo owner fork (queue G5-06) kèm `correlation_id`.

## Upload hết hạn

**Triệu chứng.** Thiết bị online lại sau khi claim upload của FileService đã hết hạn: lần commit bị từ chối vì claim hết hạn
hoặc attempt cũ bị fence (một attempt có claim hết hạn không bao giờ late-commit).

**Kiểm tra.** Intent còn không (tra bằng route ở mục trên)? Nếu `committed`: không có gì mất. Nếu `not_committed`: được cấp
attempt n+1 gắn cùng intent và cùng snapshot; claim cũ đã được ghi audit như hàng rào của attempt n.

**Khắc phục.** Không thay `upload_id` rồi dùng lại khóa commit có fingerprint cũ (fingerprint buộc payload). App tự gửi
lại byte của đúng snapshot dưới attempt mới. Retention ngắn hơn thời gian offline của người dùng là lý do thường gặp:
`OfficeIntentLookupUnknown`. Cửa sổ giữ thật do G5-D2 chốt; dev dùng giá trị tạm.

## Quota và engine outage

**Quota.** Lệnh Lưu file hết quota lưu trữ trả `403 quota_exceeded` (kiểm ở bước 7 của commit); đếm ở
`uniwork_document_quota_rejects_total{kind="file"}` và `uniwork_document_saves_total{kind="file",outcome="quota"}`. App giữ
snapshot (trạng thái `failed`, nêu cách khắc phục); không lặp lại tự động. Xử lý: tăng quota hoặc dọn dung lượng theo billing;
đừng xóa phiên bản để lấy chỗ nếu chưa hỏi chủ tài liệu.

**Engine.** Engine ngừng (`uniwork_office_engine_ready = 0`) không làm hỏng `/readyz` của API, danh sách tài liệu hay tải về
(02b). Việc cần engine (chuyển đổi, export DOCX → PDF, job XLSX/PDF) trả `engine_*` hoặc `503 engine_overloaded`; Lưu
file thường không cần engine. Kiểm tra theo [`RUNBOOK_OFFICE_ENGINE.md`](RUNBOOK_OFFICE_ENGINE.md) (sức khỏe, hàng đợi, giới
hạn). Không có alert engine ở G7-07: engine `/metrics` chưa được `deploy/prometheus.yml` scrape (mục Follow-ups của runbook
engine); đó là việc nối riêng.

## Keystore và lease lỗi

**Triệu chứng.** Keystore là kho khóa của hệ điều hành trên máy người dùng (app desktop), không có phía server: server không
thấy lỗi keystore. Biểu hiện: app không mở được thư viện offline đã ghim (khóa bị khóa/hỏng), hoặc lease hết hạn/không gia hạn
được. Phía server chỉ thấy lease không được xin lại hoặc `OfficeLeaseBlockedSpike`.

**Kiểm tra.** Server: `uniwork_office_offline_lease_grants_total{op}` (grant/renew/release) và
`uniwork_office_offline_lease_blocked_total{reason}` theo `reason`; một thiết bị cụ thể đang bị từ chối vì `limit` (200 lease)
hoặc `device` (thiếu `device_sessions` sống). Lease sống tối đa 24 giờ, gia hạn khi online.

**Khắc phục.** Keystore khóa: người dùng đăng nhập lại / mở khóa kho khóa của hệ điều hành; app không phát lại plaintext và
không xóa ciphertext. Lease hết hạn khi online: app xin lại. `office_offline_library` tắt chỉ dừng cấp mới; không xóa lease.
Không có đường server nào để "mở khóa" thay người dùng.

## Revoke

**Triệu chứng.** Một thiết bị/phiên/thành viên/chia sẻ/tài liệu mất quyền và lease offline liên quan phải đóng. Lý do
(`uniwork_office_offline_leases_revoked_total{reason}`): `device_revoked`, `session_revoked`, `member_deactivated`,
`member_removed`, `share_revoked`, `document_deleted`, `document_moved`, `policy_epoch`, `admin`. Hiệu lực tại thiết bị khi
nó nhận revoke hoặc khi lease hết hạn (tối đa 24 giờ), logout khóa ngay.

**Kiểm tra.** Consumer outbox `office_lease_revoker` (event `office_lease.revoked`) có chạy: `OutboxLagHigh`,
`OutboxDeadLetter`. Revoke lỗi ở bước kiểm membership sau commit: `OfficeLeaseRevokeFailed`
(`uniwork_office_offline_lease_revoke_failed_total`).

**Khắc phục.** Theo `OfficeLeaseRevokeFailed`. Cần dừng khẩn một thiết bị: thu hồi thiết bị/phiên (ghi audit). Không sửa bảng
`office_offline_leases` bằng tay.

## Upstream model: sập và đổi upstream

**Triệu chứng.** `UniworkAiModelErrors`, `UniworkAiLatencyP95High`, hoặc `ai_provider_error` / `ai_provider_timeout` (504 sau
55 giây) từ route UniWork AI. Chỉ UniWork AI (và mọi tính năng AI dùng cùng Gateway) bị ảnh hưởng; editor, Lưu, BYOK, feed và
offline vẫn chạy. Không fallback âm thầm sang nhà cung cấp khác.

**Kiểm tra.** Mục "UniWork AI upstream" của [`RUNBOOK_AI.md`](RUNBOOK_AI.md) (biến `AI_PROVIDER`, `OPENAI_BASE_URL`,
`OPENAI_API_KEY`, `AI_MODEL_ALLOW`, `AI_MODEL_OFFICE_UNIWORK_AI`). Gateway là một cho cả server: đổi `OPENAI_*` đổi upstream
của mọi tính năng AI trên deployment đó.

**Khắc phục.** Đổi upstream là thay cấu hình rồi restart, không phải đổi code: đặt `AI_PROVIDER`/`OPENAI_BASE_URL`/khóa trong
secret store của deployment (không trong Git, không trong báo cáo), thêm model vào `AI_MODEL_ALLOW`, đặt
`AI_MODEL_OFFICE_UNIWORK_AI`, restart `uniwork-be`, rồi kiểm một lượt có công cụ (vòng tool-result giữ đúng id tool call)
trước khi báo xong. Upstream production chưa chọn (G6-D2); cho tới khi chọn, UniWork AI không mở cho tổ chức có dữ liệu thật
(`office_ai_uniwork` mặc định tắt) và không bật khi `AI_PROVIDER=fake`. Cần dừng ngay: tắt flag `office_ai_uniwork` (kill
switch: dừng lượt mới, ẩn nhà cung cấp trong panel, vẫn đối soát usage đang chạy).

## Đối soát usage

**Triệu chứng.** `UniworkAiUsageUnknownSpike`, hoặc meter `ai.tokens` không tăng sau lượt thành công.

**Cơ chế.** Lượt `office_uniwork_ai` mà upstream không trả usage ghi `ai_usage_events.reason_code = usage_unknown`, token/cost 0.
Worker TTL (mỗi phút, trong tiến trình API) ước lượng token từ transcript đã lưu, claim dòng bằng một UPDATE có điều kiện
(`usage_unknown_reconciled`) và cộng meter một lần. Dòng usage chính là hàng đợi; không có bảng thứ hai.

**Kiểm tra.** `uniwork_ai_uniwork_usage_unknown_total` so với `uniwork_ai_uniwork_usage_reconciled_total`; `ai_usage_events`
theo `reason_code`; log `uniwork ai conversation sweep` và `ai: usage reconcile: transcript gone`; `AI_CONVERSATION_KEY` chưa
đổi (transcript cũ không giải mã được).

**Khắc phục.** Worker không chạy: restart pod API. Transcript đã hết hạn trước khi đối soát: dòng đó không thể ước lượng, ghi
nhận sai lệch cho billing và không sửa `usage_counters` bằng tay. Chi tiết: mục "UniWork AI run + usage" của
[`RUNBOOK_AI.md`](RUNBOOK_AI.md).

## Installer và update: rollback

**Triệu chứng.** Một bản app mới lỗi và cần rút lại; hoặc app báo "store mới hơn bản app" (S11) sau khi hạ bản.

**Cơ chế.** Server không lưu bản cài: `GET /api/v1/office/desktop/download` trả link theo kênh từ
`OFFICE_INSTALLER_<DEV|BETA|STABLE>_URLS` (và `_URL`); phiên bản tách từ tên tệp. Rollback phía server là đổi danh sách
tên tệp/URL của kênh về bản trước và deploy lại (chỉ đổi cấu hình; URL không vào báo cáo hay Git ngoài `deploy/app/env/`).
Rollback phía app xuống **dưới N′** (bản dev đầu tiên có guard store mới G5-04g) **không được hỗ trợ**: bản cũ hơn không biết
store schema 2. N′ phải có trên mọi kênh trước khi kênh nào phát hành store schema 2 (xem
[`support-matrix.md`](../office/g5g6g7/support-matrix.md)).

**Khắc phục.** Rút lại trong phạm vi ≥ N′: đổi link kênh về bản N′ trở lên. Cần rút xuống dưới N′: không làm; phát bản sửa
(roll-forward). Server D tương thích trước client (spec §12): rollback server không đòi hạ app. Không xóa store cục bộ để
"cứu" một bản app.

## Mất khả năng checkpoint

**Triệu chứng.** App không ghi được checkpoint của nháp (disk đầy, quyền ghi, store hỏng). Đây là tín hiệu **chỉ có ở app**:
không có metric hay alert phía server ở v1 (không có đường app → server, plan §8). Người dùng thấy cảnh báo trong app và app
không tự khởi động lại khi checkpoint thất bại.

**Kiểm tra / khắc phục.** Phía server không thấy gì để kiểm. Hướng dẫn người dùng: giải phóng đĩa, giữ cửa sổ mở, dùng "Lưu"
khi đang online để có bản trên server; không xóa thư mục dữ liệu app. Thu thập `correlation_id` của lần Lưu và bản app cho owner
fork. Khi có đường gửi metric app → server (câu hỏi mở cho OPS + Lead F), thêm alert ở thẻ riêng.

## Worker dọn TTL dừng

Các worker dọn chạy trong tiến trình API và dừng cùng `runCancel` trong chuỗi shutdown (`server/cmd/server/main.go`); không
có worker riêng để "khởi động lại" ngoài restart pod.

| Worker | Dọn gì | Dấu hiệu sống |
| --- | --- | --- |
| Snapshot feed (G5-01a) | hàng snapshot hết hạn | `uniwork_office_change_snapshot_rows_swept_total{table}` |
| Intent commit (G5-07) | intent quá cửa sổ giữ, claim không sống | `uniwork_office_commit_intents_swept_total` |
| Lease (G5-08s) | lease hết hạn/revoke quá retention | `uniwork_office_offline_lease_sweep_deleted_total` |
| Hội thoại + run UniWork AI (G6-03a/b) | transcript, run mồ côi; chạy cả đối soát usage | `uniwork_ai_uniwork_conversations_swept_total{reason}`, `uniwork_ai_uniwork_runs_swept_total{reason}`, log mỗi phút |

**Triệu chứng.** Bảng tương ứng phình dần, hoặc counter đứng 0 trong khi có dữ liệu hết hạn. `uniwork_ai_uniwork_conversations_live`
chỉ đi lên.

**Kiểm tra.** Log khởi động của worker và dòng `... sweep did not stop in time` khi shutdown; Postgres có khóa dài/
`statement_timeout` làm sweep lỗi; một pod mới deploy mà worker không đăng ký.

**Khắc phục.** Restart pod API. Không xóa hàng bằng tay (retention là bất biến: intent chưa hết cửa sổ giữ không được xóa).
Sweep dừng lâu chỉ gây phình bảng và (với intent) giữ kết quả lâu hơn cần; không làm sai kết quả.

## Trần đồng thời UniWork AI (`ai_uniwork_busy`)

**Triệu chứng.** Người dùng thấy "AI bận, thử lại" (429 `ai_uniwork_busy`, `Retry-After: 5`). Trần theo A11: 32 lượt/pod,
64 toàn cục (lease trong Redis), 8 lượt/tổ chức (`UniworkPodMax`, `UniworkOrgMax`, `UniworkGlobalMax` trong
`server/internal/service/ai_uniwork.go`; **là hằng số, không có biến môi trường**). Không có Redis thì trần tổ chức tính trong
từng pod và trần toàn cục bị bỏ; Redis lỗi thì các trần dùng chung bị bỏ (fail open).

**Khoảng trống metric (gap có tên).** Chưa có metric server nào đếm lượt từ chối vì trần: lượt bị từ chối trước Gateway nên
không vào `uniwork_ai_calls_total`, và mã `ai_uniwork_busy` không có counter riêng. Do đó **không có alert** cho nó (G7-07 không
thêm metric); owner: G6-03a. Tín hiệu gián tiếp duy nhất: `uniwork_http_requests_total{status="429",route=~".*/ai/uniwork/chat/completions"}`,
nhưng nó lẫn cả 429 của rate limiter nhóm route, và `ApiRateLimitedSpike` (> 0,5 req/s mỗi route) cũng bắt nó.

**Kiểm tra.** Tỷ lệ 429 trên hai route UniWork AI; `uniwork_http_in_flight_requests`; độ trễ lượt (`UniworkAiLatencyP95High`):
upstream chậm giữ slot lâu nên trần đầy. Một tổ chức chiếm hết 8 slot của mình là bình thường và không ảnh hưởng tổ chức khác.

**Khắc phục.** Upstream chậm: xử lý theo mục upstream. Tải thật tăng: thêm pod (trần pod nhân theo số pod, trần toàn cục
giữ 64). Đổi các hằng số cần sửa code theo G6-D1 (A11) và test; không tắt trần.

## Feed: hai chế độ lặng và retention

Hai chế độ lặng của change feed (xmin horizon do transaction dài, và retention thùng rác ≥ TTL cursor) có giải thích đầy đủ
trong mục "Change feed (G5-01b)" của [`RUNBOOK_OFFICE_ENGINE.md`](RUNBOOK_OFFICE_ENGINE.md); alert tương ứng là
`OfficeChangeFeedLagHigh` và runbook cùng tên.
