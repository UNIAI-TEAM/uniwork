# G6-02 — Spike upstream và hợp đồng façade UniWork AI

> **Trạng thái:** in-progress

Issue UNI-1364 (parent UNI-635), plan `docs/superpowers/plans/2026-10-12-office-g5-g6-g7.md` v2.6 §5.4 thẻ G6-02,
spec `docs/superpowers/specs/2026-10-02-office-g5-g6-g7-design.md` v1.2 §6.2, §8, §13.1. Nhánh
`feature/UNI-1364-g6-02-upstream-spike`, base `b6a0f4150`. Mọi số trích code dưới đây đọc tại `b6a0f4150` trừ khi ghi
SHA khác.

Báo cáo này **đề xuất**; nó không phải hợp đồng. Giá trị chốt đi vào `docs/office/g5g6g7/contract-p0.md` (X-01) khi
G6-D1 được ký. X-01 chưa có lúc viết: mọi giá trị lấy từ plan/spec được ghi **"draft, pending X-01"**.

Upstream dev: **configured per `~/.codex/config.toml` customlocal (spec §8.4)**. Báo cáo không ghi base URL, host, IP,
cổng hay khóa của nó. Chỉ dữ liệu tổng hợp đi qua upstream dev.

## 1. Tóm tắt

Spike chạy một vòng tool call → tool-result → trả lời qua provider openai-compatible có sẵn, trên `fake` (không mạng)
và trên upstream dev, rồi đề xuất mọi số và quyết định thẻ G6-02 liệt kê. Kết luận chính:

- Façade v1 là **SSE một chunk** trên `Gateway.Complete` (không thêm method stream); adapter fork phải chịu cả stream
  thật để v1.1 bật mà không đổi client.
- Provider mở rộng **trong kiểu có sẵn**: `ToolCall.ID`, message role `tool` mang `ToolCallID`, message `assistant`
  mang `ToolCalls`, cùng nằm trên `Message.Parts` của PR #219 (§4.9).
- Hội thoại phía server ở **Postgres**, nội dung mã hóa bằng `util/secretbox` (AES-256-GCM), TTL nhàn rỗi 30 phút.
- OQ-P2: tài liệu UniWork trên desktop gọi **route phiên có tài liệu trên path**
  `POST /api/v1/documents/{documentID}/ai/uniwork/chat/completions`; scope đến từ path + phiên, không từ body (§5).
- Route UniWork AI **miễn `LoadShed` theo mẫu route** (vẫn giữ body deadline) và có trần đồng thời riêng.
- Run id và conversation id đi bằng **header** (`X-UniWork-AI-Run`, `X-UniWork-AI-Conversation`); call bị lọc báo
  bằng object `x_uniwork`, `finish_reason` giữ giá trị chuẩn.
- Run/usage là **hạ tầng AI** (`Ai*` queries), không vào `audit_coverage_test.go`.

### Proposed G6-D1 values

"Ký" = người/nhóm đóng giá trị đó theo plan §3 (G6-D1: AI Platform + owner F; G6-D2: người dùng; G7-D1: QA + Product +
OPS). Cột bằng chứng trỏ tới mục chi tiết ở §4.

| # | Quyết định | Giá trị đề xuất | Bằng chứng | Ký |
| --- | --- | --- | --- | --- |
| 1 | `ModelPolicy` `office_uniwork_ai` | `Default`: `anthropic` → `claude-opus-5`, `openai` → `gpt-4o`, `fake` → `fake`, **không có `ollama`** (không hỗ trợ vòng tool → capability không cấu hình); `MaxTokens` 4096; `Temperature` 0; dev: `AI_MODEL_OFFICE_UNIWORK_AI` = model từ `/v1/models` (pending W1 measurement) | §4.1 | AI Platform + owner F |
| 2 | Trần token instruction pack | ≤ 2000 token cho phần chung + đoạn module lớn nhất (phần chung ≤ 800, mỗi đoạn module ≤ 1200) | §4.2 | AI Platform + Product (G6-14 *hitl*) |
| 3 | Trần vòng tool / lượt model mỗi run | 8 vòng tool-result, 10 lượt gọi model mỗi run (lượt đầu + 8 vòng + 1 dự phòng); vượt → `run_limit_reached` | §4.3 | AI Platform + owner F |
| 4 | Nhóm rate limit `ai-uniwork` | 60 req/phút theo danh tính (bucket riêng, không chung `ai-byok`) | §4.4 | AI Platform |
| 5 | Số lần chờ 429 tối đa mỗi run | 3; mức kẹp `Retry-After` 300 giây (EXPERIENCE OQ-UX2) | §4.5 | owner F + Product |
| 6 | Trần body / tool-result | body: giữ `maxJSONBody` 1 MiB (không override); mỗi tool-result ≤ 64 KiB; tổng tool-result một request ≤ 256 KiB; vượt → 413 `ai_tool_result_too_large` ("workbook quá lớn") | §4.6 | AI Platform + owner F |
| 7 | Ngân sách lịch sử/token | đầu vào mỗi lượt model ≤ 48 000 token ước lượng (system + lịch sử + tool-result); cắt lượt cũ nhất theo cặp nguyên vẹn; giữ tối đa 20 lượt người dùng | §4.7 | AI Platform |
| 8 | Hình dạng mở rộng provider | `ToolCall{ID, Name, Input}`; `Message{Role: user\|assistant\|tool, Content, Parts, ToolCalls, ToolCallID}`; `CompletionResponse.UsagePresent`; `ai.Request.Turns` (đã có id) thay cho câu user cuối khi lượt là tool-result; openai/anthropic/fake cài, ollama từ chối rõ (test W1 `aadf0daa5`, cài đặt `bcca72643`) | §4.8 | AI Platform |
| 9 | Kho hội thoại phía server | Postgres, 2 bảng mới (`ai_uniwork_conversations`, `ai_uniwork_turns`), nội dung mã hóa `secretbox` AES-256-GCM, TTL nhàn rỗi 30 phút, hạn tuyệt đối 24 giờ, 20 lượt | §4.9, §5 | AI Platform + G6-D2 (dữ liệu thật) |
| 10 | OQ-P2 | route phiên có tài liệu trên path, kiểm quyền tài liệu mỗi request, dọn theo sự kiện + kiểm lười + TTL | §5 | AI Platform + Lead F |
| 11 | `LoadShed` + đồng thời | miễn `LoadShed` theo mẫu route (giữ `setBodyDeadline`); trần mỗi pod 32 lượt đang chạy, toàn hệ thống 64 (lease Redis), mỗi tổ chức 8; vượt → 429 `Retry-After: 5` | §4.10 | AI Platform; số mặc định G7-D1 |
| 12 | Run id | header `X-UniWork-AI-Run` (server cấp ở response đầu, client gửi lại); conversation id header `X-UniWork-AI-Conversation`; thêm cả hai vào CORS `AllowedHeaders`/`ExposedHeaders` | §4.11 | AI Platform + owner F |
| 13 | Wire extension | object `x_uniwork` ở response/chunk cuối: `dropped_tool_calls[{index, name, reason: view_only\|not_allowlisted}]`, `step`, `limit`; `finish_reason` giữ giá trị chuẩn (`tool_calls`/`stop`/`length`), không thêm `tool_not_allowed` | §4.12 | owner F + AI Platform |
| 14 | Streaming v1 | SSE một chunk (một chunk `chat.completion.chunk` đầy đủ + `[DONE]`); stream thật là v1.1 sau khi có `Provider.Stream` | §4.13 | AI Platform + owner F |
| 15 | Entitlement | dùng lại `office.ai_cloud` — **đã quyết (U-13)**, không migration | §4.14 | đã ký (U-13) |
| 16 | Run/usage | hạ tầng AI: `ai_usage_events` + bảng run qua `Ai*`; không audit, không outbox; usage thiếu → `reason_code = usage_unknown` + metric | §4.15 | AI Platform |
| 17 | Ứng viên upstream production | bảng §6 (vendor API có ZDR, cloud hyperscaler theo region, self-host) | §6 | người dùng (G6-D2) |

