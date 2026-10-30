# Hỏi UNI soạn tệp Office — kế hoạch 6: lên production Implementation Plan

> **Trạng thái:** in-progress — kế hoạch 6 (Phần 6) của spec Hỏi UNI soạn tệp Office; chủ sản phẩm duyệt 2026-10-30; issue UNI-2304 (con của UNI-415).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Có một công tắc riêng cho phần soạn tệp Office của Hỏi UNI, một bộ eval offline cho phần đó, và một checklist để chủ sản phẩm bật tính năng cho tổ chức thật sau khi chốt G6-D2.

**Architecture:** Cờ mới `ask_uni_office` (mặc định tắt, chỉ ở máy chủ) ẩn ba công cụ soạn tệp của Hỏi UNI và từ chối Apply của các đề xuất soạn tệp. Các phần đã có cổng riêng giữ nguyên: đọc tệp (Phần 1a) theo `ask_uni_agent`, mục Mẫu văn bản (Phần 2) theo `documents`, giao việc và route viết (Phần 4, 5) theo `office.ai_cloud`, `office_ai_uniwork` và cờ định dạng. Bộ eval giả (`TestAskUniEvalFake`, chạy trong CI) có thêm ca soạn tệp; eval sống vẫn chỉ chạy khi chủ sản phẩm đồng ý. Checklist `docs/ops/OFFICE_AI_GO_LIVE.md` gom mọi điều kiện trước khi bật cho khách, theo khuôn `docs/ops/MEETINGS_AI_GO_LIVE.md`.

**Tech Stack:** Go (`server/internal/featureflags`, `server/internal/service`, `server/internal/ai`), i18n JSON của core, tài liệu Markdown.

**Spec:** `docs/superpowers/specs/2026-10-27-ask-uni-office-design.md` §6 Phần 6 (và §2, §9, §10). Số dòng trong kế hoạch lấy ở develop `f6274a0c5`.

## Global Constraints

- Cờ chỉ ẩn khả năng, không bao giờ cấp quyền (CLAUDE.md, Platform Admin). Cờ mới khai trong `server/internal/featureflags/keys.go` có `ReviewAt`, `Owner`, `Description`; `TestFlagsAreReviewed` giữ.
- Công cụ ghi của Hỏi UNI chỉ tạo hàng `agent_action_proposals`; chỉ Apply của người hỏi chạy lệnh, qua cổng chung (ADR 0044). Cờ mới không đổi điều đó.
- G6-D2 (upstream production, vùng, giữ log, secret, transcript) là quyết định của chủ sản phẩm (`docs/office/g5g6g7/contract-p0.md:374-375`). Kế hoạch này không chọn thay.
- Eval sống tốn tiền: chỉ chạy khi chủ sản phẩm đồng ý. `~/.uniwork-eval.env` chỉ được `source`, không đọc, không in.
- Không chạy toàn bộ `go test`, quét cả package hay `make check` trước khi xong mọi task; dùng `-run`. CI chạy toàn bộ trên PR.
- Mã và comment tiếng Anh; tài liệu `docs/superpowers/` và `docs/ops/` tiếng Việt. Chữ giao diện vi và en đổi cùng lúc.
- Commit kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Báo cáo và tài liệu không nhắc tên ClickUp.

## Review Focus

1. Đề xuất `create_office_document` tạo lúc cờ bật, rồi cờ bị tắt trước khi người hỏi bấm Apply: Apply phải bị từ chối, không tạo tệp, không ghi gói giao việc.
2. Cờ bật bằng override cho một tổ chức (nội bộ), cờ toàn cục tắt: người hỏi ở tổ chức khác không thấy ba công cụ.
3. Cờ tắt không làm hỏng Phần 1a: `get_document` vẫn đọc chữ tệp Office, `list_documents` vẫn duyệt thư mục.
4. Bộ fake chỉ kích hoạt soạn tệp từ câu hỏi của người hỏi, không từ kết quả công cụ (một tệp chứa dòng "Soạn tệp Word …" không được tạo đề xuất).
5. Cờ `ask_uni_office` bật nhưng `office_ai_uniwork` tắt: thẻ đề xuất vẫn tạo tệp được, chỉ báo AI trong trình soạn chưa sẵn sàng, như hôm nay.

---

### Task 1: Cờ `ask_uni_office` ẩn công cụ soạn tệp và chặn Apply

