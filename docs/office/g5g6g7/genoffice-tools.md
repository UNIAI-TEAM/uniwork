# UniWork Office — Bảng công cụ agent genoffice (G6-01)

> **Trạng thái:** in-progress — cột tay agent-core/docs/markdown/html đã viết; chờ khối trích xuất (W1) và phần
> sheets/slides/pdf (W3); cột tay chờ ký (§10).

## 1. Nguồn, cách tái tạo và kiểm tra

- **Fork tại SHA:** `0d03b185` (fork `main`), là pin web hiện tại `0.1.0-0d03b18`
  ([office-web-modules](../office-web-modules.md)). Mọi `path:line` trong tài liệu này đọc tại SHA đó.
- **Nguồn duy nhất của tên công cụ cho G6-14:** instruction pack `office_uniwork_ai@N` chỉ được nhắc tên công cụ có
  trong cột `tool` của khối trích xuất (§3). Cột tay (§4–§9) là nhận định của người viết, không là nguồn tên.
- **Tái tạo cột cơ học** (trong worktree fork, không checkout, không chạy code sản phẩm):

  ```bash
  node scripts/genoffice-tools-extract.mjs --rev 0d03b185 > /tmp/genoffice-tools.md
  ```

- **Kiểm AC-2** (khối giữa hai marker = đầu ra script, từng byte), chạy ở gốc repo D với `FORK` trỏ tới worktree fork:

  ```bash
  node "$FORK/scripts/genoffice-tools-extract.mjs" --repo "$FORK" --rev 0d03b185 > /tmp/extract.md
  sed -e '1,/^<!-- extract:begin -->$/d' -e '/^<!-- extract:end -->$/,$d' \
    docs/office/g5g6g7/genoffice-tools.md | diff - /tmp/extract.md && echo AC-2 OK
  ```

- Đồng bộ upstream hoặc đổi pin: G7-06 chạy lại script tại SHA mới; cột cơ học lệch → cập nhật khối §3 và mở một hàng
  review tay cho owner F + Product (§10).

## 2. Từ vựng chốt theo code

Mọi đường dẫn tính từ gốc fork tại `0d03b185`.

| Thuật ngữ | Nghĩa theo code | Bằng chứng |
| --- | --- | --- |
| **Công cụ** (tool) | Một `AgentToolDef` `{name, description, inputSchema}` mà model thấy trong `tools` của request; chạy trong renderer qua `executeTool`, trả `ToolExecution` (`output`, `isError`, `mutated`, `summary`) | `packages/agent-core/src/types.ts:2-6`, `types.ts:61-75` |
| **`AgentSkill`** ("skill" trong vòng agent) | Một miền năng lực của panel: đoạn system prompt + danh sách công cụ + `buildContext()` mỗi lượt + `executeTool` + `verifyResponse` tùy chọn. `composeSkills` gộp nhiều skill, tên công cụ phải duy nhất (trùng → ném lỗi); `tools`/`systemPrompt` là getter sống nên skill con ẩn/hiện công cụ theo capability ngay trước mỗi request | `packages/agent-core/src/skill.ts:15-40`, `skill.ts:46-87` |
| **Vòng agent** (`AgentLoop`) | Gọi model, chạy tool call, gửi tool result, lặp. Trần: `DEFAULT_MAX_TURNS` = 100 lượt model mỗi run (không app nào hạ trần), 3 lượt giống hệt liên tiếp, 8 lượt toàn lỗi, 3 lần input không dùng được; nén lịch sử ở 256 KB, giữ 96 KB gần nhất; mỗi lượt tối đa 2 MiB text/reasoning stream. Chụp snapshot trước công cụ `mutated` đầu tiên của run (`snapshotBefore`, móc cho nút Roll back) | `packages/agent-core/src/loop.ts:55-71`, `loop.ts:73-92`, `loop.ts:325-326` |
| **Transport** | `AgentTransport.stream(request, callbacks)`; agent-core chỉ có một bản: `createIpcTransport` phía renderer. Desktop: preload → IPC `ai:stream` → process main gọi `streamForProvider` của `@genoffice/ai-provider` (ví dụ `apps/docs/src/main/docs-main.ts:3821`). Web: cùng `createIpcTransport`, nhưng `withWebAi` thay `aiStream` bằng bản web: giao thức của ai-provider chạy trong frame, URL nhà cung cấp bị viết lại về `<ai mount>/byok/<provider>/…` kèm frame token; URL ngoài mount bị từ chối | `packages/agent-core/src/electron-transport.ts:28-38`, `web/modules/shared/ai/stream.ts:1-33`, `web/modules/shared/ai/transport.ts:1-27`, `web/docs/bridge/module-bridge.ts:165` |
| **MCP** | Server MCP **cục bộ** của app cho agent bên ngoài (Claude Code, Codex…): `McpServerService`, HTTP `/mcp` + SSE cũ, bind `127.0.0.1:3093`, không token (chỉ kiểm Host/Origin), **tắt mặc định** (`mcpEnabled === true` mới bật). Công cụ MCP (`create_docx`, `read_docx`, `apply_ops`, `read_sheet`, `apply_sheet_ops`, `read_deck`, `apply_slide_ops`, `read_pdf`, `open_documents`…) điều khiển editor đang mở qua bridge main→renderer, dùng lại executor của panel — chiều MCP → editor, không phải chiều ngược lại | `apps/shell/src/main/mcp/mcp-server.ts:13-14`, `mcp-server.ts:49`, `mcp-server.ts:93`, `apps/shell/src/main/index.ts:579`, `apps/docs/src/renderer/mcp-bridge.ts:1-15` |
| **Agent skills** (`@genoffice/cli/agent-skills`) | Bộ cài `skills/genoffice/SKILL.md` vào thư mục skills của agent bên ngoài (Claude Code `~/.claude/skills`, Codex, Cursor, Gemini CLI, Copilot, OpenCode, Windsurf), chỉ khi người dùng bấm ở Settings → Integrations hoặc gõ `genoffice skill`. Là prompt cho agent ngoài, không phải `AgentSkill` | `packages/cli/src/agent-skills.ts:17-118`, `skills/genoffice/SKILL.md:1-12` |
| **CLI** (`genoffice`) | Có server MCP riêng (stdio, hoặc HTTP loopback) cho agent ngoài. Chỗ duy nhất app spawn CLI là công cụ MCP headless | `packages/cli/src/mcp/http.ts:48-52`, `apps/shell/src/main/mcp/cli-runner.ts:92` |
| **`UNIWORK_CLOUD_TOOLS`** | Năm công cụ đám mây tốn credit của UniWork: `web_search`, `image_search`, `image_generate`, `media_analyze`, `transcribe`. Desktop: transport đặt ở shell main, gọi `/api/v1/orgs/{orgID}/ai/cloud*` bằng bearer của chính tài khoản UniWork đang đăng nhập (renderer không thấy token). Web: `/v1/office-frame/documents/{id}/ai/cloud*` bằng frame token (một tài liệu, `credentials:'omit'`). Entitlement `office.ai_cloud` và credit do server UniWork chặn. Đây là backend của các công cụ agent `web_search`, `image_search`, `generate_image`, `analyze_media`; tên trong mảng này **không** phải tên công cụ agent (`image_generate` ≠ `generate_image`) | `packages/ai-provider/src/uniwork-cloud.ts:20-29`, `apps/shell/src/main/uniwork-auth/cloud.ts:19-22`, `cloud.ts:195`, `cloud.ts:225`, `web/modules/shared/ai/client.ts:5-24` |

