# G6-02 — Spike upstream và hợp đồng façade UniWork AI

> **Trạng thái:** shipped

Issue UNI-1364 (parent UNI-635), plan `docs/superpowers/plans/2026-10-12-office-g5-g6-g7.md` v2.6 §5.4 thẻ G6-02,
spec `docs/superpowers/specs/2026-10-02-office-g5-g6-g7-design.md` v1.2 §6.2, §8, §13.1. Nhánh
`feature/UNI-1364-g6-02-upstream-spike`, base `b6a0f4150`. Mọi số trích code dưới đây đọc tại `b6a0f4150` trừ khi ghi
SHA khác.

Báo cáo này **đề xuất**; nó không phải hợp đồng. X-01 `docs/office/g5g6g7/contract-p0.md` đã được người dùng ký ngày
2026-10-12 (U-15, "duyệt theo gợi ý") và ràng buộc báo cáo này (đã merge vào nhánh ở `a24444620`). Quy ước đọc:
- Giá trị contract-p0 đã chốt (route AI, cờ, mã lỗi, biến môi trường dev, thứ tự migration, entitlement) được viết đúng như
  contract-p0 và ghi **"contract-p0 §n"**.
- Phần contract-p0 không phủ (hình dạng wire, trần số, kho hội thoại, route phiên có tài liệu…) là **đề xuất G6-D1**; giá
  trị chỉ chốt khi người dùng ký G6-D1 ở lô ký #2 (contract-p0 §2, §11), rồi được ghi vào contract-p0.
- Chỗ báo cáo từng nói khác contract-p0 đã sửa theo contract-p0 và liệt kê ở §8.1.

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
- Façade v1 **gọi upstream trước, mở response sau**: mọi lỗi trước byte đầu là status HTTP thật (429 + `Retry-After`
  giây, 502, 504…), chờ upstream kẹp 55 giây (tính từ lúc request tới) dưới watchdog 60 giây của fork, không bao giờ trả
  stream rỗng (§4.5, §4.13).
- Frame kết thúc sau header `x_uniwork.terminal` **ký ngay ở G6-D1** với trạng thái "dành sẵn: server không bao giờ phát
  ở v1"; G6-05 đọc nó từ v1 (test `fake`), nên stream thật v1.1 bật chỉ bằng server, không phát hành lại app (§4.13).
- Đo (§3, hai lần AC-2 trên upstream dev, 10 vòng mỗi lần): id tool call đi hai chiều 10/10 cả hai lần, `usage` có ở
  20/20 lượt và ở chunk cuối khi stream; cả vòng p50 3096 / 3300 ms, p95 **12 702** / 5182 ms (lần 1 / lần 2; p95 trên
  10 mẫu là mẫu chậm nhất, nên một lượt chậm của upstream dev dùng chung quyết định nó). Mọi trần/timeout dựa trên lần
  xấu hơn (lần 1). `fake` đi hai chiều 10/10. `/v1/models` 2472 tên, `gpt-6-luna` có trong danh sách (lần 2,
  `model_in_list`).

### Proposed G6-D1 values

Cột "Ký" ghi vai soạn/đồng sở hữu giá trị (AI Platform = lead `g6-ai_server`, owner F = lead F, contract-p0 §2); **người
ký là người dùng**: G6-D1 qua lô ký #2 từ báo cáo này, G6-D2 khi lên production, G7-D1 ở lô #3 (contract-p0 §2, §11).
Cột bằng chứng trỏ tới mục chi tiết ở §4. Dòng nào đã có trong contract-p0 ghi nguồn ngay trong ô.

| # | Quyết định | Giá trị đề xuất | Bằng chứng | Ký |
| --- | --- | --- | --- | --- |
| 1 | `ModelPolicy` `office_uniwork_ai` | `Default`: `anthropic` → `claude-opus-5`, `openai` → `gpt-4o`, `fake` → `fake`, **không có `ollama`** (không hỗ trợ vòng tool → capability không cấu hình); `MaxTokens` 4096; `Temperature` 0; dev: `AI_MODEL_OFFICE_UNIWORK_AI` = `gpt-6-luna` + thêm vào `AI_MODEL_ALLOW` (đã chạy 2 × 20 lượt; có trong 2472 tên của `/v1/models`, `model_in_list` lần 2, §3 ghi chú 1) | §4.1 | AI Platform + owner F |
| 2 | Trần token instruction pack | ≤ 2000 token cho phần chung + đoạn module lớn nhất (phần chung ≤ 800, mỗi đoạn module ≤ 1200) | §4.2 | AI Platform + Product (G6-14 *hitl*) |
| 3 | Trần vòng tool / lượt model mỗi run | 8 vòng tool-result, 10 lượt gọi model mỗi run (lượt đầu + 8 vòng + 1 dự phòng); vượt → `run_limit_reached` (contract-p0 §4 chốt 429, không `error_class`; **đề xuất đổi sang 409** trước khi X-03 phát hành, Q2 ở §8.1, vì fork xếp mọi 429 là "AI bận"); client kết thúc run, không chờ lại | §4.3, §7 | AI Platform + owner F |
| 4 | Nhóm rate limit `ai-uniwork` | 60 req/phút theo danh tính (bucket riêng, không chung `ai-byok`) | §4.4 | AI Platform |
| 5 | Số lần chờ 429 tối đa mỗi run | 3; mức kẹp `Retry-After` 300 giây (EXPERIENCE OQ-UX2) | §4.5 | owner F + Product |
| 6 | Trần body / tool-result | body: giữ `maxJSONBody` 1 MiB (không override); mỗi tool-result ≤ 64 KiB; tổng tool-result một request ≤ 256 KiB; vượt → 413 `ai_tool_result_too_large` ("workbook quá lớn"; mã **chưa có** trong bảng contract-p0 §4, đề xuất thêm, §8.1) | §4.6 | AI Platform + owner F |
| 7 | Ngân sách lịch sử/token | đầu vào mỗi lượt model ≤ 48 000 token ước lượng (system + lịch sử + tool-result); cắt lượt cũ nhất theo cặp nguyên vẹn; giữ tối đa 20 lượt người dùng | §4.7 | AI Platform |
| 8 | Hình dạng mở rộng provider | `ToolCall{ID, Name, Input}`; `Message{Role: user\|assistant\|tool, Content, Parts, ToolCalls, ToolCallID}`; `CompletionResponse.UsagePresent`; `ai.Request.Turns` (đã có id) thay cho câu user cuối khi lượt là tool-result; openai/anthropic/fake cài, ollama từ chối rõ (test W1 `aadf0daa5`, cài đặt `bcca72643`) | §4.8 | AI Platform |
| 9 | Kho hội thoại phía server | Postgres, 2 bảng mới (`ai_uniwork_conversations`, `ai_uniwork_turns`), nội dung mã hóa `secretbox` AES-256-GCM, TTL nhàn rỗi 30 phút, hạn tuyệt đối 24 giờ, 20 lượt; migration G6-03a = contract-p0 §5 hàng 4 (điều kiện "G6-02 chọn Postgres" thỏa bằng đề xuất này); hết hạn → `conversation_expired` 409 (contract-p0 §4) | §4.9, §5 | AI Platform + G6-D2 (dữ liệu thật) |
| 10 | OQ-P2 | route phiên có tài liệu trên path (route thứ ba, ngoài hai route UniWork AI của contract-p0 §3), kiểm quyền tài liệu mỗi request, dọn theo sự kiện + kiểm lười + TTL | §5 | AI Platform + Lead F |
| 11 | `LoadShed` + đồng thời | miễn `LoadShed` theo mẫu route (giữ `setBodyDeadline`); trần mỗi pod 32 lượt đang chạy, toàn hệ thống 64 (lease Redis), mỗi tổ chức 8; vượt → 429 `ai_uniwork_busy` + `Retry-After: 5` (mã chưa có trong contract-p0 §4, §8.1) | §4.10 | AI Platform; số mặc định G7-D1 |
| 12 | Run id | header `X-UniWork-AI-Run` (server cấp ở response đầu, client gửi lại); conversation id header `X-UniWork-AI-Conversation`; thêm cả hai vào CORS `AllowedHeaders`/`ExposedHeaders` | §4.11 | AI Platform + owner F |
| 13 | Wire extension | object `x_uniwork` ở response/chunk cuối: `dropped_tool_calls[{index, name, reason: view_only\|not_allowlisted}]`, `step`, `limit`, `terminal` (dành sẵn, hàng 14); `finish_reason` giữ giá trị chuẩn (`tool_calls`/`stop`/`length`), không thêm `tool_not_allowed` | §4.12 | owner F + AI Platform |
| 14 | Streaming v1 | SSE một chunk (một chunk `chat.completion.chunk` đầy đủ + `[DONE]`); header 200 chỉ gửi **sau** khi biết câu trả lời upstream, nên mọi lỗi là status HTTP thật (429 + `Retry-After` giây, 502, 504); deadline 55 giây tính từ lúc request tới, phủ cả việc trước upstream và lượt gọi upstream (< watchdog 60 giây của fork); không bao giờ 200 với stream rỗng; stream thật là v1.1 sau khi có `Provider.Stream`. Frame kết thúc sau header `"x_uniwork": {"terminal": {"code", "retry_after"}}` + `[DONE]` ký ngay: **dành sẵn, server không bao giờ phát ở v1**; G6-05 đọc nó từ v1 (test `fake`: terminal 429 sau một chunk → chờ ở vòng lặp agent-core, khởi động lại lượt, cùng run id, không lặp văn bản một phần; terminal 502 → lỗi, không gửi lại kiểu stream rỗng) | §4.5, §4.13 | AI Platform + owner F |
| 15 | Entitlement | dùng lại `office.ai_cloud` — **đã quyết (U-13; contract-p0 §11)**, không migration (contract-p0 §5 hàng 6) | §4.14 | đã ký (U-13) |
| 16 | Run/usage | hạ tầng AI: `ai_usage_events` + bảng run qua `Ai*`; không audit, không outbox; usage thiếu → `reason_code = usage_unknown` + metric | §4.15 | AI Platform |
| 17 | Ứng viên upstream production | bảng §6 (vendor API có ZDR, cloud hyperscaler theo region, self-host) | §6 | người dùng (G6-D2) |

## 2. Phương pháp spike

Code spike thuộc worker `worker-g6-ai_server_spike` (W1) trên cùng nhánh; báo cáo này chỉ đọc commit của nó.

| Chế độ | Lệnh | Mạng | Dữ liệu |
| --- | --- | --- | --- |
| fake (AC-1) | `bash scripts/office/ai-upstream-spike.sh fake` (đặt `AI_PROVIDER=fake`, `SPIKE_MODE=fake`) | không | tool call xác định của `provider.Fake` |
| dev (AC-2) | `source scripts/office/ai-upstream-spike-env.sh` rồi `bash scripts/office/ai-upstream-spike.sh dev`; script env đọc `base_url` + `env_key` của `[model_providers.customlocal]` và export `OPENAI_BASE_URL`/`OPENAI_API_KEY` không in giá trị; model qua `SPIKE_MODEL` hoặc `AI_MODEL_OFFICE_UNIWORK_AI`; dev bị từ chối nếu thiếu một trong ba. Giá trị configured per `~/.codex/config.toml` customlocal (spec §8.4) | có, chỉ máy dev | fixture tổng hợp |