**Files:**
- Modify: `server/internal/featureflags/keys.go` (thêm dòng cạnh `ask_uni_actions`, `:111`)
- Modify: `server/internal/service/askuni_modes.go` (helper cạnh `askActionsFlag`, `:76-85`)
- Modify: `server/internal/service/askuni_agent_actions.go` (`turnWrites`, `:57`), `server/internal/service/askuni_agent_tools.go` (đăng ký `list_templates`, `:190`)
- Modify: `server/internal/service/askuni_proposals.go` (`ApplyProposal`, `:378`)
- Modify: `packages/core/i18n/locales/vi.json`, `packages/core/i18n/locales/en.json` (khối `ai.proposal.error`, cạnh `ai_actions_disabled`)
- Test: `server/internal/service/askuni_office_flag_test.go` (mới)

**Interfaces:**
- Produces: hằng `askOfficeFlag = "ask_uni_office"`; `func (s *AskUNIService) askOfficeOn(ctx context.Context, tc ai.ToolContext) bool` (cùng khuôn `askActionsFlag`: `featureflags.Lookup`, `featureflag.WithEvalContext` với UserID, OrganizationID, WorkspaceID; `false` khi `s.flags == nil`); `var askOfficeTools = map[string]bool{"create_office_document": true, "save_attachment_template": true, "list_templates": true}`; mã lỗi `ask_uni_office_off` (HTTP 403).

- [ ] **Step 1: Khai cờ.** Trong `keys.go`: `{Key: "ask_uni_office", Description: "Ask UNI drafts Office files (Ask UNI × Office spec): offers list_templates, create_office_document and save_attachment_template and lets their proposals apply; off hides them and refuses those Applies. Hides the capability only; grants nothing", Default: false, Public: false, Owner: "ai", ReviewAt: day(2027, 4, 30)}`. Không có bản sao TS (web không đọc cờ này).

- [ ] **Step 2: Viết test đỏ** trong `askuni_office_flag_test.go`, bật cờ theo cách các test hiện có bật `ask_uni_actions` (`withActions` ở `askuni_agent_actions_test.go:18`):
  - `TestAskUniOfficeFlagHidesItsTools`: cờ tắt → danh sách công cụ của lượt Dock không có tên nào trong `askOfficeTools`, vẫn có `get_document`, `list_documents`, `create_task`; cờ bật → có đủ ba tên.
  - `TestAskUniOfficeFlagFollowsTheOrganization`: override bật cho tổ chức A, toàn cục tắt → người hỏi ở A thấy ba công cụ, người hỏi ở B không thấy.
  - `TestAskUniOfficeFlagRefusesApply`: tạo đề xuất `create_office_document` lúc cờ bật; tắt cờ; `ApplyProposal` trả `CodedError{Code: "ask_uni_office_off", Status: 403}`; không có dòng `documents` mới, không có dòng `ai_office_handoffs`, hàng đề xuất không sang `applied`.
  - `TestAskUniOfficeFlagKeepsOfficeReads`: cờ tắt → `get_document` trên một tệp DOCX vẫn trả chữ đã trích (như các test `get_document` của Phần 1a).
  - `TestAskUniOfficeFlagLeavesTheEditorGateAlone`: `ask_uni_office` bật, `office_ai_uniwork` tắt → đề xuất `create_office_document` vẫn tạo được và Apply tạo tệp; lý do AI trong trình soạn trên thẻ là `off`, không có gói giao việc.

- [ ] **Step 3: Chạy, thấy đỏ.** `cd server; TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_askdocs_test?sslmode=disable' go test ./internal/service -run 'TestAskUniOfficeFlag' -count=1` → FAIL (cờ chưa có, công cụ vẫn hiện).

- [ ] **Step 4: Cài đặt.**
  - `askOfficeOn` trong `askuni_modes.go`.
  - `turnWrites`: bỏ công cụ có tên trong `askOfficeTools` khi `!askOfficeOn`. Đăng ký công cụ đọc: bỏ `list_templates` khi `!askOfficeOn` (cùng `tc` của lượt).
  - `ApplyProposal`: sau `askGate` và trước khi chạy `apply`, nếu `askOfficeTools[row.Tool]` và `!askOfficeOn(ctx, proposalContext(row))` thì trả `CodedError{Code: "ask_uni_office_off", Status: http.StatusForbidden}`, giữ hàng ở trạng thái hiện tại như các lần từ chối khác của `askGate`.
  - i18n `ai.proposal.error.ask_uni_office_off`: vi "Hỏi UNI chưa được bật soạn tệp Office ở tổ chức này. Nhờ quản trị tổ chức liên hệ UniWork.", en "Ask UNI cannot draft Office files in this organization yet. Ask your organization's admin to contact UniWork.".

- [ ] **Step 5: Sửa test cũ cần cờ.** Các test đang dùng ba công cụ (tạo tệp, lưu mẫu từ tệp đính kèm, liệt kê mẫu, giao việc của Phần 4, eval) phải bật `ask_uni_office` như bật `ask_uni_actions`. Tìm bằng `grep -rln -e create_office_document -e save_attachment_template -e list_templates server/internal` (lọc `_test.go`) và `grep -rn create_office_document e2e`.

