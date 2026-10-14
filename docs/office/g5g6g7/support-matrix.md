# Support matrix: kênh, bản rollback tối thiểu N′ và metric (G7-07)

> **Trạng thái:** in-progress — N′ chưa phát hành (guard store mới G5-04g chưa có trong bản dev nào); ngưỡng alert pending G7-D1 · **Cập nhật:** 2026-10-14 · **Nguồn:** [contract-p0](contract-p0.md) §1, §6; plan 2026-10-12 §8, thẻ G7-07; spec §12 · **Runbook:** [`RUNBOOK_OFFICE_SYNC.md`](../../ops/RUNBOOK_OFFICE_SYNC.md), [`docs/runbooks/README.md`](../../runbooks/README.md)

Tài liệu này nói rõ bản app nào được hỗ trợ ở kênh nào, giới hạn rollback, và metric nào có alert. Nó không cấp quyền phát
hành, chữ ký hay deploy (spec §12; ký số là backlog U-11, không chặn). Số liệu "đang phục vụ" là dữ kiện tại SHA `b6a0f4150`
của contract-p0 và phải được cập nhật khi kênh đổi.

## 1. Kênh và nền tảng

| Kênh | Nền tảng và gói (theo `deploy/app/env/uniwork-be.env`, chỉ tên tệp) | Đang phục vụ | N′ |
| --- | --- | --- | --- |
| Web (frame trong `apps/web`) | Trình duyệt; pin bundle genoffice `0.1.0-0d03b18` (6 module) | Cùng bản deploy của web | Không áp dụng: web không có store cục bộ schema 2; rollback web là rollback deploy |
| Desktop dev | Windows x64 (`win32_x64-setup.exe`), macOS arm64 và x64 (`.dmg`), Linux x64 (`.deb`, `.AppImage`) | `0.11.0-dev.7` (`unsigned`) | **Chưa có.** `0.11.0-dev.7` chưa có G5-04g; N′ dự kiến `0.11.0-dev.8` nếu không có tag chen. Advisor ghi số thật khi bản đó phát hành |
| Desktop beta | Cùng bộ gói như dev khi có | Rỗng | Chưa phát hành |
| Desktop stable | Cùng bộ gói như dev khi có | Rỗng | Chưa phát hành |

- Server chỉ phát link (`GET /api/v1/office/desktop/download`, biến `OFFICE_INSTALLER_<DEV|BETA|STABLE>_URLS`); không lưu bản cài.
- Số `n` của kênh dev và beta đếm riêng; so phiên bản độc lập kênh dùng `min_store_level` (khuyến nghị OQ-P4 phương án b),
  không so thứ tự tag.
- Kênh dev hôm nay phục vụ Linux chỉ gói x64 (`.deb`, `.AppImage`); macOS có cả arm64 và x64.

## 2. Giới hạn rollback app

- **N′ = bản dev đầu tiên của fork có guard "store mới hơn" (G5-04g).** Từ N′ trở lên, app từ chối mở store schema 2 khi chạy
  bản không đủ năng lực (màn S11) và không tạo intent mới.
- **Rollback app xuống dưới N′ không được hỗ trợ.** Bản dưới N′ không biết store schema 2 và coi tệp binding như tệp cục bộ
  thường. Cách xử lý duy nhất là roll-forward bằng bản sửa. Không xóa store cục bộ để cứu một bản app.
- **N′ phải có trên mọi kênh trước khi kênh nào phát hành store schema 2.** Hôm nay không kênh nào phát hành schema 2.
- Rollback server tương thích trước client: server D rollback không đòi hạ app (spec §12). Không dùng down migration hay purge
  FileService như cách rollback.

## 3. Metric: server (có alert) và app-only (không alert ở v1)

Alert chỉ trên metric mà code server D đăng ký, kiểm bằng `scripts/office/alert-metrics.test.mjs`. Metric chỉ có ở app **không
có alert ở v1**: chưa có đường gửi metric từ app về server (plan §8, câu hỏi mở cho OPS + Lead F). Ngưỡng mọi alert dưới đây
**pending G7-D1**.

