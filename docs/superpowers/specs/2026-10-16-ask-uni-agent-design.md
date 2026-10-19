# UniWork — Hỏi UNI v2: agent làm việc như ClickUp Brain

> **Trạng thái:** in-progress — chủ sản phẩm duyệt 2026-10-16; kế hoạch P0: `docs/superpowers/plans/2026-10-16-ask-uni-p0.md`; issue UNI-1818.

**Ngày:** 2026-10-16
**Issue:** UNI-1818 (P0; sub-issue UNI-1819…1823).
**ADR mới:** 0034 — chế độ quyền của Hỏi UNI, mở rộng ADR 0033 cho kênh Hỏi UNI (§6.4); viết trong PR đầu tiên chạm hành động ghi (P3).
**Liên quan:** ADR 0007 (actor), ADR 0008 (tenant), ADR 0010 (AI không ghi trực tiếp), ADR 0029 (AI Office qua gateway, D5 tính tiền), ADR 0031 (MCP, OAuth), ADR 0033 (tool ghi MCP chạy bằng actor Human); spec F-09 `2026-09-04-ai-platform-gateway-design.md`; spec MCP `2026-10-12-mcp-connector-design.md`.

Tài liệu này được viết sau một buổi trao đổi với chủ sản phẩm. Mục ghi **(chủ sản phẩm chốt)** là quyết định của họ; mục ghi **(người viết quyết)** là lựa chọn của người viết spec, người xây dựng được đổi nếu có lý do và ghi lại.

---

## 1. Ý định

Hỏi UNI hôm nay là một ô hỏi–đáp: khớp từ khóa trong task, cuộc họp, chat, rồi gọi model một lần để trả lời có trích dẫn. Nó không hiểu câu hỏi tiếp theo, không lọc theo hạn/người/ưu tiên, không viết được gì ngoài nội dung nguồn, và không làm được việc gì.

Chủ sản phẩm muốn UNI **hoạt động như ClickUp Brain**: hiểu ý câu hỏi trong ngữ cảnh đang làm, tự tìm dữ liệu qua nhiều bước, viết tự do khi được nhờ, làm việc thay người dùng trong phạm vi người đó cho phép, và nhớ sở thích từng người.

Thành công nghĩa là một trưởng nhóm hỏi "việc nào của Marketing đang trễ, ai nên nhận lại?" và nhận câu trả lời đúng, có nguồn, kèm đề xuất giao lại mà họ bấm một lần là xong.

## 2. Hiện trạng (đã kiểm tra trong code ngày 2026-10-16)

- Luồng một lượt hỏi (`server/internal/service/askuni.go:151`): kiểm tra câu hỏi → `RequireMember` → rate limit Redis 20 câu/phút/người → lấy nguồn bằng từ khóa (`askuni_sources.go`) → `ai.BuildContext` (tối đa 20 nguồn, ~12k token) → gói rỗng thì trả câu cố định tiếng Việt, không gọi model (`ai/citations.go:24`) → `gateway.Complete` một lần với prompt `copilot_answer@1` có `OutputSchema`, nên gateway không gửi tool cho model (`ai/gateway.go:197`) → `ParseAnswer` lọc citation → lưu 2 dòng `ai_messages` → trả JSON một lần, không stream.
- Model: `claude-opus-5`, 1.500 token, temperature 0 (`ai/policy.go:53`). Server chỉ chạy **một** nhà cung cấp (`ai.FromEnv`); model cố định theo capability qua biến môi trường; allowlist ở `policy.go:116`. Bảng giá (`092_ai_gateway.up.sql:75-77`): Opus 5 $15/$75, Sonnet 5 $3/$15, Haiku 4.5 $1/$5 mỗi triệu token vào/ra.
- Lỗi đã thấy (chạy thật với `AI_PROVIDER=fake` hoặc đọc code):
  - Panel bị primitive `Sheet` ép rộng 384px (desktop) và 75% (mobile): `w-full sm:max-w-lg` thua `data-[side=right]:w-3/4 sm:max-w-sm`.
  - Enter gửi khi đang gõ dở Telex/VNI (thiếu kiểm `isComposing`).
  - Nháy giao diện sau khi có câu trả lời; đổi workspace vẫn giữ `conversationId` → hỏi tiếp bị 404.
  - `ai_provider_timeout`, `ai_tool_not_allowed` không được map lỗi; câu "Chưa đủ dữ liệu" cứng tiếng Việt, hiện cả trong giao diện tiếng Anh.
  - Tìm kiếm không hiểu mã task (`ORI-1`), không tìm tài liệu, không chuẩn hóa dấu, nạp toàn bộ task/cuộc họp mỗi câu hỏi.
  - Tiêu đề nguồn nằm ngoài thẻ `<untrusted>` (`ai/context.go:85`); `</untrusted>` trong nội dung không bị escape; câu trả lời cũ được gửi lại như lượt assistant tin cậy.
  - Model trả sai định dạng → quota đã trừ nhưng không lưu gì.
  - Hủy giữa chừng bị ghi `provider_error`, không tính tiền (`gateway.go:211-240`), trái ADR 0029 D5.