**Vòng agent trong app có gọi được CLI hoặc MCP không? Không — cả desktop lẫn web.**

- Công cụ chạy trong renderer qua `executeTool` của các skill mà từng `AiPanel` gộp; ra khỏi renderer chỉ qua các kênh IPC cố
  định `ai:stream`, `ai:web-search`, `ai:image-search`, `ai:generate-image`, `ai:analyze-media`, `ai:fetch-image`
  (ví dụ `apps/docs/src/main/docs-main.ts:3899-3967`). Không file nào trong `apps/*/src/renderer`, `packages/agent-core`
  hay `web/modules` dùng MCP client hoặc spawn CLI.
- Ngoại lệ duy nhất có chữ "MCP": `packages/ai-search/src/parallel-mcp.ts:1-30` là một MCP client tới
  `https://search.parallel.ai/mcp`, dùng làm backend dự phòng không khóa **bên trong** công cụ `web_search` trên desktop. Model
  không thấy nó như một công cụ; nó không mở thêm năng lực nào ngoài `web_search`.
- Web không có Node, không có code MCP trong module hay bridge.
- Hệ quả cho spec §6.2 "MCP và skills tắt": với nhà cung cấp UniWork AI, MCP và agent skills **không bao giờ** nằm trong lượt
  chạy. Allowlist chỉ cần lọc trên tên công cụ của `AgentSkill` (cột `tool` ở §3); công cụ đám mây trong allowlist chỉ khi tổ
  chức có `office.ai_cloud`.

## 3. Cột cơ học (sinh bằng script, không sửa tay)

<!-- extract:begin -->
PENDING extractor output (W1)
<!-- extract:end -->

## 4. Cột tay theo module

Khóa của mọi bảng là (module, tool) — đúng tên ở cột `tool` của §3. Viết tắt đường dẫn trong mục này:
`docs/ai/` = `apps/docs/src/renderer/ai/`, `md/ai/` = `apps/markdown/src/renderer/ai/`, `html/ai/` =
`apps/html/src/renderer/ai/`.

**Host.** Desktop (Electron) không đặt đối tượng capability, nên `cap(key)` luôn bật (`apps/docs/src/renderer/capabilities.ts:8-24`).
Web: mọi frame module mặc định `ai:false`; host cấp `ai` thì `aiHostGrants` bật `ai`, và từng công cụ đám mây
(`webSearch`, `imageSearch`, `imageGeneration`) chỉ bật khi host cấp thêm khóa đó, sau đó còn bị thu hẹp theo
`GET …/ai/cloud` (`web/modules/shared/ai/web-ai.ts:60-67`, `web-ai.ts:296-330`, `web/docs/bridge/module-bridge.ts:101`,
`module-bridge.ts:142-153`). `createDocument` không bao giờ được cấp trên web. "cả hai" dưới đây = desktop + web khi
host cấp `ai`; "cả hai, gate `X`" = trên web cần thêm capability `X`.

**Cột "ghi editor".** Lấy từ `mutated` mà nhánh `executeTool` trả về. Khi code trả `mutated:false` cho công cụ thực ra đổi tài
liệu, bảng ghi "có (code khai báo `false`)" — cột cơ học ở §3 theo khai báo của code, cột tay ghi sự thật; lệch đó là việc của
G6-12 (§9).

### 4.1 agent-core

`packages/agent-core` **không định nghĩa công cụ nào**: nó chỉ có kiểu (`AgentToolDef`, `AgentSkill`), vòng lặp và transport (§2).
Giới hạn chung mọi module kế thừa: 100 lượt model mỗi run, các cầu chì 3/8/3 lượt, nén lịch sử 256 KB/96 KB, 2 MiB stream mỗi
lượt (`packages/agent-core/src/loop.ts:73-92`, `loop.ts:325-326`). Nếu khối §3 có dòng `agent-core` thì đó là phát hiện của
script và phải đối chiếu lại ở đây.

### 4.2 docs (DOCX)