| Họ metric | Nguồn | Alert | Ghi chú |
| --- | --- | --- | --- |
| Feed lag `uniwork_office_change_feed_lag_seconds` | Server (G5-01b) | `OfficeChangeFeedLagHigh` | Gauge giữ giá trị cuối khi không ai gọi feed |
| 409 ở commit `uniwork_document_conflicts_total{kind="file",code="document_version_conflict"}` | Server (dùng lại counter Documents, quyết định G5-07) | `OfficeCommitConflictSpike` | Tỷ lệ trên `uniwork_document_saves_total{kind="file"}` |
| Tra intent `uniwork_office_intent_lookups_total{outcome}` | Server (G5-07) | `OfficeIntentLookupUnknown` (chỉ `unknown`) | `in_flight`, `not_committed` là bình thường |
| Replay `uniwork_office_idempotent_replays_total` | Server (G5-07) | `OfficeIdempotentReplaySpike` | |
| Lease bị chặn `uniwork_office_offline_lease_blocked_total{reason}` | Server (G5-08s) | `OfficeLeaseBlockedSpike` (trừ `flag_off`) | Tập `reason` đóng, 8 giá trị |
| Revoke lease lỗi `uniwork_office_offline_lease_revoke_failed_total` | Server (G5-08s) | `OfficeLeaseRevokeFailed` | |
| Lỗi lượt model `uniwork_ai_calls_total{capability="office_uniwork_ai",status}` | Server, Gateway | `UniworkAiModelErrors` | `rejected` là hết quota, không tính là lỗi |
| Latency lượt model `uniwork_ai_latency_ms{capability="office_uniwork_ai"}` | Server, Gateway | `UniworkAiLatencyP95High` | |
| Usage unknown `uniwork_ai_uniwork_usage_unknown_total` | Server (G6-03b) | `UniworkAiUsageUnknownSpike` | |
| Thời lượng / tín dụng mỗi run `uniwork_ai_uniwork_run_seconds`, `_run_credits` | Server (G6-03b) | `UniworkAiRunSecondsHigh`, `UniworkAiRunCreditsHigh` | |
| Tool call bị bỏ `uniwork_ai_uniwork_dropped_tool_calls_total{reason}` | Server (G6-03b) | `UniworkAiDroppedToolCalls` | |
| Từ chối vì trần đồng thời `ai_uniwork_busy` (429) | Server (G6-03a) | **Không có: gap có tên** | Chưa có metric server nào đếm lượt từ chối này (lượt bị từ chối trước Gateway nên không vào `uniwork_ai_calls_total`). Owner G6-03a. Gián tiếp: `uniwork_http_requests_total{status="429",route}`, lẫn 429 của rate limiter |
| Tuổi intent cũ nhất trong queue | App (desktop) | Không | App-only |
| Crash rate | App (desktop) | Không | App-only |
| Lỗi công cụ phía client | App (frame/desktop) | Không | App-only |
| Mất khả năng checkpoint | App (desktop) | Không | App-only; người dùng thấy cảnh báo trong app, runbook ở mục tương ứng |
| Engine Office (`office_engine_*`) | Dịch vụ engine `/metrics` | Không | Chưa được `deploy/prometheus.yml` scrape (follow-up của runbook engine) |

## 4. Cách giữ tài liệu này đúng

- Thêm alert mới: thêm dòng ở mục 3, tên metric phải qua `scripts/office/alert-metrics.test.mjs`.
- Khi N′ phát hành: Advisor ghi số bản vào mục 1 và đổi trạng thái đầu trang; khi một kênh bắt đầu phát hành store schema 2, kiểm
  N′ đã có trên mọi kênh.
- Khi có đường app → server cho metric: chuyển từng dòng app-only sang server và thêm alert ở thẻ riêng.