- Phần có sẵn để dùng lại:
  - Tool đọc/ghi của MCP chạy bằng quyền người dùng (`service/mcp_tools*.go`): nhận mã `PREFIX-N`, tìm tài liệu, ẩn lý do từ chối. Gate ghi nằm ở handler (`handler/mcp_transport.go:57,169`), không ở service.
  - `ToolResultTurn` trong gateway; run store, giới hạn vòng, `MeterKey` theo vòng, giới hạn đồng thời theo tổ chức của UniWork AI Office (`service/ai_uniwork.go`). Vòng lặp của Office do client điều khiển; **chưa có** vòng agent phía server.
  - Chuẩn hóa dấu: `foldForSearch` (`service/search_text.go:15`) và SQL `uw_fold_search` (migration `9991791780000004`).
  - `audit.WithVia` ghi `metadata.via`; hiện chỉ request `/mcp` đặt giá trị này.
  - Extension mention tiptap (`packages/views/editor/extensions/mention-extension.ts`).
  - **Streaming chưa có gì để dùng lại**: provider không có hàm stream (`openai.go:65`, `ollama.go:44` gửi `stream:false`); `WriteUniworkSSE` gửi cả câu trả lời trong một chunk.

## 3. Mục tiêu, không làm, không được thành

**Mục tiêu**
1. Trả lời đúng các câu hỏi công việc thường ngày bằng tiếng Việt, kể cả không dấu, câu hỏi tiếp theo, gọi theo mã task.
2. Tự tìm dữ liệu qua nhiều bước trong task, dự án, cuộc họp, tài liệu, chat, thành viên mà người hỏi được xem.
3. Viết tự do (email, mô tả, bình luận nháp, báo cáo); vẫn trích dẫn khi khẳng định dữ kiện về công việc.
4. Làm việc thay người dùng theo chế độ quyền họ chọn (§5.3).
5. Hiện chữ chạy dần, có nút Dừng.
6. Cho người dùng chọn model Claude (§5.4).
7. Nhớ sở thích từng người (P4).

**Không làm ở bản này:** đa nhà cung cấp (GPT, Gemini); kết nối Drive/Slack/Gmail; tìm web, deep research; tạo slide/dashboard; agent chạy nền theo lịch; @UNI trong bình luận; prompt lưu sẵn `/`; file đính kèm (phân tích file là capability flagship riêng, để sau P4).

**Không được thành**
- UNI làm một thay đổi mà người dùng không biết, không thấy, không hoàn tác được.
- Nội dung do người khác viết điều khiển được hành động ghi của UNI.
- UNI cho người hỏi thấy dữ liệu họ không được xem, hoặc làm lộ dữ liệu ra ngoài qua link/ảnh trong câu trả lời.
- Một câu hỏi tốn tiền không giới hạn.
- Một đường ghi thứ hai bỏ qua audit, outbox, gate quyền đang dùng cho MCP.

## 4. Ràng buộc

Mọi luật trong `CLAUDE.md` áp dụng. Những luật chạm trực tiếp vào thiết kế này:
- Mọi lượt gọi LLM đi qua `ai.Gateway`; `internal/ai` không import `internal/service`, nên vòng agent nằm trong `internal/service`; chỉ `internal/ai/provider` nói chuyện với nhà cung cấp.
- Mọi ghi nghiệp vụ đi qua service command có audit + outbox trong cùng transaction; lệnh mới thêm vào `audit_coverage_test.go`.
- Bảng mới: `organization_id TEXT NOT NULL`, cặp `created_by`/`created_by_kind`, ULID, không FK, index `CONCURRENTLY` mỗi file một index, query sqlc ghi tenant hoặc `-- tenant:`.
- Route mới tự vào `TestIsolationMatrix`; trường `*_id`/`*_ids` trong body cần case `isoReferences`.
- Endpoint mới: schema lenient + `parseWithFallback` + test malformed; route SSE ngoài wrapper `api` phải có lý do và được ghim như `/mcp`, nếu không thì cần SDI/SDO; `{param}` mới cần `pathParamSDI`.
- File `.ts/.tsx` ≤ 500 dòng; `packages/views` không `next/*`; chuỗi qua `t()`; icon theo `docs/conventions.md`; React Query cho server state, Zustand trong `packages/core` cho client state.
- Feature flag khai báo trong `featureflags/keys.go`, có `review_at`. Log không chứa email/tên.