## 2. Phương pháp spike

Code spike thuộc worker `worker-g6-ai_server_spike` (W1) trên cùng nhánh; báo cáo này chỉ đọc commit của nó.

| Chế độ | Lệnh | Mạng | Dữ liệu |
| --- | --- | --- | --- |
| fake (AC-1) | `bash scripts/office/ai-upstream-spike.sh fake` (đặt `AI_PROVIDER=fake`, `SPIKE_MODE=fake`) | không | tool call xác định của `provider.Fake` |
| dev (AC-2) | `source scripts/office/ai-upstream-spike-env.sh` rồi `bash scripts/office/ai-upstream-spike.sh dev`; script env đọc `base_url` + `env_key` của `[model_providers.customlocal]` và export `OPENAI_BASE_URL`/`OPENAI_API_KEY` không in giá trị; model qua `SPIKE_MODEL` hoặc `AI_MODEL_OFFICE_UNIWORK_AI`; dev bị từ chối nếu thiếu một trong ba. Giá trị configured per `~/.codex/config.toml` customlocal (spec §8.4) | có, chỉ máy dev | fixture tổng hợp |

Commit spike: `aadf0daa5` (test hình dạng), `bcca72643` (provider), `544907c3b` (harness
`server/internal/ai/provider/upstream_spike_test.go`, gắn cờ `SPIKE_MODE=fake|dev`; mọi chuỗi ghi ra đi qua
`spikeRedact` nên base URL, host và khóa thành `<upstream>`), `e568fe149` (wrapper + helper env). Wrapper ghi JSON + bản
tóm tắt + log chạy vào thư mục báo cáo của lane và trả exit code của test.

Vòng đo (theo brief lane): (1) request đầu khai một công cụ tổng hợp (ví dụ `sum_range` trên bảng số giả), model trả
`tool_calls[].id`; (2) request thứ hai gửi message `tool` với đúng `tool_call_id`; (3) model trả lời cuối. Đo: id còn
nguyên hai chiều, `usage` có hay thiếu, probe `stream: true` thô (số chunk, delta tool call, chunk usage cuối), latency
p50/p95 trên ≥ 10 lần, tên model lấy từ `/v1/models`. Harness là test Go gắn cờ môi trường trong
`server/internal/ai/provider` — package duy nhất được mở kết nối model (`TestProviderSDKOnlyInAIProvider`).

Kết quả lưu ngoài repo ở `reports/g6-ai_server/` của lane (smoke fake: `spike-smoke.json`; dev: pending W1 measurement
`w1-spike-report.md`, `ac2-dev-run-1.json`).

## 3. Kết quả đo

Cột fake lấy từ smoke `spike-smoke.json` (2026-10-12T10:07:36Z, 3 vòng). Cột upstream dev: pending W1 measurement
(`w1-spike-report.md` + `ac2-dev-run-1.json`).

| Đo | fake | upstream dev |
| --- | --- | --- |
| Model (từ `/v1/models`) | `fake` (fake không có `/v1/models`) | pending W1 measurement |
| Vòng có tool call | 3/3 | pending |
| `tool_calls[].id` response → `CompletionResponse` → `tool_call_id` request (hai chiều) | ok 3/3, câu trả lời nhắc lại id 3/3, không call thừa ở lượt 2 | pending |
| `usage` non-stream (lượt 1 / lượt 2) | có 3/3 / có 3/3 | pending |
| `usage` khi stream (`stream_options.include_usage`) | n/a | pending |
| Stream: số chunk, id trên delta tool call đầu, chunk usage cuối, `finish_reason` | n/a | pending |
| `finish_reason` / `stop_reason` thấy được | `tool_calls`, `end_turn` | pending |
| Latency p50 / p95 (lượt 1, lượt 2, cả vòng) | 0 ms (trong bộ nhớ) | pending |

## 4. Quyết định

### 4.1 `ModelPolicy` của `office_uniwork_ai`

**Đề xuất (draft, pending X-01):** `CapOfficeUniworkAI Capability = "office_uniwork_ai"` với
`ModelPolicy{Default: officeUniwork, MaxTokens: 4096, Temperature: 0}`, trong đó `officeUniwork` = `flagship` bỏ khóa
`ollama`.

Bằng chứng và lý do:
- `policy.go:44-56` — mọi capability hiện có dùng `flagship`/`fast`; `CapAgentPlanning` và `CapMediaAnalysis` đã
  dùng 4096 (`policy.go:51,55`); Ask UNI dùng 1500 (`policy.go:46`), quá thấp cho câu trả lời có bảng hoặc chuỗi tool
  call nhiều tham số. 4096 là trần đầu ra mỗi lượt model, không phải ngân sách cả run (§4.7).
- `policy.go:77-80` — provider không có default → `errPolicy`. Bỏ `ollama` khỏi `Default` làm
  `ResolveModel(office_uniwork_ai, "ollama", …)` lỗi, nên điều kiện "UniWork AI có cấu hình" (spec §8.1) sai và
  `tools.chat`/grant `uniwork_ai` không bật trên deployment ollama — đúng với G6-13 "ollama từ chối rõ".
- Model chọn bằng override có sẵn `AI_MODEL_OFFICE_UNIWORK_AI` (`policy.go:84`), phải nằm trong `allowedModels`
  (`policy.go:61-65`) hoặc `AI_MODEL_ALLOW` (`config.go:34-38`). Dev: tên model lấy từ `/v1/models` của upstream dev,
  thêm vào `AI_MODEL_ALLOW` (pending W1 measurement: tên model).
- `Temperature: 0` theo spec §8.1; `openai.go:48` và `anthropic.go:30` chỉ gửi `temperature` khi > 0, tức upstream dùng
  mặc định của nó. **Giữ hành vi đó** (không gửi `temperature: 0` tường minh): lớp openai-compatible của Anthropic trả 400
  cho `temperature` < 1 trên Claude 4.7+ (notes-upstream-candidates §3), nên gửi tường minh sẽ làm hỏng một ứng viên
  G6-D2. Giá trị temperature/max_tokens client gửi luôn bị façade bỏ qua (fork gửi `temperature: 0.3`,
  `protocols/openai-compatible.ts:199`); server sở hữu policy.

### 4.2 Trần token của instruction pack

**Đề xuất (draft, pending X-01):** tổng phần chung + đoạn module lớn nhất ≤ **2000 token** (ước lượng bằng bộ đếm của
G6-14; phần chung ≤ 800, mỗi đoạn module ≤ 1200).

Lý do: spec §7.2 cấm chép bảng công cụ vào pack vì schema đã đi qua `tools` của request (`openai.go:84-92`); pack chỉ
mang vai trò, luật dữ liệu không tin cậy (`prompt.go:12` `UntrustedFooter`), quy tắc hỏi lại, năm dạng kết quả và
quy tắc riêng của module (XLSX: sheet/range/locale/rounding/recalc). 2000 token giữ system prompt dưới ~4% ngân sách
đầu vào 48 000 (§4.7), để chỗ cho schema công cụ của module (bảng G6-01 chưa có; nếu schema một module vượt 8000 token
thì G6-14 báo lại để giảm ngân sách lịch sử, không nới trần pack). G6-14 test "số token của pack + đoạn lớn nhất ≤
trần".