Skill: `composeSkills('docs+files', …, [createDocsSkill(…), createFilesSkill(…)])` (`docs/ai/AiPanel.tsx:768-788`).
Công cụ ẩn theo capability: `web_search`, `image_search`, `generate_image`, `create_document` (`docs/ai/docs-skill.ts:26-31`);
`generate_image`/`analyze_media` còn ẩn khi không có model media (`docs-skill.ts:96-101`). Tài liệu chỉ xem (UniWork
view-only) chỉ giữ `READ_ONLY_TOOLS` (`docs-skill.ts:37-46`), công cụ khác bị lọc khỏi danh sách và bị từ chối nếu vẫn gọi
(`docs-skill.ts:133-135`); `read_attachment` ở skill khác nên vẫn còn.
`apply_ops` là bộ điều phối nhiều op con (`insertField`, `insertBookmark`, `updateFields`, op bảng, `applyStyle`,
`deleteBlocks`…; `docs/ai/ops.ts`, `field-ops.ts`, `table-ops.ts`) — op con không phải công cụ riêng.

| tool | host | vào → ra | giới hạn trong code | ghi editor | ghi chú |
| --- | --- | --- | --- | --- | --- |
| get_document_context | cả hai | — → danh sách block (preview), thống kê, vùng chọn, page setup | khung 8 000 ký tự, preview 60/20, vùng chọn 24 000 (`docs/ai/protocol.ts:33-36`) | không | view-only giữ |
| read_blocks | cả hai | khoảng block, offset → HTML rút gọn | 24 000 ký tự/trang, có phân trang (`docs/ai/tools.ts:85`) | không | view-only giữ |
| insert_content | cả hai | `html`, `afterBlockIndex` → số block | chặn echo công cụ/JSON/`<sel>` | có | theo dõi thay đổi khi bật |
| write_document | cả hai | plan, title, context, `afterBlockIndex`/`replaceDocument` → số block, ký tự | stream qua `AiDocWriter`; tài liệu không trống thì cần `afterBlockIndex` hoặc `replaceDocument` | có | bản nháp stream không vào lịch sử undo (`docs/ai/doc-writer.ts:180`) |
| replace_blocks | cả hai | khoảng block, `html` → số block | kế thừa định dạng; bảng giữ độ rộng/viền | có | công cụ chính cho "viết lại đoạn" |
| replace_selection | cả hai | `html` inline → cũ → mới (cắt 200 ký tự) | chỉ một block văn bản; từ chối vùng chọn nhiều block hoặc nội dung khóa | có | dùng vùng chọn đông cứng của lượt |
| apply_ops | cả hai | `ops[]`, `dryRun` → tóm tắt | nguyên tử (một op sai → bỏ cả lô); `dryRun` xem trước | có | `insertField` xem §5 (a) |
| read_revisions | cả hai | — → danh sách tracked change | 200 mục trong context (`protocol.ts:627`) | không | |
| accept_changes | cả hai | bộ chọn (all/ids/author/type/block) → id bị ảnh hưởng | bộ chọn được kiểm | có | |
| reject_changes | cả hai | như trên | như trên | có | |
| read_comments | cả hai | — → các luồng comment | 20 luồng trong context (`protocol.ts:708`) | không | |
| reply_comment | cả hai | `parentId`, text → ack | luồng phải tồn tại | có | |
| resolve_comment | cả hai | id → ack | — | có (code khai báo `false`) | |
| insert_footnote | cả hai | blockIndex, `afterText`, text → id | text không rỗng | có | |
| insert_endnote | cả hai | như trên | như trên | có | |
| delete_note | cả hai | kind, id → ack | từ chối block khóa | có | |
| edit_note | cả hai | id, find, replace → ack | — | có | |
| read_notes | cả hai | — → danh sách chú thích | — | không | |
| add_comment | cả hai | blockIndex, text neo, comment, author → id | author mặc định là tác giả AI | có | |
| delete_comment | cả hai | id, `withReplies` → ack | gốc có trả lời bị từ chối nếu thiếu `withReplies` | có | |
| web_search | cả hai, gate `webSearch` | query, maxResults → tiêu đề/URL/trích | mặc định 6; web cắt query 400 ký tự, 1–10 kết quả (`web/modules/shared/ai/web-ai.ts:576`, `web-ai.ts:677-679`) | không | gửi query ra backend tìm kiếm; tốn credit nếu qua UniWork cloud |
| image_search | cả hai, gate `imageSearch` | query, maxResults → URL ảnh | mặc định 8; web cùng kẹp | không | |
| analyze_media | cả hai, cần model media | blockIndex, `mediaUrls`, yêu cầu → văn bản phân tích | đầu ra cắt 6 000 ký tự (`docs/ai/tools.ts:937`); web chỉ `data:`, tối đa 4, yêu cầu 4 000 ký tự (`web-ai.ts:563-566`, `web-ai.ts:741-750`); desktop 200 MB, 12 mục (`packages/ai-search/src/media-tools.ts:46-53`) | không | web âm thầm bỏ URL không phải `data:` |
| insert_image | cả hai | `url` http(s), maxWidthPx → ack | PNG/JPG/GIF theo magic byte; desktop 50 MB (`packages/electron-utils/src/remote-image.ts:11`) | có | tải URL do model đưa, xem §5 (b) |
| generate_image | cả hai, gate `imageGeneration` + model media | prompt, aspectRatio → ack | web cắt prompt 4 000 ký tự | có | tốn credit |
| insert_chart | cả hai | kind (bar/line/pie), categories, series → ack | giá trị ép về số hữu hạn hoặc null | có | |
| edit_chart | cả hai | blockIndex, title, categories, series → ack | số điểm phải khớp bản gốc | có | |
| set_header_footer | cả hai | kind, text, view → ack | 2 000 ký tự (`docs/ai/tools.ts:1890`) | có (code khai báo `false`, `tools.ts:1901`) | ngoài cây ProseMirror: rollback không trả lại |
| create_document | **chỉ desktop**, gate `createDocument` | type (docx/pdf/md/html), title, content → đường dẫn | title làm sạch 80 ký tự; không trần kích thước nội dung | không (đúng: không đổi tài liệu đang mở) | **ghi file mới ra đĩa**, xem §5 (c) |
| define_style | cả hai | styleId, name, type, pPr/rPr → ack | styleId `^[A-Za-z0-9_-]{1,64}$`, heading 1–9 | có (code khai báo `false`, `tools.ts:1991`) | mô tả nhắc `apply_style` — không tồn tại, đúng là op `applyStyle` của `apply_ops` (`docs/ai/style-ops.ts:51-54`) |
| list_styles | cả hai | — → danh mục style | — | không | bị lọc ở view-only dù chỉ đọc |
| set_page_setup | cả hai | section/blockIndex, khổ, hướng, lề, cột → từng section | lề ≤ 50 400 twip, cột 1–12 (`docs/ai/page-setup.ts:89`, `page-setup.ts:410`) | có (code khai báo `false`, `tools.ts:1945`) | ngoài cây ProseMirror |
| insert_section_break | cả hai | `afterBlockIndex`, type → danh sách section | type thuộc 4 giá trị | có | |
| read_attachment | cả hai | index, offset → đoạn văn bản + tổng ký tự | 24 000/lần (`docs/ai/files-skill.ts:12`); desktop trần 48 000; web chỉ đuôi văn bản thuần | không | đường dẫn lấy từ danh sách người dùng đính kèm, không do model chọn |
| set_watermark | cả hai | text hoặc ảnh, màu, độ mờ… → ack | text 200 ký tự (`docs/ai/floating-ops.ts:101`), opacity 0–1 | có (code khai báo `false`, `tools.ts:2005`) | biến thể ảnh tải URL |
| insert_picture | cả hai | `url` (http(s) hoặc `data:image`), vị trí, cỡ, float → ack | PNG/JPG/GIF | có | |
| insert_text_box | cả hai | text, kích thước, vị trí, wrap → ack | cỡ chữ trong `MIN/MAX_FONT_SIZE_PT` | có | |