## 5. Quyết định của chủ sản phẩm

### 5.1 Giao diện (chủ sản phẩm chốt, tạm)

Theo phác thảo đã duyệt trong buổi trao đổi:
- Panel dock bên phải, **đẩy** nội dung sang trái (không phủ mờ), rộng 400–640px, kéo giãn được; nút mở **toàn trang**; mobile toàn màn hình.
- Header một dòng: icon UNI + tên hội thoại (bấm để mở lịch sử: danh sách, đổi tên, xóa), nút hội thoại mới, mở rộng, đóng.
- Câu trả lời không bọc bong bóng, render markdown; trích dẫn là số nhỏ trong câu, rê chuột hiện tiêu đề + đoạn trích + link mở; hàng chip nguồn; dòng bước "Đã xem 24 task, 3 cuộc họp…" thu gọn được; thanh sao chép / trả lời lại / hữu ích / chưa đúng.
- Thẻ đề xuất: "UNI đề xuất · cần bạn xác nhận", hiện thay đổi trước → sau, nút Áp dụng / Sửa / Bỏ qua.
- Ô nhập: chip ngữ cảnh (đang hỏi về task/dự án nào, có ×), textarea tự giãn, các nút + (phạm vi), @ (nhắc task, người, tài liệu), chọn chế độ quyền (§5.3), chọn model (§5.4), Gửi/Dừng.
- Điểm mở: ⌘J, nút trên thanh trên cùng, nút "Hỏi UNI" trên trang task, cuộc họp, tài liệu, chat (mở kèm ngữ cảnh đó).

### 5.2 Cách UNI làm việc (chủ sản phẩm chốt)

UNI là một agent: đọc câu hỏi, lịch sử, ngữ cảnh trang và @mention, tự chọn tool để tìm dữ liệu qua nhiều vòng, trả lời bằng chữ chạy dần. Viết tự do được phép; dữ kiện về công việc phải có trích dẫn.

### 5.3 Chế độ quyền (chủ sản phẩm chốt)

Người dùng **tự chọn chế độ** ngay trong ô nhập, giống menu chế độ của các harness agent; chế độ được nhớ theo người.

| Chế độ | UNI làm gì với thay đổi |
|---|---|
| **Hỏi trước** | Mọi thay đổi thành thẻ đề xuất; người bấm Áp dụng thì UNI mới làm. |
| **Kế hoạch** | UNI liệt kê cả loạt thay đổi định làm thành một kế hoạch; người duyệt một lần (bỏ được từng dòng), UNI làm lần lượt. |
| **Tự động** | Việc mức 1 (của riêng mình, dễ hoàn tác) UNI làm luôn và hiện nút Hoàn tác; việc mức 2 (ảnh hưởng người khác) vẫn là thẻ đề xuất. |

Quy tắc giữ ở **mọi** chế độ (trả lời lỗi chặn của buổi review kiến trúc):
1. Việc mức 3 (hàng loạt hoặc khó đảo: xóa, đóng nhiều task, gửi email ra ngoài, đổi quyền) **luôn hỏi từng việc**, hoặc không cho làm.
2. **Lượt bị nhiễm thì về Hỏi trước.** Nếu trong lượt đó UNI đọc nội dung **không do người hỏi viết** (task, bình luận, chat, email của người khác; tài liệu người khác sửa), mọi thay đổi của lượt chuyển về thẻ đề xuất, kể cả ở chế độ Tự động. **Một khi đã nhiễm, cả hội thoại giữ trạng thái đó** (chủ sản phẩm chốt): mọi thay đổi về sau trong hội thoại đều thành đề xuất. Chip ngữ cảnh và @mention trỏ tới đối tượng của người khác cũng tính là nhiễm; bộ nhớ của chính người dùng thì không.
3. **Admin tổ chức đặt mức cao nhất** được chọn; **mặc định của tổ chức là Hỏi trước** (ADR 0010 §3: "Mặc định: không tự động").
4. **Không có chế độ "Bỏ qua quyền"** (người viết quyết, chủ sản phẩm không phản đối).

### 5.4 Chọn model và mức nỗ lực (chủ sản phẩm chốt)

Bản đầu chỉ chọn trong các model **Claude: Haiku, Sonnet, Opus**; đa nhà cung cấp để giai đoạn sau. Có lựa chọn **"Tự động"** (gateway chọn) làm mặc định. Admin tổ chức bật/tắt từng model.