### 4.3 Trần vòng tool và lượt model mỗi run

**Đề xuất (draft, pending X-01):** mỗi run tối đa **8 request tool-result** và **10 lượt gọi model** (đếm ở server
theo run id). Vượt → `run_limit_reached`, "Hỏi tiếp" mở run mới trong cùng conversation (plan G6-03b).

Lý do: một tác vụ XLSX điển hình là đọc vùng → tính → ghi → kiểm lại (4 vòng); 8 cho gấp đôi chỗ cho sửa sai. 10 lượt
model = 1 lượt đầu + 8 vòng + 1 dự phòng cho request bị upstream từ chối giữa chừng mà client gửi lại cùng bước. 429 do
limiter UniWork trả **không** đếm (request không tới Gateway); 429/5xx của upstream có đếm vì Gateway đã ghi dòng usage
(`gateway.go:135` insert `pending` trước khi gọi provider). Mỗi lượt model là một dòng `ai_usage_events` có tính credit
(spec §6.2). Vòng agent của fork tự dừng ở `DEFAULT_MAX_TURNS = 100` (`packages/agent-core/src/loop.ts:89`), nên
trần server (10) luôn tới trước và fork chưa có hành vi cho `run_limit_reached` (G6-05 thêm). Fork tự gửi lại cùng
request trong ba trường hợp — stream rỗng (2 lần, `loop.ts:965-985`), stream đứt giữa tham số công cụ (1 lần,
`loop.ts:342-343`), lỗi trần `max_tokens` (1 lần, `output-cap.ts:38-55`) — mỗi lần là một lượt model ở server; lượt
"dự phòng" trong số 10 dành cho chúng (notes-fork-adapter §5). Số thật cho latency mỗi lượt: pending W1 measurement; nếu p95 một lượt > 20 giây thì 10 lượt vượt 3 phút
và cần xem lại cùng G7-D1.

### 4.4 Rate limit nhóm `ai-uniwork`

**Đề xuất (draft, pending X-01):** `mw.RateLimitByIdentityBucket(d.Redis, "ai-uniwork", 60, time.Minute, proxies,
<identity>)`, một bucket cho cả route phiên, route phiên có tài liệu (§5) và mount frame.

Bằng chứng: các nhóm AI hiện có ở `router.go:149-154` (frame) và `router.go:170-171` (phiên): `ai-byok` 60/phút,
`ai-cloud` 20/phút, `ai-credentials` 30/phút; bucket khóa theo tên nhóm nên `{orgID}`/`{documentID}` không nhân ngân
sách (ADR 0029 D6, `ratelimit.go:100-118`). 60/phút cho một run đủ 10 lượt chạy xong trong 10 giây mà không chạm
limiter (test plan G6-03b "một run đủ trần vòng không chạm limiter"), và cho phép khoảng 6 run nối tiếp mỗi phút mỗi
người. Limiter toàn cục 300/phút theo bearer (`router.go:81`) không chạm. Lưu ý cho G6-03b: limiter toàn cục khóa theo
`bearerUser`; request mang frame token không phải bearer nên rơi về IP — G6-03b đổi khóa sang danh tính token
(user + document) như plan ghi.

### 4.5 Số lần chờ 429 tối đa mỗi run

**Đề xuất (draft, pending X-01):** **3** lần chờ mỗi run; mức kẹp `Retry-After` **300 giây**. Đây là đề xuất của
EXPERIENCE.md (OQ-UX2, `docs/office/g5g6g7/ux/EXPERIENCE.md:496,1006`), G6-02 xác nhận. Server luôn gửi `Retry-After`
bằng giây trên 429 của nó (`ratelimit.go:160` đã làm cho limiter; trần đồng thời §4.10 cũng phải làm). 429 của upstream
được chuyển thành 429 có `Retry-After` của server (giá trị upstream nếu đọc được, kẹp 300; thiếu → 30), không bao giờ
là 502. Phía fork đây là việc mới: đường desktop không đọc `Retry-After` ở đâu cả, 429 kết thúc lượt bằng lỗi
`overloaded`; web parse `retryAfterSec` (`web/modules/shared/ai/errors.ts:121-127`) nhưng không ai chờ theo nó
(notes-fork-adapter §5). G6-05 cài vòng chờ trước khi lỗi được ném (`protocols/openai-compatible.ts:206-210`).

### 4.6 Trần body và tool-result

**Đề xuất (draft, pending X-01):**
- Body route: **giữ `maxJSONBody` 1 MiB** (`server/internal/handler/json.go:15`), không override. Lý do: adapter fork
  chỉ gửi câu hỏi mới + tool-result + id (plan G6-05), không gửi lịch sử, nên body không lớn dần theo hội thoại.
- Mỗi tool-result ≤ **64 KiB** (UTF-8, sau khi decode JSON); tổng tool-result một request ≤ **256 KiB**. Vượt → 413 mã
  `ai_tool_result_too_large` (client hiện "workbook quá lớn", plan G6-03a luật 4); mã mới thêm qua
  `server/internal/handler/dto/sdo/error_class.go` (X-03).
- Câu hỏi người dùng ≤ 8000 ký tự (cùng bậc `maxLength` 4000 của công cụ đám mây ở `dto/sdi/ai_cloud.go`, gấp đôi
  vì câu hỏi Office hay dán bảng nhỏ).

64 KiB ≈ 16 000 token ước lượng: một tool-result lớn nhất vẫn để chỗ cho system + lịch sử trong 48 000 (§4.7); tổng
256 KiB vượt ngân sách lượt đó nên server cắt lịch sử cũ trước, rồi mới từ chối nếu chính tool-result mới vượt ngân
sách (từ chối có mã, không cắt giữa tool-result).

### 4.7 Ngân sách lịch sử và token

**Đề xuất (draft, pending X-01):** mỗi lượt model, đầu vào ước lượng (system + transcript + tool-result mới) ≤
**48 000 token**; khi vượt, server bỏ **lượt cũ nhất theo khối nguyên vẹn** (một câu hỏi người dùng cùng mọi assistant
tool call và tool-result của nó — không bao giờ để tool-result mồ côi, vì openai-compatible từ chối `tool` không có
`tool_calls` đứng trước). Giữ tối đa **20 lượt người dùng** trong kho; lượt 21 đẩy lượt cũ nhất ra.

Lý do: Ask UNI giữ 6 message (`askuni.go:92`, cắt ở `askuni.go:245-246`) vì nó tự nạp nguồn mỗi câu; lượt Office cần
nhiều hơn vì "Hỏi tiếp" phải thấy các bước trước (plan G6-03a luật 7). 48 000 vừa trong cửa sổ 128k của các model
`flagship` với dư cho `MaxTokens` 4096 và schema công cụ. Bộ ước lượng dùng cùng quy tắc ký tự/4 mà `provider.Fake`
dùng (`fake.go:34`) cho test xác định; số thật lấy từ `usage.prompt_tokens` của lượt trước khi upstream trả (pending W1
measurement: upstream dev có trả `usage` không).

### 4.8 Hình dạng mở rộng provider (tool-call id + tool-result)

