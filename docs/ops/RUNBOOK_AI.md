# Runbook — AI Gateway và Ask UNI

> **Trạng thái:** shipped · **Cập nhật:** 2026-10-23 · **Thành phần:** `ai.Gateway` trong tiến trình API (`server/internal/ai`) · **Liên quan:** ADR 0010, spec `2026-09-04-ai-platform-gateway-design.md`, UNI-428; file đính kèm của Hỏi UNI: spec `2026-10-22-ask-uni-attachments-design.md`, UNI-2119 (file đính kèm: mục "Hỏi UNI: file đính kèm")

Mọi lượt gọi LLM (tóm tắt họp, Ask UNI) đi qua một gateway: policy chọn model
theo capability → kiểm quota `ai.tokens` của tổ chức → ghi dòng
`ai_usage_events` trạng thái `pending` → gọi provider → kiểm tool → cập nhật
dòng với token, giá (`ai_model_rates`) và trạng thái → cộng meter entitlement
→ phát `ai.usage.updated`. Không có hàng đợi, không có worker nền: gateway
chạy trong request.

## Cấu hình

| Biến | Ý nghĩa |
| --- | --- |
| `AI_PROVIDER` | `anthropic` / `openai` / `ollama` / `fake`. Rỗng = suy từ key có sẵn (Anthropic trước). Không có gì = tắt: `capabilities.enabled=false`, client ẩn nút, không lỗi 500 |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Anthropic; `ANTHROPIC_MODEL` là override kiểu cũ, phải nằm trong allowlist |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | OpenAI-compatible (OpenAI, **OpenRouter** `https://openrouter.ai/api/v1`, Gemini OpenAI-compat, vLLM…) |
| `OLLAMA_BASE_URL` | Ollama local/on-prem, không cần key |
| `AI_MODEL_<CAPABILITY>` | Override model cho một capability (`AI_MODEL_COPILOT_ANSWER=claude-sonnet-5`); ngoài allowlist → dùng mặc định + log warn |
| `AI_MODEL_COPILOT_AGENT` | Model "Tự động" của Hỏi UNI agent (production: `claude-sonnet-5-5`). `ANTHROPIC_MODEL` đè mọi capability nên phải đặt biến này riêng; người dùng chọn model khác trong danh sách đóng, Gateway kiểm allowlist và bảng giá |
| `AI_MODEL_ALLOW` | Mở rộng allowlist (csv) cho model self-host |
| `AI_TIMEOUT_SECONDS` | Mặc định 60 |

`AI_PROVIDER=fake` cho dev và E2E: trả lời deterministic, cite mọi nguồn, không
ra mạng.

### OpenRouter (thay OpenAI trực tiếp)

1. Secret: `OPENAI_API_KEY=sk-or-v1-…` (rotate nếu key từng lộ).
2. ConfigMap `uniwork-be.env`: `AI_PROVIDER=openai`, `OPENAI_BASE_URL=https://openrouter.ai/api/v1`.
3. Model: slug dạng `openai/gpt-4o-mini` — khai báo trong `AI_MODEL_ALLOW` và
   `AI_MODEL_<CAPABILITY>` (Email Hub dùng `AI_MODEL_EMAIL_THREAD_SUMMARY`).
4. Restart `uniwork-be`; kiểm `GET …/ai/capabilities` → `enabled: true`.

`TestDeployEnvResolvesPricedModels` (`server/internal/ai/deploy_env_test.go`) đọc `deploy/app/env/uniwork-be.env` và chặn cấu hình lệch: tên model không khớp provider, model ngoài allowlist (rơi về mặc định), hoặc model chưa có giá. Rollback một đợt đổi cấu hình AI: revert commit rồi chạy `ci/scripts/rollout-uniwork.sh`.

## Số cần nhìn

| Metric | Ý nghĩa | Ngưỡng |
| --- | --- | --- |
| `uniwork_ai_calls_total{capability,status}` | Lượt gọi theo trạng thái cuối (`succeeded`, `failed`, `rejected`, `cancelled`) | `failed` > 5 % trong 10 phút = provider hoặc key hỏng; `rejected` tăng = tổ chức chạm quota, không phải lỗi |
| `uniwork_ai_latency_ms{capability}` | Vòng đi provider | p95 > 20 s = đổi model tier hoặc provider |
| `ai_usage_events` `status='pending'` quá 5 phút | Tiến trình chết giữa lượt gọi | Có = điều tra; dòng này không tính tiền (cost 0) |

## Khi có sự cố

- **Mọi lượt đều `ai_provider_error`**: kiểm key/BASE_URL, log `ai: provider error`
  (chỉ có `usage_event_id`, capability, latency và message của provider — không
  có nội dung). Tắt tính năng tạm thời bằng cách bỏ key và restart: client tự ẩn.
- **`ai_quota_exceeded` với tổ chức chưa dùng nhiều**: xem `usage_counters` meter
  `ai.tokens` và `plan_features.quota_limit` (mặc định 500k, migration 099; gói
  Starter 100k). Mỗi lời gọi trừ đủ token input, output và cache ghi; token cache
  đọc chỉ trừ 10%, làm tròn lên, theo giá nhà cung cấp. Một câu hỏi agent ở
  Ask UNI tốn ước tính 2–3k token hạn mức (từ eval live P1, 2026-10-20).
- **`ai_rate_limited` hàng loạt**: Redis lỗi hay chậm quá 100ms không còn gây 429
  — giới hạn 20 lượt/phút/người của Ask UNI fail-open như mọi limiter (ruling
  P22). 429 hàng loạt là người dùng thật vượt giới hạn, tổ chức vượt trần lời
  gọi agent, hoặc nhà cung cấp trả 429 (`ai: provider rate limited` trong log).