Chủ sản phẩm chỉ ra cách ClickUp làm (xem trực tiếp trên tài khoản ClickUp của họ ngày 2026-10-16) và muốn UNI có tương đương:
- Menu model chia nhóm ("Best models", rồi "Show more" cho model cũ hơn); dòng đầu là "Brain² Max", tự chọn model tốt nhất và ghi "Current: <model>".
- Rê chuột vào một model hiện thẻ chi tiết: tên, một câu mô tả ("Fast responses for simple tasks and high volume"…), và thanh 5 nấc cho **Speed**, **Intelligence**, **Cost** (dòng Cost không hiện ở mọi model).
- Rê vào một model hiện thêm nút **"Auto ⌃"** mở menu **"Thinking effort"**: Auto (Default), Low, Medium.

UNI làm tương tự: mỗi model có thẻ chi tiết (mô tả ngắn + nấc tốc độ, trí tuệ, chi phí), và một **mức nỗ lực** chọn kèm model: Tự động (mặc định), Thấp, Vừa, Cao (người viết quyết thêm "Cao"; không mở `xhigh`/`max` cho chat vì chi phí).

### 5.5 Nguồn hiểu biết về Brain (chủ sản phẩm chốt)

Không dùng REA hay reverse engineering, scrape, gọi private API của ClickUp (Terms of Use §1.5, §2.2, §3.9). Chỉ dùng help center công khai và dùng thử giao diện.

## 6. Thiết kế kỹ thuật (người viết quyết, trừ chỗ ghi khác)

### 6.1 Vòng agent

- Đặt trong `internal/service` (ví dụ `askuni_agent.go`), không trong `internal/ai`.
- Mỗi vòng là một `gateway.Complete`: lượt đầu render prompt, các lượt sau là `ToolResultTurn`; lượt cuối là câu trả lời chữ.
- Giới hạn mỗi lượt hỏi (run): tối đa **4 vòng tool**, ngân sách token cho cả run (ước lượng bắt đầu: 60k vào, 4k ra), kết quả mỗi tool tối đa 64 KB, giới hạn đồng thời theo tổ chức như UniWork AI.
- Rate limit 20 câu/phút/người giữ nguyên (đếm theo câu hỏi); thêm giới hạn số vòng/phút/tổ chức.
- Metering: mỗi vòng có `MeterKey = "ask-uni:<run_id>:<round>"`; run id đi qua log, metric, usage row.
- Model trả sai định dạng ở lượt cuối: thử lại một lần với lời nhắc định dạng; vẫn sai thì lưu một câu trả lời lỗi có mã để người dùng thấy đã tốn gì.

### 6.2 Prompt `copilot_answer@2`

- **Bỏ `OutputSchema`** để gateway gửi được tool và để stream chữ.
- Model viết câu trả lời dạng **markdown** với dấu nguồn `[S#]`.
- Server cấp số nguồn khi tool trả về: mỗi nguồn có một `S#` **ổn định trong cả hội thoại** (lưu bảng số → nguồn theo hội thoại), để câu trả lời cũ trong lịch sử vẫn đúng số.
- Sau khi stream xong, server quét `[S#]`, giữ số có trong bảng, gửi sự kiện `citations` kèm tiêu đề, loại, href và **đoạn trích do server cắt** từ nguồn. Số không hợp lệ hiển thị như chữ thường.
- System prompt v2 giữ footer `UntrustedFooter`; nói rõ: viết tự do được, dữ kiện về công việc phải có `[S#]`, không đưa email/số điện thoại, không dùng ảnh hoặc link ngoài.
- Prompt v1 giữ lại trong registry để usage row cũ vẫn giải thích được.

### 6.3 Tool đọc và tìm kiếm

