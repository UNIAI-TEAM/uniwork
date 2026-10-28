# UniWork — Hỏi UNI soạn tệp Office cùng AI trong trình soạn

> **Trạng thái:** in-progress — chủ sản phẩm duyệt 2026-10-27 (Q1–Q10); kế hoạch 1 (Phần 1a, shipped PR #486): `docs/superpowers/plans/2026-10-27-ask-uni-office-p1-read.md`, issue UNI-2224; kế hoạch 2 (Phần 2, trừ "Lưu từ khung chat" chuyển sang kế hoạch Phần 3; shipped PR #491): `docs/superpowers/plans/2026-10-27-ask-uni-office-p2-templates.md`, issue UNI-2225; kế hoạch 3 (Phần 3 và "Lưu từ khung chat"; gói giao việc và nhãn "Mở và soạn" chuyển sang Phần 4): `docs/superpowers/plans/2026-10-28-ask-uni-office-p3-create.md`, issue UNI-2261, shipped PR #498; kế hoạch 4 (Phần 4, gồm nhãn "Mở và soạn", kiểm AI trong trình soạn và tư liệu chuyển từ Phần 3; hai repo, cần một bản phát hành fork): `docs/superpowers/plans/2026-10-28-ask-uni-office-p4-handoff.md`, issue UNI-2264, shipped PR #510; kế hoạch 5 (Phần 5: route viết cho UniWork AI, dựng deck trên web; hai repo, cần một bản phát hành fork): `docs/superpowers/plans/2026-10-28-ask-uni-office-p5-writer.md`, issue UNI-2276, chờ chủ sản phẩm duyệt; Phần 1b, 1c và Phần 6 chưa có kế hoạch.

**Nguồn quyết định:** trao đổi với chủ sản phẩm ngày 2026-10-27 (phiên brainstorm sau báo cáo
`docs/ask-uni-documents-assessment.md`). Mọi số dòng `file:line` của repo này theo `develop` tại `b1dcd6152`; của fork
`UNIAI-TEAM/uniwork-office` theo `main` tại `5373c49` (web đang pin `59defc1`, có thể lệch dòng).

## 1. Ý định

Công ty dùng UniWork cần soạn tài liệu kinh doanh: báo cáo, form hóa đơn, báo giá, bài trình chiếu. Người làm
bắt đầu từ **một mẫu có sẵn** hoặc **một ý tưởng thô**, và tệp cuối thường là **DOCX hoặc PPTX**, có khi **XLSX**.
Mục tiêu cuối của chủ sản phẩm: **Hỏi UNI thao tác được toàn diện với phần Office** — đọc, tìm, ghi — để ra một tệp
đầu ra tốt nhất có thể.

Hôm nay hai bên đều thiếu một nửa:

- **Hỏi UNI** tìm và đọc được khắp workspace, nhưng không đọc được DOCX/XLSX/PPTX/PDF trong kho Tài liệu
  (`mcp_tools_documents.go:204-206` chỉ trả tên và loại), không duyệt được thư mục, và chỉ ghi được trang UniNote.
- **AI trong trình soạn** (genoffice, 143 công cụ, `docs/office/g5g6g7/genoffice-tools.md` §3) soạn rất tốt trong tệp
  đang mở — kiểu chữ, bảng, đầu/chân trang, biểu đồ, layout slide, công thức Excel tính bằng engine — nhưng không
  nhìn được gì ngoài tệp đó (spec Office `2026-10-02-office-g5-g6-g7-design.md` §6.1, §6.3).

Thiết kế này ghép hai nửa: **Hỏi UNI gom mẫu và tư liệu, rồi giao việc cho AI trong trình soạn** (cách B, chủ sản
phẩm chọn).

## 2. Mục tiêu, không làm, chống mục tiêu

**Mục tiêu**

1. Người dùng giao việc bằng lời trong Hỏi UNI; Hỏi UNI tìm mẫu, đọc tư liệu (kể cả tệp Office trong kho), đưa thẻ kế
   hoạch; người dùng duyệt; tệp mở trong trình soạn và UniWork AI soạn ngay trước mắt người dùng; người dùng tự Lưu.
2. Đủ cả bộ định dạng của trình soạn: DOCX, XLSX, PPTX (chính), và PDF, Markdown, HTML.
3. Có mục **Mẫu văn bản** trong Tài liệu làm nguồn mẫu duy nhất của Hỏi UNI.
4. Bài trình chiếu (và báo cáo) làm từ ý tưởng thô luôn qua **dàn ý được người dùng duyệt** trước khi dựng.

**Không làm trong đợt này**

- App desktop UniWork Office (đã có đường "AI preset" riêng; xem §8). Đợt này chỉ web.
- Kho mẫu chung cho cả tổ chức. Mẫu chỉ trong một workspace.
- Bộ điền mẫu `{{key}}` phía server (`genoffice merge`): AI trong trình soạn tự điền; xem §9.
- OCR, sửa XLS/ODT.
- Gỡ BYOK khỏi sản phẩm (Q10): dự án riêng, làm sau. Thiết kế này không dựa vào BYOK và không động vào nó.

**Chống mục tiêu** — nếu xảy ra thì coi như hỏng, dù chạy được:

- Hỏi UNI ghi đè hay sửa tệp mà người dùng không thấy và không duyệt.
- AI sửa **mẫu gốc**. Mẫu chỉ được sao ra.
- AI tự Lưu. Không có autosave; một lượt AI không tạo version (spec Office §6.4).
- Dùng BYOK hay khóa ngoài ở bất kỳ bước nào.
- Hỏi UNI đọc tài liệu của workspace khác, hay vượt quyền của người hỏi.

## 3. Ràng buộc

- **Chỉ UniWork AI.** Mọi AI trong dự án chạy bằng UniWork AI, không BYOK, không khóa ngoài (chủ sản phẩm,
  2026-10-27). AI trong trình soạn dùng nhà cung cấp `uniwork` (`packages/ai-provider/src/uniwork/protocol.ts` ở fork;
  façade `server/internal/ai/openai_facade.go`).
- **G6-D2 chặn dữ liệu thật.** Cờ `office_ai_uniwork` mặc định tắt, mô tả "keep it off for organizations with real data
  until G6-D2 closes" (`server/internal/featureflags/keys.go:71`). G6-D2 = chọn upstream model production, vùng,
  thời gian giữ log; spec Office §13.1 ghi "người dùng quyết khi lên production". Xây dựng không bị chặn (dev dùng Codex).
- **ADR 0044.** Công cụ ghi của Hỏi UNI chỉ ghi đề xuất; chỉ Apply của người hỏi chạy lệnh, dưới
  `service.Human(asker)`.
- **ADR 0028 / spec Office §6.4.** Ghi vào UniWork từ trình soạn đi qua đường Lưu thường bằng phiên người dùng.
- **Phạm vi workspace.** Hỏi UNI chỉ đọc trong workspace đang hỏi (`TestAgentToolsStayInTheAskedWorkspace`). Thiết kế
  này **không** nới luật đó.
- **Hai repo.** Một phần việc ở fork `UNIAI-TEAM/uniwork-office`, rồi pin lại (`apps/web/platform/office-frame/*.pin.json`)
  và vendor lại giao thức (`packages/core/office/docs-frame-protocol.ts`).
- Luật repo: CLAUDE.md (migration không FK, `organization_id`, index `CONCURRENTLY` một file; audit + outbox cùng giao
  dịch, `audit_coverage_test.go`; sự kiện catalogue ba nơi; SDI/SDO + `pathParamSDI`; ma trận cô lập; malformed-response
  test cho endpoint mới; cờ có `review_at`; `t()` cho mọi chữ trong `packages/views`).
- Eval AI thật tốn tiền, cần chủ sản phẩm đồng ý từng lần.

## 4. Trải nghiệm (cách B)

1. **Giao việc trong Hỏi UNI.** Ví dụ "Soạn báo giá cho khách Minh An theo mẫu Báo giá 2026, 12 dòng hàng từ đơn tháng
   10", hoặc "Bài trình chiếu 10 trang giới thiệu dịch vụ bảo trì cho khách mới". Người dùng có thể đính kèm mẫu vào
   khung chat.
2. **Hỏi UNI gom mẫu và tư liệu.** Tìm mẫu trong mục Mẫu văn bản (nhiều mẫu khớp → đưa danh sách để chọn, không tự
   đoán); đọc tư liệu trong workspace (tài liệu, tệp Office, công việc, cuộc họp, tệp đính kèm).
3. **Thẻ kế hoạch.** Mẫu nào (hoặc "tệp trống"), tư liệu nào, tên tệp mới, thư mục lưu. Khi **không có mẫu** (soạn từ ý
   tưởng), thẻ có **dàn ý**: tiêu đề và ý chính từng slide (PPTX) hoặc mục lục (DOCX).
   - **"Sửa dàn ý"** mở khung soạn có Markdown và TipTap (chủ sản phẩm yêu cầu) để viết tường minh; sửa bằng lời cũng
     được — Hỏi UNI đưa dàn ý mới.
   - **"Mở và soạn" / "Mở và dựng"** là nút Apply.
4. **Tạo tệp và mở trình soạn.** Hỏi UNI tạo bản sao của mẫu (giữ logo, kiểu chữ, đầu/chân trang) hoặc tệp trống, mở nó
   trong trình soạn, và giao sẵn yêu cầu + dàn ý + tư liệu cho UniWork AI ở đó. Người dùng nhìn tệp thành hình.
5. **Xem, chỉnh, Lưu.** Nhờ AI sửa tiếp trong ô AI của trình soạn, hoàn tác cả lượt, sửa tay; bấm Lưu thì thành version
   trong Tài liệu. Chưa Lưu thì không có version nào.

Bản phác giao diện (không phải thiết kế cuối) nằm ở thư mục brainstorm của phiên: chọn cách làm việc, luồng B bốn bước,
mục Mẫu văn bản, thẻ dàn ý.

## 5. Quyết định đã chốt với chủ sản phẩm

| # | Quyết định |
| --- | --- |
| Q1 | Cách B: Hỏi UNI gom và giao việc; AI trong trình soạn soạn; người dùng Lưu. |
| Q2 | Đầu vào: mẫu có sẵn hoặc ý tưởng thô. Đầu ra: cả bộ định dạng, chính là DOCX, PPTX, XLSX. |
| Q3 | Mẫu nằm trong mục mới **Mẫu văn bản** ở thanh bên Tài liệu; tải lên ở đó hoặc tải vào khung chat thì lưu vào đó. Không dùng quy tắc đặt tên. |
| Q4 | Mục Mẫu văn bản thuộc **một workspace**; workspace khác muốn dùng thì tự lưu bản của mình. |
| Q5 | **Mọi thành viên** workspace được thêm, sửa, xóa mẫu. |
| Q6 | Mọi AI chạy bằng **UniWork AI**, không khóa ngoài. |
| Q7 | Bài trình chiếu từ ý tưởng **phải đưa dàn ý trước**. |
| Q8 | Khung "Sửa dàn ý" hỗ trợ **Markdown và TipTap**. |
| Q9 | Làm **route viết phía server cho UniWork AI** để mở `write_document`, `generate_deck`, `regenerate_slide`. |
| Q10 | Q6 áp cho **cả sản phẩm**: gỡ BYOK khỏi trình soạn web (ADR 0029) và app desktop (ADR 0034), làm thành **dự án riêng sau tính năng này**, và chỉ gỡ sau khi G6-D2 đóng. |

## 6. Thiết kế theo phần

Sáu phần, làm theo thứ tự; phần 1 và 2 độc lập với nhau.

### Phần 1 — Hỏi UNI đọc tệp Office và duyệt thư mục

- **Đọc nội dung tệp.** `get_document` (`askuni_agent_tools.go:183`, `agentGetDocument` `:515-536`) gọi
  `McpToolService.GetDocument` (`mcp_tools_documents.go:182-224`). Với DOCX/XLSX/PPTX/ODT/CSV/PDF, đọc chữ bằng
  `server/internal/attachtext` (`Extract` `attachtext.go:57`, `ReadPDF`) — bộ đọc file đính kèm đang dùng
  (`askuni_file_plan.go:95-122`) — thay vì chỉ trả tên và loại. Cắt cùng trần 16.000 ký tự và dòng báo cắt hiện có
  (`mcp_tools.go:79-82`); ghi `download` vào nhật ký truy cập như tệp văn bản (`mcp_tools_documents.go:230`).
- **Duyệt thư mục.** Đăng ký công cụ đọc `list_documents` cho Hỏi UNI, dùng lại `ListDocuments`
  (`mcp_tools_documents.go:244`).
- **Tìm theo nội dung tệp (phần 1b).** Tệp hiện chỉ khớp theo tên (`document_search.go:30-31`). Ghi chữ trích ra vào
  chỉ mục khi commit version để `search` tìm được trong nội dung. Có thể làm sau 1a.
- **Tệp đính kèm ở các module khác (phần 1c).** Tư liệu hay nằm trong tệp đính kèm của công việc, chat, cuộc họp, Email
  Hub (ví dụ đơn hàng tháng 10). Tài liệu đã có dạng xem theo nguồn (`LibraryView` `sources`, `documents-sidebar.tsx:33-35`),
  nhưng Hỏi UNI chưa đọc được (báo cáo đánh giá §1). Phần 1c cho Hỏi UNI đọc các tệp đó qua cùng đường đọc của 1a, với
  kiểm quyền của module sở hữu tệp.

### Phần 2 — Mục "Mẫu văn bản"

- **Giao diện.** Thêm `{ kind: "templates" }` vào `LibraryView` (`packages/views/documents/documents-sidebar.tsx:25`)
  và một `NavItem` cạnh "Được chia sẻ với tôi"; icon qua `DOCUMENTS_NAV_ICONS`; chữ qua i18n vi/en. Danh sách nhóm theo
  Word, Excel, PowerPoint, khác; nút "Tải mẫu lên"; menu dòng "Đánh dấu là mẫu" / "Bỏ khỏi Mẫu".
- **Dữ liệu.** Mẫu là tài liệu tệp bình thường của workspace, có thêm một dấu "là mẫu". Mọi thành viên workspace xem và
  sửa được mục (Q5), nên mẫu để `visibility = 'workspace'`.
- **Quyền, đọc Q5 theo luật tài liệu hiện có.** Trên tài liệu `workspace`, thành viên thường có `edit`, không có `manage`
  (`document_permissions.go:84-89`); chuyển vào thùng rác và đổi phạm vi xem cần `manage` (`document_lifecycle.go:860-889`).
  - Mọi thành viên: tải mẫu mới lên (người tải là chủ), sửa nội dung mẫu, đánh dấu một tài liệu đã ở phạm vi workspace
    là mẫu, **bỏ khỏi Mẫu** bất kỳ mẫu nào. "Xóa" trong mục Mẫu văn bản nghĩa là bỏ khỏi Mẫu.
  - Đánh dấu một tài liệu `restricted` là mẫu sẽ mở nó cho cả workspace, nên chỉ người có `manage` làm được, và giao
    diện nói rõ việc mở rộng phạm vi trước khi làm.
  - Chuyển tệp mẫu vào thùng rác, thu hẹp phạm vi xem: theo luật tài liệu hiện có, không đổi.
- **Lưu từ khung chat.** Khi người dùng đính kèm tệp và dùng làm mẫu, Hỏi UNI hỏi "Lưu vào Mẫu văn bản?" (thẻ đề xuất,
  công cụ ghi mức 2). "Chỉ dùng lần này" vẫn tạo tài liệu làm việc (trình soạn chỉ mở được tài liệu), nhưng không đánh
  dấu mẫu.
- Mỗi lần đánh dấu / bỏ dấu là thay đổi trạng thái nghiệp vụ: audit + outbox cùng giao dịch, sự kiện mới trong catalogue
  ba nơi, invalidate key danh sách mẫu.

### Phần 3 — Hỏi UNI tạo tệp từ mẫu hoặc tệp trống

- **Công cụ đọc** `list_templates` (mẫu của workspace, lọc theo định dạng).
- **Công cụ ghi** (askWriteTool, ADR 0044), ví dụ `create_office_document`: nguồn = id mẫu **hoặc** định dạng tệp trống;
  tên; thư mục đích; yêu cầu; dàn ý (Markdown); danh sách tư liệu (id + đoạn trích có trích dẫn).
  - **Luôn mức 2**: tạo tệp trong thư mục và mở trình soạn. Nút "Mở và soạn"/"Mở và dựng" là Apply.
  - `prepare` kiểm **quyền sửa** ở thư mục đích và quyền đọc mẫu. (Báo cáo đánh giá ghi lỗ hổng hiện có: `prepare` của
    công cụ tài liệu chỉ kiểm quyền đọc.)
  - Apply: tạo **tài liệu mới của người hỏi** từ mẫu, hoặc tệp trống bằng đường blank hiện có
    (`POST /workspaces/{workspaceID}/documents/files/blank`, `documents.go:382`; `document_office_blank_*.go`); lưu gói
    giao việc (§Phần 4); trả id tài liệu để client mở trình soạn.
  - **Không dùng `CopyDocument`.** Bản sao của nó giữ chủ ACL, phạm vi xem và chia sẻ của nguồn
    (`document_copy.go:20-27`). Với mẫu ở phạm vi workspace, mọi báo giá hay hóa đơn làm ra sẽ mở cho cả workspace và
    thuộc quyền quản lý của người tải mẫu, trong khi tư liệu Hỏi UNI gom có thể đến từ tài liệu hạn chế. Cần lệnh mới
    "tạo từ mẫu": tài liệu mới, người hỏi là chủ, version đầu dùng lại byte của version hiện tại của mẫu (như bản sao,
    không chép byte), ghi nguồn gốc vào các cột `source_*`.
  - **Phạm vi xem của tệp mới:** mặc định "chỉ mình tôi" (`restricted`); thẻ kế hoạch hiện phạm vi này và cho đổi sang
    workspace trước khi Apply.
  - **Khi AI trong trình soạn không chạy được** cho tổ chức, người dùng hay định dạng đó (cờ tắt, thiếu gói
    `office.ai_cloud`, hết credit, không có quyền sửa): `prepare` vẫn đưa thẻ, nói rõ lý do, và đổi nút thành "Tạo và mở
    để tự soạn": tệp vẫn được tạo từ mẫu hay tệp trống, chỉ không có bước giao việc.
  - Hoàn tác: chuyển tệp vào thùng rác, như hoàn tác `create_document` (`askuni_write_documents.go:24-96`).
- **Thẻ kế hoạch và thẻ dàn ý** là biến thể mới của dòng đề xuất (`packages/views/ai/ask-uni-proposal-row.tsx`).
  Dàn ý lưu dạng Markdown trong đối số đề xuất.
- **"Sửa dàn ý"** dùng lại `packages/views/editor/content-editor.tsx` (TipTap v3, `@tiptap/markdown`, nạp bằng
  `contentType: 'markdown'`, lưu bằng `getMarkdown()`), lưu qua luồng sửa đối số đề xuất có sẵn
  (`ask-uni-proposal-edit.tsx`, `onSave(changes)`).
- **Khi nào có dàn ý:** luôn có khi soạn từ ý tưởng (PPTX: từng slide; DOCX: mục lục; XLSX: các sheet và cột). Có mẫu
  thì thẻ kế hoạch liệt kê phần sẽ điền.

### Phần 4 — Cầu nối giao việc cho AI trong trình soạn (web)

- **Server — gói giao việc.** Apply ở phần 3 ghi một gói (yêu cầu, dàn ý đã duyệt, tư liệu có trích dẫn) gắn với
  (người hỏi, tài liệu), dùng một lần, có hạn. Lượt UniWork AI đầu tiên của trình soạn cho tài liệu đó, khi mang id gói,
  được server mở rộng thành câu hỏi đầu (hội thoại UniWork AI do server giữ; `AIUniworkService`, `ai_uniwork.go`).
  Lý do: client chỉ gửi tối đa 8.000 ký tự mỗi câu hỏi (fork `uniwork/protocol.ts:152-168`). Tư liệu vào hội thoại
  dưới dạng nội dung không tin cậy, không phải chỉ dẫn (spec Office §6.2).
- **Giao thức khung — yêu cầu mới host→frame** (ví dụ `ai.start {handoffId, text}`), thêm theo luật additive của giao
  thức (fork `web/docs/protocol/README.md:294-296`), có capability riêng quảng bá trong `InitAck`.
  - Fork: thêm kiểu vào `HostRequests` (`web/docs/protocol/types.ts:1378`), validator, `handleX` trong
    `web/docs/protocol/client.ts:549-615`; nối `onAiPreset`/`consumeAiPreset` trên web (đang là no-op ở
    `web/docs/bridge/hide.ts:178-179`, `web/modules/sheets/bridge.ts:1135-1136`, `web/modules/pdf/webapi.ts:1155-1156`,
    `web/modules/slides/web-slides-api.ts:1342-1343`). Trình soạn đã biết mở panel và tự chạy khi nhận preset
    (`apps/docs/src/renderer/App.tsx:2389-2397`).
  - UniWork: vendor lại giao thức, host gửi yêu cầu sau `init` khi tài liệu được mở từ Hỏi UNI; pin lại bundle.
- **Dock Hỏi UNI sau khi giao** hiện "Đã giao cho AI trong trình soạn" kèm liên kết tới tài liệu, và theo dõi trạng thái
  lượt qua sự kiện `aiRun` có sẵn (frame→host).
- **Trần lượt giữ nguyên.** Một run UniWork AI có tối đa 8 vòng công cụ, hạn 55 giây, lịch sử 48k token
  (`openai_facade.go:30-45`, `ai_uniwork.go`); giá trị cuối thuộc G7-D1. Dự án này không nâng trần. Một việc dài
  (deck nhiều trang, báo cáo nhiều mục) được chia theo dàn ý: mỗi mục hay mỗi nhóm slide là một lượt tiếp nối trong cùng
  hội thoại, trình soạn tự gửi lượt tiếp khi lượt trước xong và dàn ý còn mục chưa làm.
- **Mẫu gốc:** Hỏi UNI không bao giờ chọn một tài liệu đang là mẫu làm đích ghi; nó luôn tạo tài liệu mới. Người dùng tự
  mở mẫu trong trình soạn thì vẫn dùng AI trong trình soạn như mọi tài liệu khác; không thêm cờ khung.
- **ADR mới.** Spec Office §6.1 ("Chat không mở thành Ask UNI toàn workspace") và §6.3 (công cụ phía server đọc tài liệu
  khác cần ADR) cấm AI trong trình soạn lấy tư liệu ngoài tệp. Gói giao việc đưa tư liệu Hỏi UNI đã đọc dưới quyền
  người hỏi và người hỏi đã duyệt vào hội thoại đó. Cần một ADR mới ghi ngoại lệ này và cách kiểm.

### Phần 5 — Route viết cho UniWork AI; dựng slide và viết cả tài liệu

- **Server:** đưa `generate_deck` và `regenerate_slide` trở lại bảng công cụ slides cho UniWork AI, chỉ với lượt gắn tài
  liệu (`openai_facade.go:758-770`, `officeUniworkModulesV1`). Lý do chặn cũ (G6-09a): trên desktop chúng từng ghi nháp
  ra ngoài tài liệu đang mở; G6-12 đã sửa cho deck gắn UniWork (`genoffice-tools.md` dòng slides (c)).
- **Fork:** bỏ hai tên đó khỏi `UNIWORK_AI_HIDDEN_TOOLS` (`apps/slides/src/renderer/ai/slides-skill.ts:1100`); hiện thực
  `localGeneratePage` / `landGeneratedPages` trên web (đang là stub, `web-slides-api.ts:1338-1341`) bằng bộ dựng trang
  của `packages/pipelines` (TypeScript thuần, `page-spec.ts:527`).
- Dàn ý đã duyệt ở Hỏi UNI trở thành đầu vào `plan_deck` / `generate_deck` (`{core_hook, style, pages[]}`).
- Cập nhật spec Office §6.5, dòng PPTX ("không hứa AI tạo layout toàn deck").
- `insert_web_image`, `replace_image`, `save_style_template` vẫn chặn trong đợt này.
- **Chặn thứ hai, chưa giải.** Ngoài lỗi nháp desktop, `generate_deck`/`regenerate_slide` tự gọi model ngoài vòng công
  cụ (style, dàn ý, từng trang; `genoffice-tools.md` mục 29). Các "bộ viết một lần" đó đánh dấu `purpose: 'one-shot'`
  (`packages/agent-core/src/stream-text.ts:88`, `apps/slides/src/renderer/ai/llm-request.ts:20` ở fork), và đường
  UniWork AI trên web từ chối mọi yêu cầu như vậy (`web/modules/shared/ai/stream.ts:203-212`). Cùng cơ chế này đứng sau
  `write_document` của Word (`apps/docs/src/renderer/ai/AiPanel.tsx:957`) và bộ viết trang HTML — nên dưới UniWork AI,
  hôm nay cả công cụ "viết cả tài liệu" cũng không chạy, dù server đã cho phép (`openai_facade.go:781`).
- **Route viết phía server (Q9).** Thêm một route UniWork AI cho các lời gọi "viết một lần", mount bằng frame token như
  route chat (`office_frame_ai.go`), cùng cổng: `RequireMember` → gói `office.ai_cloud` → cờ `office_ai_uniwork` và cờ
  định dạng → `CheckQuota(ai.tokens)` → `ai.Gateway`.
  - Client không gửi system prompt (façade đã từ chối prompt của client). Client gửi **loại bộ viết** (ví dụ viết tài
    liệu Word, style deck, dàn ý deck, một trang slide, một trang HTML) và nội dung đầu vào; server chọn prompt viết
    theo loại, giữ trong gói chỉ dẫn Office (`server/internal/ai/prompts_office.go`). Nội dung đầu vào là dữ liệu không
    tin cậy.
  - Mỗi lời gọi mang `X-UniWork-AI-Run` của lượt đang chạy, ghi usage vào run đó và đếm vào trần `model_calls` đã có
    (`run_limit_reached`, `fields.limit = model_calls`). Trần đầu ra và hạn thời gian theo `ModelPolicy` của
    `office_uniwork_ai`; giá trị do G7-D1.
  - Fork: trong `uniworkTurn` (`web/modules/shared/ai/stream.ts:200-212`), yêu cầu `purpose: 'one-shot'` đi tới route
    viết thay vì bị từ chối; các chỗ gọi (`stream-text.ts`, `llm-request.ts`) gửi kèm loại bộ viết. Prompt viết của
    fork và của server phải khớp định dạng đầu ra (HTML hạn chế của Word, JSON spec trang slide 1280×720); một test
    ở mỗi repo giữ hợp đồng này.
  - Cần ADR mới (route viết, prompt giữ ở server) và sửa spec Office §6.2 (lượt model ngoài vòng công cụ).

### Phần 6 — Lên production

- Chủ sản phẩm đóng **G6-D2**. Gợi ý: dùng cùng nhà cung cấp Hỏi UNI đang dùng để chỉ có một đường dữ liệu.
- Bật `office_ai_uniwork` và cờ từng định dạng; tổ chức cần gói `office.ai_cloud` (cổng của façade, `ai_uniwork.go`).
- Cờ mới của tính năng (ví dụ `ask_uni_office`), mặc định tắt, có `review_at`.
- Eval: bộ fake/offline chạy trong CI; eval sống chỉ khi chủ sản phẩm đồng ý.

## 7. Quyết định của người viết (chủ sản phẩm có thể bác)

1. Chỉ web trong đợt này; desktop để sau.
2. Sửa trực tiếp `McpToolService.GetDocument` để cả MCP connector cũng đọc được tệp Office (một đường đọc chung), thay vì
   tách đường riêng cho Hỏi UNI.
3. Bỏ quy tắc đặt tên; mục Mẫu văn bản là nguồn mẫu duy nhất.
4. Hỏi trước khi lưu mẫu tải từ khung chat.
5. Gói giao việc ghi ở server, frame chỉ mang id gói.
6. Báo cáo DOCX và bảng XLSX từ ý tưởng cũng đi qua dàn ý (Q7 chỉ nói bài trình chiếu).
7. Mở lại `generate_deck` / `regenerate_slide` cho UniWork AI (đảo quyết định G6-09a), giữ chặn ba công cụ còn lại.
8. Tệp tạo từ mẫu là tài liệu mới của người hỏi, mặc định "chỉ mình tôi", không dùng `CopyDocument` (Phần 3).
9. Q5 đọc theo luật quyền hiện có: "xóa" trong mục Mẫu là bỏ khỏi Mẫu; thùng rác và thu hẹp phạm vi theo luật cũ; đánh
   dấu tài liệu hạn chế là mẫu cần `manage` (Phần 2).
10. AI trong trình soạn không chạy được thì vẫn tạo và mở tệp để người dùng tự soạn (Phần 3).
11. Đọc cả tệp đính kèm ở công việc, chat, cuộc họp, Email Hub (Phần 1c).
12. Không nâng trần lượt UniWork AI; chia việc dài thành nhiều lượt tiếp nối theo dàn ý (Phần 4).
13. Hỏi UNI không bao giờ ghi vào mẫu; người dùng tự mở mẫu thì vẫn dùng AI bình thường (Phần 4).

## 8. Để người xây dựng quyết

- Mô hình dữ liệu của dấu "là mẫu" (cột trên `documents` hay bảng riêng), miễn theo luật migration.
- Tên cụ thể của công cụ, sự kiện, route, capability và yêu cầu khung.
- Hạn và cách dọn gói giao việc.
- Cách hiển thị chi tiết của thẻ kế hoạch, thẻ dàn ý và mục Mẫu văn bản (theo `docs/conventions.md` và UI Rules).
- Phần 1b làm cùng phần 1 hay tách sau.
- Desktop: đường "AI preset" có sẵn (`apps/shell/src/main/index.ts:5321-5346`, `tab-manager.ts:489-513`) là hướng
  khi làm desktop.

## 9. Rủi ro và việc còn mở

- **G6-D2 chưa đóng** → không chạy được với dữ liệu thật. Quyết định của chủ sản phẩm khi lên production.
- **Hai repo, pin lại bundle**: lệch giữa fork `main` và pin web; mọi thay đổi giao thức phải additive.
- **Chất lượng AI chưa đo** cho luồng mới: có công cụ không có nghĩa là model dùng tốt. Bộ devset G6/G7 có sẵn
  (`docs/office/g5g6g7/devset`) nên mở rộng cho tình huống báo giá, hóa đơn, bài trình chiếu.
- **Hóa đơn nhiều dòng hàng**: AI phải thêm dòng bảng bằng thao tác (`insertTableRow` Word, `insert_rows` Excel); nếu
  chất lượng kém, cân nhắc bộ điền mẫu phía server dựa trên `genoffice merge` (hiện không lặp dòng, không ảnh;
  `packages/cli/src/commands/merge.ts:31,194` ở fork).
- **Trần lượt UniWork AI** (số vòng công cụ, số lượt model mỗi run) có thể không đủ cho deck dài; cần đo.
- **Chi phí credit** của một lần dựng deck hay báo cáo dài.
- **Route viết (Phần 5)**: prompt viết ở server phải đi cùng phiên bản bundle fork được pin; lệch định dạng đầu ra là lỗi
  im lặng (deck hỏng, tài liệu trống). Trần `model_calls` phải đủ cho một deck (style + dàn ý + từng trang) hoặc luồng
  phải chia theo nhóm trang.

## 10. Câu hỏi chờ chủ sản phẩm

Không còn câu hỏi chặn việc lập kế hoạch. Còn một quyết định chặn việc **chạy với dữ liệu thật**: G6-D2 (nhà cung cấp
model production, vùng, thời gian giữ log), chủ sản phẩm quyết khi lên production (§6 Phần 6).

## 11. Tham chiếu

- Báo cáo đánh giá: `docs/ask-uni-documents-assessment.md` (chưa commit).
- Spec Office G5/G6/G7: `docs/superpowers/specs/2026-10-02-office-g5-g6-g7-design.md` (§6, §13.1).
- Bảng công cụ genoffice: `docs/office/g5g6g7/genoffice-tools.md`.
- Spec Hỏi UNI làm mọi thao tác: `docs/superpowers/specs/2026-10-26-ask-uni-full-actions-design.md`.
- ADR 0010, 0028, 0029, 0044: `docs/adr/`.
- Fork: `UNIAI-TEAM/uniwork-office` — `packages/agent-core/src/loop.ts`, `packages/ai-provider/src/uniwork/`,
  `web/docs/protocol/`, `apps/slides/src/renderer/ai/slides-skill.ts`, `packages/pipelines/`, `packages/cli/`.