- **Chi phí sai**: không sửa dòng đã ghi. Thêm dòng `ai_model_rates` mới với
  `effective_at` mới; dòng cũ giữ `rate_id` cũ.
- **Model mới**: thêm vào `allowedModels` (`policy.go`) và seed rate; không
  đọc tên model từ DB hay từ người dùng.
- **Lùi migration `ai_messages.notice`** (`9991792125342925`): bản down ghi câu "Chưa đủ dữ liệu trong workspace để trả lời." vào các dòng có `notice` mà nội dung rỗng rồi mới bỏ cột, vì binary cũ phát lại mọi dòng assistant làm một lượt và provider từ chối lượt rỗng.

## UniWork AI upstream

`office_uniwork_ai` là capability của trợ lý UniWork AI trong editor Office (G6-13, UNI-1365; façade ở G6-03a). Nó đi qua
cùng một Gateway như Ask UNI nên **dùng chung provider/upstream của tiến trình**: đặt `OPENAI_*` cho UniWork AI cũng đổi
upstream của Ask UNI và tóm tắt họp trên deployment đó. Upstream riêng theo capability là ADR riêng, ngoài v1.

| Biến | Vai trò với `office_uniwork_ai` |
| --- | --- |
| `AI_PROVIDER`, `OPENAI_BASE_URL`, `OPENAI_API_KEY` | Chọn upstream (chung mọi capability); `anthropic` và `openai` hỗ trợ vòng tool-result, `fake` cho dev/CI |
| `AI_MODEL_OFFICE_UNIWORK_AI` | Chọn model riêng cho capability này (override có sẵn `AI_MODEL_<CAPABILITY>`) |
| `AI_MODEL_ALLOW` | Phải chứa model self-host/ngoài danh sách có sẵn thì override mới được nhận |

Triệu chứng và kiểm tra:

- **UniWork AI tắt / `capabilities.enabled=false`** (`ai_disabled` 503 từ route): Gateway chưa có provider. Kiểm `AI_PROVIDER`
  và key/`OPENAI_BASE_URL` của provider đã chọn, restart `uniwork-be`. `AI_PROVIDER=fake` chạy được nhưng không bao giờ báo
  UniWork AI bật cho tổ chức nào.
- **Model không như đã đặt**: `AI_MODEL_OFFICE_UNIWORK_AI` ngoài allowlist → Gateway dùng model mặc định của provider và
  ghi log cảnh báo (cùng cơ chế mục "Cấu hình"). Thêm model vào `AI_MODEL_ALLOW`, restart, kiểm lại log không còn cảnh báo.
- **`AI_PROVIDER=ollama`**: capability này từ chối rõ vì ollama chưa hỗ trợ vòng tool-result (không có model mặc định cho
  ollama); UniWork AI không bật trên deployment đó. Dùng `openai` hoặc `anthropic`.
- **Lỗi `ai_provider_error` ở lượt có công cụ**: upstream từ chối tool call/`tool_call_id` hoặc không trả tool call (một
  số model self-host không trả tool call khi `stream` là false) — đổi model, chạy lại wrapper spike (xem dưới).
- **Token/credit dev trông cao**: upstream dev cộng overhead prompt riêng; số `usage` của nó không phải tín hiệu chi phí.

Dev local: cấu hình upstream dev, cách kiểm và cách quay về `fake` ở `docs/office/g5g6g7/dev-upstream.md`; wrapper
`scripts/office/ai-upstream-spike.sh fake|dev` kiểm vòng tool-result mà không in giá trị. Production: upstream, region và
retention **chưa chọn** — chờ gate G6-D2; tới đó chỉ fixture tổng hợp chạy trên upstream dev. Không ghi base URL, host, IP
hay khóa của upstream dev ở đâu ngoài secret store/cấu hình máy dev.

## UniWork AI transcript (G6-03a, design §9)

Trợ lý UniWork AI trong editor Office giữ hội thoại **trên server**: client chỉ gửi câu hỏi mới hoặc tool-result, không
bao giờ gửi lịch sử (luật bảo mật 7). Hai bảng `ai_uniwork_conversations` / `ai_uniwork_turns`; mỗi lượt là JSON của
`provider.Message` (nội dung + tool call + tool-result) được mã hóa `server/internal/util/secretbox` (AES-256-GCM)
bằng khóa riêng `AI_CONVERSATION_KEY` — không dùng chung `AI_CREDENTIAL_KEY` để lộ một khóa không lộ cả hai.

| Mục | Giá trị |
| --- | --- |
| TTL nhàn rỗi | 30 phút kể từ `last_used_at` |
| Hạn tuyệt đối | 24 giờ kể từ `created_at` |
| Lượt giữ | 20 lượt người dùng; lượt 21 bỏ khối cũ nhất nguyên khối (không để tool-result mồ côi) |
| Hết hạn / đã dọn | 409 `conversation_expired`; client mở hội thoại mới |
| Dọn | worker TTL trong tiến trình API (mỗi phút: hết hạn, rồi tổ chức đã tắt `office_ai_uniwork`) + consumer outbox `document.deleted`, `member.removed`, `member.left`, `member.deactivated` (lane slow); `Create` xóa hội thoại cũ cùng (organization, user, document, module) trong một transaction |
| Mã hóa | `ciphertext` (BYTEA) là bản mã; server không có nhánh nào ghi plaintext |