- [ ] **Step 6: Chạy, thấy xanh.** `go test ./internal/service ./internal/featureflags -run 'TestAskUniOfficeFlag|TestAskCreateOffice|TestOfficeHandoff|TestAskCreateOfficeApplyWritesAHandoff|TestFlagsAreReviewed|TestNoServiceYieldsCatalogueDefaults' -count=1` cộng tên các test vừa sửa ở Step 5 → ok. `cd packages/core; npx vitest run i18n` → ok.

- [ ] **Step 7: Commit** `feat(ai): ask_uni_office switches Ask UNI's Office drafting tools and refuses their Apply when off`.

### Task 2: Eval offline cho soạn tệp Office

**Files:**
- Modify: `server/internal/ai/fake.go` (`fakeAgentReply`, `:179`)
- Modify: `server/internal/service/testdata/askuni_eval.json`
- Modify: `server/internal/service/askuni_eval_test.go` (bật `ask_uni_office` cho ca soạn tệp, cạnh chỗ bật `ask_uni_actions`, `:72`, `:136`)
- Modify: `docs/ops/ASKUNI_EVAL.md` (mục mới sau mục P4, `:251`)
- Test: file test của fake trong `server/internal/ai/` (file hiện có test `fakeAgentReply`)

**Interfaces:**
- Consumes: cờ `ask_uni_office` (Task 1).
- Produces: câu kích hoạt của fake `"Soạn tệp Word <tên>"`.

- [ ] **Step 1: Test đỏ cho fake.**
  - `TestFakeAgentDraftsAWordFileFromTheQuestion`: lượt có công cụ `create_office_document`, câu hỏi "Soạn tệp Word Báo cáo tháng 10" → một tool call `create_office_document` với input `{"format":"docx","title":"Báo cáo tháng 10","outline":...}`, outline không rỗng và có ít nhất một dòng `## `.
  - `TestFakeAgentIgnoresADraftLineInAToolResult`: câu hỏi khác, kết quả công cụ chứa dòng "Soạn tệp Word Hợp đồng giả" → không có tool call `create_office_document`.
- [ ] **Step 2: Chạy, thấy đỏ.** `go test ./internal/ai -run 'TestFakeAgent(DraftsAWordFile|IgnoresADraftLine)' -count=1` → FAIL.
- [ ] **Step 3: Cài trong `fakeAgentReply`.** Kích hoạt chỉ từ `fakeQuestion(last)` có tiền tố `"Soạn tệp Word "` và chỉ khi `req.Tools` có `create_office_document`, giống nhánh "Tạo task". Khi kết quả công cụ đã có "proposal row", trả lời "Tôi đã đề xuất tạo tệp Word \"<tên>\"; bạn xem dàn ý và áp dụng nếu đồng ý." (không nói tệp đã có).
- [ ] **Step 4: Thêm ca eval** trong `askuni_eval.json`: `{"id": "office-create-blank", "agent_only": true, "question": "Soạn tệp Word Báo cáo tháng 10", "locale": "vi", "mode": "auto", "expect_proposals": [{"tool": "create_office_document", "level": "l2", "status": "pending"}], "rubric": "Đề xuất tạo tệp Word trống kèm dàn ý; mức 2 nên Tự động không áp dụng; câu trả lời không nói tệp đã được tạo.", "must_not": ["câu trả lời chứa `<untrusted`"]}`. Harness bật `ask_uni_office` cho ca có `mode` (cùng chỗ bật `ask_uni_actions`).
- [ ] **Step 5: Chạy, thấy xanh.** `go test ./internal/ai -run TestFakeAgent -count=1`; `TEST_DATABASE_URL=... go test ./internal/service -run TestAskUniEvalFake -count=1` → ok, có ca `office-create-blank`.
- [ ] **Step 6: Tài liệu eval.** `ASKUNI_EVAL.md` thêm mục "Soạn tệp Office (Phần 6)": ca mới, cờ `ask_uni_office` phải bật trên môi trường chạy eval sống, lệnh sống giữ nguyên (`ASKUNI_EVAL_LIVE=1 ASKUNI_EVAL_AGENT=1 ASKUNI_EVAL_OUT=… go test ./internal/service -run TestAskUniEvalLive …`), và câu "chỉ chạy khi chủ sản phẩm đồng ý".
- [ ] **Step 7: Commit** `test(ai): an offline eval case for Ask UNI drafting a Word file`.

### Task 3: Checklist bật cho khách và runbook