Ghi chú docs:
- Bảo vệ Word (chỉ đọc, chỉ form, chỉ comment, khóa mật khẩu ghi) **không** được truyền vào panel: `AiPanel` chỉ nhận
  `readOnly={uniwork.readOnly}` (`apps/docs/src/renderer/App.tsx:7144`), không công cụ nào đọc `docProtected`. Giao dịch lập
  trình không bị `editable` chặn, nên nhiều khả năng AI sửa được tài liệu người dùng không gõ được (chưa kiểm bằng test).
- Năm công cụ khai báo `mutated:false` nhưng đổi tài liệu (`resolve_comment`, `set_header_footer`, `define_style`,
  `set_page_setup`, `set_watermark`): một run chỉ gọi chúng không có snapshot rollback (`loop.ts` chỉ chụp trước công cụ
  `mutated` đầu tiên), và rollback bằng `setContent` không trả lại style, page setup, header/footer, watermark.

### 4.3 markdown

Skill: `composeSkills('markdown+search', '', [markdownSkill, createSearchSkill()])` (`md/ai/AiPanel.tsx:380-395`).
`generate_image` chỉ có khi `cap('imageGeneration')` và có model media (`md/ai/AiPanel.tsx:388-389`). Không công cụ nào gate theo
`webSearch`/`imageSearch` trong renderer: trên web, bridge `withWebAi` trả lỗi "unavailable" khi capability tắt
(`web/modules/shared/ai/web-ai.ts:13-14`). View-only giữ `get_document_context`, `read_blocks`, `read_frontmatter`
(`md/ai/markdown-skill.ts:68`, lọc ở `:100`, từ chối ở `:112`); `web_search` ở skill khác nên vẫn còn.

| tool | host | vào → ra | giới hạn trong code | ghi editor | ghi chú |
| --- | --- | --- | --- | --- | --- |
| get_document_context | cả hai | — → khung `idx\|type\|preview` + vùng chọn | 8 000 ký tự, preview 60, vùng chọn 4 000 (`md/ai/tools.ts:27-30`) | không | đặt lại mốc chống sửa cũ |
| read_blocks | cả hai | `startIndex`, `endIndex`, `offset` → markdown của khoảng block | 24 000 ký tự/trang (`md/ai/tools.ts:29`) | không | |
| apply_ops | cả hai | `ops[]` (catalogue `editor/ops.ts`) → kết quả từng op | **không nguyên tử**: dừng ở op lỗi đầu tiên, giữ các op trước | có | khác docs/html (nguyên tử) |
| write_document | cả hai | plan, title, context, `afterIndex`, `replaceDocument` → stream markdown | 200 000 ký tự (`md/ai/doc-writer.ts:13`); tài liệu không trống cần `afterIndex`/`replaceDocument` | có | bản nháp không vào undo (`md/ai/doc-writer.ts:174`) |
| image_search | cả hai, web cần `imageSearch` | query, maxResults → URL ảnh | mặc định 8 | không | |
| insert_image | **desktop**; web luôn lỗi | `url` http(s), `afterIndex`, alt → chèn khối ảnh | PNG/JPG/GIF theo magic byte, 50 MB; cần tài liệu đã lưu | có | tải ảnh rồi **ghi file vào thư mục assets của tài liệu** (`md/ai/tools.ts:319-330`, `apps/markdown/src/main/markdown-main.ts:913-920`); web: `fetchImage` là stub trả `null` (`web/modules/markdown/webapi.ts:133`) |
| generate_image | **desktop**; web luôn lỗi | prompt, aspectRatio, `afterIndex`, alt → như `insert_image` | như `insert_image` | có | trên web ẩn hoặc lỗi ở bước tải ảnh, như trên |
| read_frontmatter | cả hai | — → YAML thô | — | không | |
| web_search | cả hai, web cần `webSearch` | query, maxResults → câu trả lời, link, trích | mặc định 6 | không | |