Số cần nhìn:

| Metric | Ý nghĩa | Ngưỡng |
| --- | --- | --- |
| `uniwork_ai_uniwork_conversations_swept_total{reason="expired"}` | Hội thoại hết TTL đã xóa | tăng đều là bình thường (TTL nhàn rỗi 30 phút) |
| `uniwork_ai_uniwork_conversations_swept_total{reason="kill_switch"}` | Hội thoại bị xóa vì `office_ai_uniwork` tắt cho tổ chức | phải xuất hiện ngay sau khi tắt cờ cho một tổ chức |
| `uniwork_ai_uniwork_conversations_live` | Hội thoại còn sống | |

Khi có sự cố:

- **Mọi lượt trả `conversation_expired`**: quá TTL nhàn rỗi (kể cả giữa một run dài) hoặc hạn tuyệt đối, hoặc
  `AI_CONVERSATION_KEY` vừa bị đổi — transcript cũ không giải mã được nên bị coi là hết hạn (không có xoay khóa ở v1;
  TTL 30 phút giới hạn thiệt hại).
- **Route UniWork AI trả 503 `ai_disabled` dù Gateway bật**: thiếu `AI_CONVERSATION_KEY` (hoặc chuỗi base64 không decode
  ra 32 byte) → server chạy nhưng không có kho hội thoại (fail closed). Đặt khóa rồi restart `uniwork-be`; log
  `uniwork ai transcript store disabled` nói lý do.
- **Hội thoại không được dọn**: kiểm worker TTL còn chạy (log `uniwork ai conversation sweep`, mỗi phút) và consumer
  `ai_uniwork_conversation_cleanup` có nhận `document.deleted` / `member.*` (lane slow; `RUNBOOK_OUTBOX.md`).
- **Đọc thẳng trong `psql`**: chỉ thấy bản mã. Nghi plaintext trong `ai_uniwork_turns` = sự cố bảo mật: dừng deploy đó
  và giữ nguyên hiện trường.

## UniWork AI run + usage (G6-03b, design §6–§7)

Mỗi câu hỏi của trợ lý mở một **run** trong `ai_uniwork_runs`: server cấp id qua `X-UniWork-AI-Run`, đếm trần **10 lượt
gọi model** và **8 vòng tool-result** trên một run (A3). Luật đếm là attempt-based: lượt bị limiter/trần/quota từ chối
trước Gateway **không** đếm; một 429 của upstream (đã tới Gateway) đếm một `model_calls`, và client gửi lại đúng run id
đó sau `Retry-After` được nhận — lần thử hỏng có dòng usage `failed` 0 token, **không** tính tiền hai lần. Hết trần:
409 `run_limit_reached` (`fields.limit` = `model_calls` | `tool_rounds`); client bỏ header run và "hỏi tiếp" — run mới
trong cùng hội thoại, transcript còn nguyên. Run hết hạn theo TTL của hội thoại (30 phút nhàn rỗi / 24 h tuyệt đối,
`expires_at` ≤ hạn của conversation); id lạ/hết hạn/không thuộc hội thoại trả 409 `run_expired` (mã mới, pending G6-D1),
lượt tool-result thiếu header run trả 400 `invalid_request`. Run/usage là hạ tầng AI: **không** có hàng audit mới.

Hết credit `ai.tokens` trả 402 `credits_exhausted` (cùng hình dạng route cloud) **trước** Gateway: không dòng usage,
không `model_calls`. Provider không trả `usage` ở **capability `office_uniwork_ai`** → dòng `ai_usage_events` mang
`reason_code = usage_unknown`, token/cost 0, không cộng meter (cộng 0 là nói không ai đếm gì); lượt đối soát trong worker
TTL **ước lượng token từ transcript đã lưu** (ký tự/4, gồm cả đối số tool call), claim dòng bằng một UPDATE có điều kiện
(`usage_unknown_reconciled`, 0 hàng = pod khác đã làm) rồi cộng meter **một lần** (idempotent theo id dòng). Dòng usage
chính là hàng đợi đối soát — không có bảng thứ hai. Nhánh này chỉ thuộc UniWork AI: chỉ nó có lượt đối soát
(`AiUniworkUnknownUsageEvents` lọc `capability = 'office_uniwork_ai'`). Capability khác giữ nguyên đường đã định giá
trước 03b: provider không trả usage ⇒ dòng `succeeded` cost 0 và vẫn cộng meter, nên không có hàng nào nằm chờ vô chủ và
`ObserveAIUsage` vẫn lấy mẫu cho chúng.

Số cần nhìn:

| Metric | Ý nghĩa | Ngưỡng |
| --- | --- | --- |
| `uniwork_ai_uniwork_runs_swept_total{reason="expired"}` | Run hết TTL đã xóa | Tăng đều là bình thường |
| `uniwork_ai_uniwork_runs_swept_total{reason="orphan"}` | Run mồ côi (hội thoại đã bị dọn) | Phải theo sau mỗi lần hội thoại bị dọn trong ≤ 1 phút |
| `uniwork_ai_uniwork_usage_unknown_total` | Lượt gọi `office_uniwork_ai` mà provider không trả usage (capability khác không vào nhánh này) | Tăng = upstream đổi hành vi, **không** phải sự cố: đối soát định giá sau; đối chiếu `ai_usage_events` reason_code `usage_unknown` (hàng đợi) và `usage_unknown_reconciled` (đã định giá) |
| `uniwork_ai_uniwork_usage_reconciled_total` | Dòng đối soát đã định giá | Theo sau `usage_unknown`; đứng ở 0 trong khi unknown tăng = lượt quét không chạy, hoặc transcript đã hết hạn trước khi kịp đối soát (log `ai: usage reconcile: transcript gone`) |
| `uniwork_ai_uniwork_run_seconds` | Tuổi run tại mỗi lượt trả lời | Lượt cuối của run = độ dài run; gần 0 liên tục = client mở run mới mỗi lượt (trần không giữ được) |
| `uniwork_ai_uniwork_run_credits` | Token run đã tiêu sau mỗi lượt | Lượt cuối = tổng của run; vọt bất thường = điều tra prompt/upstream |
| `uniwork_ai_uniwork_dropped_tool_calls_total{reason}` | Call bị allowlist bỏ (`view_only`, `not_allowlisted`) | `view_only` tăng = client gửi write tool khi chỉ có quyền xem |