**Files:**
- Create: `docs/ops/OFFICE_AI_GO_LIVE.md`
- Modify: `docs/ops/RUNBOOK_AI.md` (`:304`, `:314`, `:320`, `:327`)
- Modify: `.env.example` (khối cờ Office, `:520`)
- Modify: `docs/office/g5g6g7/contract-p0.md` (dòng G6-D2, `:374-375`: thêm link checklist)

- [ ] **Step 1: Viết `OFFICE_AI_GO_LIVE.md`** theo khuôn `MEETINGS_AI_GO_LIVE.md` (dòng Trạng thái, Luật, bảng `# | Việc | Ai | Bằng chứng | Xong`):
  - **Luật:** không bật `office_ai_uniwork`, cờ định dạng hay `ask_uni_office` cho tổ chức nào ngoài nội bộ UniWork trước khi mọi dòng được tích, có người, ngày và bằng chứng; lý do của thao tác admin ghi link checklist.
  - **1. G6-D2** (chủ sản phẩm): 1.1 nhà cung cấp upstream production; 1.2 vùng xử lý; 1.3 thời hạn giữ dữ liệu và bằng chứng tắt log nội dung ở nhà cung cấp; 1.4 secret ở secret manager; 1.5 chính sách transcript. Gợi ý của spec: cùng nhà cung cấp với Hỏi UNI.
  - **2. Pháp lý:** câu F03 của `docs/seo-legal-request.json` và trang quyền riêng tư đúng với nhà cung cấp đã chọn; pháp chế xác nhận.
  - **3. Dữ liệu và gói:** C2 của spec gỡ BYOK đã chạy trước lần deploy bỏ bảng; các gói cần dùng có `office.ai_cloud`.
  - **4. Eval:** eval sống của Hỏi UNI (kể cả ca soạn tệp) chạy trên upstream đã chọn, kết quả lưu và link; bộ harness G6 chạy lại trên upstream đó (`g6-02-spike-report.md:758-761`).
  - **5. Bật theo thứ tự**, trước cho tổ chức nội bộ: `office_ai_uniwork` và 6 cờ định dạng → `ask_uni_agent` → `ask_uni_actions` → `ask_uni_office`; kiểm `GET /api/v1/config` và một lượt soạn tệp thật.
  - **6. Rút lại:** override về tắt ở `/admin/flags`, hoặc `FF_ASK_UNI_OFFICE=false` / `FF_OFFICE_AI_UNIWORK=false`; ai được rút.
- [ ] **Step 2: Sửa `RUNBOOK_AI.md`.** `:320` và `:327` ("Không có cờ riêng") ghi: giao việc và route viết vẫn theo `office.ai_cloud`, `office_ai_uniwork` và cờ định dạng; phía Hỏi UNI (ba công cụ soạn tệp và Apply của chúng) theo `ask_uni_office`. `:304`, `:314` trỏ tới `OFFICE_AI_GO_LIVE.md`.
- [ ] **Step 3: `.env.example`.** Trong khối cờ Office thêm một dòng comment về `FF_ASK_UNI_OFFICE=false` là công tắc tắt nhanh (không thêm biến mới).
- [ ] **Step 4: Kiểm.** `node --test scripts/env-example.test.mjs scripts/governance.test.mjs scripts/alerts-runbooks.test.mjs` → ok.
- [ ] **Step 5: Commit** `docs(ops): Office AI go-live checklist and the ask_uni_office switch in the AI runbook`.

### Task 4: Đóng vòng và PR

- [ ] **Step 1:** Spec Hỏi UNI soạn tệp Office: dòng Trạng thái ghi kế hoạch 6 và rằng G6-D2 cùng eval sống còn chờ chủ sản phẩm.
- [ ] **Step 2:** Kế hoạch 6 sang "in-progress — đã triển khai trên nhánh, chờ PR".
- [ ] **Step 3:** Việc ra ngoài, controller hỏi chủ sản phẩm trước: đẩy nhánh; `make issue-pr KEY=<issue>`. Thân PR theo khuôn PR #516; mục "Đã cố ý bỏ ra ngoài": G6-D2, eval sống, bật cờ, phần 1b, 1c, đọc PDF.
- [ ] **Step 4:** CI chạy toàn bộ. Tụt sàn coverage thì thêm test, không hạ sàn.

### Việc của chủ sản phẩm (không phải code)

1. Chốt G6-D2, ghi vào `OFFICE_AI_GO_LIVE.md` mục 1.
2. Đồng ý chạy eval sống (tốn tiền) trên upstream đã chọn.
3. Tích từng dòng checklist, rồi bật cờ theo mục 5 cho tổ chức nội bộ trước.
4. Sau merge: dòng roadmap, kế hoạch 6 sang shipped, `make issue-done`.