Khoảng trống tại base: `ToolCall` chỉ có `Name`/`Input` (`provider.go:52-55`); `Message` có `Role`
user/assistant, `Content`, `Parts` (`provider.go:23-30`); `oaiToolCall` không có `id` (`openai.go:39-44`) và
`Complete` bỏ id khi đọc response (`openai.go:115-117`); không có message role `tool`; anthropic bỏ `ToolUseBlock.ID`
(`anthropic.go:76-77`) và gửi mọi message assistant thành một text block (`anthropic.go:34-38`); `ai.Request` chỉ nhận
`History` + một câu user cuối render từ prompt (`gateway.go:56`, `gateway.go:143-144`).

**Đề xuất (draft, pending X-01; đã cài trên nhánh spike ở `bcca72643`, `server/internal/ai/provider/provider.go`):**

```go
type ToolCall struct {
	ID    string          // vendor id, carried unchanged both ways
	Name  string
	Input json.RawMessage
}

type Message struct {
	Role       string     // "user" | "assistant" | "tool"
	Content    string
	Parts      []Part     // PR #219 media, user messages only
	ToolCalls  []ToolCall // assistant turn that asked for tools
	ToolCallID string     // role "tool": the call this result answers
}

type CompletionResponse struct {
	// ...existing fields...
	UsagePresent bool // false when the vendor sent no usage block (unknown, not zero)
}
```

Test hợp đồng của W1 (commit `aadf0daa5`, `server/internal/ai/provider/provider_test.go`) chốt đúng hình dạng này:
`TestOpenAIToolResultLoop` (id `call_abc` từ response đi lại thành `tool_calls[].id` của assistant phát lại và
`tool_call_id` của message `tool`, arguments giữ nguyên), `TestOpenAIUsageAbsent` (thiếu `usage` →
`UsagePresent = false`, không phải 0), `TestFakeToolLoop` (fake trả một call có id rồi trả lời khi thấy kết quả),
`TestAnthropicToolResultLoop` (`tool_use.id` hai chiều; message `tool` thành block `tool_result` trên lượt user kế),
`TestOllamaRefusesToolMessages` (`ErrUnsupported`).

| Provider | Gửi | Nhận |
| --- | --- | --- |
| `openai.go` | assistant: `tool_calls[{id, type:"function", function{name, arguments}}]`; tool: `{role:"tool", tool_call_id, content}` | `choices[0].message.tool_calls[].id` → `ToolCall.ID` |
| `anthropic.go` | assistant: `tool_use{id, name, input}` block (+ text nếu có); tool: user message chứa `tool_result{tool_use_id, content}`. Spike cài **mỗi message `tool` thành một user message riêng**; với nhiều call song song trong một lượt, Messages API cần mọi `tool_result` ngay sau lượt assistant — G6-13 gộp các message `tool` liên tiếp vào một user message và thêm test hai call song song | `ToolUseBlock.ID` → `ToolCall.ID` |
| `fake.go` | ghi lại `Last` như hiện có | chế độ kịch bản: lượt 1 trả `ToolCall{ID:"call_fake_1", …}`, lượt có message `tool` khớp id trả lời cuối và nhắc lại id (`TestFakeToolLoop`) |
| `ollama.go` | message có `ToolCalls`/role `tool` → `ErrUnsupported` | — |

`ai.Request` thêm `Turns []provider.Message` (transcript đã có id, do service dựng từ kho §4.9): khi `Turns` khác rỗng,
Gateway dùng `Turns` thay cho `History` + câu user render, giữ nguyên đường cũ cho Ask UNI/tóm tắt (golden prompt không
đổi). `Response.ToolCalls` mang id. Gateway giữ nguyên `auditToolCalls` (`gateway.go:214-228`) nhưng thêm chế độ
**lọc** cho façade (§4.12): call ngoài allowlist bị bỏ khỏi `Response.ToolCalls`, ghi vào `Response.Dropped`, cột
`tool_calls` của dòng usage vẫn ghi `allowed:false`; chế độ mặc định (Ask UNI) vẫn fail `ErrToolNotAllowed`
(`gateway.go:171-176`).

### 4.9 Kho hội thoại phía server

**Đề xuất (draft, pending X-01):**

| Mục | Giá trị |
| --- | --- |
| Nơi lưu | **Postgres**: `ai_uniwork_conversations` (id ULID, `organization_id`, `workspace_id` NULL được — route phiên không tài liệu, `user_id`, `document_id` NULL được, `module`, `device_id` NULL được, `created_by` + `created_by_kind`, `last_used_at`, `expires_at`) và `ai_uniwork_turns` (id, `organization_id`, `conversation_id`, `run_id`, `seq`, `role` user/assistant/tool, `ciphertext`, `usage_event_id`, `created_at`); migration `999<ms>_ai_uniwork_conversations`, index `CONCURRENTLY` mỗi file một câu, không FK |
| Mã hóa | nội dung lượt (câu hỏi, câu trả lời, tool call input, tool-result) mã hóa `server/internal/util/secretbox` AES-256-GCM như kho khóa (ADR 0029 D2); khóa riêng `AI_CONVERSATION_KEY` (base64 32 byte, `.env.example`), không dùng chung `AI_CREDENTIAL_KEY` để lộ một khóa không lộ cả hai; thiếu khóa → UniWork AI coi như chưa cấu hình (`tools.chat` false), fail closed |
| TTL nhàn rỗi | **30 phút** kể từ `last_used_at` (≥ 300 giây kẹp `Retry-After` + thời gian một run tối đa ≈ 10 lượt × 60 giây timeout `AI_TIMEOUT_SECONDS` (`config.go:28-33`) = 600 giây; 1800 > 900) |
| Hạn tuyệt đối | 24 giờ kể từ `created_at` (transcript chứa nội dung chưa lưu, spec §8.3) |
| Lượt giữ | 20 lượt người dùng (§4.7) |
| Dọn | worker TTL đăng ký vào chuỗi shutdown của `server/cmd/server/main.go` (plan §4), xóa theo lô; consumer outbox cho `document.deleted`, `member.removed`, `member.left`, `member.deactivated` (`docs/events/CATALOGUE.md:127-164`); kiểm lười ở mỗi request (§5); đăng xuất xóa conversation của phiên không tài liệu; "hội thoại mới" xóa conversation cũ của cùng (user, document, module); `office_ai_uniwork` tắt cho tổ chức → worker xóa theo `organization_id` ở vòng kế và request mới bị từ chối |
| Lịch sử lệch với client | fork xóa khỏi lịch sử của nó mọi lượt của run lỗi (`rollbackFailedRun`, `loop.ts:645-650`); server làm cùng: run kết thúc bằng lỗi (không có câu trả lời assistant cuối) thì các lượt của run đó **không** vào transcript dùng cho run sau, nên model và panel thấy cùng một lịch sử. Server không bao giờ đọc lịch sử client gửi |
| Tenant | `organization_id TEXT NOT NULL`; query `Ai*` có `organization_id = $n` hoặc `-- tenant:`; hàng trong `TestIsolationMatrix` |
| Metric | `uniwork_ai_uniwork_conversations_swept_total{reason}`, gauge số conversation sống; runbook mục "UniWork AI transcript" |

Vì sao Postgres, không Redis:
- Redis là tùy chọn trong deployment này: rate limit chỉ có khi có Redis và fail-open (CLAUDE.md › Backend HTTP Rules,
  `ratelimit.go:60`), `/readyz` không gate Redis. Hội thoại mất khi Redis khởi động lại là lỗi người dùng thấy
  (`conversation_expired` hàng loạt), còn với rate limit thì chỉ là mất ngân sách.