Khi có sự cố:

- **`run_limit_reached` nhiều**: bình thường khi người dùng làm việc dài; nếu tăng vọt, kiểm client có gửi lại header
  run đúng không (mỗi lượt một run mới = mất trần, xem `run_seconds`).
- **`run_expired` hàng loạt**: client trộn run id giữa các hội thoại, hoặc giữ id qua TTL nhàn rỗi 30 phút.
- **Meter không tăng dù lượt thành công**: đọc dòng `ai_usage_events` (reason_code, input/output tokens) và
  `usage_counters` meter `ai.tokens`; `usage_unknown` đang chờ đối soát — không phải mất tiền.
- **Đối soát không tiến**: kiểm worker TTL còn chạy (log `uniwork ai conversation sweep`) và khóa `AI_CONVERSATION_KEY`
  chưa xoay (transcript cũ không giải mã được).

Alert của `office_uniwork_ai` (lỗi, latency, usage unknown, run, tool call bị bỏ): `deploy/alerts.yml` nhóm `uniwork-ai`,
runbook theo tên alert trong [`docs/runbooks/README.md`](../runbooks/README.md) (ngưỡng pending G7-D1). Upstream sập/đổi,
đối soát usage và trần đồng thời: [`RUNBOOK_OFFICE_SYNC.md`](RUNBOOK_OFFICE_SYNC.md).

## Hỏi UNI agent (P1)

Hỏi UNI chạy như agent đọc (vòng model → tool → model) khi flag `ask_uni_agent` bật cho người hỏi và tổ chức của họ.

- **Bật/tắt**: ở `/admin/flags`, đặt override `ask_uni_agent` theo tổ chức hoặc theo người dùng (override thắng file tĩnh và `FF_ASK_UNI_AGENT`). Tắt = quay về luồng retrieval cũ, không mất dữ liệu.
- **Provider**: agent cần vòng tool-result, nên chỉ chạy trên `anthropic`, `openai` (và `fake`). `AI_PROVIDER=ollama` không có model `copilot_agent`: Hỏi UNI ở luồng retrieval cũ dù flag bật.
- **Model Tự động**: đổi bằng `AI_MODEL_COPILOT_AGENT` (phải nằm trong allowlist, xem bảng cấu hình ở trên). Tự động (model mặc định của nền tảng) **luôn dùng được** và không theo công tắc của tổ chức.
- **Model tổ chức cho chọn**: `GET/PUT /api/v1/orgs/{org}/ai/ask-models` (body `{"models": ["haiku","sonnet"]}`, PUT chỉ owner/admin). Công tắc này chỉ giới hạn các lựa chọn rõ: `[]` = chỉ Tự động; body thiếu `models` (hoặc `null`) → 400, không bao giờ hiểu là "tắt hết". Lựa chọn không dùng được (lạ, tắt, chưa có giá) thì chạy Tự động và log `reason` (`unknown`, `disabled`, `unpriced`, `lookup_failed` khi đọc DB lỗi), không log chuỗi client gửi.
- **Lượt hỏng sau khi đã tính tiền**: lỗi provider, timeout, hết hạn mức hay lỗi DB trong tool sau ít nhất một lời gọi model đã trả lời thì lượt vẫn được lưu với notice `agent_failed` (nội dung rỗng, gắn usage row cuối) để người hỏi thấy trong hội thoại; trước lời gọi đầu tiên thì vẫn trả lỗi như cũ.

| Metric | Loại | Ý nghĩa |
| --- | --- | --- |
| `uniwork_ai_ask_runs_total{outcome}` | counter | Lượt agent theo `answered`, `agent_failed`, `refused`, `rate_limited`, `busy`, `timeout`, `stopped`, `interrupted`, `rejected`. `rejected` là lượt trả lời lại (regenerate) bị từ chối: câu trả lời đích không còn là câu cuối khi lượt bắt đầu chạy, hoặc lượt thua một câu trả lời mới hơn tại bước lưu. Đó là lời từ chối, không phải lượt lỗi. `stopped` là người hỏi bấm Dừng (hoặc đóng kết nối); `interrupted` là lượt bị cắt vì server tắt (xem "Hỏi UNI stream"). `rate_limited` gồm giới hạn của nhà cung cấp, trần lời gọi của tổ chức và hết hạn mức token. `timeout` là hết hạn 120 giây của lượt, hoặc một lời gọi model quá hạn của gateway (mặc định 60 giây). `agent_failed` còn gồm: lỗi hạ tầng (provider 5xx, lỗi DB, lưu lượt thất bại, panic), focus người hỏi không được đọc (`ai_context_forbidden`), và lần thử lại định dạng vẫn hỏng |
| `uniwork_ai_ask_run_rounds` | histogram (0–4) | Số vòng tool mỗi lượt, trần 4; dồn về 4 = agent chạm trần vòng tool (lời gọi sau vòng cuối là vòng trả lời) |
| `uniwork_ai_ask_run_seconds` | histogram (tới 150s) | Thời gian một lượt; hạn chót 120s nên bucket 120–150 là lượt chạm hạn |
| `uniwork_ai_ask_tool_calls_total{tool,status}` | counter | Call tool theo 12 tên trong registry (tên khác gom về `other`) và `ok`, `error`, `truncated` |
| `uniwork_ai_ask_tool_seconds{tool}` | histogram | Độ trễ từng tool |