### 4.4 html

Skill: `composeSkills('html+search', '', [documentSkill, createSearchSkill(), createFilesSkill(…), intentSkill])`
(`html/ai/AiPanel.tsx:670-705`); `intentSkill` không có công cụ (`html/ai/intent.ts`). View-only giữ `get_outline`,
`read_source` (`html/ai/tools.ts:919`, `tools.ts:938`); `web_search`, `read_attachment` ở skill khác nên vẫn còn.
Trình soạn thảo là mã nguồn (CodeMirror) + preview iframe.

| tool | host | vào → ra | giới hạn trong code | ghi editor | ghi chú |
| --- | --- | --- | --- | --- | --- |
| get_outline | cả hai | `depth`, `from_sid` → dòng `L<a>-L<b> sid=N tag#id.class "preview"` | 80 dòng mặc định (`html/ai/tools.ts:18`), preview 60 | không | |
| read_source | cả hai | `start_line`/`end_line` hoặc `sid`, `page` → mã nguồn đánh số | 12 000 ký tự/trang (`html/ai/tools.ts:19`) | không | |
| apply_ops | cả hai | `ops[]`: `str_replace`, `replace_element`, `set_inner_html`, `set_text`, `insert_html`, `remove`, `move`, `set_attr`, `set_style` → khoảng đã áp | tối đa 40 op (`html/ai/tools.ts:286`); nguyên tử; từ chối `data:` URL bị cắt | có | HTML do AI viết **không được làm sạch** (`<script>`, `on*=`, `javascript:` qua được) |
| ask_clarification | cả hai | `questions[]` (≤ 4, mỗi câu ≤ 5 lựa chọn; `html/ai/tools.ts:334`) → câu trả lời của người dùng | — | không | chặn run tới khi người dùng trả lời, xem §7 |
| plan_page | cả hai | `mode` (`new`/`redesign`/`restyle`/`extract`), notes → thẻ brief, rồi trang | brief 40 000 ký tự (`html/ai/brief-writer.ts:11`) | có | `new`/`redesign` **thay toàn bộ tài liệu** |
| write_document | cả hai | title, plan, context → cả trang | 200 000 ký tự (`html/ai/page-writer.ts:11`) | có | thay toàn bộ tài liệu; chỉ chặn khi tài liệu không trống và đã bị sửa sau khi model đọc |
| web_search | cả hai, web cần `webSearch` | như markdown | — | không | |
| read_attachment | **desktop**; web luôn lỗi | index, offset → văn bản tệp đính kèm | 24 000/lần (`html/ai/files-skill.ts:12`), main 48 000 | không | web stub (`web/modules/html/webapi.ts:120`) |

### 4.5 sheets, slides, pdf

PENDING phần W3 (r-ssp), gộp vào khi lead báo xong.

## 5. Kiểm an toàn (spec §6.3)

Bốn kiểm: (a) chạy macro/VBA/DDE/script; (b) tải URL từ nội dung tài liệu hoặc từ công cụ; (c) ghi ra ngoài tài liệu đang
mở; (d) gọi API UniWork bằng quyền khác phiên người dùng. Kết luận: **đạt** / **vi phạm** (blocker → G6-12, §9) / **n/a**.