- Dọn theo tài liệu/thành viên cần truy vấn theo `document_id`/`user_id`; Redis cần index phụ tự quản.
- Luật tenant (`TestNewTablesCarryOrganizationID`, `TestEveryQueryNamesItsTenant`, `TestIsolationMatrix`) phủ bảng
  Postgres tự động; Redis nằm ngoài các test đó.
- Có tiền lệ: `ai_conversations`/`ai_messages` của Ask UNI ở Postgres (`server/migrations/092_ai_gateway.up.sql:51-70`).

Vì sao không dùng lại `ai_conversations`/`ai_messages`: `workspace_id NOT NULL` (route phiên không tài liệu thuộc tổ
chức, không workspace), không có `document_id`/`module`, `role` chỉ `user`/`assistant` (CHECK ở `092:65`), nội dung
plaintext, không TTL; sửa chúng là đổi hợp đồng Ask UNI. Bảng mới tách rõ vòng đời.

### 4.10 `LoadShed` và trần đồng thời

**Đề xuất (draft, pending X-01; số mặc định do G7-D1 chốt):**
- Route UniWork AI **miễn `mw.LoadShed`**, miễn **theo mẫu route** (ba mẫu: `/api/v1/orgs/{orgID}/ai/uniwork/chat/completions`,
  `/api/v1/documents/{documentID}/ai/uniwork/chat/completions`, `/api/v1/office-frame/documents/{documentID}/ai/uniwork/chat/completions`),
  không theo tiền tố, và nhánh miễn **vẫn gọi `setBodyDeadline`**.
- Trần riêng: **32 lượt đang chạy mỗi pod**, **64 toàn hệ thống** (lease Redis có hạn = timeout lượt + 10 giây), **8
  mỗi tổ chức** (toàn hệ thống qua Redis; không Redis thì 8 mỗi pod). Vượt → 429 `ai_uniwork_busy` + `Retry-After: 5`.

Bằng chứng: `loadshed.go:21-49` — miễn chỉ bằng so khớp path chính xác (`exempt[r.URL.Path]`) hoặc WebSocket, và nhánh
miễn gọi thẳng `next` nên bỏ `setBodyDeadline` (`loadshed.go:32-35` so với `:39`); router đặt `HTTPMaxInFlight` mặc
định 128 (`config.go:295`, `router.go:116`). Một lượt UniWork AI giữ slot suốt thời gian model trả lời (timeout 60 giây,
`config.go:28`); 128 người hỏi cùng lúc sẽ làm mọi request khác nhận 503 `server_busy` — trái plan G6-03a "lượt UniWork
AI không bao giờ làm `LoadShed` cắt request khác". 32/pod = 25% của 128, nên kể cả khi tắt miễn trừ vẫn còn 96 slot cho
phần còn lại. Trần tổ chức 8 giữ một tổ chức lớn không ăn hết 64.

### 4.11 Run id: header hay body

**Đề xuất (draft, pending X-01):** **header**. Response đầu của run trả `X-UniWork-AI-Run: <ULID>` và
`X-UniWork-AI-Conversation: <ULID>`; request tool-result và câu hỏi tiếp gửi lại hai header đó. Server bỏ qua mọi id
trong body.

Lý do: body giữ đúng openai-compatible (`messages`, `tools`, `stream`), nên adapter fork dùng lại bộ dựng body sẵn có
và chỉ thêm header; SSE gửi header trước chunk đầu nên id có ngay cả khi stream bị cắt giữa chừng; id do server cấp,
không bao giờ lấy từ input người dùng hoặc model (spec §8.2). Việc kèm theo: thêm hai header vào CORS `AllowedHeaders`
(`router.go:95`) và `ExposedHeaders` (`router.go:111`), nếu không frame web không đọc được id.

Kiểm ở fork (notes-fork-adapter §3): header đi ra có tiền lệ `opencodeSessionHeaders(baseUrl, cb.sessionId)`
(`packages/ai-provider/src/providers.ts:18-25`, chèn ở `protocols/openai-compatible.ts:179-184`), và proxy web chỉ bỏ
`authorization`/`x-api-key`/`x-goog-api-key`/`user-agent` (`web/modules/shared/ai/transport.ts:29-37`), nên header
tự đặt đi qua. Đọc header trả về **chưa có**: `StreamCallbacks` không có hook header (`protocols/shared.ts:253-265`) —
G6-05 thêm một `onResponseHeaders` (~10-20 dòng). Trường body thì `bodyExtras` tĩnh theo endpoint
(`registry.ts:17-28`), phải đục thêm tham số qua `streamForProvider` và `runTurn` web — xâm lấn hơn. Header thắng.
`cb.sessionId` của fork là id theo transport, không theo tài liệu, nên **không** dùng làm conversation id; conversation
id luôn do server cấp.

### 4.12 Wire extension `x_uniwork` hay `finish_reason`

**Đề xuất (draft, pending X-01):** object mở rộng **`x_uniwork`** ở response không stream và ở chunk cuối (trước
`[DONE]`) của SSE:

```json
"x_uniwork": {
  "dropped_tool_calls": [{"index": 1, "name": "delete_sheet", "reason": "view_only"}],
  "step": 3,
  "limit": 8
}
```

`reason` ∈ `view_only` (công cụ ghi có trong bảng module nhưng quyền hiện tại chỉ xem — luật 6) | `not_allowlisted`
(không có trong allowlist module). `step`/`limit` là số vòng tool đã dùng và trần (§4.3). `finish_reason` giữ giá trị
chuẩn: `tool_calls` nếu còn ít nhất một call hợp lệ, ngược lại `stop`; **không** thêm `tool_not_allowed`.

Lý do: client openai-compatible chuẩn bỏ qua trường lạ ở top-level nhưng xử lý `finish_reason` lạ không đồng nhất
(nhiều SDK coi là lỗi hoặc dừng vòng agent); một lượt có thể vừa có call hợp lệ vừa có call bị bỏ, điều một giá trị
`finish_reason` không diễn được. Server lọc trước khi tới client (spec §6.2) nên call bị bỏ không bao giờ có trong
`tool_calls`. Ở stream thật (v1.1) delta tool call được giữ theo index tới khi biết tên (plan G6-03a). Panel map
`view_only` → `aiErrViewOnlyEdit`, `not_allowlisted` → `aiErrUnsupported` (plan G6-05u).

Kiểm ở fork (notes-fork-adapter §4): object top-level lạ bị parser bỏ qua ở cả SSE và JSON
(`protocols/openai-compatible.ts:250-266`, `:81-92`), nên `x_uniwork` an toàn; `finish_reason` lạ bị nuốt im lặng khi
lượt đã có nội dung và thành lỗi "model returned no content" khi lượt rỗng (`:312-314`, `:336-338`) — thêm một lý do
không dùng `tool_not_allowed`. Hai bẫy phải tránh: **không bao giờ** dùng khóa `error` cho dữ liệu không fatal (mọi
`event.error` truthy làm hủy lượt, `:267`, `:97`), và giá trị `reason` chỉ là mã (`view_only`, `not_allowlisted`),
không câu chữ. Fork hiện không có chỗ hiển thị call bị bỏ (`StreamCallbacks`, `AiStreamChunk.type`): G6-05 thêm một
loại chunk/callback `notice`, G6-05u vẽ chip.

### 4.13 Streaming thật hay SSE một chunk ở v1

**Đề xuất (draft, pending X-01):** **SSE một chunk** ở v1: khi client gửi `stream: true`, façade trả
`text/event-stream` gồm một `chat.completion.chunk` đầy đủ (role, content, tool_calls có id, `finish_reason`,
`x_uniwork`, `usage`) rồi `data: [DONE]`; `stream: false` trả JSON thường.