Khi chi phí tăng đột biến:

1. Xem `uniwork_ai_cost_usd_total{model}` để biết model nào đẩy chi phí, và `AiSumRunUsage` (sqlc, theo tổ chức + run id) để biết run nào.
2. Hạ model Tự động (`AI_MODEL_COPILOT_AGENT`), hoặc tắt Opus của tổ chức bằng `PUT /api/v1/orgs/{org}/ai/ask-models`.
3. Chưa đủ: tắt `ask_uni_agent` cho tổ chức đó bằng override.

## Hỏi UNI stream (P2)

Dock mới của Hỏi UNI nhận câu trả lời qua SSE thay vì chờ cả lượt.

- **Route**: `POST /api/v1/workspaces/{workspaceID}/ai/ask/stream`, cùng body với `POST …/ai/ask`. Từ chối trước sự kiện đầu (không đăng nhập, không phải thành viên, hết hạn mức, rate limit…) trả JSON như route cũ; sau sự kiện đầu, lỗi là sự kiện `error` chỉ mang `code`. Route không bị chặn bởi flag.
- **Khung SSE**: `event: <tên>` + `data: <json>`; các tên là `run`, `step`, `sources`, `delta`, `citations`, `followups`, `done`, `title`, `error` (P2b thêm `sources`, `followups`, `title`, xem dưới). Một lỗi sau `run` là sự kiện `error` chỉ mang mã, không có `done`. Mỗi 15 giây có một dòng `: ping` để proxy không cắt kết nối rỗng. Header: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
- **Proxy phía trước**: phải để SSE đi thẳng. Với nginx, `X-Accel-Buffering: no` đã tắt buffering cho route này; nếu cấu hình đè header đó thì đặt `proxy_buffering off` cho location `…/ai/ask/stream`. `proxy_read_timeout` ≥ 130 giây (hạn một lượt là 120 giây, cộng ping). Triệu chứng sai cấu hình: chữ không hiện dần mà đến một lúc rồi hiện hết, hoặc kết nối rớt đúng ở mốc timeout của proxy.
- **Dừng**: client đóng kết nối (nút Dừng) hoặc writer chết thì lượt bị hủy. Lượt được lưu với notice `stopped` (câu hỏi và phần trả lời đã có); metric `uniwork_ai_ask_runs_total{outcome="stopped"}`.
- **Dừng và tính tiền**: lời gọi model đang chạy khi bị dừng không biến mất. Dòng `ai_usage_events` có `status='cancelled'` với `reason_code` là `ai_cancelled` (người dùng dừng) hoặc `ai_provider_timeout` (hết `Options.StreamTimeout`, 120 giây). Dòng này được định giá và cộng meter `ai.tokens` như dòng `succeeded`; nếu provider chưa báo token thì ước lượng `ceil(số byte / 3)` (đầu ra từ chữ đã nhận, đầu vào từ request). Chưa nhận được gì (không chữ, không token) thì dòng ghi cost 0 và không trừ. `uniwork_ai_calls_total{status="cancelled"}` đếm các dòng này; `cancelled` nhiều là người dùng dừng nhiều, chỉ điều tra khi đi cùng `ai_provider_timeout`.
- **Tắt server**: `main.go` gọi `askUNI.Shutdown()` trước khi dừng HTTP; các lượt đang chạy bị hủy và lưu với notice `interrupted` (client hiện "Câu trả lời bị gián đoạn nên chưa đầy đủ."), metric outcome `interrupted`. Một đợt deploy làm `interrupted` tăng một nhịp là bình thường; tăng khi không deploy = pod bị kill.
- **Flag `ask_uni_stream`** (Public, mặc định tắt): bật thì client dùng dock mới và route stream, tắt thì giữ panel cũ và `POST …/ai/ask`. Đặt override theo tổ chức ở `/admin/flags`. Rollback: tắt flag (override hoặc `FF_ASK_UNI_STREAM`); route cũ vẫn chạy nguyên, không mất hội thoại hay dữ liệu. Flag chỉ đổi giao diện, nên tắt flag không cắt một lượt đang stream.
- **Phản hồi và đổi tên**: `PUT`/`DELETE …/ai/conversations/{conversationID}/messages/{messageID}/feedback` và `PATCH …/ai/conversations/{conversationID}` ghi bảng `ai_message_feedback` và tiêu đề hội thoại; không có hàng audit.

### P2b: nguồn, gợi ý tiếp, tiêu đề, trả lời lại