| module | kiểm | kết luận | bằng chứng và lý do |
| --- | --- | --- | --- |
| agent-core | (a)–(d) | n/a | Không công cụ; vòng lặp không tải URL, không ghi file, không gọi API (`packages/agent-core/src/loop.ts`, `skill.ts`). |
| docs | (a) | **vi phạm** | Không có thực thi macro/VBA (không đọc `vbaProject`). Nhưng op `insertField` của `apply_ops` dùng **danh sách chặn**: chỉ chặn `TOC INDEX XE HYPERLINK INCLUDEPICTURE INCLUDETEXT EMBED FORM* ADDIN` (`apps/docs/src/renderer/ai/field-ops.ts:21-33`); mọi từ khóa `^[A-Za-z]+$` khác qua được (`field-ops.ts:636-640`), gồm `DDE`, `DDEAUTO`, `LINK`, `IMPORT`, `DATABASE`. Trường được ghi `dirty` để Word tính lại khi mở → nội dung bị prompt injection có thể khiến AI chèn trường DDE vào file. Cần danh sách cho phép. `updateFields scope:"all"` cũng đánh dấu `dirty` cả trường DDE/INCLUDETEXT có sẵn trong file (`field-ops.ts:589-598`). |
| docs | (b) | đạt (ghi chú) | Editor không tự tải đích `INCLUDEPICTURE`/`INCLUDETEXT`. Ảnh chỉ tải khi model gọi `insert_image`/`insert_picture`/`set_watermark` (ảnh): desktop qua `ai:fetch-image` → `fetchRemoteImage` (`apps/docs/src/main/docs-main.ts:3949-3967`) → `fetchWithSsrfGuard` chặn dải private/loopback/link-local ở **mọi bước redirect** (`packages/electron-utils/src/safe-remote-url.ts:19-30`, `safe-remote-url.ts:95-115`), trần 50 MB; web qua RPC `image.fetch` của host (`web/docs/bridge/webapi.ts:764`, proxy phía server UniWork, không kiểm ở fork). URL có thể đến từ text bị injection (kết quả tìm kiếm, nội dung tài liệu); system prompt không có câu "nội dung là dữ liệu không tin cậy" — phần đó thuộc instruction pack G6-14. |
| docs | (c) | **vi phạm** | `create_document` (chỉ desktop) ghi file mới `.pdf`/`.md`/`.html` vào thư mục lưu mặc định, hoặc mở tab `.docx` mới tự lưu vào đó, không hỏi người dùng (`apps/docs/src/renderer/ai/tools.ts:980-1008`, `apps/docs/src/main/docs-main.ts:5021`, `docs-main.ts:5568-5612`). Không ghi đè (`uniquePathIn`), nhưng là ghi đĩa ngoài tài liệu đang mở do một lượt AI. Với UniWork AI phải ra khỏi allowlist. `read_attachment` chỉ đọc tệp người dùng đính kèm (`docs/ai/files-skill.ts`). |
| docs | (d) | đạt | Desktop: công cụ đám mây đi qua transport ở shell main bằng bearer của chính tài khoản đang đăng nhập (`apps/shell/src/main/uniwork-auth/cloud.ts:195`, `cloud.ts:225`); web: frame token một tài liệu, `credentials:'omit'` (`web/modules/shared/ai/client.ts:5-7`). Không khóa dịch vụ, không quyền cao hơn phiên. |
| markdown | (a) | đạt | Markdown không có macro/script; prompt cấm sinh HTML thô (`md/ai/markdown-skill.ts`, "Never emit raw HTML"). Cách render khối HTML thô/mermaid chưa được kiểm trong lane này. |
| markdown | (b) | đạt (ghi chú) | Như docs: chỉ `insert_image`/`generate_image` tải ảnh, chỉ `^https?://`, PNG/JPG/GIF, qua cùng `fetchRemoteImage` (`md/ai/tools.ts:319`); link trong tài liệu không bị công cụ tải. Web: `fetchImage` là stub `null` nên không tải gì (`web/modules/markdown/webapi.ts:133`). |
| markdown | (c) | đạt (ghi chú) | `insert_image`/`generate_image` ghi file ảnh vào thư mục assets **của chính tài liệu** (`apps/markdown/src/main/markdown-main.ts:913-920`; đường dẫn tài liệu lấy từ main, không từ renderer), giống khi người dùng dán ảnh (`apps/markdown/src/renderer/editor/localImage.ts:153`). Assets là một phần tài liệu Markdown (§6.5), nhưng file được ghi **ngay lúc gọi công cụ**, trước khi Lưu, và undo/rollback không xóa nó — xem §6. |
| markdown | (d) | đạt | Như docs. |
| html | (a) | đạt trên web; **vi phạm** trên desktop (chờ Product) | Script trong trang chạy trong preview iframe `sandbox="allow-scripts allow-forms allow-popups allow-modals"`, không `allow-same-origin` → không chạm được app (`apps/html/src/renderer/preview/PreviewFrame.tsx:178`). Web: `preview.html` có CSP riêng `connect-src 'none'`, `form-action 'none'` và iframe `credentialless` (`web/docs/build/modules.ts:121-127`). Desktop: giao thức `html-preview://` trả về không kèm CSP (`apps/html/src/main/preview-protocol.ts:45`) → script trong trang (kể cả script AI vừa viết qua `apply_ops`/`write_document`, vốn không được làm sạch) được dùng mạng, có thể gửi nội dung trang ra ngoài. Đây là hành vi có chủ ý của preview (trang dùng CDN), nhưng với lượt AI nó là đường rò; Product quyết: CSP cho preview desktop, làm sạch HTML do AI viết, hoặc chấp nhận có ghi lý do. |
| html | (b) | đạt (ghi chú) | Không công cụ AI nào của html tải URL (không có `insert_image`). `fetchImage` của main (`apps/html/src/main/html-main.ts:1651`) chỉ `^https?:` + `fetchRemoteImage`, dùng cho thao tác UI; web là stub `null` (`web/modules/html/webapi.ts:156`). Tài nguyên trang do preview tải là phần (a). |
| html | (c) | đạt | `apply_ops`/`plan_page`/`write_document` chỉ đổi bộ đệm editor (`apps/html/src/renderer/App.tsx:480-520`). Tham chiếu `attachment://` được thay bằng ảnh trong `assets/` của tài liệu hoặc `data:` (`html/ai/tools.ts:397`, `tools.ts:486`). |
| html | (d) | đạt | Như docs. |

Kiểm thêm theo spec §6.2: **công cụ đám mây** (`web_search`, `image_search`, `generate_image`, `analyze_media`) gửi query/prompt/ảnh
ra dịch vụ ngoài và tốn credit; chúng đi theo `office.ai_cloud` của tổ chức, không theo allowlist editor.

## 6. Hiển thị và hoàn tác thay đổi AI (spec §6.4)