Lý do: `provider.Provider` không có method stream (`provider.go:89-93`) và `Gateway.Complete` là một request một
response (`gateway.go:114-204`); stream thật cần method mới ở cả ba provider, lọc tool call theo delta, và chốt usage
khi stream đứt — rủi ro lớn hơn lợi ích khi latency một lượt chưa đo (pending W1 measurement: p50/p95; nếu p50 > 15
giây thì UX "đang nghĩ" của EXPERIENCE `uwTipWaitAiLong` 30 giây phải hiện sớm hơn). Adapter `uniwork` của fork vẫn
phải chịu stream thật (spec §6.2) để v1.1 bật bằng server mà không phát hành lại app. Kết quả probe stream thô của
upstream dev (chunk usage cuối có hay không) quyết định v1.1 có tính credit đúng được không: pending W1 measurement.

Ràng buộc từ fork (notes-fork-adapter §2, §4, uniwork-office `0d03b185`):
- Mỗi phần tử `tool_calls` trong chunk **phải có `index`** (bộ gộp delta khóa theo `tc.index`,
  `protocols/openai-compatible.ts:284-307`; thiếu `index` thì mọi call gộp làm một), cùng `id`, `function.name`,
  `function.arguments` đầy đủ và `finish_reason` trong **cùng** chunk, rồi `[DONE]`.
- Watchdog của fork chờ header tối đa 60 giây, im lặng tối đa 180 giây (`watchdog.ts:8-15`), bằng đúng timeout
  Gateway 60 giây (`config.go:28`). Façade vì vậy **gửi header SSE ngay** khi nhận request (sau kiểm quyền/quota), rồi
  gửi comment keep-alive `: ping` mỗi 15 giây cho tới khi có chunk.
- Luôn trả SSE khi client gửi `stream: true` (fork luôn gửi `stream: true`): đường JSON của fork quét **mọi chuỗi** trong
  body và ném `AiCreditsError` khi gặp cụm như "credit … exhausted/balance" (`throwIfCreditsNotice`,
  `protocols/shared.ts:352-382`), nên một câu trả lời về bảng tính có chữ "credit balance" sẽ thành lỗi tín dụng giả.
  SSE không bị quét. Usage trong chunk vô hại: fork không đọc `usage` (notes §2).

### 4.14 Entitlement

**Đã quyết (U-13):** dùng lại `office.ai_cloud`; `chat` là một công cụ cloud, grant `uniwork_ai` của frame đọc cùng
khóa (spec §8.2). Không migration, không khóa mới. Bằng chứng: ADR 0029 D5 (`office.ai_cloud` cho mọi công cụ đám mây,
đọc qua `EntitlementService.Can`, fail-closed). G6-02 không mở lại quyết định này.

### 4.15 Run/usage: business state hay hạ tầng AI

**Đề xuất (draft, pending X-01):** **hạ tầng AI**. Usage tiếp tục là `ai_usage_events` qua `AiInsertUsageEvent` /
`AiFinishUsageEvent` (`server/pkg/db/queries/ai.sql:5,12`); bộ đếm run (`ai_uniwork_runs`: id, `organization_id`,
`conversation_id`, `model_calls`, `tool_rounds`, `waits`, `expires_at`) và kho hội thoại (§4.9) đọc/ghi bằng query
`Ai*` từ `internal/service/ai_uniwork.go`. Không thêm action vào `server/internal/service/audit_coverage_test.go`,
không sự kiện outbox mới ngoài `ai.usage.updated` có sẵn (`gateway.go:190-197`, chỉ khi có workspace).