- **Sự kiện SSE mới**: `sources` (nguồn tìm được, đến trước chữ để dock hiện thẻ sớm), `followups` (câu hỏi gợi ý, đến trước `done`) và `title` (`conversation_id` + `title`). `step` giờ mang thêm `label` (tên đối tượng đang tra, không phải chuỗi giao diện).
- **Tiêu đề**: `title` đến SAU `done`, chỉ ở câu trả lời đầu của hội thoại mới. Server gọi một lần capability `copilot_title` (tầng fast, tối đa 32 token, prompt `conversation_title@1`; đổi model bằng `AI_MODEL_COPILOT_TITLE` như các capability khác, phải nằm trong allowlist). Gọi hỏng, quá 10 giây, tiêu đề rỗng hoặc người dùng đã đổi tên trước đó: hội thoại giữ câu hỏi làm tiêu đề, không có sự kiện `title`, không phải lỗi (chỉ một dòng log warn theo id). Lời gọi này đi qua Gateway nên tính tiền và meter như mọi lời gọi khác. Người hỏi đóng panel ngay sau `done` không hủy lời gọi (hủy giữa chừng vẫn bị tính tiền): tiêu đề vẫn được lưu, chỉ sự kiện `title` không được gửi.
- **Trả lời lại**: body có `regenerate_message_id` (chỉ route stream; `question` bị bỏ qua, dùng câu hỏi và ngữ cảnh đã lưu). Chỉ câu trả lời cuối của hội thoại trong dock được trả lời lại; id khác trả 400. Câu trả lời cũ được đánh dấu `superseded_at` (không xóa), câu mới thay tại chỗ. Hai lượt trả lời lại cùng lúc: lượt thua bị từ chối ở bước lưu và tính vào `uniwork_ai_ask_runs_total{outcome="rejected"}`. Lượt trả lời lại không ra được câu trả lời (model từ chối, lỗi sau một lời gọi đã tính tiền, định dạng hỏng sau lần thử lại, hoặc bị dừng trước khi có chữ) không lưu gì và không đánh dấu câu cũ: stream kết thúc bằng `error`, câu trả lời cũ vẫn hiện, các lời gọi đã chạy vẫn tính tiền. Dừng sau khi đã có chữ thì phần chữ đó thay câu cũ, như lượt thường.

## Hỏi UNI: file đính kèm (UNI-2119)

Người hỏi gắn tối đa 5 file vào một câu hỏi; UNI đọc chúng ở mọi vòng của lượt đó và của các lượt sau trong cùng cuộc trò chuyện. Chỉ chạy trên đường agent: đường P0 không đọc file. Spec: `docs/superpowers/specs/2026-10-22-ask-uni-attachments-design.md`. Cờ mặc định tắt. Eval thật cho `copilot_answer@5` chưa chạy (`ASKUNI_EVAL.md`), nên đừng bật cho người dùng thật trước khi chạy và được chủ sản phẩm duyệt.

- **Route**: `POST /api/v1/workspaces/{workspaceID}/ai/attachments` (multipart, field `file`; trả `file_id`), `DELETE …/ai/attachments/{fileID}` (bỏ file chưa gắn), `GET …/ai/attachments/{attachmentID}/content` (tải về file một câu hỏi đã gắn). `attachment_ids` là trường của `POST …/ai/ask` và `…/ai/ask/stream`; `GET …/ai/capabilities` có trường `attachments`, là cái client dùng để hiện hay ẩn nút tải file. Cả ba route chỉ dành cho chính người hỏi: file của người khác, của workspace khác hay của tổ chức khác đều là 404.
- **Cờ `ask_uni_attachments`** (`server/internal/featureflags/keys.go`, mặc định tắt, không Public, `review_at` 2027-03-31): bật ở `/admin/flags` bằng override theo tổ chức hoặc người dùng. Chỉ có tác dụng khi lượt hỏi chạy agent, tức `ask_uni_agent` bật, công cụ đọc đã nối và có model `copilot_agent` (`AI_PROVIDER=ollama` thì không). `capabilities.attachments` là `true` khi cả hai điều kiện đúng.
- **Tắt tính năng**: đặt override `ask_uni_attachments=false` (hoặc `FF_ASK_UNI_ATTACHMENTS`). Client ẩn nút tải file ở lần đọc capabilities kế tiếp; server từ chối upload và `attachment_ids` bằng `ai_attachments_unavailable`; lượt đang chạy xong bình thường. Lượt hỏi tiếp không đọc lại file của câu trước nữa. Không mất dữ liệu: file đã gắn vẫn hiện trong lịch sử và vẫn tải về được (tải về chỉ cần là thành viên và là chủ file, không cần cờ), nên tắt cờ là rollback an toàn. Tắt `ask_uni_agent` cũng làm cờ này vô hiệu.