| module | thay đổi hiện ra thế nào | hoàn tác | một bước undo mỗi lượt? | kết luận §6.5 |
| --- | --- | --- | --- | --- |
| docs | **Theo dõi thay đổi AI tắt mặc định**: bật chỉ khi `localStorage['ai-docs-track-changes'] === '1'` (`docs/ai/AiPanel.tsx:167`, `AiPanel.tsx:392-394`). Bật: `insert_content`, `write_document`, `replace_blocks`, `replace_selection`, `apply_ops` ghi revision tác giả AI, duyệt ở tab Review (`docs/ai/protocol.ts:1202-1357`, `docs/ai/ops.ts:1495-1509`). Tắt: highlight vàng bị chấp nhận ngay trong cùng tick, không còn dấu (`AiPanel.tsx:805-808`). Biểu đồ, ảnh nổi, text box, chú thích, comment, header/footer, page setup, style, watermark không bao giờ được theo dõi. Thẻ edit queue (`docs/ai/edit-queue.ts`, `EditQueueCard.tsx`) là hàng đợi **chỉ dẫn trước khi gửi** (≤ 10 mục, ≤ 500 ký tự; `edit-queue.ts:14-16`), không hiển thị kết quả. | Nút Roll back của mỗi run: snapshot `editor.getJSON()` trước công cụ `mutated` đầu tiên (`AiPanel.tsx:790`, `AiPanel.tsx:802-804`, `AiPanel.tsx:1208-1219`). Không trả lại style/page setup/header-footer/watermark (ngoài cây ProseMirror) và không có snapshot nếu run chỉ gọi công cụ khai báo `mutated:false`. | **Không bảo đảm.** Không có `closeHistory`/nhóm lịch sử trong `apps/docs/src/renderer/ai`; mỗi công cụ là một giao dịch, lịch sử ProseMirror chỉ gộp theo cửa sổ thời gian mặc định. Chỉ bản nháp `write_document` không vào lịch sử (`docs/ai/doc-writer.ts:180`). | **blocker** cho hàng DOCX sửa: mặc định không có dấu vùng sửa trước khi Lưu; undo không theo lượt; rollback không đủ. |
| markdown | Highlight các khoảng do giao dịch `OP_META.source === 'ai'` đổi (`apps/markdown/src/renderer/editor/aiHighlight.ts`); edit queue như docs (`md/ai/edit-queue.ts:15-17`). Không có mô tả thay đổi dạng diff. | Roll back theo run (snapshot thân + frontmatter, `md/ai/AiPanel.tsx:397`). File ảnh đã ghi vào assets không bị xóa. | **Không bảo đảm.** Mỗi op một giao dịch (`apps/markdown/src/renderer/editor/ops.ts:552-555`), không nhóm lịch sử; `apply_ops` không nguyên tử. | **blocker** một phần: có dấu vùng sửa; thiếu undo một bước mỗi lượt. |
| html | Highlight khoảng AI sửa trong editor mã nguồn (`apps/html/src/renderer/source/SourceEditor.tsx:129`, `SourceEditor.tsx:146`), bị xóa khi người dùng gõ; thẻ brief/clarify/partial trong panel; preview nháp khi stream trang. Không có diff, không hiện trên preview. | Roll back theo run (snapshot `{text}`); Ctrl+Z của CodeMirror (`apps/html/src/renderer/source/cm-setup.ts:83`). | **Không bảo đảm.** Sửa của AI chỉ mang annotation `External` (`SourceEditor.tsx:118`), vào lịch sử CodeMirror mỗi lần dispatch; nhiều lượt gọi công cụ = nhiều bước undo. `plan_page`/`write_document` thay cả tài liệu trong một bước. | **blocker** một phần: có dấu vùng sửa ở mã nguồn, không ở preview; thiếu undo một bước mỗi lượt. |
| agent-core | Cung cấp `snapshotBefore` cho rollback (`packages/agent-core/src/loop.ts:13-21`); không có khái niệm nhóm undo. | — | — | Chỗ hợp lý để G6-09 thêm móc "bắt đầu/kết thúc lượt" cho editor nhóm lịch sử. |

## 7. Công cụ hỏi lại người dùng

| module | có không | chi tiết |
| --- | --- | --- |
| agent-core | không | Vòng lặp không có công cụ hỏi lại; một skill tự thêm nếu cần. |
| docs | **không** | Không có `ask_clarification` hay tương đương; model hỏi bằng văn bản trả lời rồi kết thúc lượt. Chỉ có luật prompt cho luồng comment (`docs/ai/protocol.ts:133`). |
| markdown | **không** | Prompt bảo model hỏi giá trị còn thiếu bằng văn bản (`md/ai/markdown-skill.ts`). |
| html | **có**: `ask_clarification` | `html/ai/tools.ts:324` (định nghĩa), `tools.ts:772` (thực thi). Hiện thẻ 1–4 câu, mỗi câu ≤ 5 lựa chọn, thẻ tự thêm "để AI quyết" và ô "khác"; **chặn run** tới khi người dùng trả lời (`html/ai/AiPanel.tsx:682-684`); bỏ qua/dừng/chat mới trả `cancelled` (`AiPanel.tsx:808`, `AiPanel.tsx:993`). Dùng trước khi tạo trang mới; `intentSkill` tắt nó khi ý định là "viết nội dung". |

Chip "Cần làm rõ" của G6-14 cần một tín hiệu xác định: module không có công cụ hỏi lại thì kết quả "cần làm rõ" chỉ nhận ra
được từ văn bản — mục G6-12 ở §9.

## 8. Đối chiếu ma trận tác vụ (spec §6.5)

Mỗi ô: công cụ dùng được (tên ở cột `tool` §3), hoặc `missing: <thiếu gì>`. Hàng XLSX, PPTX, PDF lấy từ phần W3 (§4.5).