Lý do: lượt UniWork AI không đổi business state — Lưu là thao tác riêng (spec §6.4, plan §4 "một lượt AI không tạo
upload, version hay save intent"). Tiền lệ: Ask UNI tạo/ghi `ai_conversations` mà không audit; trong nhóm AI chỉ
`ai.credential.saved`/`ai.credential.deleted` có audit (`audit_coverage_test.go:1286-1296`, `audit/actions.go:193-194`)
vì đó là bí mật người dùng quản lý. Dấu vết truy ngược đã có trên dòng usage: `prompt_id`, `provider`, `model`,
`tool_calls`, `correlation_id` (spec §8.3).

Usage thiếu: `ai_usage_events.status` chỉ nhận `pending|succeeded|failed|rejected` (`092_ai_gateway.up.sql:38`) và
`openai.go:111-114` đọc `usage` vắng thành 0 token (spike thêm `CompletionResponse.UsagePresent`, §4.8, để Gateway
phân biệt được). Đề xuất G6-03b: khi `UsagePresent` false, dòng là
`succeeded` + `reason_code = usage_unknown`, không gọi `quota.Record` với 0, tăng
`uniwork_ai_uniwork_usage_unknown_total`, và job đối soát ước lượng sau (không đếm hai lần). Không cần migration đổi
CHECK. Upstream dev có trả `usage` không: pending W1 measurement.

## 5. OQ-P2 — tài liệu UniWork mở trên desktop

Câu hỏi (plan §3): desktop gọi UniWork AI bằng phiên thiết bị, không có frame token; SDI phiên AI không mang
`document_id` (`server/internal/handler/dto/sdi/ai_cloud.go`); spec §6.2 bước 2 nói scope suy từ phiên hoặc frame
token, không từ body.

**Đề xuất (draft, pending X-01):** thêm **route phiên có tài liệu trên path**:

`POST /api/v1/documents/{documentID}/ai/uniwork/chat/completions` — nhóm `authed` (bearer web hoặc desktop,
`RequireAuthWithDevice`), cùng handler façade, cùng bucket `ai-uniwork`, cùng miễn `LoadShed` (§4.10).

Route `/orgs/{orgID}/ai/uniwork/chat/completions` giữ cho file cục bộ chưa bind (S10). Desktop đã biết `documentID` khi
mở tài liệu UniWork (`docs/office/g3g4/uniwork-office-app-api-contract.md` §2: `GET /documents/{documentID}`,
launch bridge), nên adapter chọn route theo việc tài liệu có id UniWork hay không.

Cách conversation buộc tài liệu:
1. Handler đọc `documentID` từ path, user từ phiên; service gọi kiểm quyền tài liệu có sẵn
   (`DocumentService.authorizeDocument(..., DocumentLevelView)`, `server/internal/service/document_access.go:190`) —
   tổ chức và workspace lấy từ tài liệu, không từ client. Không thành viên/không quyền → 404/403 qua `mapServiceError`
   như mọi route tài liệu.
2. Conversation id do server cấp, buộc `(user, org, document, module)`; module lấy từ định dạng lưu của tài liệu (cùng
   cách `OfficeFrameClaims.Module` suy khi mint, `office_frame.go:57-60`), chỉ dùng chọn đoạn instruction pack.
3. Mỗi request so conversation với `(user, org, document, module)` hiện tại; khác → conversation mới (không lỗi);
   conversation đã dọn/hết hạn → `conversation_expired`.

Luật (3) và (6) của G6-03a trên route này:
- **(3)** Run id buộc user + org + document + có hạn (`ai_uniwork_runs.expires_at` = TTL nhàn rỗi); route path cho
  document, nên run id của tài liệu A gửi lên path tài liệu B bị từ chối như run id lạ. Hành vi giống hệt route frame;
  khác biệt duy nhất là nguồn claim (phiên + path thay vì frame token).
- **(6)** Quyền tính lại **mỗi request** (`access.Level` ≥ `DocumentLevelEdit` như `CanEdit` ở `office_frame.go:172`);
  xuống chỉ xem giữa run → request kế bỏ công cụ ghi khỏi allowlist, call ghi model vẫn trả bị lọc với
  `reason: view_only` (§4.12).

Điều kiện dọn (G6-03a) cho conversation có `document_id`:
- `document.deleted` → consumer outbox (`RegisterLane` lane `slow`, vì xóa trên nhiều bảng theo `document_id`) xóa conversation + turns + run.
- Mất quyền (share/link bị thu, `member.removed`/`left`/`deactivated`) → consumer xóa theo user/org khi có sự kiện;
  phần không có sự kiện riêng (đổi ACL tài liệu) bắt bằng **kiểm lười**: request kế thấy không còn quyền → xóa
  conversation của (user, document) rồi trả 403/404.
- "Hội thoại mới" cho cùng tài liệu, `office_ai_uniwork` tắt cho tổ chức, TTL/hạn tuyệt đối → như §4.9.

Ba test bắt buộc (plan §3, giao G6-03a/G6-05; mọi test dùng `fake`):
1. **Bind trên desktop:** bearer desktop gọi route tài liệu A → conversation có `document_id = A`; câu hỏi tiếp cùng
   conversation thấy lượt trước; cùng conversation id gửi lên path tài liệu B → conversation mới, transcript A không tới
   model.
2. **Quyền xuống chỉ xem trên route phiên:** run đang có công cụ ghi; hạ quyền người dùng xuống xem; request tool-result
   kế không còn công cụ ghi trong `tools` gửi upstream, call ghi do fake trả có trong `x_uniwork.dropped_tool_calls`
   với `reason: view_only`, không có trong `tool_calls`.
3. **Xóa tài liệu → dọn:** xóa tài liệu A (sự kiện `document.deleted` qua dispatcher) → không còn hàng
   `ai_uniwork_conversations`/`turns` của A; request kế với conversation id cũ → `conversation_expired`.

Phương án đã loại: (a) `document_id` trong body/`x_uniwork` của route org — trái spec §6.2 "scope không từ body" và
cần kiểm chéo org; (b) desktop xin frame token rồi gọi route frame — trộn hai danh tính và kéo grant web
(`uniwork_ai`) vào desktop; (c) không bind tài liệu trên desktop — mất luật 3/6 và điều kiện dọn theo tài liệu.

Hệ quả cho G6-03a: thêm một route (`apiOp`, `pathParamSDI` đã có `documentID`), một hàng isolation tự phủ vì path
mang tenant row; cập nhật `uniwork-office-app-api-contract.md` §3.

## 6. Ứng viên upstream production cho G6-D2

Nguồn: `reports/g6-ai_server/notes-upstream-candidates.md` (W3), chỉ tài liệu công khai, đọc 2026-10-12. Đây là dữ
kiện, không phải khuyến nghị: G6-D2 là quyết định của người dùng. "unverified" = W3 không xác nhận được từ trang đã đọc.

| Ứng viên | Hosting / region | Retention mặc định | Tắt log nội dung? | ZDR / hợp đồng | Khớp provider có sẵn | Nguồn |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI API | xử lý + lưu ở US/EU/UAE; Singapore **chỉ lưu, không xử lý** trong vùng | log giám sát lạm dụng ≤ 30 ngày; không train từ 2023-03-01 | ZDR hoặc Modified Abuse Monitoring sau khi sales duyệt | vùng ngoài US cần MAM/ZDR + Modified Retention amendment; giá vùng +10% với model từ 2026-03-05 | `openai.go` nguyên trạng (đổi `OPENAI_BASE_URL`) | https://developers.openai.com/api/docs/guides/your-data |
| Azure OpenAI (Foundry) | theo geography của resource; Global/DataZone có thể xử lý ngoài geography; Southeast Asia: khả dụng model **unverified** | không lưu prompt/completion trong model; mẫu bị gắn cờ vào kho giám sát lạm dụng, thời hạn **unverified** | xin "modified abuse monitoring" (Limited Access); kiểm `ContentLogging = false` | DPA Microsoft; không train | API mặt OpenAI; đường dẫn/khóa Azure cần kiểm với `openai.go` (unverified) | https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy , https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/abuse-monitoring |
| Anthropic API | `inference_geo` chỉ `global`/`us`; **không có vùng châu Á** | xóa trong 30 ngày (ngoại lệ vi phạm chính sách) | ZDR theo thỏa thuận với sales, theo tổ chức | không train dữ liệu thương mại | dùng `anthropic.go` (Messages API gốc); lớp openai-compatible được Anthropic ghi "không sẵn sàng production" | https://privacy.claude.com/en/articles/7996866 , https://privacy.claude.com/en/articles/8956058 , https://platform.claude.com/docs/en/manage-claude/data-residency |
| Google Vertex AI (Gemini) | `asia-southeast1` có Gemini; endpoint global không bảo đảm vùng | cache trong bộ nhớ 24 giờ (tắt được theo project); log giám sát lạm dụng | logging request-response tắt mặc định; ZDR = xin ngoại lệ + tắt cache | không train | endpoint openai-compatible có tools/stream/usage, nhưng auth OAuth hết hạn 1 giờ — **không khớp** `OPENAI_API_KEY` tĩnh nếu không có proxy làm mới token | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance , https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations |
| AWS Bedrock | `ap-southeast-1`: Claude 5.5 chỉ cross-region global (xử lý có thể rời Singapore) | mặc định không lưu input/output; một số model giữ traffic bị gắn cờ (hoặc toàn bộ, Claude Fable) ≤ 30 ngày | `data_retention_mode = none` theo vùng/tài khoản; model đòi mức cao hơn thì không dùng được | ZDR từng model qua account manager | Chat Completions `bedrock-runtime …/openai/v1`; round trip `tool_call_id` **unverified**; không có `GET /models` | https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html , https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions.html |
| Tự host vLLM + model open-weight | nơi ta đặt (DC FPT/Viettel ở Việt Nam có; năng lực 2026 **unverified**) | do ta cấu hình; vLLM không log request mặc định, prompt chỉ ở DEBUG | có, ta kiểm soát | không có vendor; giấy phép weights **unverified** (chưa chọn model) | `/v1/chat/completions` openai-compatible; tools cần `--enable-auto-tool-choice` + parser; usage stream cần `--enable-force-include-usage`/`stream_options` | https://docs.vllm.ai/en/latest/features/tool_calling/ , https://docs.vllm.ai/en/latest/cli/serve/ |

Ghi chú cho G6-D2:
- **Pháp lý (không phải tư vấn luật):** Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 và Nghị định 356/2025/NĐ-CP hiệu lực
  2026-01-01; gửi nội dung tài liệu khách hàng tới upstream ngoài Việt Nam là chuyển dữ liệu cá nhân xuyên biên giới
  (hồ sơ đánh giá tác động, Bộ Công an xem xét). Chỉ phương án tự host tại Việt Nam tránh được việc chuyển này.
  Nguồn tóm tắt: EY Vietnam legal alert 03/2026, Vietnam Briefing (W3 §7; văn bản gốc chưa đọc).
- Ứng viên phải nói được tool calling với id hai chiều (§4.8) và trả `usage` (§4.15); bộ đo của W1 chạy lại được trên
  ứng viên được chọn chỉ bằng biến môi trường.
- Việc còn cần người/vendor trả lời: W3 §8 (khả dụng model ở Đông Nam Á của Azure/Bedrock, quy trình ZDR từng vendor,
  sizing GPU tự host, DPIA/CTIA).

Tiêu chí G6-D2 (spec §8.3, §13.1): nội dung chưa lưu tới upstream; phải có retention và tắt log nội dung chứng minh
được trước dữ liệu thật; tương thích openai-compatible với tool calling (để chỉ đổi `OPENAI_BASE_URL`, spec §8.1) hoặc
anthropic (provider có sẵn).

## 7. Ảnh hưởng tới adapter `uniwork` phía fork

Nguồn: `reports/g6-ai_server/notes-fork-adapter.md` (W3, đọc uniwork-office tại pin `0d03b185`, chỉ đọc). Đường dẫn
dưới đây tương đối với gốc fork.

| Điểm | Hiện trạng ở fork | Việc cho G6-05 |
| --- | --- | --- |
| Tool-call id hai chiều | đã nói `role:'tool'` + `tool_call_id` và gửi lại đúng id đọc từ response (`protocols/openai-compatible.ts:46-74`); **thiếu id thì tự sinh UUID** (`:122`, `:287-292`) | server luôn trả `id` cho mọi tool call; server từ chối `tool_call_id` không thuộc run (luật 2) — UUID tự sinh sẽ bị từ chối, đúng ý |
| Gửi lịch sử | vòng agent gửi **toàn bộ** `history` mỗi lượt (`agent-core/src/loop.ts:904-921`, tối đa 40 message) | adapter tự cắt: run mới = message `user` cuối; vòng tool = các message `tool` sau assistant cuối (§4.6 giữ body nhỏ nhờ việc này) |
| Run id / conversation id | header ra có tiền lệ (`providers.ts:18-25`); không có hook đọc header về (`protocols/shared.ts:253-265`) | thêm `onResponseHeaders`; `cb.sessionId` không phải conversation id (§4.11) |
| SSE một chunk / JSON | chịu cả một chunk đủ + `finish_reason`, thiếu `[DONE]` vẫn được (`:242-332`); chịu JSON khi `stream:true` (`shared.ts:329-337`) | server luôn có `index` trong `tool_calls`, header SSE sớm + keep-alive (§4.13) |
| `x_uniwork` | bị bỏ qua, không lỗi; chưa có chỗ hiển thị | thêm chunk/callback `notice` + chip (G6-05u) |
| 429 / `Retry-After` | desktop không đọc; web parse nhưng không chờ | vòng chờ tối đa 3 lần, kẹp 300 giây (§4.5) |
| Trần run | client 100 lượt; tự gửi lại 3 trường hợp | xử lý `run_limit_reached` (§4.3) |
| Provider không khóa | handler main của docs/sheets/slides **từ chối provider không có `apiKey`** (`apps/docs/src/main/docs-main.ts:3842`, `apps/slides/src/main/ai-ipc.ts:182`, `apps/sheets/src/main/sheets-main.ts:3743,3779`); pdf/html/markdown chưa định vị handler | G6-05 sửa handler main của mọi module, không chỉ `packages/ai-provider` |
| Web | `toProxyRequest` chỉ nhận URL `/byok/…` (`web/modules/shared/ai/transport.ts:45-87`); `proxyConfig` cứng `byok` (`stream.ts:68-79`); `WEB_PROVIDER_IDS` và `settings()` chỉ dựng từ khóa BYOK đã lưu (`web-ai.ts:71-73`, `:359-409`) | đường riêng cho `…/ai/uniwork/chat/completions` và mục provider không khóa |
| Seam cloud | `UNIWORK_CLOUD_TOOLS` chưa có `chat` (`uniwork-cloud.ts:17-26`) | thêm `chat` (plan G6-05) |
| Usage | fork không đọc `usage` | không đổi; usage hoàn toàn ở server (G6-03b) |
| Lỗi có sẵn của fork | `throwIfCreditsNotice` quét toàn body JSON (`protocols/shared.ts:352-382`) | báo upstream/sửa ở fork; façade tránh bằng SSE (§4.13) |

Phạm vi sửa ở fork (notes §6): `packages/ai-provider/src/{types,providers,registry,stream,uniwork-cloud,fetch,ai-notice}.ts`,
`protocols/{openai-compatible,shared}.ts` (hoặc `protocols/uniwork.ts` mới), handler `ai:stream` của từng app,
`packages/ui` (picker, logo), `web/modules/shared/ai/*`, map capability web và khóa frame `uniworkAi` (thay đổi hai repo,
spec §3 bất biến 9). Sự kiện `aiRun` (X-02) chưa có ở pin này.

## 8. Rủi ro và việc còn mở

| Rủi ro / việc | Ảnh hưởng | Xử lý đề xuất |
| --- | --- | --- |
| Upstream dev không trả `usage` | credit tính sai | `usage_unknown` + đối soát (§4.15); pending W1 measurement |
| `temperature` không gửi khi 0 (`openai.go:48`) | upstream dùng mặc định riêng, kết quả kém xác định | chấp nhận ở v1 (gửi tường minh làm Claude qua lớp compat trả 400, §4.1); G6-08 đo độ ổn định trên dev set |
| Schema công cụ module lớn | ăn ngân sách 48 000 | G6-01 đo kích thước schema; G6-14 báo nếu > 8000 token |
| Khóa `AI_CONVERSATION_KEY` mới | thêm secret phải quản lý | ADR 0029 Hệ quả: secret manager; không có xoay khóa v1, đổi khóa = mọi transcript thành `conversation_expired` (chấp nhận được vì TTL 30 phút) |
| Lease Redis đồng thời | không Redis → chỉ trần mỗi pod | chấp nhận (plan G6-03a); số chốt ở G7-D1 |
| Gateway một provider cho cả server (spec §8.1) | đổi upstream UniWork AI đổi luôn Ask UNI | ngoài v1, cần ADR |
| Số trong bảng tóm tắt | chưa ký | G6-D1 (AI Platform + owner F), G7-D1 cho trần đồng thời |

Việc còn mở trong báo cáo: §3 (số đo W1), §4.8 (SHA commit W1).

## 9. Tham chiếu

- Plan `docs/superpowers/plans/2026-10-12-office-g5-g6-g7.md` §3, §4, §5.4 (G6-02, G6-13, G6-03a, G6-03b, G6-03c,
  G6-14, G6-05).
- Spec `docs/superpowers/specs/2026-10-02-office-g5-g6-g7-design.md` §6.1, §6.2, §7.2, §8, §10, §12, §13.1.
- `docs/adr/0029-ai-cua-office-tren-web-qua-ai-gateway.md` (D2, D3, D5, D6, D9).
- `docs/office/g5g6g7/ux/EXPERIENCE.md` (429, OQ-UX2).
- `docs/office/g3g4/uniwork-office-app-api-contract.md` §2, §3.
- Code: `server/internal/ai/{gateway,policy,config,errors,tools,prompt,cloud}.go`,
  `server/internal/ai/provider/{provider,openai,anthropic,fake}.go`, `server/internal/middleware/{loadshed,ratelimit}.go`,
  `server/internal/handler/router/router.go`, `server/internal/handler/ai_mount.go`,
  `server/internal/service/{office_frame,document_access,askuni}.go`, `server/pkg/db/queries/ai.sql`,
  `server/migrations/092_ai_gateway.up.sql`, `server/internal/service/audit_coverage_test.go`.
- Báo cáo lane: `.uniwork-dev/office-g5g6g7/reports/g6-ai_server/` — `w1-spike-report.md`, `ac2-dev-run-1.json`,
  `notes-fork-adapter.md`, `notes-upstream-candidates.md` (ngoài repo).