| Giới hạn | Giá trị |
| --- | --- |
| Loại file (xét theo nội dung, không theo đuôi) | ảnh JPEG/PNG/GIF/WebP, PDF, DOCX, XLSX, PPTX, ODT, TXT, CSV, Markdown; DOC, XLS, PPT và loại khác bị từ chối |
| Một file | 20 MB; ảnh tối đa 7,5 MB và 8000 × 8000 điểm ảnh (giới hạn một ảnh của Anthropic: 10 MB khi mã hóa base64), từ chối ngay lúc tải lên |
| Một câu hỏi | tối đa 5 file, tổng 20 MB |
| Một lượt (file của câu hiện tại cộng file của các câu còn trong lịch sử) | tối đa 5 file, tổng 20 MB; file gắn sau được ưu tiên; file cũ không vừa thì lượt đó bỏ qua nó |
| Phần token dành cho file | 30.000 mỗi lượt, chia theo thứ tự gắn (`askFileTokenShare`); ước lượng PDF 2.000 token một trang, ảnh 4.800 token, chữ `ceil(số rune / 3)` |
| Ngân sách đầu vào của lượt | 60.000 token như cũ; riêng lượt có file, token đọc từ cache chỉ tính 1/10 vì file gửi lại ở mọi vòng |
| Lượt có file cùng lúc | 2 mỗi tiến trình, giữ suốt lượt; mở và đọc file thì 1 lúc một (xem dưới) |
| Một lần mở PDF | tối đa 131.072 object, 4 MiB một object, 10.000 object một object stream, 16 MiB một stream giải nén; heap sống tăng quá 48 MiB cộng ba lần cỡ file (chừng 108 MiB với file 20 MB: pdfcpu giữ bản sao mọi stream, bản cắt hay bản bỏ mã hóa ghi vào một bộ đệm cấp một lần bằng cỡ file, nên PDF scan cần chừng hai lần cỡ file; phần còn lại chừa cho object đã phân tích và lời gọi model của lượt kia) thì dừng và coi là `ai_attachment_unreadable`; mức nền đo sau một lần dọn rác. Một PDF chỉ mở một lần, PDF có mật khẩu chủ luôn được ghi lại không mã hóa trước khi gửi |
| Một lần đọc file Office hay văn bản | giữ tối đa 4 MiB chữ (phần token chỉ dùng được chừng 90.000 ký tự); phần sau chỉ được đếm, không giữ, nên file lớn được đọc phần đầu chứ không bị từ chối. Mỗi sheet của Excel giữ các dòng đầu trong phần của nó. Giải nén tối đa 64 MiB (zip bomb thì từ chối), bảng chuỗi dùng chung, danh sách sheet và quan hệ tối đa 16 MiB, thư mục zip tối đa 1 MiB; một dòng văn bản đọc theo từng đoạn và cắt ở 1 MiB |

File vượt phần token thì UNI đọc phần đầu (N trang đầu của PDF; với Excel, phần token chia đều cho các sheet và mỗi sheet giữ các dòng đầu, phần sheet nào dùng không hết chuyển cho sheet sau) và ghi lại trong `ai_messages.file_notes` của câu trả lời; client hiện dòng "UNI đã đọc … trên …" lấy từ đó và từ sự kiện `done`, không phụ thuộc model có tự nói hay không.

| Mã lỗi | HTTP | Nghĩa | Việc cần làm |
| --- | --- | --- | --- |
| `ai_attachments_unavailable` | 403 | Cờ `ask_uni_attachments` tắt cho người này, hoặc lượt hỏi sẽ không chạy agent, hoặc server không có kho file | Bật cờ và `ask_uni_agent`, kiểm provider không phải `ollama`; không phải sự cố nếu cờ cố ý tắt |
| `ai_attachments_invalid` | 400 | Quá 5 file, cùng một id hai lần, hoặc có `attachment_ids` trong lượt trả lời lại | Lỗi client; trả lời lại không nhận file mới, nó đọc lại file của câu gốc |
| `ai_attachments_too_large` | 422 | File của một câu cộng lại quá 20 MB; hoặc, ở route tải lên, ảnh quá 7,5 MB hay quá 8000 × 8000 điểm ảnh (thông điệp nêu giới hạn, file bị từ chối không được giữ) | Lỗi người dùng; client cũng báo trước |
| `ai_attachment_unreadable` | 422 | File đúng loại nhưng hỏng hoặc có mật khẩu (DOCX hỏng, PDF mã hóa), hay quá phức tạp để mở an toàn (PDF cần hơn 48 MiB cộng ba lần cỡ file, bảng chuỗi của Excel quá 16 MiB). Câu hỏi không được lưu và không có lời gọi model; thông điệp nêu tên file, client đánh dấu đúng thẻ file đó. Ở route tải lên: ảnh có phần đầu không đọc được | Người dùng gỡ hoặc thay file; metric `uniwork_ai_ask_runs_total{outcome="rejected"}` |
| `media_unsupported` | 422 | Provider đang chạy không nhận loại file này (ví dụ PDF với OpenAI). Với route stream, đây là sự kiện `error` sau sự kiện đầu | Đổi sang provider đọc được (`anthropic`) hoặc tắt cờ; không lẳng lặng bỏ file |
| 404 trơn, không có `code` riêng | 404 | Một id không phải file chưa gắn của chính người hỏi trong workspace này: của người khác, đã quá 24 giờ, đã hủy hoặc đã gắn vào câu khác. Mọi trường hợp cùng một câu trả lời để không lộ id có tồn tại | Không điều tra như lỗi; người dùng tải lại file |
| `too_large` / `file_too_large` (413), `file_type_rejected` (415) | 413, 415 | Từ route tải lên: file quá 20 MB, hoặc loại không nhận | Lỗi người dùng |
| lỗi 500 | 500 | Kho file không đọc được (mất kết nối kho). Cố ý không phải `ai_attachment_unreadable`, để người dùng không bị bảo file của họ hỏng khi kho đang sập | Xem kết nối tới kho file và log của `uniwork-be`; lượt không lưu gì, người dùng hỏi lại được |