| hàng | đọc / phân tích | sửa trong editor (xem, hoàn tác, rồi Lưu) |
| --- | --- | --- |
| XLSX | PENDING phần W3 | PENDING phần W3 |
| DOCX | Hỏi/tóm tắt: `get_document_context` + `read_blocks` (phân trang). Trích có anchor: chỉ số block từ hai công cụ trên; `read_comments`, `read_notes` trả block neo và text neo; `read_revisions` cho tracked change. Ảnh trong tài liệu: `analyze_media` (cần model media). So sánh/giải thích: `read_revisions`, `read_attachment` cho tệp thứ hai; `missing: công cụ so sánh hai tài liệu` (model tự so trong context). | Viết lại/rút gọn/dịch đoạn chọn: `replace_selection` (trong một block), `replace_blocks` (nhiều block, kể cả bảng — giữ độ rộng, viền, ô không đổi), `apply_ops` (nguyên tử, `dryRun`). Giữ bảng và phần không sửa: công cụ chỉ đổi khoảng được chỉ, kế thừa định dạng. `missing: dấu vùng sửa mặc định trước khi Lưu` (theo dõi thay đổi tắt mặc định), `missing: undo một bước mỗi lượt`, `missing: rào code giới hạn sửa trong vùng chọn` (chỉ prompt), `missing: tôn trọng bảo vệ Word` (§4.2). |
| PPTX | PENDING phần W3 | PENDING phần W3 |
| PDF có text layer | PENDING phần W3 | PENDING phần W3 |
| Markdown | Hỏi/tóm tắt theo heading/source range: `get_document_context` (nhãn `h1`–`h6` trong khung), `read_blocks` (theo chỉ số block), `read_frontmatter`. `missing: tra theo tên heading hoặc theo khoảng ký tự nguồn` (chỉ có chỉ số block). | Sửa vùng chọn: `apply_ops` (vùng chọn báo trong context là "block N..M"), `write_document` với `afterIndex`. Giữ frontmatter: chỉ op `setFrontmatter` ghi nó. Giữ link/assets ngoài vùng: chỉ nhờ prompt. `missing: rào code giới hạn op trong vùng chọn`, `missing: apply_ops nguyên tử`, `missing: undo một bước mỗi lượt`. Ảnh: `insert_image`/`generate_image` chỉ desktop. |
| HTML | Hỏi/tóm tắt nội dung: `get_outline`, `read_source` (theo `sid` hoặc dòng), `read_attachment` (desktop). `missing: trích văn bản thuần` (model đọc mã nguồn HTML). | Sửa text/DOM target: `apply_ops` (`set_text`, `set_attr`, `set_style`, `replace_element`, `insert_html`, `remove`, `move`, `str_replace`; nguyên tử, ≤ 40 op), mặc định nhắm phần tử đang chọn. `missing: làm sạch HTML do AI viết` (script, `on*=`, `javascript:`), `missing: CSP preview desktop` (§5 html (a)), `missing: undo một bước mỗi lượt`. `plan_page`/`write_document` thay cả trang — không nằm trong hàng "sửa target", nên ra khỏi allowlist khi lượt chỉ là sửa. |

Hàng XLSX còn các điểm con của spec §6.5 (nhãn cột X/Y/Z vs địa chỉ cột, sheet id/range resolved, kiểu/locale/10 vs 10 %,
dòng ẩn/lọc, hàng tổng, recalc vs cache, số dòng xử lý/coverage, target range + số ô bị ghi đè trước khi Lưu) — điền từ phần
W3.

## 9. Công cụ còn thiếu → G6-12

Mỗi dòng: module — cần gì — vì sao — hàng ma trận / kiểm an toàn.

1. docs — `insertField` theo **danh sách cho phép** (bỏ `DDE`, `DDEAUTO`, `LINK`, `IMPORT`, `DATABASE`…), và `updateFields` không
   đánh dấu `dirty` trường DDE/INCLUDE có sẵn — chèn DDE qua prompt injection — §5 docs (a).
2. docs — `create_document` ra khỏi tập công cụ khi nhà cung cấp là UniWork AI (hoặc hỏi người dùng trước khi ghi) — ghi file
   ngoài tài liệu đang mở — §5 docs (c).
3. docs — dấu vùng sửa AI bật mặc định trong lượt UniWork AI (theo dõi thay đổi hoặc highlight còn tới khi Lưu) — thay đổi phải
   thấy được trước khi Lưu — DOCX sửa, spec §6.4.
4. docs, markdown, html — một bước undo mỗi lượt AI (nhóm lịch sử ProseMirror/CodeMirror theo run) — G6-09 — DOCX, Markdown,
   HTML sửa.
5. docs — khai báo `mutated:true` cho `resolve_comment`, `set_header_footer`, `define_style`, `set_page_setup`, `set_watermark`,
   và rollback trả lại style/page setup/header-footer/watermark — rollback và cột cơ học `editor_write` đúng sự thật — DOCX sửa.
6. docs — truyền bảo vệ Word (chỉ đọc/form/comment/khóa ghi) vào `isReadOnly` của skill — AI không được sửa thứ người dùng không
   sửa được — DOCX sửa.
7. docs, markdown — công cụ hỏi lại người dùng (như `ask_clarification` của html) — chip "Cần làm rõ" xác định được (G6-14) —
   mọi hàng.
8. markdown — `apply_ops` nguyên tử như docs/html — một lượt hỏng không để lại nửa thay đổi — Markdown sửa.
9. markdown, html — rào code giới hạn sửa trong vùng chọn/target khi lượt là "sửa vùng chọn" — giữ phần ngoài vùng — Markdown,
   HTML sửa.
10. html — làm sạch HTML do AI viết hoặc CSP cho preview desktop — script AI viết có mạng trên desktop — §5 html (a); cần quyết
    định Product.
11. markdown, html — `insert_image` (markdown) và `read_attachment` (html) trên web — hiện là stub luôn lỗi; hoặc ẩn khỏi tập công
    cụ web để model không gọi công cụ chắc chắn hỏng — Markdown/HTML, host web.
12. markdown — ảnh do AI chèn chỉ ghi vào assets khi Lưu (hoặc dọn khi rollback) — một lượt AI không ghi gì ra đĩa trước Lưu —
    spec §6.4, §5 markdown (c).
13. docs — sửa mô tả `define_style` (nhắc `apply_style` không tồn tại) — model gọi công cụ không có — DOCX sửa.
14. docs — công cụ so sánh hai tài liệu (tùy Product; model hiện so trong context) — DOCX đọc "so sánh và giải thích".

Dòng của sheets, slides, pdf: PENDING phần W3.

## 10. Ký duyệt cột tay (AC-4)

Cột tay (§2, §4–§9) chờ owner F + Product ký qua Advisor; chữ ký đóng gate G6-D4. Cột cơ học (§3) không cần ký: nó
được kiểm bằng lệnh AC-2 ở §1.