Tên biến môi trường khớp contract-p0 §8: máy dev đặt `AI_PROVIDER=openai`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`,
`AI_MODEL_ALLOW` và `AI_MODEL_OFFICE_UNIWORK_AI`; cloud runner/CI/unit test dùng `AI_PROVIDER=fake` và không đặt biến
nào còn lại (chế độ fake của wrapper làm đúng như vậy). Giá trị luôn theo `~/.codex/config.toml` `[model_providers.customlocal]`.

Commit spike: `aadf0daa5` (test hình dạng), `bcca72643` (provider), `544907c3b` (harness
`server/internal/ai/provider/upstream_spike_test.go`, gắn cờ `SPIKE_MODE=fake|dev`; mọi chuỗi ghi ra đi qua
`spikeRedact` nên base URL, host và khóa thành `<upstream>`), `e568fe149` (wrapper + helper env), `85bca4171` (giới hạn danh sách model harness giữ: giới hạn đọc 1 MiB cũ cắt cụt JSON
của `/v1/models`, xem §3 ghi chú 1), `d9049f79c` (`model_in_list` + `model_name_count` tính trên **toàn bộ** danh sách
trước khi cắt mẫu 200 tên). Wrapper ghi JSON + bản tóm tắt + log chạy vào thư mục báo cáo của lane và trả exit
code của test.

Vòng đo (theo brief lane): (1) request đầu khai một công cụ tổng hợp (`get_cell` trên một sheet giả, `upstream_spike_test.go:37-40`), model trả
`tool_calls[].id`; (2) request thứ hai gửi message `tool` với đúng `tool_call_id`; (3) model trả lời cuối. Đo: id còn
nguyên hai chiều, `usage` có hay thiếu, probe `stream: true` thô (số chunk, delta tool call, chunk usage cuối), latency
p50/p95 trên ≥ 10 lần, tên model lấy từ `/v1/models`. Harness là test Go gắn cờ môi trường trong
`server/internal/ai/provider` — package duy nhất được mở kết nối model (`TestProviderSDKOnlyInAIProvider`).

Kết quả lưu ngoài repo ở `reports/g6-ai_server/` của lane (dev: `ac2-dev-run-1.{json,txt,log}` và
`ac2-dev-run-2.{json,txt,log}`; bản ghi bằng chứng của W1: `w1-spike-report.md`).

## 3. Kết quả đo

Cột fake: lần chạy `bash scripts/office/ai-upstream-spike.sh fake` với `SPIKE_LOOPS=10`, exit 0, không mạng
(`w1-spike-report.md` §2 #5, §4). Upstream dev: **hai lần AC-2**, cùng model, cùng fixture, 10 vòng mỗi lần, cả hai
`--- PASS: TestUpstreamSpike`:
- **Lần 1** — `ac2-dev-run-1.{json,txt,log}`, bắt đầu 2026-10-12T10:24:36Z, harness `85bca4171`, 48,65 giây.
- **Lần 2** — `ac2-dev-run-2.{json,txt,log}`, bắt đầu 2026-10-12T10:34:43Z, harness `d9049f79c`, 40,58 giây
  (`w1-spike-report.md` §2 #6b).

Trước lần 1 còn một lượt thử 10:21:54Z (harness `544907c3b`, cả vòng p50 3310 / p95 7073 ms) mà artifact bị lần 1 ghi
đè; nó chỉ nằm trong lịch sử của `w1-spike-report.md` §4 và không dùng làm bằng chứng. Mọi file ở thư mục báo cáo lane,
ngoài repo.

| Đo | fake | upstream dev lần 1 | upstream dev lần 2 |
| --- | --- | --- | --- |
| Model | `fake` | `gpt-6-luna` (`SPIKE_MODEL`, ghi chú 1) | `gpt-6-luna` |
| `GET /v1/models` | n/a | HTTP 200, **2472 tên**, giữ mẫu 200 tên | HTTP 200, 2472 tên, **`model_in_list: true`** |
| Vòng có tool call | 10/10 | 10/10 | 10/10 |
| id hai chiều (`tool_calls[].id` → `CompletionResponse` → `tool_call_id` request được upstream nhận) | ok 10/10 | **ok 10/10, lỗi 0** | **ok 10/10, lỗi 0** |
| Câu trả lời nhắc lại id | 10/10 | 0/10 (ghi chú 3) | 0/10 |
| Call thừa ở lượt 2 | 0 | 0 | 0 |
| `usage` non-stream (lượt 1 / lượt 2) | có 10/10 / 10/10 | **có 10/10 / 10/10** | **có 10/10 / 10/10** |
| Token prompt lượt 1 / lượt 2 | 24 / 10 (ước lượng) | **2637 / 2682** (cả 10 vòng; ghi chú 2) | 2637 / 2682 |
| Token completion lượt 1 / lượt 2 | n/a | 19 / 10–11 | 19 / 10–11 |
| `finish_reason` thấy được | `tool_calls`, `end_turn` | `tool_calls`, `stop` | `tool_calls`, `stop` |
| Stream thô (`stream: true` + `stream_options.include_usage`) | n/a | HTTP 200, 8 chunk, có delta tool call, **id có ngay trên delta đầu**, **có chunk usage cuối**, `finish_reason` `tool_calls` | giống lần 1 |
| Latency lượt 1 p50 / p95 | 0 ms | 1488 / 3127 ms | 1676 / 3816 ms |
| Latency lượt 2 (tool-result) p50 / p95 | 0 ms | 1732 / **9819** ms | 1475 / 1971 ms |
| Latency cả vòng p50 / p95 | 0 ms | 3096 / **12 702** ms | 3300 / 5182 ms |
| Lỗi / 429 | không | không (20 call) | không (20 call) |

**Vì sao hai lần lệch.** p50 ổn định (cả vòng 3096 vs 3300 ms, lượt 1 1,5 vs 1,7 giây), chỉ p95 lệch. Harness tính
percentile theo nearest rank (`spikePercentile`, `upstream_spike_test.go:587-601`): với 10 mẫu, p95 = mẫu thứ 10, tức
**mẫu chậm nhất**. p95 lượt 2 của lần 1 (9819 ms, gấp 5 lần lần 2) vì vậy là **một** lượt tool-result chậm, kéo p95 cả
vòng lên 12 702 ms; lần 2 không có lượt nào như thế. Upstream dev là proxy dùng chung, tải của người khác quyết định
đuôi; 10 mẫu không đủ để ước lượng đuôi ổn định. Quy tắc của báo cáo: **mọi trần và timeout dựa trên lần xấu hơn
(lần 1)** — lượt chậm nhất đã thấy 9,8 giây, cả vòng chậm nhất 12,7 giây — và G6-08/G7-D1 đo lại với nhiều mẫu hơn.

Ghi chú:
1. Brief yêu cầu tên model lấy từ `/v1/models`. Lượt thử 10:21:54Z đọc được status 200 nhưng không có tên nào vì giới
   hạn đọc 1 MiB cắt cụt JSON; `85bca4171` đọc tới 8 MiB (lần 1 đọc được 2472 tên, mẫu 200 tên đầu theo thứ tự chữ đều
   dạng `cl/<hãng>/<model>`, không chứa `gpt-6-luna`), và `d9049f79c` tính `model_in_list` trên **toàn bộ** danh sách
   trước khi cắt mẫu. Lần 2: `model_in_list: true`, `model_name_count: 2472`. Cùng với bằng chứng âm (model sai trả 404,
   `SPIKE_MODEL=no-such-model-uni1364`, `w1-spike-report.md` §2 #7), giá trị dev ở §4.1 thỏa contract-p0 §8 ("chọn từ
   `/v1/models`").
2. Prompt của harness chỉ là một câu + một công cụ, không system prompt (`upstream_spike_test.go:37-41`), tức vài chục
   token, nhưng upstream dev báo 2637 token đầu vào ổn định ở cả hai lần: upstream dev **cộng thêm ~2,6k token** của
   riêng nó (system prompt phía proxy hoặc tương đương). Hệ quả cho quota/usage: `usage.prompt_tokens` của upstream
   **không** phải tín hiệu chi phí trung thực của nội dung UniWork — dòng `ai_usage_events` và `quota.Record` (§4.15) sẽ
   tính cả phần overhead mà người dùng không gửi. Dev: chấp nhận, chỉ dùng cho dev; G6-13/G6-03b ghi `prompt_tokens` của
   upstream nguyên trạng (không trừ đoán) nhưng ngân sách lịch sử (§4.7) so với ước lượng của UniWork; production: G7-D1
   đo overhead của ứng viên G6-D2 (§6) bằng cùng harness trước khi chốt cost/run.
3. Model thật không nhắc lại id trong câu trả lời: id sống sót qua giao thức 10/10 (cả hai lần) nhưng chỉ `fake` nhắc
   lại nó. Test muốn thấy id quay về phải đọc `tool_calls[].id`, không đọc văn bản trả lời; id có ngay trên delta tool
   call đầu của stream, nên façade stream (v1.1) khóa theo nó được.
4. Adapter `openai.go` hiện **không gửi trường `stream`** (thân request không có khóa này). Một model của upstream dev
   (`deepseek-4.1`) coi việc thiếu `stream` là `stream:true` và trả thân SSE; với `stream:false` tường minh nó trả JSON
   `finish_reason: stop` **không có tool call**. `gpt-6-luna` theo mặc định và trả `tool_calls`. Hệ quả cho **G6-13**:
   adapter openai phải **luôn gửi `stream` tường minh** (`false` ở đường `Complete`), không dựa vào mặc định của upstream;
   chọn model dev cho `AI_MODEL_OFFICE_UNIWORK_AI` là quyết định có hậu quả, và mỗi ứng viên G6-D2 chạy lại harness để
   kiểm tool call với `stream:false` (`w1-spike-report.md` §5.1).

## 4. Quyết định

### 4.1 `ModelPolicy` của `office_uniwork_ai`

**Đề xuất G6-D1.** Tên capability `office_uniwork_ai`, biến `AI_MODEL_OFFICE_UNIWORK_AI` + `AI_MODEL_ALLOW` và việc enum
chưa có capability này (G6-13 thêm) đã ghi ở contract-p0 §8; giá trị policy là đề xuất:
`CapOfficeUniworkAI Capability = "office_uniwork_ai"` với
`ModelPolicy{Default: officeUniwork, MaxTokens: 4096, Temperature: 0}`, trong đó `officeUniwork` = `flagship` bỏ khóa
`ollama`.

Bằng chứng và lý do:
- `policy.go:44-56` — mọi capability hiện có dùng `flagship`/`fast`; `CapAgentPlanning` và `CapMediaAnalysis` đã
  dùng 4096 (`policy.go:51,55`); Ask UNI dùng 1500 (`policy.go:46`), quá thấp cho câu trả lời có bảng hoặc chuỗi tool
  call nhiều tham số. 4096 là trần đầu ra mỗi lượt model, không phải ngân sách cả run (§4.7).
- `policy.go:77-80` — provider không có default → `errPolicy`. Bỏ `ollama` khỏi `Default` làm
  `ResolveModel(office_uniwork_ai, "ollama", …)` lỗi, nên điều kiện "UniWork AI có cấu hình" (spec §8.1) sai và
  `tools.chat`/grant `uniwork_ai` không bật trên deployment ollama — đúng với G6-13 "ollama từ chối rõ". Đề xuất cùng
nhịp: `ai_uniwork` trong route capability app `GET /orgs/{orgID}/office/capabilities` (contract-p0 §3, §4) chỉ true khi
cờ `office_ai_uniwork` bật **và** `ResolveModel` ra được model cho provider đang chạy; deployment `AI_PROVIDER=fake`/`ollama`
không bao giờ báo true cho tổ chức nào (contract-p0 §8, spec §12.3).
- Model chọn bằng override có sẵn `AI_MODEL_OFFICE_UNIWORK_AI` (`policy.go:84`), phải nằm trong `allowedModels`
  (`policy.go:61-65`) hoặc `AI_MODEL_ALLOW` (`config.go:34-38`). Dev: `AI_MODEL_OFFICE_UNIWORK_AI=gpt-6-luna` và
  `AI_MODEL_ALLOW=gpt-6-luna` — model AC-2 đã chạy (hai lần × 10 vòng, id hai chiều 10/10 mỗi lần, §3). Đây là model dev, không
  phải default production; default production đi theo G6-D2. `gpt-6-luna` có trong 2472 tên của `/v1/models`
  (`model_in_list: true`, lần 2, §3 ghi chú 1). Chọn model dev có hậu quả: `deepseek-4.1` không trả tool call
  khi gửi `stream:false` (§3 ghi chú 4), `gpt-6-luna` thì có.
- `Temperature: 0` theo spec §8.1; `openai.go:48` và `anthropic.go:30` chỉ gửi `temperature` khi > 0, tức upstream dùng
  mặc định của nó. **Giữ hành vi đó** (không gửi `temperature: 0` tường minh): lớp openai-compatible của Anthropic trả 400
  cho `temperature` < 1 trên Claude 4.7+ (notes-upstream-candidates §3), nên gửi tường minh sẽ làm hỏng một ứng viên
  G6-D2. Giá trị temperature/max_tokens client gửi luôn bị façade bỏ qua (fork gửi `temperature: 0.3`,
  `protocols/openai-compatible.ts:199`); server sở hữu policy.

### 4.2 Trần token của instruction pack

**Đề xuất G6-D1 (contract-p0 không phủ trần pack):** tổng phần chung + đoạn module lớn nhất ≤ **2000 token** (ước lượng bằng bộ đếm của
G6-14; phần chung ≤ 800, mỗi đoạn module ≤ 1200).

Lý do: spec §7.2 cấm chép bảng công cụ vào pack vì schema đã đi qua `tools` của request (`openai.go:84-92`); pack chỉ
mang vai trò, luật dữ liệu không tin cậy (`prompt.go:12` `UntrustedFooter`), quy tắc hỏi lại, năm dạng kết quả và
quy tắc riêng của module (XLSX: sheet/range/locale/rounding/recalc). 2000 token giữ system prompt dưới ~4% ngân sách
đầu vào 48 000 (§4.7), để chỗ cho schema công cụ của module (bảng G6-01 chưa có; nếu schema một module vượt 8000 token
thì G6-14 báo lại để giảm ngân sách lịch sử, không nới trần pack). G6-14 test "số token của pack + đoạn lớn nhất ≤
trần".

### 4.3 Trần vòng tool và lượt model mỗi run

**Đề xuất G6-D1 (số):** mỗi run tối đa **8 request tool-result** và **10 lượt gọi model** (đếm ở server theo run id).
Vượt → `run_limit_reached`, "Hỏi tiếp" mở run mới trong cùng conversation (plan G6-03b). Mã đã chốt ở contract-p0 §4:
HTTP **429**, không `error_class`, "như `ai_rate_limited`", do X-03 thêm. Hệ quả cho client (G6-05): nếu giữ 429,
vòng chờ §4.5 phải rẽ theo **mã lỗi** — `run_limit_reached` kết thúc run, không có `Retry-After` và không chờ lại; chỉ 429
của limiter, `ai_uniwork_busy` (§4.10) hoặc upstream mới vào vòng chờ. Fork hiện xếp **mọi** 429 là "AI bận" trước khi
ai đọc mã (§7, `overload-error.ts:10-20`, `ai-chat-error.ts:43`; web ném ở `transport.ts:107`), nên báo cáo **khuyến nghị
đổi `run_limit_reached` sang 409** trước khi X-03 phát hành (Q2, §8.1).

Lý do: một tác vụ XLSX điển hình là đọc vùng → tính → ghi → kiểm lại (4 vòng); 8 cho gấp đôi chỗ cho sửa sai. 10 lượt
model = 1 lượt đầu + 8 vòng + 1 dự phòng cho request bị upstream từ chối giữa chừng mà client gửi lại cùng bước. 429 do
limiter UniWork trả **không** đếm (request không tới Gateway); 429/5xx của upstream có đếm vì Gateway đã ghi dòng usage
(`gateway.go:135` insert `pending` trước khi gọi provider). Mỗi lượt model là một dòng `ai_usage_events` có tính credit
(spec §6.2). Vòng agent của fork tự dừng ở `DEFAULT_MAX_TURNS = 100` (`packages/agent-core/src/loop.ts:89`), nên
trần server (10) luôn tới trước và fork chưa có hành vi cho `run_limit_reached` (G6-05 thêm). Fork tự gửi lại cùng
request trong ba trường hợp — stream rỗng (2 lần, `loop.ts:965-985`), stream đứt giữa tham số công cụ (1 lần,
`loop.ts:342-343`), lỗi trần `max_tokens` (1 lần, `output-cap.ts:38-55`) — mỗi lần là một lượt model ở server; lượt
"dự phòng" trong số 10 dành cho chúng (notes-fork-adapter §5). Đo trên upstream dev (§3, prompt nhỏ, lấy lần xấu hơn — lần 1): p50 một lượt 1,5–1,7 giây nên 10 lượt thường ≈ 17
giây; lượt chậm nhất đã thấy 9,8 giây (p95 lượt 2 của lần 1 = mẫu chậm nhất; lần 2 chỉ 2,0 giây), nên trường hợp xấu 10
lượt đều chậm như thế ≈ 100 giây, cộng thời gian công cụ trong renderer — mỗi lượt vẫn dưới trần chờ upstream 55 giây
(§4.13) và cả run vẫn xa TTL §4.9 (1800 giây). Prompt Office thật (instruction pack + schema module + lịch sử) dài hơn nhiều; G6-08 đo lại, và nếu p95 một
lượt > 20 giây thì trần 10 lượt (≈ 3 phút) xem lại cùng G7-D1.

### 4.4 Rate limit nhóm `ai-uniwork`

**Đề xuất G6-D1 (contract-p0 không phủ nhóm này):** `mw.RateLimitByIdentityBucket(d.Redis, "ai-uniwork", 60, time.Minute, proxies,
<identity>)`, một bucket cho cả route phiên, route phiên có tài liệu (§5) và mount frame.

Bằng chứng: các nhóm AI hiện có ở `router.go:149-154` (frame) và `router.go:170-171` (phiên): `ai-byok` 60/phút,
`ai-cloud` 20/phút, `ai-credentials` 30/phút; bucket khóa theo tên nhóm nên `{orgID}`/`{documentID}` không nhân ngân
sách (ADR 0029 D6, `ratelimit.go:100-118`). 60/phút cho một run đủ 10 lượt chạy xong trong 10 giây mà không chạm
limiter (test plan G6-03b "một run đủ trần vòng không chạm limiter"), và cho phép khoảng 6 run nối tiếp mỗi phút mỗi
người. Limiter toàn cục 300/phút theo bearer (`router.go:81`) không chạm. Lưu ý cho G6-03b: limiter toàn cục khóa theo
`bearerUser`; request mang frame token không phải bearer nên rơi về IP — G6-03b đổi khóa sang danh tính token
(user + document) như plan ghi.

**Mã lỗi của limiter (BE2-2).** `RateLimitByIdentityBucket` hôm nay viết cứng thân lỗi
`sdo.NewErrorSDO("rate_limited", "too many requests")` (`server/internal/middleware/ratelimit.go:159-165`); chuỗi
`ai_rate_limited` chỉ có ở đường Ask UNI (`service/askuni.go:105-111` → `ai/errors.go:37`), một limiter khác. G6-05 rẽ
theo mã, nên mã nhận thật phải là mã đã ký. **Khuyến nghị: G6-03b thêm tham số mã vào middleware** (biến thể nhận
`code string`, mặc định giữ `rate_limited` cho mọi nhóm hiện có) và nhóm `ai-uniwork` truyền `ai_rate_limited`, để ba
nguồn 429 của §4.5 (limiter, trần đồng thời `ai_uniwork_busy`, upstream) cùng một họ mã và X-03 chỉ ghi một mã. Test
G6-03b: vượt bucket `ai-uniwork` → thân `code = ai_rate_limited` + `Retry-After`; nhóm khác vẫn `rate_limited`.
Phương án thay: không đổi middleware, ghi mã `rate_limited` ở hàng limiter của §4.5 và G6-05 rẽ theo `rate_limited` —
rẻ hơn nhưng hai mã cho cùng một ý "chờ rồi thử lại"; hỏi Q6 (§8.1).

### 4.5 Số lần chờ 429 tối đa mỗi run

**Đề xuất G6-D1:** **3** lần chờ mỗi run; mức kẹp `Retry-After` **300 giây**. Đây là đề xuất của
EXPERIENCE.md (OQ-UX2, `docs/office/g5g6g7/ux/EXPERIENCE.md:496,1006`), G6-02 xác nhận. Server luôn gửi `Retry-After`
bằng giây trên 429 của nó (`ratelimit.go:160` đã làm cho limiter; trần đồng thời §4.10 cũng phải làm).

**Quy tắc lỗi v1 (một quy tắc, §4.13 dùng đúng nó):** façade gọi upstream **trước** và chỉ mở response (status + header)
khi đã biết câu trả lời upstream. Vì v1 là SSE một chunk / JSON (§4.13), không có gì để gửi sớm, nên mọi lỗi trước byte
đầu luôn là **status HTTP thật với thân JSON** `{code, message}` — không bao giờ là frame lỗi trong một 200:

| Nguồn | HTTP | Mã | `Retry-After` | Fork thấy (pin `0d03b185`) |
| --- | --- | --- | --- | --- |
| Limiter `ai-uniwork` (§4.4) | 429 | `ai_rate_limited` (cần G6-03b thêm tham số mã vào middleware; hôm nay là `rate_limited`, §4.4) | có, giây | vào vòng chờ G6-05 |
| Trần đồng thời (§4.10) | 429 | `ai_uniwork_busy` | `5` | vào vòng chờ G6-05 |
| 429 của upstream | 429 | `ai_rate_limited` | giá trị upstream nếu đọc được, kẹp 300; thiếu → 30 | vào vòng chờ G6-05; **không bao giờ** thành 502 (cần sửa server, xem dưới bảng) |
| Trần run (§4.3) | 429 theo contract-p0; **đề xuất 409** (Q2) | `run_limit_reached` | không | kết thúc run, "Hỏi tiếp" |
| Tool-result quá trần (§4.6) | 413 | `ai_tool_result_too_large` | không | kết thúc run, thông báo theo nền tảng (§4.6) |
| Conversation hết hạn/đã dọn (§4.9) | 409 | `conversation_expired` | không | hội thoại mới |
| Cờ tắt / mất quyền (§4.9, §5) | 403 (JSON, không bao giờ `text/html`, §7) | `office_capability_off` / lỗi quyền tài liệu | không | kết thúc run |
| Upstream 5xx / không kết nối được | 502 | `ai_provider_error` (`server/internal/ai/errors.go:39`) | không | kết thúc run, "Thử lại" |
| Quá deadline 55 giây (§4.13) | 504 | `ai_provider_timeout` (mã mới, không lớp; Q4) | không | kết thúc run, "Thử lại" |

**Hàng "429 của upstream" cần sửa server, chưa có ở base.** Hôm nay provider openai trả lỗi status không 2xx thành chuỗi
`fmt.Errorf("provider: %s → %d: %s", …)` không có kiểu (`server/internal/ai/provider/openai.go:203-208`), và Gateway
gói **mọi** lỗi provider thành `ErrProviderError` 502 (`server/internal/ai/gateway.go:162-169`); ngoài proxy BYOK không
chỗ nào trong `server/internal/ai` đọc 429 hay `Retry-After` của upstream. Việc cần làm:
- **G6-13 (provider):** openai/anthropic trả một lỗi có kiểu mang HTTP status + `Retry-After` (giây, đã parse; thiếu thì
  0), bọc được bằng `errors.As`; `fake` có kịch bản tiêm lỗi đó.
- **G6-03a (Gateway/façade):** rẽ theo lỗi có kiểu **trước** `ErrProviderError.wrap` ở `gateway.go:169` — status 429 →
  `ai_rate_limited` 429 + `Retry-After` (kẹp 300, thiếu → 30); mọi status khác vẫn 502 như bảng. Dòng usage vẫn
  `failed` như hôm nay (lượt có đếm, §4.3).
- **Test** (`AI_PROVIDER=fake`, tên `TestAIUniwork…RateLimit` theo contract-p0 §10): fake tiêm 429 với `Retry-After: 7`
  → façade trả 429 `ai_rate_limited`, `Retry-After: 7`, header run/conversation giữ nguyên (§4.11); tiêm 429 không có
  `Retry-After` → `Retry-After: 30`; tiêm 500 → 502 `ai_provider_error`.

Ghi chú riêng, không thuộc việc 429: `FakeReply` (`server/internal/ai/fake.go`) đã đặt `UsagePresent: true` từ
`4f6949525` (BE-4), nên fake báo usage giống provider thật; không còn việc G6-13 nào cho điểm này.

Façade **không bao giờ** trả 200 rồi đóng stream rỗng: fork coi "(empty stream)" là lỗi tạm và tự gửi lại hai lần
(`EMPTY_STREAM_RETRY_DELAYS_MS = [1_000, 3_000]`, `packages/agent-core/src/loop.ts:336`, nhánh `:969-985`), mỗi lần là một
lượt model bị tính ở server và ăn trần §4.3. Thân thông báo của mọi lỗi không được khớp bộ phân loại desktop, để mã —
không phải câu chữ — quyết định nhánh. Toàn bộ `OVERLOADED_PATTERN` (`packages/ai-provider/src/overload-error.ts:10-20`,
không phân biệt hoa thường) là `\bHTTP (429|503|529)\b` | `overload` | `rate.?limit` | `too many requests` |
`resource.{0,12}exhausted` | `quota exceeded`; thêm `CREDITS_PATTERN` `/credit|pricing/i` (`:25`) và
`CREDITS_EXHAUSTED_PATTERN` (`:28-29`) của nhánh tín dụng. Desktop đưa cả thân lỗi vào chuỗi
`HTTP <status>: <detail>` (`protocols/openai-compatible.ts:207-209`), nên mọi 429/503 và cả mã `ai_rate_limited`
(khớp `rate.?limit`) luôn bị xếp `overloaded` dù câu chữ thế nào — câu chữ không thay được nhánh theo mã của G6-05 trước
`:209`. Quy tắc câu chữ chỉ giữ cho các lỗi **khác** (409, 413, 403, 502, 504) khỏi bị xếp nhầm: `message` tiếng Việt
của chúng và mọi mã khác không chứa cụm nào trong các mẫu trên (không chữ "credit", "quota exceeded", "rate limit"…).

Phía fork đây là việc mới, ở **hai** chỗ:
- **Desktop** (`packages/ai-provider`): không đọc `Retry-After` ở đâu cả; status không OK thành `Error("HTTP 429: …")`
  (`protocols/openai-compatible.ts:206-210`) rồi bị xếp `overloaded` (`overload-error.ts:10-20`, `ai-chat-error.ts:43`)
  và lượt kết thúc. G6-05 rẽ theo status + `code` **trước** dòng `:209` (hoặc trong `protocols/uniwork.ts` mới) và chạy
  vòng chờ ở đó.
- **Web** (`web/modules/shared/ai/*`): `createProxyFetch` ném `aiErrorFromResponse(res)` cho **mọi** status trong
  `BY_STATUS` — gồm 403, 429, 502, 503 — trước khi lớp protocol thấy response (`transport.ts:101-110`, `proxyAnswered`
  `:90-98`, `isContractFailure` `errors.ts:99-108,189-191`); `retryAfterSec` được parse (`errors.ts:121-127,161-163`)
  nhưng không ai chờ theo nó (notes-fork-adapter §5). Vòng chờ đặt riêng ở `:206-210` **không bao giờ chạy** trên frame
  web: G6-05 phải đặt nhánh/vòng chờ trong `transport.ts`/`errors.ts` (hoặc fetch riêng của route `…/ai/uniwork/…`, §7)
  dùng `AiWebError.retryAfterSec` + `serverCode`. Status ngoài `BY_STATUS` (409, 413, 504) đi tiếp xuống
  `openai-compatible.ts:209` như desktop, nên cũng cần nhánh theo mã ở đó.

### 4.6 Trần body và tool-result

**Đề xuất G6-D1:**
- Body route: **giữ `maxJSONBody` 1 MiB** (`server/internal/handler/json.go:15`), không override. Lý do: adapter fork
  chỉ gửi câu hỏi mới + tool-result + id (plan G6-05), không gửi lịch sử, nên body không lớn dần theo hội thoại.
- Mỗi tool-result ≤ **64 KiB** (UTF-8, sau khi decode JSON); tổng tool-result một request ≤ **256 KiB**. Vượt → 413 mã
  `ai_tool_result_too_large` (client hiện "workbook quá lớn", plan G6-03a luật 4). Bảng mã X-03 của contract-p0 §4 **chưa
  liệt kê** mã này; nếu G6-D1 được ký thì thêm một hàng (HTTP 413, không lớp) vào bảng đó và đăng ký ở
  `server/internal/handler/dto/sdo/error_class.go` (§8.1).
- **Map theo nền tảng.** Mã này áp dụng trên cả ba route (org, frame, route phiên có tài liệu §5), tức cả desktop. Chuỗi
  hiện có `aiErrWorkbookTooLarge` chỉ đúng cho **web** ("quá lớn để AI xử lý trên web. Mở bằng ứng dụng UniWork Office",
  hành động "Mở bằng ứng dụng", `docs/office/g5g6g7/ux/EXPERIENCE.md:524,1001`); trên desktop người dùng **đã ở trong
  ứng dụng**, nên câu đó sai và nút đó chết. Đề xuất: web giữ `aiErrWorkbookTooLarge` + "Mở bằng ứng dụng"; desktop map
  cùng mã sang một chuỗi riêng (ý: "vùng dữ liệu quá lớn để AI xử lý một lần — chọn vùng hoặc sheet nhỏ hơn"), **không**
  có hành động mở ứng dụng. Câu chữ vi/en của chuỗi desktop là việc UX: follow-up cho Advisor/UX owner (spine
  EXPERIENCE), ghi ở §8.1 hàng 14; G6-05u không tự đặt câu.
- Câu hỏi người dùng ≤ 8000 ký tự (cùng bậc `maxLength` 4000 của công cụ đám mây ở `dto/sdi/ai_cloud.go`, gấp đôi
  vì câu hỏi Office hay dán bảng nhỏ).

64 KiB ≈ 16 000 token ước lượng: một tool-result lớn nhất vẫn để chỗ cho system + lịch sử trong 48 000 (§4.7); tổng
256 KiB vượt ngân sách lượt đó nên server cắt lịch sử cũ trước, rồi mới từ chối nếu chính tool-result mới vượt ngân
sách (từ chối có mã, không cắt giữa tool-result).

### 4.7 Ngân sách lịch sử và token

**Đề xuất G6-D1:** mỗi lượt model, đầu vào ước lượng (system + transcript + tool-result mới) ≤
**48 000 token**; khi vượt, server bỏ **lượt cũ nhất theo khối nguyên vẹn** (một câu hỏi người dùng cùng mọi assistant
tool call và tool-result của nó — không bao giờ để tool-result mồ côi, vì openai-compatible từ chối `tool` không có
`tool_calls` đứng trước). Giữ tối đa **20 lượt người dùng** trong kho; lượt 21 đẩy lượt cũ nhất ra.

Lý do: Ask UNI giữ 6 message (`askuni.go:92`, cắt ở `askuni.go:245-246`) vì nó tự nạp nguồn mỗi câu; lượt Office cần
nhiều hơn vì "Hỏi tiếp" phải thấy các bước trước (plan G6-03a luật 7). 48 000 vừa trong cửa sổ 128k của các model
`flagship` với dư cho `MaxTokens` 4096 và schema công cụ. Bộ ước lượng dùng cùng quy tắc ký tự/4 mà `provider.Fake`
dùng (`fake.go:34`) cho test xác định; số thật lấy từ `usage.prompt_tokens` của lượt trước khi upstream trả — upstream dev
trả `usage` ở 20/20 lượt (§3). Ngân sách so với số **của UniWork** (ước lượng), không với `prompt_tokens` của upstream,
vì upstream dev cộng ~2.6k token overhead riêng (§3 ghi chú 2); 48 000 còn dư đủ cho overhead cỡ đó.

### 4.8 Hình dạng mở rộng provider (tool-call id + tool-result)

Khoảng trống tại base: `ToolCall` chỉ có `Name`/`Input` (`provider.go:52-55`); `Message` có `Role`
user/assistant, `Content`, `Parts` (`provider.go:23-30`); `oaiToolCall` không có `id` (`openai.go:39-44`) và
`Complete` bỏ id khi đọc response (`openai.go:115-117`); không có message role `tool`; anthropic bỏ `ToolUseBlock.ID`
(`anthropic.go:76-77`) và gửi mọi message assistant thành một text block (`anthropic.go:34-38`); `ai.Request` chỉ nhận
`History` + một câu user cuối render từ prompt (`gateway.go:56`, `gateway.go:143-144`).

**Đề xuất G6-D1 (đã cài trên nhánh spike ở `bcca72643`, `server/internal/ai/provider/provider.go`; thư mục
`server/internal/ai/provider/*` thuộc AI Platform theo contract-p0 §2):**

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

**Đề xuất G6-D1** (thứ tự và tên migration theo contract-p0 §5 hàng 4; nội dung bảng là đề xuất):

| Mục | Giá trị |
| --- | --- |
| Nơi lưu | **Postgres**: `ai_uniwork_conversations` (id ULID, `organization_id`, `workspace_id` NULL được — route phiên không tài liệu, `user_id`, `document_id` NULL được, `module`, `device_id` NULL được, `created_by` + `created_by_kind`, `last_used_at`, `expires_at`) và `ai_uniwork_turns` (id, `organization_id`, `conversation_id`, `run_id`, `seq`, `role` user/assistant/tool, `ciphertext`, `usage_event_id`, `created_at`); một migration `999<ms>_ai_uniwork_conversations` (G6-03a, contract-p0 §5 hàng 4; `<ms>` = `max(unix-ms lúc viết, tiền tố lớn nhất trên root + 1)`, đổi tên khi rebase nếu merge lệch thứ tự), index `CONCURRENTLY` mỗi file một câu, không FK; bảng run nằm ở migration riêng của G6-03b (§4.15) |
| Mã hóa | nội dung lượt (câu hỏi, câu trả lời, tool call input, tool-result) mã hóa `server/internal/util/secretbox` AES-256-GCM như kho khóa (ADR 0029 D2); khóa riêng `AI_CONVERSATION_KEY` (base64 32 byte, `.env.example`), không dùng chung `AI_CREDENTIAL_KEY` để lộ một khóa không lộ cả hai; thiếu khóa → UniWork AI coi như chưa cấu hình (`tools.chat` false), fail closed |
| TTL nhàn rỗi | **30 phút** kể từ `last_used_at` (≥ 300 giây kẹp `Retry-After` + thời gian một run tối đa ≈ 10 lượt × 55 giây trần chờ upstream của façade (§4.13; dưới timeout Gateway 60 giây `AI_TIMEOUT_SECONDS`, `config.go:28-33`) = 550 giây; 1800 > 850) |
| Hạn tuyệt đối | 24 giờ kể từ `created_at` (transcript chứa nội dung chưa lưu, spec §8.3) |
| Lượt giữ | 20 lượt người dùng (§4.7) |
| Dọn | worker TTL đăng ký vào chuỗi shutdown của `server/cmd/server/main.go` (plan §4), xóa theo lô; consumer outbox cho `document.deleted`, `member.removed`, `member.left`, `member.deactivated` (`docs/events/CATALOGUE.md:127-164`); kiểm lười ở mỗi request (§5); đăng xuất xóa conversation của phiên không tài liệu; "hội thoại mới" xóa conversation cũ của cùng (user, document, module); cờ `office_ai_uniwork` (contract-p0 §4) tắt cho tổ chức → worker xóa theo `organization_id` ở vòng kế và request mới bị từ chối bằng 403 `office_capability_off` với `fields.capability` (contract-p0 §4: cờ ẩn capability, không phải từ chối quyền) |
| Lịch sử lệch với client | fork xóa khỏi lịch sử của nó mọi lượt của run lỗi (`rollbackFailedRun`, `loop.ts:645-650`); server làm cùng: run kết thúc bằng lỗi (không có câu trả lời assistant cuối) thì các lượt của run đó **không** vào transcript dùng cho run sau, nên model và panel thấy cùng một lịch sử. Server không bao giờ đọc lịch sử client gửi |
| Tenant | `organization_id TEXT NOT NULL`; query `Ai*` có `organization_id = $n` hoặc `-- tenant:`; hàng trong `TestIsolationMatrix` |
| Metric | `uniwork_ai_uniwork_conversations_swept_total{reason}`, gauge số conversation sống; runbook mục "UniWork AI transcript" |

Vì sao Postgres, không Redis:
- Redis là tùy chọn trong deployment này: rate limit chỉ có khi có Redis và fail-open (CLAUDE.md › Backend HTTP Rules,
  `ratelimit.go:60`), `/readyz` không gate Redis. Hội thoại mất khi Redis khởi động lại là lỗi người dùng thấy
  (`conversation_expired` hàng loạt; mã 409, không `error_class`, contract-p0 §4, registry thêm khi G6-D1 đóng), còn với rate
  limit thì chỉ là mất ngân sách.
- Dọn theo tài liệu/thành viên cần truy vấn theo `document_id`/`user_id`; Redis cần index phụ tự quản.
- Luật tenant (`TestNewTablesCarryOrganizationID`, `TestEveryQueryNamesItsTenant`, `TestIsolationMatrix`) phủ bảng
  Postgres tự động; Redis nằm ngoài các test đó.
- Có tiền lệ: `ai_conversations`/`ai_messages` của Ask UNI ở Postgres (`server/migrations/092_ai_gateway.up.sql:51-70`).

Vì sao không dùng lại `ai_conversations`/`ai_messages`: `workspace_id NOT NULL` (route phiên không tài liệu thuộc tổ
chức, không workspace), không có `document_id`/`module`, `role` chỉ `user`/`assistant` (CHECK ở `092:65`), nội dung
plaintext, không TTL; sửa chúng là đổi hợp đồng Ask UNI. Bảng mới tách rõ vòng đời.

### 4.10 `LoadShed` và trần đồng thời

**Đề xuất G6-D1 (số mặc định do G7-D1 chốt; contract-p0 không phủ):**
- Route UniWork AI **miễn `mw.LoadShed`**, miễn **theo mẫu route** (ba mẫu: `/api/v1/orgs/{orgID}/ai/uniwork/chat/completions`,
  `/api/v1/documents/{documentID}/ai/uniwork/chat/completions`, `/api/v1/office-frame/documents/{documentID}/ai/uniwork/chat/completions`),
  không theo tiền tố, và nhánh miễn **vẫn gọi `setBodyDeadline`**.
- Trần riêng: **32 lượt đang chạy mỗi pod**, **64 toàn hệ thống** (lease Redis có hạn = timeout lượt + 10 giây), **8
  mỗi tổ chức** (toàn hệ thống qua Redis; không Redis thì 8 mỗi pod). Vượt → 429 `ai_uniwork_busy` + `Retry-After: 5`
  (mã mới, không lớp; contract-p0 §4 chưa liệt kê, §8.1).
- Ba mẫu route trên: hai mẫu `…/orgs/{orgID}/…` và `…/office-frame/documents/{documentID}/…` là route UniWork AI của
  contract-p0 §3 (tiền tố `/api/v1`); mẫu `…/documents/{documentID}/…` là route phiên có tài liệu đề xuất ở §5.

Bằng chứng: `loadshed.go:21-49` — miễn chỉ bằng so khớp path chính xác (`exempt[r.URL.Path]`) hoặc WebSocket, và nhánh
miễn gọi thẳng `next` nên bỏ `setBodyDeadline` (`loadshed.go:32-35` so với `:39`); router đặt `HTTPMaxInFlight` mặc
định 128 (`config.go:295`, `router.go:116`). Một lượt UniWork AI giữ slot suốt thời gian model trả lời (tối đa 55 giây, §4.13;
dưới timeout Gateway 60 giây ở `config.go:28`); 128 người hỏi cùng lúc sẽ làm mọi request khác nhận 503 `server_busy` — trái plan G6-03a "lượt UniWork
AI không bao giờ làm `LoadShed` cắt request khác". 32/pod = 25% của 128, nên kể cả khi tắt miễn trừ vẫn còn 96 slot cho
phần còn lại. Trần tổ chức 8 giữ một tổ chức lớn không ăn hết 64.

### 4.11 Run id: header hay body

**Đề xuất G6-D1 (contract-p0 §3 ghi "hình dạng wire: G6-D1"):** **header**. Response đầu của run trả `X-UniWork-AI-Run: <ULID>` và
`X-UniWork-AI-Conversation: <ULID>`; request tool-result và câu hỏi tiếp gửi lại hai header đó. Server bỏ qua mọi id
trong body.

Lý do: body giữ đúng openai-compatible (`messages`, `tools`, `stream`), nên adapter fork dùng lại bộ dựng body sẵn có
và chỉ thêm header; hai header có trên **mọi** response của run, kể cả response lỗi của §4.5 (429, 409, 413, 502, 504),
nên vòng chờ 429 gửi lại đúng run id (EXPERIENCE:496 "giữ run id") dù lỗi tới trước câu trả lời đầu; id do server cấp,
không bao giờ lấy từ input người dùng hoặc model (spec §8.2). Việc kèm theo: thêm hai header vào CORS `AllowedHeaders`
(`router.go:95`) và `ExposedHeaders` (`router.go:111`), nếu không frame web không đọc được id. `router.go` là seam của
Lead D, sửa nối tiếp qua root (contract-p0 §2).

Kiểm ở fork (notes-fork-adapter §3): header đi ra có tiền lệ `opencodeSessionHeaders(baseUrl, cb.sessionId)`
(`packages/ai-provider/src/providers.ts:18-25`, chèn ở `protocols/openai-compatible.ts:179-184`), và proxy web chỉ bỏ
`authorization`/`x-api-key`/`x-goog-api-key`/`user-agent` (`web/modules/shared/ai/transport.ts:29-37`), nên header
tự đặt đi qua. Đọc header trả về **chưa có**: `StreamCallbacks` không có hook header (`protocols/shared.ts:253-265`) —
G6-05 thêm một `onResponseHeaders` (~10-20 dòng). Trường body thì `bodyExtras` tĩnh theo endpoint
(`registry.ts:17-28`), phải đục thêm tham số qua `streamForProvider` và `runTurn` web — xâm lấn hơn. Header thắng.
`cb.sessionId` của fork là id theo transport, không theo tài liệu, nên **không** dùng làm conversation id; conversation
id luôn do server cấp.

### 4.12 Wire extension `x_uniwork` hay `finish_reason`

**Đề xuất G6-D1 (wire, contract-p0 §3):** object mở rộng **`x_uniwork`** ở response không stream và ở chunk cuối (trước
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
loại chunk/callback `notice` ở đường JSON, đường SSE và cầu IPC desktop (§7), G6-05u vẽ chip. Spine UX
`EXPERIENCE.md:134` còn nhắc `finish_reason = tool_not_allowed`; Advisor bỏ vế đó khi đóng G6-D1 (§8.1 hàng 13).

### 4.13 Streaming thật hay SSE một chunk ở v1

**Đề xuất G6-D1 (streaming nằm trong G6-D1, contract-p0 §11):** **SSE một chunk** ở v1: khi client gửi `stream: true`, façade trả
`text/event-stream` gồm một `chat.completion.chunk` đầy đủ (role, content, tool_calls có id, `finish_reason`,
`x_uniwork`, `usage`) rồi `data: [DONE]`; `stream: false` trả JSON thường. Cả hai chỉ được mở (status 200 + header)
**sau** khi Gateway đã có câu trả lời upstream — đúng quy tắc lỗi v1 ở §4.5.

Lý do: `provider.Provider` không có method stream (`provider.go:89-93`) và `Gateway.Complete` là một request một
response (`gateway.go:114-204`); stream thật cần method mới ở cả ba provider, lọc tool call theo delta, và chốt usage
khi stream đứt — rủi ro lớn hơn lợi ích. Số đo (§3) ủng hộ: một lượt p50 1,5–1,7 giây, chậm nhất đã thấy 9,8 giây (lần 1), phần lớn lượt
Office là tool call ngắn (19 token đầu ra ở lượt 1) nên stream thật không rút ngắn được gì người dùng thấy; chỉ câu trả
lời văn bản dài mới được lợi, và đó là việc của v1.1. Ngưỡng `uwTipWaitAiLong` 30 giây của EXPERIENCE không cần đổi.
Adapter `uniwork` của fork vẫn phải chịu stream thật (spec §6.2) để v1.1 bật bằng server mà không phát hành lại app.
Probe stream thô trên upstream dev cho thấy v1.1 khả thi về đo đếm: 8 chunk, id có ngay trên delta tool call đầu (nên
façade lọc theo index được sớm), và có chunk usage cuối khi gửi `stream_options.include_usage` — v1.1 phải luôn gửi tùy
chọn đó (ADR 0029 Giới hạn đã biết: thiếu nó thì proxy ghi 0 token).

Ràng buộc từ fork (notes-fork-adapter §2, §4, uniwork-office `0d03b185`):
- Mỗi phần tử `tool_calls` trong chunk **phải có `index`** (bộ gộp delta khóa theo `tc.index`,
  `protocols/openai-compatible.ts:284-307`; thiếu `index` thì mọi call gộp làm một), cùng `id`, `function.name`,
  `function.arguments` đầy đủ và `finish_reason` trong **cùng** chunk, rồi `[DONE]`.
- Watchdog của fork chờ **header** tối đa 60 giây (`AI_CONNECT_TIMEOUT_MS`, `watchdog.ts:8`), sau đó im lặng tối đa 180
  giây (`watchdog.ts:15`); timeout Gateway mặc định cũng là 60 giây (`config.go:28`), tức không có biên. **Quy tắc v1:
  façade gọi upstream trước, rồi mới gửi header.** Deadline **55 giây tính từ lúc request tới**: handler façade đặt
  `context.WithDeadline(r.Context(), arrival+55s)` ngay khi bắt đầu, và context đó phủ **cả** việc trước upstream (xác
  thực, lease đồng thời §4.10, đọc body tới 1 MiB, giải mã kho hội thoại §4.9, kiểm quyền/quota) **lẫn** lượt gọi
  upstream; `context.WithTimeout` của Gateway ở `gateway.go:153` lồng bên trong, cái nhỏ hơn thắng; không đổi
  `AI_TIMEOUT_SECONDS` dùng chung với Ask UNI. Không phải một timeout chỉ quanh lượt gọi Gateway: khi đó việc trước
  upstream chậm cộng 55 giây có thể vượt watchdog 60 giây của fork, và fork báo `AiTimeoutError` ("timeout") thay vì
  hàng 504 trong khi server vẫn tính lượt. 5 giây còn lại giữa 55 và 60 chỉ phủ mạng và ghi response, nên fork luôn
  nhận một status thật trước khi watchdog bắn. Quá deadline → 504 `ai_provider_timeout` (dù deadline hết trước hay
  trong lượt gọi upstream; khi hết giữa lượt gọi, Gateway trả `ErrProviderError.wrap(context.DeadlineExceeded)`
  = 502 tại `gateway.go:162-169`, và dòng usage đã được ghi `failed` với `reason_code = ai_provider_error`
  (`gateway.go:163`) trước khi nơi gọi thấy lỗi). Bộ phân biệt là **deadline của façade**, không phải lỗi provider có
  kiểu: G6-03a thêm một nhánh deadline trong Gateway cạnh `ErrUnsupportedMedia` (`errors.Is(perr,
  context.DeadlineExceeded)` hoặc `ctx.Err()` của context cha) trả lỗi mới `ErrProviderTimeout` (504
  `ai_provider_timeout`) **và** ghi dòng usage `failed` với `reason_code = ai_provider_timeout` thay cho
  `ai_provider_error`; handler façade cũng kiểm `ctx.Err()` của chính nó trước khi áp hàng 502 (phủ trường hợp lỗi
  trả về bọc context lỗi theo cách khác). Deadline hết **trước** khi tới Gateway: 504 không có dòng usage (chưa có lượt
  gọi). Mọi lỗi khác theo bảng §4.5. Test G6-03a (`TestAIUniwork…Timeout`, `fake` có độ trễ): việc
  trước upstream chậm 10 giây + fake chậm 50 giây → 504 lúc ≈ 55 giây tính từ lúc request tới, và dòng usage `failed` mang `reason_code = ai_provider_timeout`. Không gửi keep-alive `: ping` ở v1 (trước header không có gì để gửi; sau header chunk đến ngay).
  Biên đo được: lượt chậm nhất 9,8 giây (§3, lần 1), xa 55 giây.
- Không bao giờ trả 200 rồi đóng stream rỗng hay không có chunk đầy đủ: fork gửi lại "(empty stream)" hai lần
  (`loop.ts:336`, `:969-985`), mỗi lần là một lượt model bị tính (§4.3, §4.5).
- Vì sao không chọn "header sớm + keep-alive" (phương án b của review FE R1-1): nó cho phép chờ quá 60 giây, nhưng mọi
  lỗi sau header (upstream 429/5xx/timeout) không còn là status HTTP: `Retry-After` không đi được, đường 429 có sẵn của
  web (`AiWebError.retryAfterSec`, §4.5) không dùng được, và frame kết thúc (bullet dưới) thành đường lỗi **chính** của
  mọi lượt ngay ở v1 thay vì một nhánh dành sẵn, cho một lợi ích v1 không cần (câu trả lời một chunk). Rủi ro của phương án a: câu trả lời văn bản dài gần `MaxTokens` 4096 trên
  upstream chậm có thể vượt 55 giây (≈ 75 token/giây là ngưỡng); G6-08 đo lượt dài nhất trên dev set, và nếu chạm trần
  thì đó là lý do bật stream thật (v1.1), không phải nới trần.
- **Frame kết thúc sau header — ký ngay ở G6-D1, dành sẵn ở v1.** Spec §6.2 bắt adapter `uniwork` chịu cả stream thật,
  và §1 hứa v1.1 bật bằng server mà không phát hành lại app; điều đó chỉ đúng nếu lỗi **sau** header có hình dạng đã ký
  trước khi G6-05 phát hành. Thiếu nó, một 429/5xx của upstream sau header ở v1.1 thành stream đứt (→ "(empty stream)"
  gửi lại hai lần nếu chưa có chunk, `loop.ts:969-985`, mỗi lần một lượt bị tính) hoặc câu trả lời cụt không báo lỗi.
  Hình dạng: một chunk cuối chỉ mang `"x_uniwork": {"terminal": {"code": "ai_rate_limited" | "ai_provider_error" |
  "ai_provider_timeout", "retry_after": <giây, chỉ với ai_rate_limited>}}` rồi `data: [DONE]`; **không** dùng khóa
  `error` (mọi `error` truthy hủy lượt, `openai-compatible.ts:267`); vẫn không bao giờ đóng stream rỗng.
  - Trạng thái G6-D1: **dành sẵn — server không bao giờ phát nó ở v1** (v1 là SSE một chunk, mọi lỗi là status HTTP thật
    theo §4.5). Server bắt đầu phát chỉ khi v1.1 bật stream thật; khi đó `code` và `retry_after` mang đúng nghĩa của
    hàng tương ứng ở bảng §4.5.
  - G6-05 đọc nó **từ v1**, không điều kiện: `terminal.code = ai_rate_limited` → chờ theo §4.5 (kẹp 300, tối đa 3 lần,
    cùng run id); mã khác → lỗi theo mã, "Thử lại"; không bao giờ coi frame này là "(empty stream)" để tự gửi lại.
    **Vòng chờ này không nằm trong transport.** Tới lúc frame tới, các chunk nội dung đã đi qua `cb.onDelta`
    (`openai-compatible.ts:275-281`) vào `turnText` của vòng lặp và ra UI qua `events.onText`
    (`packages/agent-core/src/loop.ts:923-932`); transport không rút lại được. Nên transport chỉ báo một lỗi có kiểu
    (`ai_rate_limited` + `retry_after`), và việc chờ + gửi lại chạy ở đường `onError` của vòng lặp agent-core
    (hoặc một callback reset mới), **khởi động lại lượt** như `startTurn` (`loop.ts:904-906` đặt lại `turnText`,
    `turnReasoning`, `toolCalls`; tiền lệ `retryDrop`, `:975-985`, "text được vẽ lại"). Desktop và web dùng chung
    agent-core nên đây là một chỗ, không phải hai. (Chỉ 429 **trước** header mới chờ được trong transport, vì chưa có
    delta nào đã phát.) Test G6-05 với `AI_PROVIDER=fake` (kịch bản fake phát frame, hoặc fixture SSE cùng
    hình dạng phía fork): (1) một chunk nội dung rồi terminal `ai_rate_limited`, `retry_after: 2` → chờ 2 giây, gửi lại
    cùng `X-UniWork-AI-Run`, **và sau lần gửi lại, văn bản đã vẽ và `history` chỉ chứa câu trả lời của lần gửi lại,
    không có chữ nào của chunk một phần (không lặp, không nối)**; (2) terminal `ai_provider_error` ngay sau header → lỗi "Thử lại", không có lượt gửi lại
    nào do nhánh stream rỗng.
- Luôn trả SSE khi client gửi `stream: true` (fork luôn gửi `stream: true`): đường JSON của fork quét **mọi chuỗi** trong
  body và ném `AiCreditsError` khi gặp cụm như "credit … exhausted/balance" (`throwIfCreditsNotice`,
  `protocols/shared.ts:352-382`), nên một câu trả lời về bảng tính có chữ "credit balance" sẽ thành lỗi tín dụng giả.
  SSE không bị quét. Usage trong chunk vô hại: fork không đọc `usage` (notes §2).

### 4.14 Entitlement

**Đã quyết (U-13; contract-p0 §11 "đã đóng"):** dùng lại `office.ai_cloud`; `chat` là một công cụ cloud, grant
`uniwork_ai` của frame đọc cùng khóa (spec §8.2). Không migration (contract-p0 §5 hàng 6: chỉ có khi G6-D1 chọn nhánh
entitlement mới, và U-13 đã loại), không khóa mới. Bằng chứng: ADR 0029 D5 (`office.ai_cloud` cho mọi công cụ đám mây,
đọc qua `EntitlementService.Can`, fail-closed). G6-02 không mở lại quyết định này.

### 4.15 Run/usage: business state hay hạ tầng AI

**Đề xuất G6-D1:** **hạ tầng AI**. Usage tiếp tục là `ai_usage_events` qua `AiInsertUsageEvent` /
`AiFinishUsageEvent` (`server/pkg/db/queries/ai.sql:5,12`); bộ đếm run (`ai_uniwork_runs`: id, `organization_id`,
`conversation_id`, `model_calls`, `tool_rounds`, `waits`, `expires_at`) và kho hội thoại (§4.9) đọc/ghi bằng query
`Ai*` từ `internal/service/ai_uniwork.go`. Bảng `ai_uniwork_runs` vẫn cần migration `999<ms>_ai_uniwork_runs` của G6-03b
(contract-p0 §5 hàng 5) dù run **không** là business state — bộ đếm vòng phải bền qua nhiều pod; contract-p0 ghi hàng đó
"nếu G6-02 xếp run là business state", xem §8.1. Không thêm action vào `server/internal/service/audit_coverage_test.go`,
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
CHECK. Upstream dev trả `usage` ở 20/20 lượt non-stream và trong chunk cuối khi stream (§3), nên nhánh `usage_unknown`
là đường phòng thủ cho upstream khác (vLLM chỉ trả usage stream khi bật cờ, notes-upstream-candidates §6), không phải
đường thường; test `TestOpenAIUsageAbsent` (`aadf0daa5`) đã giữ hình dạng.

## 5. OQ-P2 — tài liệu UniWork mở trên desktop

Câu hỏi (plan §3): desktop gọi UniWork AI bằng phiên thiết bị, không có frame token; SDI phiên AI không mang
`document_id` (`server/internal/handler/dto/sdi/ai_cloud.go`); spec §6.2 bước 2 nói scope suy từ phiên hoặc frame
token, không từ body.

**Đề xuất G6-D1** (OQ-P2 thuộc G6-02, ký ở lô #2 — contract-p0 §11). contract-p0 §3 chỉ liệt kê hai route UniWork AI
(`POST /orgs/{orgID}/ai/uniwork/chat/completions` và `POST /office-frame/documents/{documentID}/ai/uniwork/chat/completions`,
tiền tố `/api/v1`); đây là **route thứ ba** và chỉ thành hợp đồng khi G6-D1 được ký, khi đó thêm một hàng vào bảng §3 của
contract-p0. Thêm **route phiên có tài liệu trên path**:

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

Ba test bắt buộc (plan §3, giao G6-03a/G6-05; mọi test dùng `fake`). Tên test Go bắt đầu bằng `TestAIUniwork…` để khớp
lệnh ma trận AC của contract-p0 §10 (`-run 'AIUniwork|IsolationMatrix'` cho G6-A07; hậu tố `Timeout|Credits|RateLimit|Cancel`
cho G6-A08, `Usage` cho G6-A09):
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

Hệ quả cho G6-03a: thêm một route (`apiOp`, `pathParamSDI` đã có `documentID`) và một hàng isolation **viết tay** — route
mới không tự phủ được. Path mang tenant row nên ma trận tự gọi nó (không có hàng thì mặc định `isoScoped`, không body,
`isolation_matrix_test.go:468`), nhưng pass điều khiển của chủ tổ chức (`isolation_matrix_test.go:303`, bỏ qua GET và hàng
có `skipControl`) không thể đi qua nếu chỉ dựa vào mặc định, vì ba điều kiện: (1) cờ `office_ai_uniwork` mặc định `false`;
fixture hiện bật mọi cờ trong `featureflags.Catalogue()` (`isolation_world_test.go:205-212`) nên cờ chỉ bật khi G6-03a
khai nó trong catalogue — hàng/test phải xác nhận cờ bật, vì bị tắt thì chủ nhận `feature_disabled` chứ không phải 2xx; (2) route POST completions cần grant `office.ai_cloud` của gói — `isolation_world_test.go` không
gán, nên hàng phải bảo đảm grant (cùng cách các hàng `ai/cloud/*` ở `isolation_routes_test.go:374-377` được chủ gọi
thành công); (3) body mặc định của `isoScoped` rỗng, không có `messages`/`tools` hợp lệ. Nghĩa vụ G6-03a: thêm mục
`isoRoutes` (`isolation_routes_test.go:173`) cho `POST /api/v1/documents/{documentID}/ai/uniwork/chat/completions`
(đúng pattern đăng ký ở router) với `body: isoJSON(...)` (`isolation_routes_test.go:157`) là một `messages` tối thiểu hợp lệ
(`AI_PROVIDER=fake`), bảo đảm cờ + grant `office.ai_cloud` cho tenant trong world để pass chủ trả 2xx; không dùng
`skipControl` (nếu không, route mất control và một route hỏng sẽ giả làm route cô lập). Ba pass từ chối còn lại
(cross-tenant, mixed parent/child, ẩn danh 401) chạy từ chính hàng đó; thêm `isoReferences` chỉ khi body có `*_id`. Cập nhật `uniwork-office-app-api-contract.md` §3. Các seam G6-03a chạm đi nối tiếp qua root theo contract-p0 §2:
`openapi.go`, `router.go`, `server/cmd/server/main.go` (worker TTL trong chuỗi shutdown), migration (thứ tự §5 của
contract-p0, Advisor giữ thứ tự merge), `isolation_matrix_test.go`; `audit_coverage_test.go` không thêm dòng (§4.15).

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
| SSE một chunk / JSON | chịu cả một chunk đủ + `finish_reason`, thiếu `[DONE]` vẫn được (`:242-332`); chịu JSON khi `stream:true` (`shared.ts:329-337`) | server luôn có `index` trong `tool_calls`; header chỉ gửi khi đã có câu trả lời upstream (deadline 55 giây từ lúc request tới, dưới watchdog 60 giây `watchdog.ts:8`), lỗi là status HTTP thật, không bao giờ 200 rỗng (§4.5, §4.13); G6-05 đọc frame `x_uniwork.terminal` từ v1 (dành sẵn, server v1 không phát) + test `fake` terminal 429 sau một chunk / terminal 502 (§4.13) |
| `x_uniwork` | bị bỏ qua, không lỗi; chưa có chỗ hiển thị: `AiStreamChunk.type` chỉ có `delta\|reasoning\|tool-call\|done\|error\|ping` (`packages/ai-provider/src/types.ts:216-220`), bản sao IPC `IpcStreamChunk.type` cũng vậy (`packages/agent-core/src/electron-transport.ts:14-18`) | thêm loại chunk/callback `notice` ở **cả ba** chỗ: đường JSON (`emitOpenAiJsonMessage`), đường SSE (`openai-compatible.ts`), và cầu IPC desktop (`AiStreamChunk.type` + `IpcStreamChunk.type`, kênh `ai:stream-chunk` main → renderer của từng app, ví dụ `apps/docs/src/main/docs-main.ts:3840`, `apps/slides/src/main/ai-ipc.ts:180`); chip ở G6-05u |
| 429 / `Retry-After` | desktop không đọc, 429 thành `Error("HTTP 429: …")` (`openai-compatible.ts:206-210`); web ném `AiWebError` cho mọi 429 ngay trong `createProxyFetch` (`web/modules/shared/ai/transport.ts:101-110`, `errors.ts:148-165`), parse `retryAfterSec` nhưng không chờ | vòng chờ tối đa 3 lần, kẹp 300 giây, rẽ theo `code`; **hai chỗ**: desktop trước `openai-compatible.ts:209`, web trong `transport.ts`/`errors.ts` (vòng chờ chỉ ở `:206-210` không bao giờ chạy trên web) (§4.5) |
| Trần run | client 100 lượt; tự gửi lại 3 trường hợp. Một `run_limit_reached` 429 thành chữ `HTTP 429: …`, khớp `\bHTTP (429\|503\|529)\b` trong `packages/ai-provider/src/overload-error.ts:10-20` → `errorCode: 'overloaded'` (`packages/ai-provider/src/ai-chat-error.ts:43`) → "AI đang bận, thử lại sau" thay vì `aiErrRunLimit` + "Hỏi tiếp" | rẽ theo mã **trước** bộ phân loại `overloaded` (desktop) và trước `createProxyFetch` ném (web). Khuyến nghị gốc: trả lời Q2 bằng **409** để run limit không bao giờ là 429 (§4.3, §8.1) |
| 403 | desktop: 403 có `content-type: text/html` bị coi là trang chặn và gửi lại qua rescue fetch (`packages/ai-provider/src/fetch.ts:63-67,85-97`); web: 403 là `entitlement_required` (`errors.ts:99-108`) | façade luôn trả 403 bằng **JSON** (`office_capability_off`, lỗi quyền tài liệu ở route §5), không bao giờ `text/html`; G6-05 map `code` của 403 thay vì coi mọi 403 là thiếu entitlement |
| Provider không khóa | handler main của docs/sheets/slides **từ chối provider không có `apiKey`** (`apps/docs/src/main/docs-main.ts:3842`, `apps/slides/src/main/ai-ipc.ts:182`, `apps/sheets/src/main/sheets-main.ts:3743,3779`); pdf/html/markdown chưa định vị handler | G6-05 sửa handler main của mọi module, không chỉ `packages/ai-provider` |
| Web | `toProxyRequest` chỉ nhận URL `/byok/…` (`web/modules/shared/ai/transport.ts:45-87`); `proxyConfig` cứng `byok` (`stream.ts:68-79`); `WEB_PROVIDER_IDS` và `settings()` chỉ dựng từ khóa BYOK đã lưu (`web-ai.ts:71-73`, `:359-409`) | đường riêng cho `…/ai/uniwork/chat/completions` và mục provider không khóa |
| Seam cloud | `UNIWORK_CLOUD_TOOLS` chưa có `chat` (`uniwork-cloud.ts:17-26`) | thêm `chat` (plan G6-05) |
| Usage | fork không đọc `usage` | không đổi; usage hoàn toàn ở server (G6-03b) |
| Lỗi có sẵn của fork | `throwIfCreditsNotice` quét toàn body JSON (`protocols/shared.ts:352-382`) | báo upstream/sửa ở fork; façade tránh bằng SSE (§4.13) |

Phạm vi sửa ở fork (notes §6): `packages/ai-provider/src/{types,providers,registry,stream,uniwork-cloud,fetch,ai-notice}.ts`,
`protocols/{openai-compatible,shared}.ts` (hoặc `protocols/uniwork.ts` mới), handler `ai:stream` của từng app,
`packages/ui` (picker, logo), `web/modules/shared/ai/*` (gồm `transport.ts`/`errors.ts` cho vòng chờ 429 và nhánh theo
mã), `packages/ai-provider/src/{overload-error,ai-chat-error}.ts` (rẽ mã trước bộ phân loại), `packages/agent-core/src/electron-transport.ts`
(`IpcStreamChunk` thêm `notice`), map capability web và khóa frame `uniworkAi` (thay đổi hai repo, spec §3 bất biến 9).
Sự kiện `aiRun` (X-02) chưa có ở pin này.

## 8. Rủi ro và việc còn mở

| Rủi ro / việc | Ảnh hưởng | Xử lý đề xuất |
| --- | --- | --- |
| Upstream production không trả `usage` (upstream dev có trả, 20/20) | credit tính sai | `usage_unknown` + đối soát (§4.15); kiểm lại trên ứng viên G6-D2 bằng cùng harness |
| `usage` của upstream gồm overhead riêng (~2,6k token mỗi lượt trên upstream dev, cả hai lần AC-2, §3 ghi chú 2) | `prompt_tokens` của upstream không phải tín hiệu chi phí trung thực: dòng `ai_usage_events`/`quota.Record` (§4.15) tính cả phần người dùng không gửi; trên dev, prompt vài chục token thành ~2,6k | dev: chấp nhận, không dùng số dev để định giá; G6-13/G6-03b ghi usage upstream nguyên trạng, ngân sách §4.7 so với ước lượng UniWork; production: G7-D1 đo overhead của ứng viên G6-D2 bằng cùng harness trước khi chốt cost/run và quota |
| `/v1/models` liệt kê 2472 tên, artifact giữ mẫu 200 (§3 ghi chú 1) | — | **Đã đóng:** `d9049f79c` tính `model_in_list` trên toàn danh sách; AC-2 lần 2: `gpt-6-luna` có (`true`) |
| `openai.go` không gửi trường `stream`; `deepseek-4.1` trên upstream dev coi thiếu là `stream:true`, còn `stream:false` thì không trả tool call (§3 ghi chú 4) | đường không stream phụ thuộc mặc định của từng upstream/model | **G6-13 phải gửi `stream` tường minh** (`false` ở `Complete`) + test hợp đồng thân request có khóa `stream`; dev dùng `gpt-6-luna`; mỗi ứng viên G6-D2 chạy lại harness |
| p95 lệch giữa hai lần AC-2 (cả vòng 12 702 vs 5182 ms; lượt 2 9819 vs 1971 ms) | với 10 mẫu, p95 = mẫu chậm nhất, nên một lượt chậm của upstream dev dùng chung quyết định nó | mọi trần/timeout dựa trên lần xấu hơn (lần 1, §3); G6-08/G7-D1 đo lại với nhiều mẫu hơn và tải thật trước khi chốt trần 10 lượt |
| Trần chờ upstream 55 giây ở v1 (§4.13) | câu trả lời văn bản dài gần `MaxTokens` 4096 trên upstream chậm (< ~75 token/giây) thành 504 `ai_provider_timeout` | G6-08 đo lượt dài nhất trên dev set; chạm trần → bật stream thật v1.1, không nới trần (watchdog fork 60 giây) |
| Stream thật v1.1 cần frame kết thúc sau header (`x_uniwork.terminal`, §4.13) | adapter v1 không đọc được nó → v1.1 phải phát hành lại app, trái spec §6.2 | **ký hình dạng ngay ở G6-D1**, trạng thái "dành sẵn: server không bao giờ phát ở v1"; G6-05 đọc nó từ v1, chờ ở vòng lặp agent-core (khởi động lại lượt, bỏ văn bản một phần), không ở transport + test `fake` (terminal 429 sau một chunk → chờ, cùng run id, văn bản đã vẽ chỉ gồm câu trả lời gửi lại; terminal 502 → lỗi, không gửi lại kiểu stream rỗng) |
| Upstream 429 hôm nay thành 502 (`openai.go:203-208` lỗi không kiểu, `gateway.go:162-169`) | hàng 429 upstream của §4.5 không xảy ra; đường chờ G6-05 với 429 upstream không thử end-to-end được | G6-13 lỗi provider có kiểu (status + `Retry-After`), G6-03a rẽ trước `ErrProviderError.wrap`, test `fake` tiêm 429 (§4.5) |
| `temperature` không gửi khi 0 (`openai.go:48`) | upstream dùng mặc định riêng, kết quả kém xác định | chấp nhận ở v1 (gửi tường minh làm Claude qua lớp compat trả 400, §4.1); G6-08 đo độ ổn định trên dev set |
| Schema công cụ module lớn | ăn ngân sách 48 000 | G6-01 đo kích thước schema; G6-14 báo nếu > 8000 token |
| Khóa `AI_CONVERSATION_KEY` mới | thêm secret phải quản lý | ADR 0029 Hệ quả: secret manager; không có xoay khóa v1, đổi khóa = mọi transcript thành `conversation_expired` (chấp nhận được vì TTL 30 phút) |
| Lease Redis đồng thời | không Redis → chỉ trần mỗi pod | chấp nhận (plan G6-03a); số chốt ở G7-D1 |
| Gateway một provider cho cả server (spec §8.1) | đổi upstream UniWork AI đổi luôn Ask UNI | ngoài v1, cần ADR |
| Số trong bảng tóm tắt | chưa ký | người dùng ký G6-D1 ở lô #2 (contract-p0 §2, §11); G7-D1 cho trần đồng thời ở lô #3 |

Mọi quyết định của thẻ G6-02 đã có đề xuất và bằng chứng; không mục nào còn chờ số đo. Còn mở ngoài phạm vi quyết định: các câu hỏi Q1–Q5 ở §8.1, hai việc ngoài lane ở §8.1 hàng 13–14 (spine EXPERIENCE), và việc ký G6-D1 / G6-D2 / G7-D1.

### 8.1 Đối chiếu contract-p0

Đối chiếu từng giá trị đã chốt ở contract-p0 (ký U-15, 2026-10-12) với báo cáo trước khi có nó. Contract-p0 thắng; không
sửa contract-p0. "Thay đổi" là phần đã sửa trong báo cáo này.

| # | Báo cáo từng nói | contract-p0 nói | Thay đổi |
| --- | --- | --- | --- |
| 1 | G6-D1 ký bởi "AI Platform + owner F" (theo plan §3) | G6-D1 → người dùng; "Báo cáo G6-02 → lô #2; người dùng" (§2, §11) | Sửa phần dẫn bảng tóm tắt và hàng rủi ro cuối: cột "Ký" chỉ còn là vai soạn/đồng sở hữu, người ký là người dùng |
| 2 | Cờ tắt → "request mới bị từ chối" (không nêu mã) | Cờ ẩn capability, trả `office_capability_off` 403 kèm `fields.capability`, không nhập vào `permission` (§4) | §4.9 dùng mã này; giá trị `fields.capability` chưa chốt (câu hỏi Q1) |
| 3 | `run_limit_reached` chỉ nêu tên mã; vòng chờ 429 ở §4.5 chưa phân biệt | `run_limit_reached` 429, không lớp (§4) | §4.3, §4.5 ghi HTTP 429 và buộc client phân biệt theo mã; §7 nêu chỗ fork xếp 429 là "bận" (`overload-error.ts:10-20`, `ai-chat-error.ts:43`); **khuyến nghị đổi sang 409** (Q2) |
| 4 | `conversation_expired` không nêu HTTP | 409, không lớp, registry thêm khi G6-D1 đóng (§4) | §4.9 ghi 409 |
| 5 | `ai_uniwork_runs` thuộc "hạ tầng AI", vẫn cần bảng | Migration G6-03b hàng 5 chỉ "nếu G6-02 xếp run là business state" (§5) | Báo cáo giữ kết luận hạ tầng AI (§4.15) **và** nêu bảng vẫn cần migration; điều kiện của contract-p0 đọc lệch (Q3) |
| 6 | Tên migration `999<ms>_ai_uniwork_conversations` | Hàng 4, đúng tên; `<ms>` = `max(unix-ms lúc viết, tiền tố lớn nhất + 1)` (§5) | §4.9 ghi quy tắc `<ms>`; không đổi tên |
| 7 | Route thứ ba `POST /api/v1/documents/{documentID}/ai/uniwork/chat/completions` (OQ-P2) | §3 chỉ có hai route AI (org, office-frame), "hình dạng wire: G6-D1" | Không xung đột; giữ làm đề xuất G6-D1, nêu rõ cần thêm hàng vào §3 khi ký (§5) |
| 8 | Mã `ai_tool_result_too_large` (413), `ai_uniwork_busy` (429), `ai_provider_timeout` (504) | Bảng mã §4 không có ba mã này | Giữ làm đề xuất G6-D1; thêm vào bảng khi ký (§4.5, §4.6, §4.10, §4.13; Q4) |
| 9 | Dev env: `AI_PROVIDER=openai`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `AI_MODEL_ALLOW`, `AI_MODEL_OFFICE_UNIWORK_AI`; capability `office_uniwork_ai` | Cùng tên, cùng giá trị cloud (`fake`, không đặt gì) (§8) | Khớp, chỉ thêm trích dẫn (§2, §4.1) |
| 10 | `office.ai_cloud`, không migration | Đã đóng bởi U-13, §5 hàng 6 | Khớp, thêm trích dẫn (§4.14) |
| 11 | Các seam `router.go`, `openapi.go`, `main.go`, isolation matrix nhắc rải rác | Lead D giữ, sửa nối tiếp qua root (§2) | Thêm nhắc ở §4.11 và §5 |
| 12 | Không nhắc "My AI"/model theo tài khoản (UNI-1240) | §1: G6-02/G6-03c xác minh đường dẫn cụ thể khi dùng | Spike không đụng nên **chưa xác minh**; để G6-03c (Q5) |
| 13 | (ngoài contract-p0) spine UX `docs/office/g5g6g7/ux/EXPERIENCE.md:134` (Result chip luật 2) vẫn ghi "Chưa hỗ trợ nếu server báo tool call bị bỏ hoặc `finish_reason = tool_not_allowed`" | — | Báo cáo bỏ `tool_not_allowed` (§4.12: call bị lọc chỉ đi qua `x_uniwork.dropped_tool_calls`, `finish_reason` chuẩn). Spine phải bỏ vế `finish_reason = tool_not_allowed` để G6-05u không cài nhánh cho giá trị server không bao giờ gửi. Spine **không** là path của lane: **Advisor sửa khi đóng G6-D1** |
| 14 | (ngoài contract-p0) `aiErrWorkbookTooLarge` (`EXPERIENCE.md:524,1001`) là câu chỉ cho web ("mở bằng ứng dụng") | — | 413 `ai_tool_result_too_large` cũng tới desktop (§4.6): cần một chuỗi desktop vi/en không có hành động mở ứng dụng. Follow-up UX cho **Advisor/UX owner** (spine), G6-05u dùng chuỗi đó khi có |
| 15 | `x_uniwork.terminal` chỉ đặt tên cho v1.1; G6-05 đọc nó "nếu muốn" v1.1 bật bằng server | §3: "hình dạng wire: G6-D1" | Không xung đột: hình dạng là một phần wire G6-D1 (hàng 13–14 bảng tóm tắt), ký ngay với trạng thái "dành sẵn, server không bao giờ phát ở v1"; G6-05 đọc nó từ v1, không điều kiện (§4.13) |

Câu hỏi cho lead (contract-p0 giữ nguyên):
- **Q1.** `fields.capability` của `office_capability_off` nhận giá trị gì cho UniWork AI: `ai_uniwork` (khóa của route
  capability app, §4) và `ai_uniwork_<format>`? Đề xuất dùng đúng các khóa đó.
- **Q2.** `run_limit_reached` là 429 như limiter. Ở pin `0d03b185` mọi 429 bị fork xếp "AI bận" trước khi ai đọc mã
  (desktop `overload-error.ts:10-20` → `ai-chat-error.ts:43`; web `transport.ts:107`), nên giữ 429 buộc G6-05 rẽ theo mã ở
  hai chỗ trước các bộ đó, và một bản fork thiếu nhánh sẽ tự chờ rồi báo "bận" cho một run đã hết trần. **Khuyến nghị:
  đổi `run_limit_reached` sang 409** (không lớp, cùng HTTP với `conversation_expired`, phân biệt theo mã) trước khi X-03
  phát hành: 409 không nằm trong `BY_STATUS` của web và không khớp mẫu `overloaded`, nên không bao giờ vào vòng chờ;
  đây là sửa một hàng của contract-p0 §4, cần người dùng ký cùng G6-D1.
- **Q3.** Hàng 5 của §5 ghi bảng run chỉ cần "nếu run là business state". Bảng bộ đếm run vẫn cần dù là hạ tầng AI. Xin xác nhận
  hàng 5 áp dụng vô điều kiện cho G6-03b (hoặc bộ đếm đi cùng migration hàng 4).
- **Q4.** Có thêm `ai_tool_result_too_large` (413), `ai_uniwork_busy` (429) và `ai_provider_timeout` (504, §4.13) vào
  bảng mã X-03 không, hay G6-03a/b đăng ký qua registry owner (như `conversation_expired`) khi G6-D1 đóng?
- **Q6.** Limiter `ai-uniwork` phát `ai_rate_limited` (G6-03b thêm tham số mã vào `RateLimitByIdentityBucket`, khuyến
  nghị, §4.4) hay giữ `rate_limited` của middleware hiện tại và G6-05 rẽ theo `rate_limited`? contract-p0 §4 (dòng
  `run_limit_reached`) chỉ nhắc `ai_rate_limited` như mã có sẵn, nên X-03 cần ghi một trong hai.
- **Q5.** Ai xác minh chỗ lưu "My AI"/model theo tài khoản của UNI-1240 (contract-p0 §1)? Báo cáo này không làm.

## 9. Tham chiếu

- `docs/office/g5g6g7/contract-p0.md` (X-01, đã ký U-15) §1, §2, §3, §4, §5, §8, §10, §11.
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
  `ac2-dev-run-2.json`, `notes-fork-adapter.md`, `notes-upstream-candidates.md`, `review-fe-1.md`, `review-fe-2.md` (ngoài repo).