**Trần 2 lượt có file.** Backend chạy một pod 512 MiB, `GOMEMLIMIT=400MiB` (`deploy/app/uniwork/values.yaml`, `deploy/app/env/uniwork-be.env`), và chỉ một replica cho tới khi ADR 0025 §3 thỏa. Một lượt có file mang tới 20 MB file trong mọi lời gọi model của nó, thêm chừng 27 MB khi lời gọi dựng JSON (base64), suốt lượt. Nên mỗi tiến trình `uniwork-be` chỉ cho 2 lượt có file chạy cùng lúc (`askFileTurns` trong `askuni_turn_files.go`), giữ chỗ từ lúc đọc file tới khi lượt kết thúc, ở mọi đường ra (trả lời, dừng, lỗi, file không đọc được); việc đặt tên cuộc trò chuyện sau đó không giữ chỗ. Trong hai lượt đó, mở và đọc file thì một lúc một (`fileReads`), nên chỉ một PDF hay file Office được mở tại một thời điểm, tối đa thêm chừng 108 MiB với PDF 20 MB. Cộng lại: 2 lượt × chừng 47 MB cộng một lần mở, dưới `GOMEMLIMIT`. "Lượt có file" gồm cả câu hỏi tiếp theo không gắn file mới nhưng lịch sử còn file của câu trước. Lượt không file không bao giờ phải chờ. Đổi trần bằng sửa hằng số, không có biến môi trường.

Khi hai chỗ đang bận, lượt có file chờ theo hạn của chính nó (120 giây); chưa có model nào được gọi và chưa có gì được lưu, hết hạn thì người dùng thấy lỗi quá thời gian và hỏi lại được. Dấu hiệu bão hòa: không có metric riêng cho hàng chờ, nên nhìn `uniwork_ai_ask_runs_total{outcome="timeout"}` tăng và bucket 120–150 giây của `uniwork_ai_ask_run_seconds` dày lên. Số dòng mới của `ai_attachments` chỉ cho biết bao nhiêu câu có file được gửi (lưu lượng), không cho biết lượt nào đang kẹt: câu bị chờ hết hạn không ghi dòng nào. Bộ nhớ pod tiến gần 400 MiB là dấu hiệu GC phải chạy liên tục. Không thêm replica để gỡ (một replica theo ADR 0025); cách xử lý là tắt cờ `ask_uni_attachments` cho tổ chức đang dồn tải trong lúc điều tra.

**Vòng đời của file.** File sống theo cuộc trò chuyện. Tải lên mà chưa gửi thì file chỉ nằm trong kho dùng chung, chưa có dòng `ai_attachments`, và cửa sổ nhận của kho đóng sau 24 giờ (`files.ClaimTTL`); file quá hạn do collector của kho file dọn, mỗi ngày một lần (`RUNBOOK_FILE_GC.md`), nên vật lý có thể còn thêm tới một ngày. Không có worker riêng của Hỏi UNI. Gửi câu hỏi thì server nhận file và ghi dòng `ai_attachments` trong cùng giao dịch lưu câu hỏi; câu bị từ chối thì file vẫn là file chưa gắn. Bấm × trước khi gửi gọi `DELETE …/ai/attachments/{fileID}`. Xóa cuộc trò chuyện xóa các dòng `ai_attachments` và nhả file trong cùng giao dịch; object trong kho do cùng collector xóa ở lượt quét sau, không tức thì (`FILE_GC_MODE=dry_run` hoặc `off` hoãn việc xóa). Chữ rút ra từ file không bao giờ được lưu: mỗi lượt đọc lại từ file gốc trong kho, nên không tìm văn bản của file trong bảng nào. Bản xuất dữ liệu của tổ chức có `ai_attachments` chỉ với thông tin file (tên, loại, dung lượng, ngày, cuộc trò chuyện và tin nhắn), không có file gốc.

**Prompt và chi phí.** Lượt có file chạy `copilot_answer@5`, kể cả câu hỏi tiếp theo không gắn file mới mà lịch sử còn file của câu trước (lượt đó đọc lại các file ấy); lượt không file nào giữ `@4` (dock) hoặc `@3` như trước, nên bật tính năng không đổi chi phí của cuộc trò chuyện không có file. Xem phần của file trong chi phí bằng `ai_usage_events.prompt_id`:

```sql
SELECT prompt_id, count(*) AS calls, sum(cost_micros) AS cost_micros
FROM ai_usage_events
WHERE capability = 'copilot_agent' AND created_at > now() - interval '7 days'
GROUP BY prompt_id;
```

Spec ước một câu có file đắt thêm khoảng 0,01–0,03 USD với Sonnet 5.5 (file được tính đủ ở vòng đầu rồi 1/10 ở các vòng sau); đó là ước lượng, chưa đo bằng eval thật. Khi chi phí tăng bất thường, làm như mục "Hỏi UNI agent (P1)" và tắt `ask_uni_attachments` trước khi tắt `ask_uni_agent`.

**Khi lùi migration.** Tắt cờ trước, rồi lùi theo thứ tự ngược: `9991792710000300_ai_messages_file_notes` bỏ cột `file_notes`; `9991792710000203_ai_attachments_file_idx`, `…202_ai_attachments_message_idx` và `…201_ai_attachments_conversation_idx` bỏ ba index của bảng (mỗi file một câu `DROP INDEX CONCURRENTLY`); `9991792710000200_ai_attachments` bỏ bảng `ai_attachments` (file đã gắn vẫn nằm trong kho, không còn dòng nào trỏ tới); `9991792710000100_file_purpose_ai_attachment` xóa các phiên tải lên mục đích `ai_attachment` trước khi thu hẹp CHECK.

## Không bao giờ

- Không log prompt, nguồn hay câu trả lời. `ai_messages` là dữ liệu người dùng,
  xóa được từ panel. Cũng không log tên hay nội dung file đính kèm.
- Không gọi SDK provider ngoài `internal/ai/provider`; không cho `internal/ai`
  chạm bảng nghiệp vụ (`arch_test.go`).