- **Một bộ tool đọc dùng chung** cho MCP và Hỏi UNI, đặt ở tầng service; server tự gắn workspace (model không truyền `workspace_id`). Gồm: tìm toàn văn, lọc task (hạn, người nhận, trạng thái, ưu tiên, dự án), lấy task theo id hoặc `PREFIX-N` kèm bình luận, cuộc họp kèm tóm tắt, tài liệu, dự án.
- Hỏi UNI thêm hai tool **chỉ cho kênh này**: chat (phòng người hỏi tham gia) và thành viên (tên + vai trò). MCP không có hai tool này (ADR 0031 §4).
- Mọi so khớp chữ dùng `foldForSearch` / `uw_fold_search`; lọc chuyển dần xuống SQL có `LIMIT`, không nạp cả workspace.
- Mỗi kết quả tool mang cờ `authored_by_asker` (true/false/không rõ) cho quy tắc lượt bị nhiễm (§5.3 #2); "không rõ" tính như false.
- Vá injection: tiêu đề nằm trong `<untrusted>`, escape `</untrusted>` trong nội dung, lượt assistant cũ được bọc khi gửi lại.

### 6.4 Hành động ghi

- Tool ghi dùng lại lệnh service của MCP (tạo/sửa task, dự án, cuộc họp, tài liệu, thêm bình luận) và thêm soạn/gửi chat nếu cần cho mức 2.
- **Mỗi tool khai báo mức trong code**, model không tự đặt. Mức 1 chỉ khi mọi thay đổi chạm đúng đối tượng của người hỏi và không thông báo cho ai khác (tạo task chỉ giao cho chính mình; sửa task do mình tạo và mình là người nhận duy nhất — repo không có "dự án cá nhân", dự án nào cũng cả workspace thấy). Mức được phân loại lúc chạy theo tham số (ví dụ `create_task` giao cho người khác là mức 2).
- **Gate ghi dùng chung**: chuyển `mcpWriteRefusal` từ handler xuống service để MCP và Hỏi UNI đi qua cùng một gate; thêm điều kiện riêng của Hỏi UNI (công tắc tổ chức, flag, chế độ người dùng, mức trần admin).
- **Đề xuất lưu trên server**: bảng `agent_action_proposals` theo thiết kế của spec A-01 `2026-09-04-agent-actor-model-design.md` (chưa có migration), tạo trong P3 để Hỏi UNI và agent runtime sau này dùng chung; Hỏi UNI ghi `created_by_kind = human`. Cột tối thiểu cho Hỏi UNI (`organization_id`, `workspace_id`, `conversation_id`, `message_id`, `created_by`/`created_by_kind`, `tool`, `args`, `preview`, `target_revision`, `status` pending/applied/rejected/expired/failed, `expires_at`, `result`).
  - Client chỉ gửi `POST …/ai/proposals/{id}/confirm` (hoặc `/reject`), có thể kèm phần người dùng sửa ở nút "Sửa" (server kiểm lại như input mới).
  - Server chạy **đúng lệnh service** của tool dưới `audit.WithVia(Via{Kind: "ask_uni"})`; từ chối khi revision đã đổi hoặc đề xuất hết hạn.
- **Chế độ Kế hoạch** là một đề xuất nhiều dòng; xác nhận chạy lần lượt, dừng ở dòng lỗi đầu tiên và báo dòng nào đã làm.
- **Chế độ Tự động, mức 1**: server chạy ngay, ghi `via: ask_uni`, trả sự kiện kèm link và cách hoàn tác. Hoàn tác bằng lệnh service ngược đã khai báo ở tool; tool không có lệnh ngược thì không được là mức 1.
- Actor là `Human` (người hỏi), theo ADR 0033 §2: Hỏi UNI do người khởi động, không phải agent runtime.
- **ADR 0034** viết trước P3: mở rộng 0033 sang kênh Hỏi UNI, định nghĩa mức 1–3, quy tắc lượt bị nhiễm, trần admin, mặc định Hỏi trước; kèm test registry "mọi tool ghi có undo hoặc không được tự động" và thay `TestAskUniToolsAreReadOnly` trong cùng PR.

### 6.5 Streaming

- SSE qua `fetch` (POST, Bearer); không `EventSource`, không WebSocket.
- Sự kiện: `run` (run id, conversation id), `step` (tool, số đối tượng đã xem), `delta` (chữ), `citations`, `proposal`, `applied` (mức 1 đã làm, kèm hoàn tác), `done` (message id, usage), `error` (mã).
- Provider: thêm hàm stream cho provider `openai` (đường tới router, §6.7); fake provider cũng stream để test và E2E.
- Client: hàm stream trong `packages/core/api` có refresh 401; mỗi sự kiện qua `parseWithFallback`, có test frame hỏng.
- Nút Dừng: client hủy request; server **tính tiền phần đã chạy** (ADR 0029 D5) và lưu câu trả lời dở, đánh dấu "đã dừng". Server tắt giữa chừng (10s): lưu câu trả lời dở.
- Route ngoài wrapper `api` thì ghim bằng test như `/mcp`.
- Endpoint `POST …/ai/ask` cũ giữ đến khi client mới chạy ổn, rồi gỡ trong cùng đợt; không giữ song song lâu.

### 6.6 Chọn model và mức nỗ lực (theo §5.4)

- Model mở cho người dùng: thế hệ Claude hiện hành Haiku 5.5, Sonnet 5.5, Opus 5.5 (tên theo router, §6.7). Allowlist (`policy.go:116`) và `ai_model_rates` hiện chỉ có `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`; thêm ba model mới bằng migration và sửa allowlist.
- **Bảng giá trong repo lệch giá hiện hành.** `092_ai_gateway.up.sql` ghi Opus 5 $15/$75 và Sonnet 5 $3/$15; tài liệu Anthropic (bản cache 2026-10-06) ghi Opus 5 $5/$25, Sonnet 5 $2/$10, Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 (≤100K token prompt). Người xây dựng kiểm lại trên trang giá chính thức trước khi ghi rate mới, và sửa rate cũ nếu sai.
- `GET …/ai/capabilities` trả thêm danh sách model được chọn: giao của allowlist gateway, model có giá trong `ai_model_rates`, và model admin bật. Mỗi model kèm mô tả ngắn (i18n phía client) và ba nấc 1–5: tốc độ, trí tuệ, chi phí (chi phí tính từ bảng giá; tốc độ và trí tuệ là hằng số khai báo trong code, người xây dựng chọn giá trị).
- Request mang `model` và `effort` (bỏ trống = Tự động). Gateway kiểm cả hai thuộc danh sách đóng; giá trị lạ thì dùng mặc định và ghi cảnh báo. Sửa comment ở `policy.go:8-10` cho khớp: model do gateway kiểm, người dùng chọn trong danh sách đóng.
- **Tự động = Sonnet 5.5, mức nỗ lực mặc định của route** (người viết quyết; chỉnh theo bộ đánh giá §8). Mức Thấp/Vừa/Cao gửi thành `output_config.effort` = `low`/`medium`/`high`.
- Đổi model giữa hội thoại được phép; thinking block của model cũ bị model mới bỏ qua (không lỗi, không tính tiền), nên không cần làm gì thêm ngoài giữ lịch sử chỉ thêm, không sửa (§6.7).
- Quota tính theo token như hiện tại; giao diện nhắc khi chọn Opus.

### 6.7 Router AI và ghi chú API Claude

**Router (chủ sản phẩm chốt):** production gọi model qua một router do chủ sản phẩm tự xây, theo dạng OpenRouter. Router là phụ thuộc nằm ngoài spec này.
- UniWork nói chuyện với router bằng provider `openai` có sẵn (API tương thích OpenAI, `OPENAI_BASE_URL`). Streaming thêm cho provider này, không phải provider Anthropic.
- Allowlist và `ai_model_rates` khai báo theo tên model của router (ví dụ `anthropic/claude-sonnet-5.5`), provider `openai`.
- **Hợp đồng tối thiểu với router:**
  - chat completions có `stream: true`, gửi usage ở cuối stream;
  - `tools` / `tool_calls`;
  - tham số mức nỗ lực (dạng `reasoning: {effort}` như OpenRouter);
  - chuyển tiếp `cache_control` cho prompt caching;
  - trả về và nhận lại khối reasoning giữa các lượt tool (dạng `reasoning_details` như OpenRouter);
  - lỗi 429 kèm `Retry-After`;
  - danh sách model cố định, tên ổn định.
- Router chưa có tính năng nào thì phần tương ứng của UNI chờ: streaming (P2), mức nỗ lực và caching (P1).
- Router phải tự áp các ràng buộc của Claude dưới đây khi chuyển tiếp; UniWork không gửi gì vi phạm chúng.

**Ghi chú API Claude** (theo tài liệu Anthropic, cache 2026-10-06):

- **Mức nỗ lực:** `output_config: {effort: "low"|"medium"|"high"|"xhigh"|"max"}`, GA, không cần beta header. Mặc định `medium` trên Opus 5.5 và Haiku 5.5, `high` trên Sonnet 5.5 — luôn gửi giá trị tường minh.
- **Thinking:** cả ba model chạy adaptive thinking. Opus 5.5 không tắt được thinking (`{type:"disabled"}` và `budget_tokens` trả 400). Không gửi `budget_tokens` cho model nào.
- **Sampling:** không gửi `temperature`/`top_p`/`top_k` khác mặc định — Opus 5.5 trả 400, Sonnet 5.5 và Haiku 5.5 trả 400 với giá trị khác mặc định. Provider `openai` và `anthropic` hiện chỉ gửi `temperature` khi > 0 (`provider/openai.go:66`, `provider/anthropic.go:33`); policy của Hỏi UNI phải giữ 0.
- **Tool:** `tool_choice` chỉ dùng `auto` (`any`/`tool` trả 400 trên Opus 5.5, Sonnet 5.5); dùng `strict: true` trên tool để tham số đúng schema.
- **Vòng tool:** gửi lại nguyên các block assistant của lượt trước, kể cả thinking block, trong cùng run; lịch sử chỉ thêm, không sửa ("preserved thinking"). `provider.Message` hiện chỉ mang `Content` và `ToolCalls`, nên cần mở rộng để giữ block thinking.
- **Hiển thị suy nghĩ:** mặc định thinking trả về rỗng (`display: "omitted"`); muốn hiện dòng tiến độ giữa các lần gọi tool thì xem `display: "updates"` (beta) — tùy chọn cho dòng "Đã xem…".
- **Từ chối:** kiểm `stop_reason == "refusal"` trước khi đọc nội dung; cân nhắc `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) cho Opus 5.5/Sonnet 5.5, ghi vào usage row model thực sự trả lời.
- **Prompt caching:** đặt `cache_control` sau system prompt + danh sách tool (giữ thứ tự tool cố định) để mỗi vòng không trả giá đầy đủ cho phần lặp lại.
- **Streaming:** qua router (§6.7); khi input của tool đến dần theo stream, kiểm input theo schema trước khi chạy tool.

### 6.8 An toàn hiển thị

- Markdown render **không ảnh, không HTML thô**; link chỉ là đường dẫn nội bộ hoặc href của nguồn đã trích, link khác hiện như chữ.
- Thẻ đề xuất bình luận/chat hiện nguyên văn nội dung sẽ đăng và ai sẽ thấy.

### 6.9 Bộ nhớ (P4)

- Bảng sở thích theo người dùng (theo luật migration). Chỉ ghi khi người dùng xác nhận (UNI đề xuất "nhớ điều này?"); người dùng xem, sửa, tắt, xóa được.
- Đưa vào prompt như nội dung `<untrusted>` của chính người dùng.
- Khi rời tổ chức hoặc bị vô hiệu hóa: người xây dựng chọn giữ hay xóa, nhưng phải ghi lại.

### 6.10 i18n

Server không trả chuỗi tiếng Việt cố định cho giao diện: trả mã và số đếm (ví dụ `step` mang `{tool, counts}`), client dịch. Câu "chưa đủ dữ liệu" cũng thành mã.

### 6.11 Quyết định bổ sung sau vòng đọc của người xây dựng (người viết quyết)

1. **Mức 3 / hàng loạt:** một hành động chạm hơn 10 đối tượng, hoặc xóa, hoặc gửi ra ngoài tổ chức, hoặc đổi quyền. Giao lại 3 task là 3 dòng mức 2.
2. **Nhiều thay đổi trong một lượt:** ở chế độ Hỏi trước, gom thành một thẻ nhiều dòng; mỗi dòng có nút riêng, thêm nút "Áp dụng tất cả". Ở chế độ Kế hoạch, lượt bị nhiễm vẫn là một kế hoạch duyệt một lần; từng dòng hiện rõ và bỏ được, chính bước duyệt đó là xác nhận. Tình huống §1 vì vậy xong bằng một cú bấm.
3. **Phạm vi:** chỉ workspace hiện tại; "Marketing" ở §1 là một dự án. Nút "+" chọn phạm vi trong workspace: dự án, cuộc họp, tài liệu, phòng chat. Thêm tool đọc "khối lượng việc theo thành viên" (số task mở, quá hạn) để gợi ý người nhận. Phòng ban và tìm chéo workspace: không làm ở bản này.
4. **Hoàn tác:** chỉ hiện cho thay đổi có lệnh ngược, ở mọi chế độ.
   - Tạo task → hoàn tác là xóa đúng task đó, chỉ khi task do chính đề xuất đó tạo và chưa ai sửa (revision không đổi).
   - Sửa trường → hoàn tác là ghi lại giá trị cũ, khi revision không đổi.
5. **Không có tool xóa** cho Hỏi UNI ở bản này (như ADR 0033). Gửi email ra ngoài và đổi quyền: không cung cấp. Mức 3 hiện chỉ gồm thao tác hàng loạt. Gửi chat thay người dùng: trong phạm vi, mức 2.
6. **Kế hoạch có bước phụ thuộc:** tham số cố định khi đề xuất; cho phép tham chiếu id của dòng trước (`{{row:N.id}}`) cho quan hệ cha–con, ví dụ tạo dự án rồi tạo task trong đó. Vòng agent không chạy tiếp sau khi duyệt.
7. **Mặc định của tổ chức:**
   - Công tắc ghi riêng cho Hỏi UNI, không dùng chung công tắc MCP; cùng flag `ask_uni_actions`.
   - Trần mặc định: Hỏi trước và Kế hoạch (cả hai đều cần người duyệt). Tự động cần admin mở.
   - Chế độ mặc định của người dùng: Hỏi trước.
   - Model bật sẵn: Haiku, Sonnet; Opus tắt đến khi admin bật.
8. **Lựa chọn của người dùng thắng biến môi trường** `AI_MODEL_COPILOT_ANSWER`; biến môi trường chỉ đặt model cho "Tự động".
9. **Phản hồi 👍/👎:** chỉ lưu id tin nhắn, đánh giá, lý do chọn sẵn và ghi chú tùy chọn của người dùng; không xuất nội dung ra ngoài tổ chức. Bộ đánh giá §8 dựng từ dữ liệu mẫu tự tạo, không lấy dữ liệu khách hàng.

## 7. Lộ trình

Mỗi giai đoạn là một hoặc vài PR có issue riêng. Từ P1, mỗi giai đoạn đứng sau feature flag có `review_at`; P0 chỉ sửa lỗi nên không cần flag.

1. **P0 — Sửa nền.** 6 lỗi giao diện ở §2; vá injection (§6.3); tìm kiếm: mã task, không dấu, tài liệu; i18n câu không có nguồn; khi gói nguồn rỗng mà hội thoại đã có câu hỏi trước, tìm lại bằng câu hỏi trước ghép câu hiện tại (prompt v1 chỉ trả lời từ nguồn, nên gọi model khi không có nguồn là vô ích); bộ câu hỏi đánh giá (§8); sửa cấu hình AI production cho khớp (hiện `AI_PROVIDER=anthropic` nhưng model Hỏi UNI đặt `openai/gpt-4o-mini`). Xong khi bộ đánh giá chạy được và ghi lại mức nền.
2. **P1 — Agent đọc.** Vòng agent §6.1 với tool đọc §6.3, prompt v2 §6.2, chưa stream; chọn model và mức nỗ lực §6.6, ghi chú API §6.7. Xong khi (chủ sản phẩm chốt): bộ đánh giá đạt **≥ 80%** câu đúng theo người chấm, các câu chống lệnh cài và chéo tenant đạt **100%**, và chi phí AI trung bình **≤ $0.10 mỗi câu hỏi**.
3. **P2 — Streaming và giao diện mới.** §6.5 + giao diện §5.1, chia `ask-uni-panel.tsx` thành nhiều component; điểm mở từ task, cuộc họp, tài liệu, chat; @mention.
4. **P3 — Hành động.** ADR 0034, `agent_action_proposals`, gate chung, ba chế độ quyền §5.3, §6.4, an toàn hiển thị §6.8.
5. **P4 — Bộ nhớ** §6.9.

## 8. Đo chất lượng

- Bộ câu hỏi đánh giá trong repo, chạy được với model thật (người chấm theo tiêu chí ghi sẵn cho từng câu) và với fake (CI, kiểm cấu trúc và các câu bảo mật), gồm: câu tiếng Việt có dấu và không dấu, gọi theo mã task, câu hỏi tiếp theo dựa vào lịch sử, lọc theo hạn/người/ưu tiên, câu cần tài liệu, câu viết tự do, câu không có dữ liệu, câu có nội dung injection trong task hoặc chat, câu hỏi chéo tenant (phải không thấy gì).
- Mỗi câu ghi nguồn mong đợi, ý chính mong đợi, và điều không được xảy ra.
- 👍/👎 lưu vào bảng mới (theo luật migration); chỉ owner/admin tổ chức đọc tổng hợp; dùng để bổ sung bộ đánh giá.

## 9. Vận hành

- Metric: số vòng/run, thời gian và lỗi theo tool, token và chi phí theo model, tỉ lệ đề xuất được áp dụng/bỏ qua, số lượt bị nhiễm bị hạ quyền.
- Flag (ví dụ `ask_uni_agent`, `ask_uni_stream`, `ask_uni_actions`, `ask_uni_memory`), mỗi flag có `review_at`.
- Cập nhật `docs/ops/RUNBOOK_AI.md`: tắt hành động khẩn cấp, xử lý chi phí tăng đột biến.

## 10. Test bắt buộc ngoài test thường lệ

- Thay `TestAskUniToolsAreReadOnly` bằng test registry theo ADR 0034.
- Lệnh confirm/reject đề xuất trong `audit_coverage_test.go`.
- Route mới trong isolation matrix; `conversation_id`, `proposal_id`, id trong @mention có case `isoReferences`.
- Lượt bị nhiễm: câu lệnh injection trong task của người khác → ở chế độ Tự động vẫn chỉ ra đề xuất.
- Trần admin và mặc định Hỏi trước.
- Bấm Dừng vẫn tính tiền.
- Frame SSE hỏng không làm client vỡ.
- Render markdown chặn ảnh và link ngoài.
- E2E: hỏi → trả lời có nguồn → đề xuất → áp dụng → hoàn tác.

## 11. Để người xây dựng quyết định

- Tên file, tên bảng, cấu trúc package cụ thể (trong khuôn luật repo).
- Ngân sách token chính xác của run và số vòng tối đa (bắt đầu từ ước lượng §6.1, chỉnh theo bộ đánh giá).
- Cách tính `authored_by_asker` cho từng loại nguồn (§6.3).
- Phân loại mức của từng tool ghi, theo quy tắc §6.4.
- Thời hạn của một đề xuất.
- Thư viện render markdown, nếu đáp ứng §6.8 và luật dependency.
- Thứ tự PR trong mỗi giai đoạn.

## 12. Câu hỏi mở

Không còn câu hỏi cho chủ sản phẩm. Phụ thuộc ngoài: router AI (§6.7) — streaming của router phải sẵn sàng trước P2.
