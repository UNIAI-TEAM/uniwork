# UniWork Office — Bảng công cụ agent genoffice (G6-01, làm mới sau G6-12)

> **Trạng thái:** in-progress — cột cơ học (khối trích xuất tại `cb76dde5`, pin web `0.1.0-cb76dde`; sinh bằng extractor đã sửa ở F
> `f5b75e1f` cho tới khi fork main có bản sửa; bản G6-12 ở `66169a9a` chỉ khác dòng `rev=` và ô markdown `ask_clarification`) và
> cột tay đủ bảy module; hàng đã sửa ở G6-12 ghi commit + test ở §9; hàng chưa sửa ghi chủ mới hoặc "chờ Product (đợt 3)". Chờ
> owner F + Product ký cột tay (§10).

## 1. Nguồn, cách tái tạo và kiểm tra

- **Fork tại SHA:** `66169a9a` (`66169a9ae1d3d7497d6585efbf5c7be9d94aa96c`, đầu nhánh tích hợp
  `feature/UNI-1366-g6-12-tools` của fork, đã đẩy). Đó là fork `main` `673fc563` cộng toàn bộ nhánh module G6-12 (UNI-1366).
  Bản tài liệu trước (G6-01) đọc ở `0d03b185` = pin web `0.1.0-0d03b18`
  ([office-web-modules](../office-web-modules.md)); các hàng đã sửa ở G6-12 đọc ở `66169a9a` — riêng khối §3 nay đọc ở
  `cb76dde5` (gạch đầu dòng dưới).
- **Khối §3 ở G7-06 (UNI-1378):** khối trích xuất nay đọc ở `cb76dde5` (`cb76dde5928f8ea9cf66af938d3f83bd1278f78c` — fork `main`
  sau G6-12, pin web `0.1.0-cb76dde`), sinh bằng extractor **đã sửa** ở F `f5b75e1f`
  (`f5b75e1f4f773a8a22d12574a0e33c7e45d55127`, nhánh `feature/UNI-1378-g7-06-extractor`, blob
  `94babf94780facd66e88cb622cc5f2c8e7841e70`) vì fork `main` chưa có bản sửa. So với khối ở `66169a9a`, chỉ khác dòng `rev=` và ô
  markdown `ask_clarification` `yes` → `no` (§3.1 nhóm C đã đóng). Số dòng `path:line` ở §2 và §4–§8 vẫn đọc ở `66169a9a` trừ
  chỗ ghi khác (không đọc lại ở `cb76dde5`).
- **Số dòng `path:line` trong §2 và §4–§8.** Giữ nguyên số dòng đọc ở `0d03b185` cho mọi hàng G6-12 không chạm: giữa
  `0d03b185` và `e6862e53` không file nào dưới `apps/*/src/renderer`, `apps/*/src/main`, `packages/agent-core`,
  `packages/ai-provider`, `packages/electron-utils`, `web/modules` hay `web/docs/bridge` đổi ngoài các shard i18n (kiểm bằng
  `git diff --name-only`). Từ `e6862e53` tới `66169a9a` có hai nguồn đổi số dòng: file G6-12 sửa (danh sách ở §9), và các commit fork `main`
  vào nhánh tích hợp (tín hiệu `aiRun` của X-02: `web/docs/bridge/module-bridge.ts`, `web/modules/shared/ai/web-ai.ts`,
  `web/docs/protocol/*`, `apps/shell/src/main/*`, `apps/*/src/preload/index.ts`, `packages/electron-utils/src/ai-run*.ts`). Số
  dòng cũ ở các file đó có thể lệch (cấu trúc và kết luận ở §2 và §4.5 không đổi vì G6-12 không chạm đường transport hay cloud
  tool); chỗ nào đã đọc lại ở `66169a9a` thì ghi rõ "(66169a9a)". Trong mọi hàng và đoạn G6-12 chạm, con trỏ ở file có đổi giữa
  hai pin luôn mang dấu: "(66169a9a)" = số dòng đã đọc lại ở `66169a9a`; "(0d03b185)" = mô tả hành vi trước G6-12, số dòng đọc ở
  `0d03b185` (chỗ đó đã đổi hoặc biến mất ở `66169a9a`). Con trỏ không dấu ở file không đổi giữa hai pin đúng ở cả hai. Khóa so
  khớp luôn là tên công cụ và tên ký hiệu, không phải số dòng.
- **Nguồn duy nhất của tên công cụ cho G6-14:** instruction pack `office_uniwork_ai@N` chỉ được nhắc tên công cụ có
  trong cột `tool` của khối trích xuất (§3). Cột tay (§4–§9) là nhận định của người viết, không là nguồn tên.
- **Tái tạo cột cơ học** (trong worktree fork ở nhánh `feature/UNI-1378-g7-06-extractor` — script đã sửa — không checkout,
  không chạy code sản phẩm):

  ```bash
  node scripts/genoffice-tools-extract.mjs --rev cb76dde5 > /tmp/genoffice-tools.md
  ```

- **Kiểm AC-2** (khối giữa hai marker = đầu ra script, từng byte), chạy ở gốc repo D với `FORK` trỏ tới worktree fork và
  `EXTRACTOR` trỏ tới script đã sửa ở F `f5b75e1f` (khi fork `main` chưa có bản sửa):

  ```bash
  node "$EXTRACTOR" --repo "$FORK" --rev cb76dde5 > /tmp/extract.md
  sed -e '1,/^<!-- extract:begin -->$/d' -e '/^<!-- extract:end -->$/,$d' \
    docs/office/g5g6g7/genoffice-tools.md | diff - /tmp/extract.md && echo AC-2 OK
  ```

  Đã chạy ngày 2026-10-12 (G7-06) với script F `f5b75e1f` ở `--rev cb76dde5`: `AC-2 OK`, `diff` thoát 0; sha256 của đầu ra
  script (cũng là của khối giữa hai marker) `d0ef92a89cf178086768295c885448087af0ba05463748197fc9785428982fac`, 141 dòng
  công cụ, 0 ô `unresolved`, 0 ô `undeclared`. Cùng script ở `--rev 66169a9a` chỉ khác khối cũ `3acc970f…` ở ô markdown
  `ask_clarification` (`yes` → `no`; dòng `rev=` theo rev), và ở `--rev 0d03b185` in đúng bản G6-01 `0df68253…` như script cũ
  của `66169a9a`.
- **Ghim lịch sử.** Script của `66169a9a` chạy ở `--rev 0d03b185` vẫn in đúng bản G6-01 từng giao: sha256 `0df68253…`
  (`0df682539473c28ffb1f978a81e62828c0d81a6116dc1c4bdf1d55703931e1c9`; chạy lại ở `66169a9a` trong WDoc và khớp dòng
  `G6_01_PIN_0D03_IDENTICAL` của vòng cloud `cloud-test-extractor-2`). Ở `--rev e6862e53` (nền của G6-12) đầu ra là
  `34877e54…` như vòng đó ghi. Nghĩa là script G6-12 đổi không làm lệch bảng cũ; mọi khác biệt giữa khối cũ và khối mới (§3.1) đến từ
  code công cụ đổi ở G6-12, không từ script.
- Đồng bộ upstream hoặc đổi pin: G7-06 chạy lại script tại SHA mới; cột cơ học lệch → cập nhật khối §3 và mở một hàng
  review tay cho owner F + Product (§10).

## 2. Từ vựng chốt theo code

Mọi đường dẫn tính từ gốc fork; số dòng đọc ở `0d03b185` trừ chỗ ghi khác (xem §1).

| Thuật ngữ | Nghĩa theo code | Bằng chứng |
| --- | --- | --- |
| **Công cụ** (tool) | Một `AgentToolDef` `{name, description, inputSchema}` mà model thấy trong `tools` của request; chạy trong renderer qua `executeTool`, trả `ToolExecution` (`output`, `isError`, `mutated`, `summary`) | `packages/agent-core/src/types.ts:2-6`, `types.ts:61-75` |
| **`AgentSkill`** ("skill" trong vòng agent) | Một miền năng lực của panel: đoạn system prompt + danh sách công cụ + `buildContext()` mỗi lượt + `executeTool` + `verifyResponse` tùy chọn. `composeSkills` gộp nhiều skill, tên công cụ phải duy nhất (trùng → ném lỗi); `tools`/`systemPrompt` là getter sống nên skill con ẩn/hiện công cụ theo capability ngay trước mỗi request | `packages/agent-core/src/skill.ts:15-40`, `skill.ts:46-87` |
| **Vòng agent** (`AgentLoop`) | Gọi model, chạy tool call, gửi tool result, lặp. Trần: `DEFAULT_MAX_TURNS` = 100 lượt model mỗi run (không app nào hạ trần), 3 lượt giống hệt liên tiếp, 8 lượt toàn lỗi, 3 lần input không dùng được; nén lịch sử ở 256 KB, giữ 96 KB gần nhất; mỗi lượt tối đa 2 MiB text/reasoning stream. Chụp snapshot trước công cụ `mutated` đầu tiên của run (`snapshotBefore`, móc cho nút Roll back) | `packages/agent-core/src/loop.ts:55-71`, `loop.ts:73-92`, `loop.ts:325-326` |
| **Transport** | `AgentTransport.stream(request, callbacks)`; agent-core chỉ có một bản: `createIpcTransport` phía renderer. Desktop: preload → IPC `ai:stream` → process main gọi `streamForProvider` của `@genoffice/ai-provider` (ví dụ `apps/docs/src/main/docs-main.ts:3821`). Web: cùng `createIpcTransport`, nhưng `withWebAi` thay `aiStream` bằng bản web: giao thức của ai-provider chạy trong frame, URL nhà cung cấp bị viết lại về `<ai mount>/byok/<provider>/…` kèm frame token; URL ngoài mount bị từ chối | `packages/agent-core/src/electron-transport.ts:28-38`, `web/modules/shared/ai/stream.ts:1-33`, `web/modules/shared/ai/transport.ts:1-27`, `web/docs/bridge/module-bridge.ts:165` |
| **MCP** | Server MCP **cục bộ** của app cho agent bên ngoài (Claude Code, Codex…): `McpServerService`, HTTP `/mcp` + SSE cũ, bind `127.0.0.1:3093`, không token (chỉ kiểm Host/Origin), **tắt mặc định** (`mcpEnabled === true` mới bật). Công cụ MCP (`create_docx`, `read_docx`, `apply_ops`, `read_sheet`, `apply_sheet_ops`, `read_deck`, `apply_slide_ops`, `read_pdf`, `open_documents`…) điều khiển editor đang mở qua bridge main→renderer, dùng lại executor của panel — chiều MCP → editor, không phải chiều ngược lại | `apps/shell/src/main/mcp/mcp-server.ts:13-14`, `mcp-server.ts:49`, `mcp-server.ts:93`, `apps/shell/src/main/index.ts:579`, `apps/docs/src/renderer/mcp-bridge.ts:1-15` |
| **Agent skills** (`@genoffice/cli/agent-skills`) | Bộ cài `skills/genoffice/SKILL.md` vào thư mục skills của agent bên ngoài (Claude Code `~/.claude/skills`, Codex, Cursor, Gemini CLI, Copilot, OpenCode, Windsurf), chỉ khi người dùng bấm ở Settings → Integrations hoặc gõ `genoffice skill`. Là prompt cho agent ngoài, không phải `AgentSkill` | `packages/cli/src/agent-skills.ts:17-118`, `skills/genoffice/SKILL.md:1-12` |
| **CLI** (`genoffice`) | Có server MCP riêng (stdio, hoặc HTTP loopback) cho agent ngoài. Chỗ duy nhất app spawn CLI là công cụ MCP headless | `packages/cli/src/mcp/http.ts:48-52`, `apps/shell/src/main/mcp/cli-runner.ts:92` |
| **`UNIWORK_CLOUD_TOOLS`** | Năm công cụ đám mây tốn credit của UniWork: `web_search`, `image_search`, `image_generate`, `media_analyze`, `transcribe`. Desktop: transport đặt ở shell main, gọi `/api/v1/orgs/{orgID}/ai/cloud*` bằng bearer của chính tài khoản UniWork đang đăng nhập (renderer không thấy token). Web: `/v1/office-frame/documents/{id}/ai/cloud*` bằng frame token (một tài liệu, `credentials:'omit'`). Entitlement `office.ai_cloud` và credit do server UniWork chặn. Đây là backend của các công cụ agent `web_search`, `image_search`, `generate_image`, `analyze_media`; tên trong mảng này **không** phải tên công cụ agent (`image_generate` ≠ `generate_image`) | `packages/ai-provider/src/uniwork-cloud.ts:20-26`, `apps/shell/src/main/uniwork-auth/cloud.ts:19-22`, `cloud.ts:195`, `cloud.ts:225`, `web/modules/shared/ai/client.ts:5-24` |

**Vòng agent trong app có gọi được CLI hoặc MCP không? Không qua công cụ nào — cả desktop lẫn web; riêng desktop, nhà cung
cấp model Codex là một tiến trình CLI (xem gạch đầu dòng cuối).**

- Công cụ chạy trong renderer qua `executeTool` của các skill mà từng `AiPanel` gộp; ra khỏi renderer chỉ qua các kênh IPC cố
  định `ai:stream`, `ai:web-search`, `ai:image-search`, `ai:generate-image`, `ai:analyze-media`, `ai:fetch-image`
  (ví dụ `apps/docs/src/main/docs-main.ts:3899-3967`). Không file nào trong `apps/*/src/renderer`, `packages/agent-core`
  hay `web/modules` dùng MCP client hoặc spawn CLI.
- Ngoại lệ duy nhất có chữ "MCP": `packages/ai-search/src/parallel-mcp.ts:1-30` là một MCP client tới
  `https://search.parallel.ai/mcp`, dùng làm backend dự phòng không khóa **bên trong** công cụ `web_search` trên desktop. Model
  không thấy nó như một công cụ; nó không mở thêm năng lực nào ngoài `web_search`.
- Web không có Node, không có code MCP trong module hay bridge.
- Desktop, nhà cung cấp `codex`: `ai:stream` → `streamForProvider` chạy **Codex CLI** làm backend model, `spawn(cliPath,
  codexAppServerLaunchArgs())` (`packages/ai-provider/src/codex-app-server.ts:379`). Công cụ/MCP riêng của Codex bị chặn bằng
  instruction ("Never … run shell commands, browse, call MCP", `codex-app-server.ts:70`, `codex-app-server.ts:693`) và bằng
  `approvalPolicy: 'never'` + profile quyền hoặc sandbox `read-only` dự phòng (`codex-app-server.ts:803-855`) — tức là chặn bằng
  cấu hình, không phải vì không có. Web loại `codex` và `genspark` (`web/modules/shared/ai/web-ai.ts:71-73`). Đường này nằm
  ngoài phạm vi nhà cung cấp UniWork AI: allowlist G6-12 khóa theo nhà cung cấp (§9 dòng 35), nên lượt UniWork AI không đi
  qua Codex CLI.
- Hệ quả cho spec §6.2 "MCP và skills tắt": với nhà cung cấp UniWork AI, MCP và agent skills **không bao giờ** nằm trong lượt
  chạy. Allowlist chỉ cần lọc trên tên công cụ của `AgentSkill` (cột `tool` ở §3); công cụ đám mây trong allowlist chỉ khi tổ
  chức có `office.ai_cloud`.

## 3. Cột cơ học (sinh bằng script, không sửa tay)

<!-- extract:begin -->
<!-- genoffice-tools-extract v1 rev=bf4ff7b07ee799b13375e0b63ad4798ff255ae05 -->
| module | tool | input_schema_sha256 | editor_write | source |
| --- | --- | --- | --- | --- |
| docs | accept_changes | 9af09d4b7b735877e734a81a8d86f6dbd6fe1ba184cd649a13dec3fe2e196fe0 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | add_comment | 2c02b65e695409a1779ba442dfe9c681ef389a3f4e5ad33e47ead67291b7777f | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | analyze_media | 4be9eff4d929769f31dfd25837b4f07af62ea6084cc720a88573d595b8711974 | no | apps/docs/src/renderer/ai/tools.ts |
| docs | apply_ops | acc60f5acf92201819c6ff3f7887e6216bb4f8cf54ca4487ea7d7d0fd8c5f613 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | ask_clarification | 7b1327afd202f0d0d47debc5f922fdcbe4541bad90d6f97efe31db002b3373f7 | no | apps/docs/src/renderer/ai/tools.ts |
| docs | create_document | 8c956443bbd56633e88e3fc40d47cea47048995ccbf4813023736f14dfbb54cf | no | apps/docs/src/renderer/ai/tools.ts |
| docs | define_style | 18fc6a4f754c0dc3282428b868dba32ea0945ee246839cdcac475fc7b35c6957 | yes | apps/docs/src/renderer/ai/style-ops.ts |
| docs | delete_comment | ca077b8285b224249d6df8bf86f4baf458bacca9e50cfa8434c5d5d0f9fdda53 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | delete_note | 83ab8c2ba74a615ceb5d0e472c28c4d5adcdc8f2eb7cdb4d064c33b385ce8c3d | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | edit_chart | c29264bd21515db11818de1199fe3af4e8d87a1aaab711fe9ef1f176fe635a45 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | edit_note | f465830acda36342513258eff25bc94a37c3cfc7868505a0fefcceabb4bfb055 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | generate_image | f6852b9e5272085ee5e6509a3c6a37dcd28da7f5349151248118e9e4f38c1cde | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | generate_mindmap | unresolved:identifier:depth | no | apps/docs/src/renderer/ai/mind-map.ts |
| docs | get_document_context | c8a1ac469a826ea3547ac220c7bbfdcd6b58080d4ec596ff2a0149c5ccb9b699 | no | apps/docs/src/renderer/ai/tools.ts |
| docs | image_search | 874a0d101865e7910d3ba9145ce2d9a29776932ce1a689060beb89d8d04fb699 | no | apps/docs/src/renderer/ai/tools.ts |
| docs | insert_chart | 12fab920f1474bfb8d1ed16c4cc02856f27d322275d274149df02cf2e4b521a4 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | insert_content | 40b05e9c8e06cd3281e3d9f1bdea9b08ccf7a5b7da24bfe2922390dfa79dae4e | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | insert_endnote | c838739e51d952f781dd0b70020c6255ff6bb377131d3059691aadbf08ea44b4 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | insert_footnote | c838739e51d952f781dd0b70020c6255ff6bb377131d3059691aadbf08ea44b4 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | insert_image | 41599e38e0e679b0b256dff03373f7bb0a48bf029f7d5dc3c5af2feb83cb5d9f | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | insert_picture | 59731827ce79f01ecb317d188714938ba88f79f85098e9bd7f7339796a42255e | yes | apps/docs/src/renderer/ai/floating-ops.ts |
| docs | insert_section_break | 522265b893a991ceef091847c50a816cb64d84ed5be77ca2507241201489d67f | yes | apps/docs/src/renderer/ai/page-setup.ts |
| docs | insert_text_box | 482ff3f6aa88c8cd184095e0c9dc6f5aa874b9eda71e8870e7ec7baa711fce7a | yes | apps/docs/src/renderer/ai/floating-ops.ts |
| docs | list_styles | c8a1ac469a826ea3547ac220c7bbfdcd6b58080d4ec596ff2a0149c5ccb9b699 | no | apps/docs/src/renderer/ai/style-ops.ts |
| docs | read_attachment | 8a54dbeec0b943d31f55257b1442d0dbb1b1a1a7138eb41bd6c44677efc8350f | no | apps/docs/src/renderer/ai/files-skill.ts |
| docs | read_blocks | 488117c5d732c8fe02bd16a962ce6c24ff4fefc34a5f006ed3506a46d98df062 | no | apps/docs/src/renderer/ai/tools.ts |
| docs | read_comments | c8a1ac469a826ea3547ac220c7bbfdcd6b58080d4ec596ff2a0149c5ccb9b699 | no | apps/docs/src/renderer/ai/tools.ts |
| docs | read_notes | c8a1ac469a826ea3547ac220c7bbfdcd6b58080d4ec596ff2a0149c5ccb9b699 | no | apps/docs/src/renderer/ai/tools.ts |
| docs | read_revisions | c8a1ac469a826ea3547ac220c7bbfdcd6b58080d4ec596ff2a0149c5ccb9b699 | no | apps/docs/src/renderer/ai/tools.ts |
| docs | reject_changes | 9af09d4b7b735877e734a81a8d86f6dbd6fe1ba184cd649a13dec3fe2e196fe0 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | replace_blocks | 1ce77037ff2c09be75505ff7ae12aa56fb96b8a2e2376c726e5e12d3477a1350 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | replace_selection | dc0dcc82ae6d1ab941913cbe80f777df4b81c41a6c2cfbbe2e5c9d5329bed161 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | reply_comment | db11ba65a17724a2e361a1c95d01c0e155440ba1d6f9bda8b298696f5144adf1 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | resolve_comment | ebe1eaf288ea69a42e0f9ec3fb0a59e79c86d99c6d940fef6733927577da3750 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | set_header_footer | e697d4aab47ae2eda0e96e816204f069edfd5e5fa77b31b614e77ac5e1ca4f6e | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | set_page_setup | cdc7c96a266910c5bf472893f8a3bd3b1e4a3bd84ad546d5c1cf355d8a83b996 | yes | apps/docs/src/renderer/ai/page-setup.ts |
| docs | set_watermark | 7472f1d51802ae0fa36252afb5ec408d9ed7524430337bea08f6ddf94c810256 | yes | apps/docs/src/renderer/ai/floating-ops.ts |
| docs | web_search | 768c0c31293d6717b7345cc108d9bcd69dbbb7e4a695ee3059600e674670cbf4 | no | apps/docs/src/renderer/ai/tools.ts |
| docs | write_document | 72dac356ba2c80721cc2937fff59bece13ddefa491ea862ec4028b832c7ae247 | yes | apps/docs/src/renderer/ai/tools.ts |
| html | apply_ops | 7ceda385ebf30d139a07335e082b922514da756a956ecebe3a80a1692663fbd2 | yes | apps/html/src/renderer/ai/tools.ts |
| html | ask_clarification | 7b1327afd202f0d0d47debc5f922fdcbe4541bad90d6f97efe31db002b3373f7 | no | apps/html/src/renderer/ai/tools.ts |
| html | get_outline | e141e58bb530c31af684002a9588e3bc2a673f1b0816a35f90d7fb7cdf60c985 | no | apps/html/src/renderer/ai/tools.ts |
| html | plan_page | 58fc7bd38c9ce9fe63b3444bd1cb899291b359a85e53f295806b18549de8455f | yes | apps/html/src/renderer/ai/tools.ts |
| html | read_attachment | 8a54dbeec0b943d31f55257b1442d0dbb1b1a1a7138eb41bd6c44677efc8350f | no | apps/html/src/renderer/ai/files-skill.ts |
| html | read_source | 9ed4ae6a05bf9137df0a71a4266f5337a3867e208125c67c64a72c7aae2b179d | no | apps/html/src/renderer/ai/tools.ts |
| html | web_search | 0190a7f984b61a677dd6b5e3bbe3f4b0bacbde61149c05035f4b3da9b05154ba | no | apps/html/src/renderer/ai/search-skill.ts |
| html | write_document | f84f720da1d30d480c519e8dbb46ca81bb3b3d69b12332634bd5b3187c63f313 | yes | apps/html/src/renderer/ai/tools.ts |
| markdown | apply_ops | e796ff6fcf174827819356e0312f2246fd573b42cb7bbb1f0b7052407c1334c3 | yes | apps/markdown/src/renderer/ai/tools.ts |
| markdown | ask_clarification | 7b1327afd202f0d0d47debc5f922fdcbe4541bad90d6f97efe31db002b3373f7 | no | apps/markdown/src/renderer/ai/tools.ts |
| markdown | generate_image | ed7b16fa3ca50a85c50bc04b296613c9b84014231d5c3ea987819284f5561c25 | yes | apps/markdown/src/renderer/ai/tools.ts |
| markdown | generate_mindmap | unresolved:identifier:depth | no | apps/markdown/src/renderer/ai/mind-map.ts |
| markdown | get_document_context | c8a1ac469a826ea3547ac220c7bbfdcd6b58080d4ec596ff2a0149c5ccb9b699 | no | apps/markdown/src/renderer/ai/tools.ts |
| markdown | image_search | 9c4b23b1cd0fe8dae086fe7c3c86dbceb1130a0c36d8ea7f93bbbe8bcfc9de2a | no | apps/markdown/src/renderer/ai/tools.ts |
| markdown | insert_image | f53e4d066d933c53c73e9025eb6871cbad02f6693f678290fd1f51748b55f726 | yes | apps/markdown/src/renderer/ai/tools.ts |
| markdown | read_blocks | 43906c937a64ff557e497bbc2db305e16176dec8cf19cd6a2d0fc95fb6b78570 | no | apps/markdown/src/renderer/ai/tools.ts |
| markdown | read_frontmatter | c8a1ac469a826ea3547ac220c7bbfdcd6b58080d4ec596ff2a0149c5ccb9b699 | no | apps/markdown/src/renderer/ai/tools.ts |
| markdown | web_search | 0190a7f984b61a677dd6b5e3bbe3f4b0bacbde61149c05035f4b3da9b05154ba | no | apps/markdown/src/renderer/ai/search-skill.ts |
| markdown | write_document | 42efa66d7b2df6b81fac2f67ff52ba129bffb85cc9f7b510e63a0e26f51efea3 | yes | apps/markdown/src/renderer/ai/tools.ts |
| pdf | add_form_mark | 39c0a9f18cb88678ae33f619a18e2c1999248fa93e659ca03afaa5ecf4b67939 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | add_note | b78909ab881af2b68b8cf305f2fb95aa12970f67e1677ee15dc3b0cb30b28311 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | apply_ops | dc6f7d04bad7922a5d59525553fa7e91122fe16f6d73c909dd4509ee8d495ef2 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | ask_clarification | 7b1327afd202f0d0d47debc5f922fdcbe4541bad90d6f97efe31db002b3373f7 | no | apps/pdf/src/renderer/ai/tools.ts |
| pdf | create_document | fe097c873ed74f6402ef15297ef0997bb56954d08b4def2130b0c6b9232f7c3b | no | apps/pdf/src/renderer/ai/tools.ts |
| pdf | crop_image | c1683f732be87c3f9e50ceb3210ad11e56b913eaa4752a4de99b18687efeea4d | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | crop_pages | 96866da2a702d164f399f1fca3391f63593220bbf53ee92688144905cee0044f | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | delete_image | aa9d7de1d597d6b21ba83a2a9bd9a451ccf8eecf3acefca64284ccee4dcc24a4 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | delete_inserted_text | 4d55d4f349564d7ee4d7f488c5b8b6a5e88fc513b82801f307f2644c9918ff27 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | delete_markup | 65dde718fc4c40634bdbbb0bb7c799b76139c8bd5b57f0671a8b3e46240172b7 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | delete_note | 4e4f6cfea22486f5a0a47782cc9d42033c3dfe7e369c318cd62a1997d531638a | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | edit_block | 93267a67fa162f956614318f8238f3059d014c3b2a8ebdb704e50d885435a15f | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | edit_inserted_text | 28587e819fdb98bd3c9a7c837ad9cfc512ce03c360a137c7dccd097090a9883f | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | edit_note | 08eb258ca30c06765420a5a498a6daeef7337731da9bd8655ec350151328d025 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | edit_text | 52f9b809c4439421eabd53215b12359ff1611d3974d0f75b96b0192cf39c0072 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | extract_pages | 94304d5992c42e07d10e14a81e756808b62a2709e686dbf993d44253aaba72a8 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | flip_image | 58fab356a9986907251da94a202d6947551d844cbea291eb00fab15bbf5927d6 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | generate_image | 6adfeeb2b65038a13a35b6e2089714b958bec217b151984033d7fb690a3c0cc0 | no | apps/pdf/src/renderer/ai/tools.ts |
| pdf | get_outline | efddc7bd8bbcef73a14eb1ace1ffdaec81e518ef1e13c1e9271d0b8acb694a49 | no | apps/pdf/src/renderer/ai/tools.ts |
| pdf | goto_page | d08e1e0482ccb65079ce141caa0264743a830e0b3d9b679e5c3319e27812c3c1 | no | apps/pdf/src/renderer/ai/tools.ts |
| pdf | image_search | 24d2fbeee56a509e5141ae68ca3fc2b260ced684cd18a6fb4ad4bbf1315fc63f | no | apps/pdf/src/renderer/ai/tools.ts |
| pdf | insert_blank_page | 94133c62264fed14dc19946811b4546b492d0e57bc36ed17b6bd5040e22b3257 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | insert_image | 5fc2af181dd9794b2a5dcedb906f98013f0a9dd27c70f13f6c31aeeb05d84df9 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | insert_text | 44902101a798fde1e08d05a275981828143647384b61d02f9a755d0fe783f0eb | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | list_form_fields | efddc7bd8bbcef73a14eb1ace1ffdaec81e518ef1e13c1e9271d0b8acb694a49 | no | apps/pdf/src/renderer/ai/tools.ts |
| pdf | list_inserted_text | 7ae9c14dd2b9684a3a39a454a872d8ad9cd7f9974a4df090df533e55af8b6905 | no | apps/pdf/src/renderer/ai/tools.ts |
| pdf | list_page_images | 52a8289c184b879b1e0c79242971986bd567db2c57692c24a46a3c11d8e3871a | no | apps/pdf/src/renderer/ai/tools.ts |
| pdf | markup_text | 151b7c2f778dc88011252ad826b3e33d166741195e35c954e15c4dd2f544608a | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | merge_pages | f986e106682a79ad266071249c5c7d3a1393b8079c75c090c5fea5e003d16415 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | move_inserted_text | a6fb60a0ed52995372e587bbe8fa674d6470e777779b89306f0d5aa06897673d | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | move_text_block | 5b49a73e30dd1f6725d5d1e6696facd424921284875f9f83d0832c0ce2698511 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | read_annotations | 966d8d2399298271eff60af7f8847c3fa88d3791a48bd4f540c5cdf79dd97bc4 | no | apps/pdf/src/renderer/ai/tools.ts |
| pdf | read_pages | 744c3b4d39150dbfbfe2b64657a971db07c917f3c4263c1bcd12af7b948a546c | no | apps/pdf/src/renderer/ai/tools.ts |
| pdf | remove_image_background | 348310d3b49604866cc33ec673115d2fe4c05f33a5a13cce6e93b1492c712da0 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | replace_image | b2c47ae3002c77bb60f173309d1338f90e52cfcaa3ae3f3b95e0cebcc1772d69 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | replace_pages | 24f600e63e5263bcdc4b081a0ceade56000c8be81a576e3e8abe981313db9a2b | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | reply_note | 971b93a1e884302c404a6af72fee61abe32132e98804ee0d54794685a3528769 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | rotate_image | 205c4ecbaf064b2506124f44e0d33a88183d13450921afa7b7750c05f2477a75 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | search_text | 0a232c4fd65e5b7f093b984c0d1ce6e820bed49190ed5fd1c9cba4f814959dc7 | no | apps/pdf/src/renderer/ai/tools.ts |
| pdf | set_header_footer | be3bce9fa7662a04bae24270dc74601b4f09f72f31d9dc3c678a1c35cda71dfd | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | set_image_opacity | 9dab142b4241cc104fa49155a5ccdc2089979cad208cc7be6024ec0cc42cc2a3 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | set_page_size | 9a467b57f08dbd28cac7981f84feafbf3df81f59b3c56cd6dc253f3bd2a7fccf | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | set_watermark | b05b95260b6bb279d917ed274da04a53558cf60de372e998d45b3019790ae210 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | split_pages | 4dc5cd116949877be22bee4270982e14a3ebb1ddf0206863146d21ce9dd39c14 | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | split_pdf | 29524e7ddcfab3d2a128194b02151e91cebbfda6be466ec85084181b886aa3db | yes | apps/pdf/src/renderer/ai/tools.ts |
| pdf | transform_image | df2862b332437b3a963d607932a4aafff006ee9f6be8515242e1eae94a7b1060 | yes | apps/pdf/src/renderer/ai/tools.ts |
| sheets | aggregate_range | 0bb8acb955e7fe08c6509362b175c0b2c8db86ba77525ea0a27551ebac751701 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | ask_clarification | 7b1327afd202f0d0d47debc5f922fdcbe4541bad90d6f97efe31db002b3373f7 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | compare_ranges | 1a0ed0e9ac3b9c9fde667582044c3ae87c41335812facb48fbd559d41a7fa4eb | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | create_document | 125a43f66d295e90404e05abadaa0e82e269fa06eaeddb20841497e3d4a692a7 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | find_cells | 2b150624089aafa5e5f49047d7ff2bb3451971257180529846ea79eb415fe8d2 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | generate_image | df82864f0926591f453c9aaabdd23fb1a9b746228098c5239ecb8ff01f151d69 | no | apps/sheets/src/renderer/ai/image-skill.ts |
| sheets | get_workbook_context | c8a1ac469a826ea3547ac220c7bbfdcd6b58080d4ec596ff2a0149c5ccb9b699 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | image_search | 3f5b97d7c6b3a4519fb63c6c2684b872e6e09c378eeb727d226e710be4dd7135 | no | apps/sheets/src/renderer/ai/image-skill.ts |
| sheets | load_guide | 4b24c5f64409be810b1d584cfd981e98476ef5617a6d2b3f24a3139b2028d6f6 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | merge_attached_workbooks | 23d617b33e9315f6762639a47ccad59f220f6d2edc617b3dcfdf2e2e983aa3c0 | yes | apps/sheets/src/renderer/ai/merge-skill.ts |
| sheets | propose_operations | a88b43f46d8b4363aa78db40b7912648b423731861e2e7f31c7cfd3c8374015f | yes | apps/sheets/src/renderer/ai/tools.ts |
| sheets | read_attachment | 681c5f1b81a89e7dffd61d75c1156e2e401fac649ce47c837de86da09797f866 | no | apps/sheets/src/renderer/ai/files-skill.ts |
| sheets | read_cells | 4fc7b92ab7498b96dcc18ac8680f53f8f8cbad07cc9c268d001b8673bcc7d12b | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | read_formats | fadf34ccc70f71a2f554a2675263adfed999de7de9806c634d96fd23ca5b460a | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | read_range | a24cfa6cf4bdfa061ee716a84a3c3f04cbaa912b2fec21bf912db77c3ec4a5d0 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | read_sheet_features | dbeaf7ccbb6be10d3dcd1b1b0463b3707698c07278731d60e811f2d52499c8cb | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | select_range | 5c4bc90b431bfb06f9ee24b68846dde2109f76a79be3c9ebf9fb83ef7bab72c2 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | summarize_range | c3bcb611cc7910edb523a061002f52b6fa9f01fdacee9ed63c17302a48d80070 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | trace_dependents | c943056ce23e242700a590848ccf78ad915967ac7a3b03f015d6a7bad0be1459 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | trace_precedents | ca54e759b883d7b6a58f4dfabbc21d782573ccef76199887c5404c0b8ee78aff | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | web_search | 0190a7f984b61a677dd6b5e3bbe3f4b0bacbde61149c05035f4b3da9b05154ba | no | apps/sheets/src/renderer/ai/search-skill.ts |
| slides | analyze_media | dbfb29df5c12dc878a617b1f1300a77537e83dbcf62ae9448ce160c174b09ca7 | no | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | apply_ops | deb4af7fbbf172cd483bbb6cfe5f0e476adfc1d6d3479062969b4598ddddf4bf | yes | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | ask_clarification | c85e716881674f5450b0b4ee851f27c3555513844f0910de58697787c41482c7 | no | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | edit_chart | c35f2a3daeeb75bdc7600b3f5d742dc30d9cf0892e14e7bf42d3cc27d948a66a | yes | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | execute_slide_script | c668e7cdaf360955b7c3a45df5fb47a1fa88396341f13e49219a5f9947bb186a | yes | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | generate_deck | 2e80fd0fac52ae549fd9f810be7c38f062c576df8c34a28c0fa5165b3cc4dd2e | yes | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | generate_image | 929e663eb5ee3b01e420979f98004d0c80d63afb770117906e1afb9ff8d77e1a | no | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | image_search | 1b59acae4fdff79780dec2c15f4951dc6d5a0f636a8e575d6e0c82819cad00f6 | no | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | insert_web_image | f4f9d0a026fc42c98cf3b02e0bc351c0bc318bcc9befa1372278e25740d8229b | yes | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | list_style_templates | c8a1ac469a826ea3547ac220c7bbfdcd6b58080d4ec596ff2a0149c5ccb9b699 | no | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | load_guide | 4b43764ff86ea2bbcf7897f723987b02e6e3600db050b6584ead581c7ddfe8c3 | no | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | plan_deck | 5305dfa9952eec88feeb5f2cd10d70a0fdaab0b6edf299df41ebe5d2d67d0862 | no | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | read_attachment | 681c5f1b81a89e7dffd61d75c1156e2e401fac649ce47c837de86da09797f866 | no | apps/slides/src/renderer/ai/files-skill.ts |
| slides | read_slide | 8289e679005cfd2be6f564ddf548e931a9a2641a7e7b5f017c1742e450fb6378 | no | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | regenerate_slide | 9b1b1b37328e30d044d4e121245a8cd212e3b1a823a137f7e065dc404f685b2e | yes | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | replace_image | c45ddb4760a4345ec58055d3b059195ea404787ece5c3bc8615d12b0d6c1dcf9 | yes | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | save_style_template | a0d566b3cefb088e514beef01988e12e1a9bb32f6f94f4ac7d5af016331937a0 | no | apps/slides/src/renderer/ai/slides-skill.ts |
| slides | web_search | ad55d2f1724692e27e27fb578dd9095a69f273b356c8ad4b417335248702efc4 | no | apps/slides/src/renderer/ai/slides-skill.ts |
<!-- extract:end -->

### 3.1 Đối chiếu cột cơ học với cột tay

- **Tên công cụ:** 141 dòng, khớp đúng tập tên của các bảng tay §4 theo từng module — docs 38, markdown 10, html 8, sheets 21,
  slides 18, pdf 46; `agent-core` không có dòng nào. Không thiếu, không thừa, không trùng. So với bản G6-01 (135 dòng) có 6 dòng
  mới, đều do G6-12 thêm công cụ: `ask_clarification` ở docs, markdown, sheets và pdf (bốn hàng, cùng `input_schema_sha256`
  `7b1327af…` với html — hợp đồng C-ASK), cùng `summarize_range` và `compare_ranges` ở sheets (§9 dòng 21, 24).
- **Khác biệt khối cũ → khối mới** (cùng script; đã chạy `diff` giữa đầu ra ở `0d03b185` và `66169a9a`): 6 dòng thêm ở trên;
  `editor_write` đổi ở 9 ô; một hash schema đổi có chủ ý (sheets `aggregate_range` `32587dfe…` → `0bb8acb9…`, vì thêm
  `skipHiddenRows`); mọi hash schema khác và mọi cột `source` không đổi. 9 ô `editor_write`: docs `resolve_comment`,
  `set_header_footer`, `define_style`, `set_page_setup`, `set_watermark` `no` → `yes` (§9 dòng 5); sheets
  `merge_attached_workbooks` `undeclared` → `yes` (§9, mục merge); html `ask_clarification`, pdf `create_document`, pdf
  `generate_image` `undeclared` → `no`. Không còn ô `undeclared` nào trong khối.
- **Khối ở `bf4ff7b0` (DOC-05 lockstep, 2026-10-16):** 143 dòng; so với `cb76dde5` chỉ khác dòng `rev=` và hai hàng mới `docs`
  `generate_mindmap` và `markdown` `generate_mindmap` (hash in `unresolved:identifier:depth`, `editor_write` `no`, nguồn
  `mind-map.ts` của từng module) — đúng đầu ra của `scripts/genoffice-tools-extract.mjs --rev bf4ff7b0` ở fork. Hai hàng đã đóng
  ở §9.1; cột tay ở §4.2 và §4.3.
- **`editor_write`:** cột cơ học chỉ đọc khai báo của code, còn cột "ghi editor" ở §4 ghi theo hành vi. Ở khối `cb76dde5` còn **12**
  chỗ hai cột khác nhau, đều nhóm B (công cụ ghi file; không phải lỗi). Ở `66169a9a` là **13**: 12 chỗ nhóm B và 1 chỗ nhóm C
  (markdown `ask_clarification`, đọc của script — xem dòng C dưới bảng, đã đóng ở G7-06). Tính lại từ 20 của khối cũ: −5 (nhóm A
  cũ, code khai báo sai: đã sửa ở G6-12, §9 dòng 5) −3 (html `ask_clarification`, pdf `generate_image`, sheets
  `merge_attached_workbooks`: nay khai báo đúng, cột cơ học và cột tay trùng) = 12, cộng 1 chỗ mới (markdown
  `ask_clarification`, nhóm C) = 13 ở `66169a9a`, rồi −1 khi extractor đã sửa đọc đúng ô đó = **12** ở `cb76dde5`; pdf
  `create_document` chuyển từ nhóm C cũ sang nhóm B (nay `no`, hand `file`). Cột cơ học không sửa tay; chỗ nào code sai thì sửa ở
  code rồi chạy lại script.

| nhóm | module / tool | cơ học | tay | giải thích |
| --- | --- | --- | --- | --- |
| A. Code khai báo `false` nhưng công cụ có đổi tài liệu | (không còn) | — | — | Năm công cụ docs (`resolve_comment`, `set_header_footer`, `define_style`, `set_page_setup`, `set_watermark`) nay khai báo `mutated: true` (§9 dòng 5), nên cột cơ học là `yes`, trùng cột tay `có`. |
| B. Ghi ra ngoài tài liệu | docs `create_document`; sheets `create_document`; slides `save_style_template`; pdf `create_document`; pdf `insert_blank_page`, `set_page_size`, `crop_pages`, `extract_pages`, `split_pdf`, `split_pages`, `merge_pages`, `replace_pages` | `no` / `yes` | file | `editor_write` chỉ nói về tài liệu đang mở. Cột tay ghi `file` vì công cụ ghi file, lưu, hoặc tạo version (§5 (c)). Các công cụ cấp file của pdf vừa đổi tài liệu (`yes`) vừa ghi file. Ba công cụ `create_document` (docs, sheets, pdf) bị ẩn khi tài liệu gắn UniWork (§5, §9 dòng 2, 17, 31); các công cụ pdf cấp file còn lại chờ Product (§9 dòng 30, 31). |
| C. Script đọc khác hành vi — **đã đóng ở G7-06** | markdown `ask_clarification` | `no` (khối `cb76dde5`; khối `66169a9a` in `yes`) | không | Mọi đường trả về của công cụ trong code đều khai báo `mutated: false` (`apps/markdown/src/renderer/ai/tools.ts`, test `apps/markdown/tests/g6-12-ask-clarification.test.ts`). Ở `66169a9a` ô cơ học in `yes` vì `branchRange` (`scripts/genoffice-tools-extract.mjs:1322-1331` (66169a9a)) kết thúc nhánh không có `{}` chỉ ở `;` hoặc `}`; fork không dùng dấu chấm phẩy, nên vùng của `if (call.name === 'ask_clarification') return …` chạy tiếp vào `switch (call.name)` kế bên và gom cả `case 'write_document': return writeDocument(…)`, mà helper đó khai báo `mutated: true` → `yes` (ở docs, chuỗi token sau guard gặp `}` trước khi tới helper nào có `mutated`, nên vẫn ra `no`). Extractor đã sửa ở F `f5b75e1f` (`feature/UNI-1378-g7-06-extractor`, blob `94babf94…`, chờ gộp vào fork main) kết thúc nhánh không `{}` ở cuối câu lệnh, nên khối `cb76dde5` in `no`, trùng cột tay `không`. Duyệt: Advisor, 2026-10-13 (ủy quyền của người dùng, người dùng xác nhận buổi sáng): đây là sửa lỗi đã biết của script, không mở hàng review thủ công cho owner F + Product. |


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
liệu, bảng ghi "có (code khai báo `false`)" — cột cơ học ở §3 theo khai báo của code, cột tay ghi sự thật. Ở `66169a9a` không
còn công cụ nào ở trạng thái đó (năm công cụ docs đã khai báo `mutated: true`, §9 dòng 5); các chỗ lệch còn lại ở §3.1 là
công cụ ghi file và một ô đọc sai của script.

### 4.1 agent-core

`packages/agent-core` **không định nghĩa công cụ nào**: nó chỉ có kiểu (`AgentToolDef`, `AgentSkill`), vòng lặp và transport (§2).
Giới hạn chung mọi module kế thừa: 100 lượt model mỗi run, các cầu chì 3/8/3 lượt, nén lịch sử 256 KB/96 KB, 2 MiB stream mỗi
lượt (`packages/agent-core/src/loop.ts:73-92`, `loop.ts:325-326`). Nếu khối §3 có dòng `agent-core` thì đó là phát hiện của
script và phải đối chiếu lại ở đây.

### 4.2 docs (DOCX)

Skill: `composeSkills('docs+files', …, [createDocsSkill(…), createFilesSkill(…)])` (`docs/ai/AiPanel.tsx:822-842` (66169a9a)).
Công cụ ẩn theo capability: `web_search`, `image_search`, `generate_image`, `create_document` (`docs/ai/docs-skill.ts:27-32` (66169a9a));
`generate_image`/`analyze_media` còn ẩn khi không có model media (`docs-skill.ts:118-123` (66169a9a)). Từ G6-12: `create_document` còn ẩn
khi tài liệu gắn UniWork (`BOUND_HIDDEN_TOOLS` + vị từ `isBound`, lấy từ `uniwork.bound` có sẵn, không thêm IPC;
`docs-skill.ts` (66169a9a)) và bị từ chối nếu vẫn bị gọi; `ask_clarification` chỉ xuất hiện khi panel có thẻ hỏi (tham số
`getAsk`) và nằm trong `READ_ONLY_TOOLS`. Tài liệu chỉ xem (UniWork
view-only) chỉ giữ `READ_ONLY_TOOLS` (`docs-skill.ts:38-48` (66169a9a)), công cụ khác bị lọc khỏi danh sách và bị từ chối nếu vẫn gọi
(`docs-skill.ts:157-159` (66169a9a)); `read_attachment` ở skill khác nên vẫn còn.
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
| apply_ops | cả hai | `ops[]`, `dryRun` → tóm tắt | nguyên tử (một op sai → bỏ cả lô); `dryRun` xem trước | có | `insertField` theo danh sách **cho phép** từ G6-12, xem §5 (a); `updateFields scope:"all"` chỉ đánh dấu `dirty` loại trường trong danh sách |
| read_revisions | cả hai | — → danh sách tracked change | 200 mục trong context (`protocol.ts:627`) | không | view-only giữ |
| accept_changes | cả hai | bộ chọn (all/ids/author/type/block) → id bị ảnh hưởng | bộ chọn được kiểm | có | |
| reject_changes | cả hai | như trên | như trên | có | |
| read_comments | cả hai | — → các luồng comment | 20 luồng trong context (`protocol.ts:708`) | không | view-only giữ |
| reply_comment | cả hai | `parentId`, text → ack | luồng phải tồn tại | có | |
| resolve_comment | cả hai | id → ack | — | có (`mutated: true` từ G6-12; trước đó code khai báo `false`) | rollback trả lại trạng thái comment (§6) |
| insert_footnote | cả hai | blockIndex, `afterText`, text → id | text không rỗng | có | |
| insert_endnote | cả hai | như trên | như trên | có | |
| delete_note | cả hai | kind, id → ack | từ chối block khóa | có | |
| edit_note | cả hai | id, find, replace → ack | — | có | |
| read_notes | cả hai | — → danh sách chú thích | — | không | view-only giữ |
| add_comment | cả hai | blockIndex, text neo, comment, author → id | author mặc định là tác giả AI | có | |
| delete_comment | cả hai | id, `withReplies` → ack | gốc có trả lời bị từ chối nếu thiếu `withReplies` | có | |
| web_search | cả hai, gate `webSearch` | query, maxResults → tiêu đề/URL/trích | mặc định 6; web cắt query 400 ký tự, 1–10 kết quả (`web/modules/shared/ai/web-ai.ts:576-577`, `web-ai.ts:677-679`) | không | gửi query ra backend tìm kiếm; tốn credit nếu qua UniWork cloud; view-only giữ |
| image_search | cả hai, gate `imageSearch` | query, maxResults → URL ảnh | mặc định 8; web cùng kẹp | không | view-only giữ |
| analyze_media | cả hai, cần model media | blockIndex, `mediaUrls`, yêu cầu → văn bản phân tích | đầu ra cắt 6 000 ký tự (`docs/ai/tools.ts:937`); web chỉ `data:`, tối đa 4, yêu cầu 4 000 ký tự (`web-ai.ts:563-566`, `web-ai.ts:741-750`); desktop 200 MB, 12 mục (`packages/ai-search/src/media-tools.ts:46-53`) | không | web âm thầm bỏ URL không phải `data:`; view-only giữ |
| insert_image | cả hai | `url` http(s), maxWidthPx → ack | PNG/JPG/GIF theo magic byte; desktop 50 MB (`packages/electron-utils/src/remote-image.ts:11`) | có | tải URL do model đưa, xem §5 (b) |
| generate_image | cả hai, gate `imageGeneration` + model media | prompt, aspectRatio → ack | web cắt prompt 4 000 ký tự | có | tốn credit |
| insert_chart | cả hai | kind (bar/line/pie), categories, series → ack | giá trị ép về số hữu hạn hoặc null | có | |
| edit_chart | cả hai | blockIndex, title, categories, series → ack | số điểm phải khớp bản gốc | có | |
| set_header_footer | cả hai | kind, text, view → ack | 2 000 ký tự (`docs/ai/tools.ts:1989` (66169a9a)) | có (`mutated: true` từ G6-12, `tools.ts:1996` (66169a9a); trước đó `false`, `tools.ts:1901` (0d03b185)) | ngoài cây ProseMirror: rollback trả lại từ G6-12 (`run-snapshot.ts`), trừ khi người dùng lưu giữa lượt (§6) |
| create_document | **chỉ desktop**, gate `createDocument` | type (docx/pdf/md/html), title, content → đường dẫn | title làm sạch 80 ký tự; không trần kích thước nội dung | file (không đổi tài liệu đang mở; ghi file mới, xem §5 (c)) | **ghi file mới ra đĩa**, xem §5 (c). Từ G6-12 **ẩn** khi tài liệu gắn UniWork (bị gọi vẫn thì `isError`: "this is a UniWork document, so the AI cannot write files outside it"); tài liệu cục bộ giữ cũ |
| define_style | cả hai | styleId, name, type, pPr/rPr → ack | styleId `^[A-Za-z0-9_-]{1,64}$`, heading 1–9 | có (`mutated: true` từ G6-12, `tools.ts:2086` (66169a9a); trước đó `false`, `tools.ts:1991` (0d03b185)) | mô tả đã sửa ở G6-12: dùng op `applyStyle` của `apply_ops` (`{ op: "applyStyle", target, styleId }`), không còn nhắc `apply_style` không tồn tại (`style-ops.ts:53` (66169a9a)); rollback trả lại style tạm (§6) |
| list_styles | cả hai | — → danh mục style | — | không | bị lọc ở view-only dù chỉ đọc |
| set_page_setup | cả hai | section/blockIndex, khổ, hướng, lề, cột → từng section | lề ≤ 50 400 twip, cột 1–12 (`docs/ai/page-setup.ts:89`, `page-setup.ts:410`) | có (`mutated: true` từ G6-12, `tools.ts:2040` (66169a9a); trước đó `false`, `tools.ts:1945` (0d03b185)) | ngoài cây ProseMirror; rollback trả lại từ G6-12 (§6) |
| insert_section_break | cả hai | `afterBlockIndex`, type → danh sách section | type thuộc 4 giá trị | có | |
| read_attachment | cả hai | index, offset → đoạn văn bản + tổng ký tự | 24 000/lần (`docs/ai/files-skill.ts:12`); desktop trần 48 000; web chỉ đuôi văn bản thuần | không | đường dẫn lấy từ danh sách người dùng đính kèm, không do model chọn |
| set_watermark | cả hai | text hoặc ảnh, màu, độ mờ… → ack | text 200 ký tự (`docs/ai/floating-ops.ts:101`), opacity 0–1 | có (`mutated: true` từ G6-12 cho cả nhánh chữ và ảnh, `tools.ts:2100` (66169a9a); trước đó `false`, `tools.ts:2005` (0d03b185)) | biến thể ảnh tải URL; rollback trả lại watermark từ G6-12 (§6) |
| insert_picture | cả hai | `url` (http(s) hoặc `data:image`), vị trí, cỡ, float → ack | PNG/JPG/GIF | có | |
| insert_text_box | cả hai | text, kích thước, vị trí, wrap → ack | cỡ chữ trong `MIN/MAX_FONT_SIZE_PT` | có | |
| ask_clarification | cả hai (chỉ khi panel có thẻ hỏi) | `questions[]` (≤ 4, mỗi câu ≤ 5 lựa chọn) → câu trả lời của người dùng | `inputSchema` giống từng byte html (hash `7b1327af…`); mô tả riêng cho docs: hỏi nghĩa/phạm vi/đích trước khi sửa hoặc trả lời | không (`mutated: false` ở mọi đường trả về) | **mới ở G6-12** (§7, §9 dòng 7; `tools.ts:110` (66169a9a)). Thẻ gắn vào panel, chặn run tới khi người dùng trả lời; Bỏ qua/Dừng/Chat mới/đóng panel trả `cancelled`. Câu trả lời hiện thành biên nhận dưới tin nhắn người dùng (`clarify-receipts.ts`). View-only giữ |
| generate_mindmap | cả hai | `root` (cây `label`, `block?`, `children[]`), `focus?` → thẻ sơ đồ tư duy trong chat | tối đa 120 nút, sâu 5, nhãn 60 ký tự, `focus` 80 ký tự; trích dẫn `block` sai bị bỏ, không lỗi (`docs/ai/mind-map.ts:12-17` (bf4ff7b0)) | không (`mutated: false`; chỉ trả `display: { kind: 'mindmap' }`, nằm trong `READ_ONLY_TOOLS`) | **mới sau `cb76dde5`** (khối §3 đọc ở `bf4ff7b0`; `docs/ai/tools.ts:1479` (bf4ff7b0)). Không ghi tài liệu, không ghi file; view-only giữ. Sản phẩm: Advisor 2026-10-16 `msg_f4b50f24445b` (mặc định của Advisor, người dùng có thể đổi) |

Ghi chú docs:
- Bảo vệ Word (chỉ đọc, chỉ form, chỉ comment, khóa mật khẩu ghi) **không** được truyền vào panel: `AiPanel` chỉ nhận
  `readOnly={uniwork.readOnly}` (`apps/docs/src/renderer/App.tsx:7224` (66169a9a)), không công cụ nào đọc `docProtected`. Giao dịch lập
  trình không bị `editable` chặn, nên nhiều khả năng AI sửa được tài liệu người dùng không gõ được (chưa kiểm bằng test).
- Năm công cụ từng khai báo `mutated:false` nhưng đổi tài liệu (`resolve_comment`, `set_header_footer`, `define_style`,
  `set_page_setup`, `set_watermark`) nay khai báo `mutated: true` (G6-12, §9 dòng 5); một run chỉ gọi chúng đã có snapshot
  rollback. Rollback giờ chụp cả trạng thái ngoài cây ProseMirror (comment, header/footer, page setup, style tạm,
  watermark) và trả lại cùng cây (`apps/docs/src/renderer/ai/run-snapshot.ts`). **Giới hạn đã chấp nhận:** nếu người dùng
  lưu hoặc tải lại file giữa lượt, rollback chỉ trả cây; phần ngoài cây giữ như file đã lưu và panel không báo (§9.2, chủ G6-09).
- `apply_ops` `insertField` giờ chỉ nhận từ khóa trường trong danh sách cho phép (SEQ, REF, PAGEREF, NOTEREF, STYLEREF, DATE,
  TIME, CREATEDATE, SAVEDATE, PRINTDATE, EDITTIME, MERGEFIELD, IF, PAGE, NUMPAGES, SECTIONPAGES, SECTION, NUMWORDS, NUMCHARS,
  AUTHOR, TITLE, SUBJECT, KEYWORDS, COMMENTS, LASTSAVEDBY, REVNUM, DOCPROPERTY, LISTNUM; không phân biệt hoa thường). DDE,
  DDEAUTO, LINK, IMPORT, INCLUDE*, DATABASE, MACROBUTTON, ASK, FILLIN, AUTOTEXT và từ khóa lạ bị từ chối (`field-ops.ts:35` (66169a9a)).

### 4.3 markdown

Skill: `composeSkills('markdown+search', '', [markdownSkill, createSearchSkill()])` (`md/ai/AiPanel.tsx:434-450` (66169a9a)).
`generate_image` chỉ có khi `cap('imageGeneration')` và có model media (`md/ai/AiPanel.tsx:442-443` (66169a9a)). Không công cụ nào gate theo
`webSearch`/`imageSearch` trong renderer: trên web, bridge `withWebAi` trả lỗi "unavailable" khi capability tắt
(`web/modules/shared/ai/web-ai.ts:13-14` (66169a9a)). View-only giữ `get_document_context`, `read_blocks`, `read_frontmatter`
(`md/ai/markdown-skill.ts:70` (66169a9a), lọc ở `:109` (66169a9a), từ chối ở `:140` (66169a9a)); `web_search` ở skill khác nên vẫn còn. Từ G6-12: (1) capability
mới `aiImageFetch` (web mặc định `false`, `web/modules/markdown/webapi.ts`; desktop không đặt object nên bật) quyết định
`insert_image` và `generate_image` có trong getter `tools` hay không (`md/ai/markdown-skill.ts`, `hostOffers`), kèm một câu ghi
chú trong prompt và từ chối nếu vẫn bị gọi; (2) `ask_clarification` chỉ có khi panel có thẻ hỏi, nằm trong `READ_ONLY_TOOLS`;
(3) một **rào vùng sửa** cho lượt "sửa vùng chọn" hoặc hàng đợi sửa (đơn vị là block cấp cao nhất; xem ghi chú dưới bảng).

| tool | host | vào → ra | giới hạn trong code | ghi editor | ghi chú |
| --- | --- | --- | --- | --- | --- |
| get_document_context | cả hai | — → khung `idx\|type\|preview` + vùng chọn | 8 000 ký tự, preview 60, vùng chọn 4 000 (`md/ai/tools.ts:27-30`) | không | đặt lại mốc chống sửa cũ |
| read_blocks | cả hai | `startIndex`, `endIndex`, `offset` → markdown của khoảng block | 24 000 ký tự/trang (`md/ai/tools.ts:29`) | không | |
| apply_ops | cả hai | `ops[]` (catalogue `editor/ops.ts`) → kết quả từng op | **nguyên tử với lô của AI** từ G6-12: op lỗi đầu tiên hoàn tác mọi bước đã áp (kể cả `setFrontmatter`), kết quả `applied: 0`, `rolledBack: true`, `mutated: false`, `isError: true`; lô của UI (`source: 'ui'`) vẫn dừng-giữ-trước như cũ; bị rào vùng sửa từ chối thì hoàn tác cùng đường (`REFUSED: …`) | có | `editor/ops.ts` `runOps` (66169a9a). Hoàn tác không vào lịch sử undo; Ctrl+Z đầu tiên sau lô lỗi có thể là một bước rỗng. Mô tả công cụ nói rõ là nguyên tử |
| write_document | cả hai | plan, title, context, `afterIndex`, `replaceDocument` → stream markdown | 200 000 ký tự (`md/ai/doc-writer.ts:13`); tài liệu không trống cần `afterIndex`/`replaceDocument`; khi có rào: từ chối ghi cả tài liệu hoặc `afterIndex` không nằm trong/kề block được rào | có | bản nháp không vào undo (`md/ai/doc-writer.ts:174`) |
| image_search | cả hai, web cần `imageSearch` | query, maxResults → URL ảnh | mặc định 8 | không | |
| insert_image | **desktop**; web **ẩn** (cap `aiImageFetch` = false từ G6-12) | `url` http(s), `afterIndex`, alt → chèn khối ảnh | PNG/JPG/GIF theo magic byte, 50 MB; cần tài liệu đã lưu; khi có rào, chỉ chèn trong/kề vùng được rào | có | tải ảnh rồi **ghi file vào thư mục assets của tài liệu** (`md/ai/tools.ts:389-400` (66169a9a), `apps/markdown/src/main/markdown-main.ts:913-920`); web: `fetchImage` vẫn là stub trả `null` (`web/modules/markdown/webapi.ts:135` (66169a9a)) nhưng công cụ không còn trong danh sách gửi model, và bị từ chối trước khi stub chạy nếu vẫn bị gọi (§9 dòng 11) |
| generate_image | **desktop**; web **ẩn** (cap `aiImageFetch` cùng `imageGeneration`) | prompt, aspectRatio, `afterIndex`, alt → như `insert_image` | như `insert_image` | có | cùng bước tải ảnh + lưu như trên nên bị ẩn bằng cùng cap, kể cả nếu host web sau này cấp `imageGeneration` |
| read_frontmatter | cả hai | — → YAML thô | — | không | |
| web_search | cả hai, web cần `webSearch` | query, maxResults → câu trả lời, link, trích | mặc định 6 | không | |
| ask_clarification | cả hai (chỉ khi panel có thẻ hỏi) | `questions[]` (≤ 4 câu, ≤ 5 lựa chọn) → câu trả lời của người dùng | `inputSchema` giống từng byte html; mô tả riêng cho markdown | không (`mutated: false` ở mọi đường trả về; khối §3 ở `cb76dde5` cũng ghi `no` sau khi sửa script, §3.1 nhóm C đã đóng) | **mới ở G6-12** (§7, §9 dòng 7; `md/ai/tools.ts:149` (66169a9a)). Chặn run tới khi người dùng trả lời; Bỏ qua/Dừng/Chat mới/đóng panel trả `cancelled`; biên nhận dưới tin nhắn người dùng. View-only giữ. Rào vùng sửa không áp |
| generate_mindmap | cả hai | `root` (cây `label`, `block?`, `children[]`), `focus?` → thẻ sơ đồ tư duy trong chat | tối đa 120 nút, sâu 5, nhãn 60 ký tự, `focus` 80 ký tự; trích dẫn `block` sai bị bỏ, không lỗi (`md/ai/mind-map.ts:12-17` (bf4ff7b0)) | không (`mutated: false`; chỉ trả `display: { kind: 'mindmap' }`, nằm trong `READ_ONLY_TOOLS`) | **mới sau `cb76dde5`** (khối §3 đọc ở `bf4ff7b0`; `md/ai/tools.ts:793` (bf4ff7b0)). Không ghi tài liệu, không ghi file; view-only giữ. Sản phẩm: Advisor 2026-10-16 `msg_f4b50f24445b` (mặc định của Advisor, người dùng có thể đổi) |

**Rào vùng sửa (G6-12, §9 dòng 9) — markdown.** Chỉ bật khi lượt có phạm vi: gửi từ composer/popover/ribbon khi đang có vùng chọn
(chip "Selection (N words)" còn đó; bỏ chip bằng × thì lượt không rào) hoặc gửi hàng đợi sửa (mỗi neo là một vùng). Rào là danh
sách vùng-theo-block, đi theo mọi sửa (của AI hay người) qua mapping giao dịch. `runOps` nhận móc `verify(before, after)` chỉ cho
AI: mọi block cấp cao nhất ngoài rào phải giống hệt và đúng thứ tự, vi phạm thì hoàn tác cả lô (đường của `apply_ops` nguyên tử);
`setFrontmatter` bị từ chối khi có rào. **Đơn vị là block**: rào trên một phần đoạn văn vẫn cho phép viết lại cả đoạn đó (chấp nhận,
ghi cho spec); văn bản ngoài các block được rào giữ nguyên từng byte. Thử lại một lượt có rào không bao giờ chạy không rào
(`retryFence`: lượt có phạm vi dùng vùng đã lưu của chính nó; mục khôi phục từ transcript dùng rào rỗng, từ chối mọi sửa).
`ai/edit-fence.ts` (66169a9a); test `apps/markdown/tests/g6-12-md-edit-fence.test.ts`.

### 4.4 html

Skill: `composeSkills('html+search', '', [documentSkill, createSearchSkill(), createFilesSkill(…), intentSkill])`
(`html/ai/AiPanel.tsx:677-713` (66169a9a)); `intentSkill` không có công cụ (`html/ai/intent.ts`). View-only giữ `get_outline`,
`read_source` (`html/ai/tools.ts:946` (66169a9a), `tools.ts:965` (66169a9a)); `web_search`, `read_attachment` ở skill khác nên vẫn còn.
Trình soạn thảo là mã nguồn (CodeMirror) + preview iframe. Từ G6-12: capability mới `attachments` (web mặc định `false`,
`web/modules/html/webapi.ts`; desktop không đặt object nên bật) quyết định skill file có đóng góp công cụ `read_attachment`, prompt
và danh sách tệp đính kèm hay không (getter đọc lại trước mỗi request; bị gọi vẫn thì từ chối trước khi `readAttachment` chạy;
`html/ai/files-skill.ts`, 66169a9a). `ask_clarification` nay khai báo `mutated: false` ở cả bốn đường trả về. Có một **rào vùng
sửa** theo `sid` (xem ghi chú dưới bảng).

| tool | host | vào → ra | giới hạn trong code | ghi editor | ghi chú |
| --- | --- | --- | --- | --- | --- |
| get_outline | cả hai | `depth`, `from_sid` → dòng `L<a>-L<b> sid=N tag#id.class "preview"` | 80 dòng mặc định (`html/ai/tools.ts:18`), preview 60 | không | |
| read_source | cả hai | `start_line`/`end_line` hoặc `sid`, `page` → mã nguồn đánh số | 12 000 ký tự/trang (`html/ai/tools.ts:19`) | không | |
| apply_ops | cả hai | `ops[]`: `str_replace`, `replace_element`, `set_inner_html`, `set_text`, `insert_html`, `remove`, `move`, `set_attr`, `set_style` → khoảng đã áp | tối đa 40 op (`html/ai/tools.ts:289` (66169a9a)); nguyên tử; từ chối `data:` URL bị cắt; khi có rào vùng sửa, biên dịch lô trước (`compileOps`) và từ chối cả lô nếu có patch rơi ngoài `range` của mọi phần tử được rào (`0 of N ops applied. REFUSED: …`, nguồn không đổi) | có | HTML do AI viết **không được làm sạch** (`<script>`, `on*=`, `javascript:` qua được) |
| ask_clarification | cả hai | `questions[]` (≤ 4, mỗi câu ≤ 5 lựa chọn; `html/ai/tools.ts:337` (66169a9a)) → câu trả lời của người dùng | — | không (khai báo `mutated: false` từ G6-12; trước đó `undeclared`) | chặn run tới khi người dùng trả lời, xem §7. Biên nhận trả lời bị bỏ khi mở tài liệu khác (G6-12 WR) |
| plan_page | cả hai | `mode` (`new`/`redesign`/`restyle`/`extract`), notes → thẻ brief, rồi trang | brief 40 000 ký tự (`html/ai/brief-writer.ts:11`) | có | `new`/`redesign` **thay toàn bộ tài liệu**; bị từ chối khi có rào vùng sửa |
| write_document | cả hai | title, plan, context → cả trang | 200 000 ký tự (`html/ai/page-writer.ts:11`) | có | thay toàn bộ tài liệu; chỉ chặn khi tài liệu không trống và đã bị sửa sau khi model đọc; bị từ chối khi có rào vùng sửa |
| web_search | cả hai, web cần `webSearch` | như markdown | — | không | |
| read_attachment | **desktop**; web **ẩn** (cap `attachments` = false từ G6-12) | index, offset → văn bản tệp đính kèm | 24 000/lần (`html/ai/files-skill.ts:16` (66169a9a)), main 48 000 | không | web: stub vẫn còn (`web/modules/html/webapi.ts:122` (66169a9a)) nhưng công cụ không còn trong danh sách gửi model và bị từ chối trước khi stub chạy (§9 dòng 11). Nút đính kèm trong composer web chưa ẩn (việc UI ngoài phạm vi) |

**Rào vùng sửa (G6-12, §9 dòng 9) — html.** Rào là danh sách `sid` (bản đồ parse giữ `sid` ổn định qua các lần dựng lại). Bật khi
lượt có phạm vi: "Ask AI" trên phần tử đang chọn (preset mang `fenceSids: [askTarget.sid]`) hoặc gửi hàng đợi sửa (mọi `sid` trong
hàng đợi). Patch sát mép phần tử (ví dụ chèn anh em ngay cạnh) tính là trong rào. `plan_page` và `write_document` bị từ chối khi có
rào. Gửi thẳng từ composer khi có phần tử đang chọn **không** rào (composer html không có chip phạm vi để người dùng bỏ rào; chờ
Product xác nhận, §9.1). Thử lại giữ `fenceSids` của lượt đã gửi. `html/ai/edit-fence.ts` (66169a9a); test
`apps/html/tests/g6-12-html-edit-fence.test.ts`.

### 4.5 Gắn công cụ theo host — sheets, slides, pdf

Trong 4.5–4.8, §5, §6, §7, §8.1 và các dòng 16–35 của §9, đường dẫn rút gọn là của module đang nói: `tools.ts`, `files-skill.ts`, `merge-skill.ts`, `search-skill.ts`, `image-skill.ts`, `view-only-skill.ts`, `workbook-readers.ts`, `aggregate.ts`, `AiChatPanel.tsx` = `apps/sheets/src/renderer/ai/…` (sheets) hoặc `apps/pdf/src/renderer/ai/…` (pdf); `slides-skill.ts`, `AiPanel.tsx`, `edit-queue.ts`, `layout-script*.ts` = `apps/slides/src/renderer/ai/…`; `App.tsx` = `apps/<module>/src/renderer/App.tsx`; `ai-ipc.ts`, `slides-main.ts` = `apps/slides/src/main/…`; `install.ts`, `webapi.ts` (pdf) = `web/modules/pdf/…`.

- Desktop: renderer gọi `window.desktopApi` / `slidesApi` / `pdfApi` (preload Electron), không đặt `capabilities` → mọi `cap()`
  bật (`apps/sheets/src/renderer/capabilities.ts:4-6`). Chat đi qua IPC transport (`apps/sheets/src/renderer/ai/transport.ts:6`).
- Web: frame cài cùng renderer; `installModuleBridge` bọc global bằng `withWebAi` (`web/docs/bridge/module-bridge.ts:165`),
  grant AI lấy từ host (`aiHostGrants`, `web/docs/bridge/module-bridge.ts:149`). Khi có grant `ai`: `aiStream` đi proxy BYOK của
  UniWork; `webSearch`/`imageSearch`/`generateImage`/`analyzeMedia` đi công cụ cloud UniWork bằng frame token
  (`web/modules/shared/ai/web-ai.ts:674,690,726-740,741`), mỗi cái cần capability riêng + công tắc `GET cloud` của server.
- Công cụ cloud desktop (`UNIWORK_CLOUD_TOOLS`, `packages/ai-provider/src/uniwork-cloud.ts:20-26`) chạy ở main process với
  bearer token của phiên UniWork người dùng (`apps/shell/src/main/uniwork-auth/index.ts:210,263`); token không tới renderer.
- "Gated" = công cụ ẩn khỏi danh sách tool gửi cho model khi capability/điều kiện tắt (getter `tools` đọc lại trước mỗi request).
  "Stub" = công cụ vẫn được khai báo cho model nhưng bridge web trả lỗi "unavailable".

### 4.6 sheets

Skill ghép: `composeSkills('sheets+files', …)` tại `apps/sheets/src/renderer/App.tsx:1437-1464` (66169a9a) = workbook skill + files (gate
`attachments`) + merge (gate `mergeWorkbooks`) + search (gate `webSearch`) + image (gate `imageGeneration`/`imageSearch`), tất cả
bọc `restrictToReading` (view-only UniWork → chỉ `VIEW_ONLY_TOOLS`, `apps/sheets/src/renderer/ai/view-only-skill.ts:9-28,46-68` (66169a9a)).
Web: `createDocument`, `attachments`, `mergeWorkbooks` luôn tắt; `webSearch`/`imageSearch`/`imageGeneration` tắt tới khi host cấp
(`web/modules/sheets/capabilities.ts:27-36,54`). Từ G6-12: (1) `createWorkbookSkill` ẩn `create_document` (và bullet prompt của nó)
khi workbook gắn UniWork — nguồn là `workbookFile.uniworkBound` có sẵn, không thêm IPC — và từ chối nếu vẫn bị gọi
(`SheetsSkillDeps.isUniworkBound`); (2) `propose_operations` từ chối **cả lô** nếu workbook gắn UniWork có op `add_image` với đường
dẫn không phải `http(s)://`, `data:image/`, `file://` (main chỉ mở `file:` trong kho ảnh sinh ra của chính nó) và không phải đúng
đường dẫn một tệp đính kèm của chat; (3) ba công cụ mới (`summarize_range`, `compare_ranges`, `ask_clarification`), hai công cụ
đọc đầu nằm trong `VIEW_ONLY_TOOLS`; (4) quy ước đầu ra mới cho mọi công cụ đọc: ô công thức chưa tính lại in
`NOT RECALCULATED (=công thức)`, ô có kiểu dễ gây hiểu nhầm in `[type; raw …; format …]`, hàm engine không hỗ trợ in
`unsupported function: X`, dòng ẩn/lọc được đếm và nêu rõ đã gộp hay bỏ.

| tool | host | vào → ra | giới hạn trong code | ghi editor | ghi chú |
| --- | --- | --- | --- | --- | --- |
| get_workbook_context | cả hai | `{}` → danh sách sheet (id/tên/extent), sheet active, selection (đóng băng lúc gửi), merge, chart, ô đã biết | ô đã biết ≤200, merge ≤50 (`tools.ts:712,726`) | không | `tools.ts:269`. Báo chế độ streaming và sheet READ-ONLY vượt trần save-patch (`tools.ts:661-692`) |
| read_range | cả hai | `{range, sheetId?}` → lưới giá trị/công thức có nhãn cột A,B,… và số dòng | ≤2000 ô (`MAX_READ_RANGE_CELLS`, `tools.ts:303,1396` (66169a9a)); phải nằm trong data extent (`tools.ts:1411` (66169a9a)) | không | `tools.ts:324` (66169a9a). Từ G6-12 (§9 dòng 19, 20, 22): nhãn dòng `5 (hidden)` / `6 (filtered out)` + dòng `Hidden rows in this range: …`; dưới lưới liệt kê (≤ 200 dòng) ô mà chuỗi hiển thị một mình dễ gây hiểu nhầm, dạng `[type; raw …; format …]` (demo và lazy cùng một hình `CellRead`: `value` hiển thị, `rawValue`, `type`, `numberFormat`; `ai/cell-read.ts`, 66169a9a); ô công thức dùng giá trị cache có nhãn "cached value from the file"; cache có thể cũ in `NOT RECALCULATED` |
| aggregate_range | cả hai | `{range, sheetId?, topValues?}` → cells, nonEmpty, distinct, numeric count/sum/avg/min/max, top values | ≤1.000.000 ô (`tools.ts:304,1523` (66169a9a)); topValues 0–50 (`tools.ts:305,1542` (66169a9a)); distinct ngừng sau 200.000 (`aggregate.ts:10`) | không | `tools.ts:349` (66169a9a). Tính bằng JS (`aggregate.ts:33-70`), không phải model. Từ G6-12: tham số `skipHiddenRows` (mặc định `false` = gộp dòng ẩn như SUM, **không bỏ im lặng**), đầu ra luôn có `hidden/filtered rows in the range: N` + "(INCLUDED …)" hoặc "(SKIPPED — visible rows only)"; **giữ lại thống kê** (in `NOT RECALCULATED: …`) khi dùng giá trị cache của ô công thức có thể đã cũ; không dò hàng tổng (§9 dòng 24). Status bar vẫn dùng `skipFileHiddenRows` (`App.tsx:2113` (66169a9a)) |
| load_guide | cả hai | `{guides[]}` → văn bản hướng dẫn op (prompts/guides/*.md) | danh mục cố định (`guides.ts`) | không | `tools.ts:325` |
| read_formats | cả hai | `{range, sheetId?}` → định dạng tường minh (bold, màu, number format, căn lề, viền) | ≤200 ô (`tools.ts:263,980`) | không | `tools.ts:342`. Là chỗ duy nhất thấy number format (vd `0%`) |
| read_sheet_features | cả hai | `{sheetId?}` → AutoFilter, CF, DV, defined names, freeze, hidden/protected, shape/ảnh, page setup | — | không | `tools.ts:360`; `workbook-readers.ts:28` |
| read_cells | cả hai | `{addresses[], sheetId?}` → giá trị/công thức từng ô | ≤100 địa chỉ (`tools.ts:301,1999` (66169a9a); trước G6-12 cắt bớt im lặng, nay có ghi chú, xem cột ghi chú); streaming: bao ≤2000 ô (`tools.ts:2058-2061` (66169a9a)) | không | `tools.ts:575` (66169a9a). Từ G6-12 (§9 dòng 23): vượt 100 địa chỉ thì đầu ra mở đầu bằng ghi chú nêu số đã hỏi, số đã đọc (100), số **chưa** đọc, địa chỉ đầu tiên chưa đọc và cách gọi tiếp; thêm `[type; raw; format]`, nhãn cache/`NOT RECALCULATED` và `unsupported function` như `read_range` |
| find_cells | cả hai | `{query?, regex?, look_in?, sheetId?, errors_only?, max_results?}` → `Sheet!Addr` + nội dung | mặc định 50, tối đa 200 (`tools.ts:264-265,1129`); báo truncated/sheet chưa index xong | không | `tools.ts:398`; `workbook-search.ts`. Giá trị công thức = giá trị tính gần nhất |
| select_range | cả hai | `{range, sheetId?}` → chọn + cuộn tới vùng | — | không (đổi selection của người dùng) | `tools.ts:438` |
| trace_precedents | cả hai | `{address, sheetId?}` → tham chiếu của công thức + mẫu giá trị + cờ lỗi | độ sâu 1; defined name không mở | không | `tools.ts:457`; `formula-audit.ts` |
| trace_dependents | cả hai | `{address, sheetId?}` → mọi công thức đọc ô | không thấy phụ thuộc qua defined name | không | `tools.ts:475` |
| propose_operations | cả hai | `{operations[] (workbook DSL), summary}` → "Auto-applied N change(s)" + before→after (≤20 ô) + đọc lại ≤10 ô công thức sau 300 ms | ≤2000 thay đổi ô mở rộng; op bulk ≤200.000 ô; op cấu trúc không chung batch (mô tả `tools.ts:708-711` (66169a9a), kiểm ở `plan()` của xlsx-gateway); batch all-or-nothing; `MAX_READBACK_FORMULAS=10`, `FORMULA_RECALC_DELAY_MS=300` (`tools.ts:308-310` (66169a9a)); streaming: ngân sách ~50.000 ô tham chiếu (`tools.ts:916` (66169a9a)) | có (`mutated: true`, `tools.ts:2297,2335` (66169a9a)) | `tools.ts:693` (66169a9a). **Áp dụng ngay** (`App.tsx:3626-3657` (66169a9a) `autoApplySafePlan`), không có bước xem trước. Zod `workbookOperationSchema` kiểm op (`tools.ts:2243` (66169a9a)). Gồm cả `add_image` tải URL (xem §5). Từ G6-12: workbook gắn UniWork từ chối cả lô nếu `add_image` dùng đường dẫn cục bộ không phải tệp đính kèm (§9 dòng 16); dòng đọc lại nêu `unsupported function: X` thay vì `#NAME?` trần |
| create_document | desktop (gated `createDocument`; web luôn tắt, bridge stub `web/modules/sheets/bridge.ts:820`) | `{type: xlsx/csv/docx/pdf/md/html, sheetId?, title?, content?}` → file mới trong thư mục lưu mặc định, mở tab mới | content rỗng/echo bị từ chối (`tools.ts:2412-2417` (66169a9a)) | file | `tools.ts:727` (66169a9a); **ẩn khi workbook gắn UniWork** từ G6-12 (§9 dòng 17); gate ở `workbook-skill.ts:16-21` (66169a9a) và `tools.ts:2362` (66169a9a); ghi đĩa ở `apps/sheets/src/main/sheets-main.ts:1524,1570,3182` (66169a9a) |
| read_attachment | desktop (gated `attachments`; web tắt) | `{index, offset?}` → text trích của file đính kèm, phân trang | 24.000 ký tự/khúc (`files-skill.ts:12`) | không | `files-skill.ts:34`. Đọc file cục bộ người dùng đã đính kèm |
| merge_attached_workbooks | desktop (gated `mergeWorkbooks`; web tắt) | `{indexes?}` → nhập mọi sheet của file đính kèm (xlsx/xlsm/xls/csv/tsv) vào workbook đang mở | chỉ phần mở rộng bảng tính (`merge-skill.ts:14` (66169a9a)) | có (`mutated: true` từ G6-12; trước đó không khai báo → `undeclared`) | `merge-skill.ts:68` (66169a9a); công thức nguồn nhập thành giá trị. Kết quả báo `undoSteps` (đo độ sâu stack undo của đúng workbook trước/sau) và `mergePathsWithUndo` cộng vào nút [Undo] của tin nhắn trợ lý (test wiring `g6-12-merge-undo-wiring`). Nếu merge làm tràn stack Univer (20 mục/đơn vị, ví dụ nhiều độ cao dòng tùy chỉnh) thì `undoSteps` = `null`, đầu ra nói thẳng "không hoàn tác được, xóa các sheet mới" — không hứa sai (§9.2) |
| web_search | desktop luôn; web khi có grant `webSearch` + công tắc cloud | `{query, maxResults?}` → title/url/snippet (+ answer) | mặc định 6; web cắt query 400 ký tự, kết quả 1–10 (`web-ai.ts:677-679,576-577`) | không | `search-skill.ts:20`. Desktop: UniWork cloud nếu bật, nếu không chuỗi keyless Serper/DuckDuckGo (`packages/ai-search/src/search-tools.ts:4-5,36`; IPC `sheets-main.ts:3843-3853`) |
| image_search | desktop luôn; web khi có grant `imageSearch` | `{query, maxResults?}` → danh sách imageUrl + kích thước | mặc định 8 | không | `image-skill.ts:38`; `sheets-main.ts:3855-3864` |
| generate_image | desktop khi có model media BYOK hoặc cloud; web khi có grant `imageGeneration` | `{prompt, aspectRatio?}` → URL ảnh (web: `data:` URL) | web: prompt ≤4000 ký tự (`web-ai.ts:727`) | không (chỉ trả URL; chèn qua `add_image`) | `image-skill.ts:52`; gate `App.tsx:1424-1429` |
| summarize_range | cả hai | `{range, sheetId?, function?, valueColumn?, where[]?, groupBy?, hasHeader?, skipHiddenRows?, includeTotalRows?, maxGroups?}` → kết quả tổng/đếm/trung bình/min/max, có điều kiện và nhóm | tối đa 1.000.000 ô; `maxGroups` mặc định 50, tối đa 200; `where` toán tử `= <> > >= < <= contains not_contains blank not_blank` (tất cả phải đúng) | không (`mutated: false`; trong `VIEW_ONLY_TOOLS`) | **mới ở G6-12** (§9 dòng 21, 24). Tính bằng code (`ai/summarize.ts`), không bằng model; so sánh chữ không phân biệt hoa thường như SUMIFS; `> >= < <=` chỉ so số thật; ô chữ trông như số ("1.234,5"), ô trống, boolean, lỗi **bị bỏ và đếm theo lý do kèm ví dụ ô, không bao giờ ép kiểu**. Đầu ra nêu sheet/range, header, phép tính, bộ lọc, số dòng xử lý/khớp, dòng ẩn (gộp/bỏ), ô giá trị đã dùng, ô bị bỏ, ô công thức cache. Dòng **tổng/subtotal bị loại mặc định** (nhận bằng công thức SUBTOTAL/AGGREGATE, SUM khối ngay phía trên, hoặc nhãn "Total/Grand total/Subtotal/Tổng cộng/合计…"; `ai/total-rows.ts`) và được liệt kê; `includeTotalRows` gộp lại. Giữ lại kết quả (`NOT RECALCULATED`) khi giá trị cache có thể cũ |
| compare_ranges | cả hai | `{leftRange, leftKey, rightRange, rightKey, leftSheetId?, rightSheetId?, leftColumns?, rightColumns?, hasHeader?, tolerance?, skipHiddenRows?, includeTotalRows?, maxListed?}` → khóa khớp (giống/khác), chỉ có ở trái, chỉ có ở phải, chênh lệch từng ô | tối đa 1.000.000 ô mỗi phía; `maxListed` 1–200, mặc định 50; khóa và cột phải nằm trong range; range chỉ có header bị từ chối | không (`mutated: false`; trong `VIEW_ONLY_TOOLS`) | **mới ở G6-12** (§9 dòng 24). Chỉ đọc (`ai/reconcile.ts`). Khóa khớp sau khi cắt khoảng trắng, NFC, không phân biệt hoa thường; cột ghép theo header trùng nhau khi không chỉ định (không có header chung thì chỉ so khóa và nói rõ); số và cùng chữ số lưu dạng text là **khác biệt** ("number vs text"), không ép kiểu; chênh lệch số là `right − left`; coverage mỗi phía: dòng xử lý, khóa, khóa trống, khóa trùng (chỉ so dòng đầu, liệt kê các dòng còn lại), dòng ẩn, dòng tổng. Giữ lại so sánh khi cache có thể cũ |
| ask_clarification | cả hai | `questions[]` (≤ 4, mỗi câu ≤ 5 lựa chọn) → câu trả lời của người dùng | `inputSchema` giống từng byte html (kiểm bằng fixture ghim, không import chéo app); mô tả riêng sheets: xác nhận nghĩa cột / dòng nào / range đích trước khi tính hoặc ghi (ví dụ X/Y/Z) | không (`mutated: false`; trong `VIEW_ONLY_TOOLS`) | **mới ở G6-12** (§7, §9 dòng 25). Thẻ dock trong `AiChatPanel`, composer ẩn trong lúc thẻ mở (giữ bản nháp và tệp đính kèm); Bỏ qua/Dừng/Chat mới/đóng trả `cancelled`; lần gọi thứ hai thay thẻ đang mở (hủy thẻ cũ); panel **không đóng được** khi đang chờ câu hỏi và tự mở lại khi có câu hỏi (`ai/copilot-open.ts`); biên nhận trả lời dưới tin nhắn người dùng |

### 4.7 slides

Skill: `composeSkills('slides+files', …)` tại `apps/slides/src/renderer/ai/AiPanel.tsx:1399-1401` = slides skill + files skill.
Getter `tools` chỉ ẩn `generate_image`/`analyze_media` khi không có provider media và lọc theo `READ_ONLY_TOOLS` khi view-only
(`slides-skill.ts:1080-1085,1094-1102,1122-1127`). **Không có gate theo capability web** cho các công cụ khác: trên web nhiều công
cụ được khai báo cho model nhưng bridge trả "unavailable" (`web/modules/slides/web-slides-api.ts:1111-1135`).

| tool | host | vào → ra | giới hạn trong code | ghi editor | ghi chú |
| --- | --- | --- | --- | --- | --- |
| read_slide | cả hai | `{slideIndex}` → mọi phần tử của trang, full text, màu hex, hệ số px↔EMU | — | không | `slides-skill.ts:288` |
| execute_slide_script | cả hai | `{slideIndex, code, explanation?}` → kết quả script + audit layout | DSL đồng bộ trong interpreter riêng: `MAX_STEPS=25.000`, độ sâu 64, collection 10.000, regex 32M bước (`layout-script-interpreter.ts:15-17,49`); log ≤20.000 ký tự (`layout-script.ts:20-21`); một transaction, lỗi → rollback | có (`mutated: true`, `slides-skill.ts:1486`) | `slides-skill.ts:300`. Executor còn nhận bí danh ẩn `execute_layout_script` (`slides-skill.ts:1433`) — không khai báo cho model |
| web_search | desktop; web chỉ khi grant `webSearch` (không gate: thiếu grant → lỗi) | `{query, maxResults?}` → title/link/snippet | mặc định 6 | không | `slides-skill.ts:343,1491`; desktop `apps/slides/src/main/ai-ipc.ts` (chuỗi Serper/DDG/cloud như sheets) |
| image_search | như web_search (grant `imageSearch`) | `{query, maxResults?}` → imageUrl | mặc định 8 | không | `slides-skill.ts:356` |
| generate_image | desktop + web (gated `imageGenAvailable`: `cap('imageGeneration')` + provider, `AiPanel.tsx:1357-1359`) | `{prompt, model?, referenceImageUrls?, aspectRatio?, transparentBackground?}` → URL ảnh | web: ≤4 ảnh tham chiếu, chỉ `data:` URL (`web-ai.ts:563-566,731`) | không | `slides-skill.ts:369`. `model` mở các model cloud đặc biệt (xóa nền, upscale…) |
| analyze_media | desktop + web (gated `mediaAnalysisAvailable`) | `{mediaUrls[], requirements}` → văn bản phân tích | output cắt 6000 ký tự (`slides-skill.ts:1594`); desktop: đường dẫn cục bộ chỉ trong media roots của tài liệu + temp (`ai-ipc.ts:74-76,309-321`); web: ≤4 media `data:` (`web-ai.ts:741-748`) | không | `slides-skill.ts:404`. Gửi nội dung media cho provider BYOK hoặc cloud UniWork |
| insert_web_image | desktop; web **stub** (`insertImageUrl: async () => null`, `web-slides-api.ts:1121`) | `{slideIndex, url\|attachment://name, x,y,w,h}` → id phần tử mới | URL chỉ `http(s)`/`file` (`slides-skill.ts:1618`); main: SSRF guard + trần byte (`ai-ipc.ts:344-380`, `packages/electron-utils/src/remote-image.ts:11,83`) | có (`mutated: true`, `slides-skill.ts:1638`) | `slides-skill.ts:425` |
| replace_image | desktop; web stub (`web-slides-api.ts:1122`) | `{slideIndex, sourceId, url, keepCrop?}` → thay nguồn ảnh tại chỗ | như trên (`ai-ipc.ts:417-449`) | có (`slides-skill.ts:1687`) | `slides-skill.ts:447` |
| ask_clarification | cả hai | `{questions[2–4] {id,label,options≤5,multi?}}` → câu trả lời người dùng (card chờ) | 2–4 câu, ≤5 lựa chọn (mô tả schema) | không | `slides-skill.ts:462`; card `AiPanel.tsx:1033-1038`. **Công cụ hỏi người dùng** |
| plan_deck | cả hai | `{core_hook, style, pages[]}` → ghi kế hoạch vào state của skill | — | không | `slides-skill.ts:493,1731` |
| regenerate_slide | desktop; web **stub** (`landGeneratedPages`/`localGeneratePage` unavailable, `web-slides-api.ts:1127-1129`) | `{slideIndex, brief, title?, layout?, image_urls?, dataSource?}` → trang mới thay tại chỗ | — | có (`slides-skill.ts:1844` (66169a9a)) + **file** (desktop tự ghi nháp cho deck **cục bộ**, §5; deck gắn UniWork: không ghi nháp, từ G6-12) | `slides-skill.ts:547` (66169a9a). Gọi LLM nội bộ thêm (sinh trang local). Deck gắn UniWork: các trang AI vào editor, deck đánh dấu dirty (Lưu và hộp thoại đóng thấy chúng), `session.path` giữ nguyên, kết quả IPC `path: ''` (panel không đổi tên); ghi nháp thất bại ở deck cục bộ cũng trả `path: ''` và giữ dirty (§9 dòng 27) |
| generate_deck | desktop; web stub | `{topic?, approx_pages?, context?, core_hook?, style?, pages?, insert_mode?, style_template?, builtin_template?, dataSource?}` → deck mới / trang nối thêm | `approx_pages` ≤200 (`MAX_APPROX_PAGES`, `slides-skill.ts:33,600` (66169a9a)) | có (`slides-skill.ts:2535` (66169a9a)) + **file** (nháp `<Documents>/UniWork Office/*.pptx` và sidecar `.styleskill.json` cho deck **cục bộ**, §5; deck gắn UniWork: không nháp, không sidecar, từ G6-12) | `slides-skill.ts:582` (66169a9a). Nhiều lượt LLM nội bộ (style, outline, từng trang); cloud slide generation tắt cứng (`apps/slides/src/main/slides-main.ts:1032-1036` (66169a9a)) |
| save_style_template | desktop; web stub (`web-slides-api.ts:1133`) | `{name}` → lưu style + skeleton | tên ≤64 ký tự sau khi lọc (`ai-ipc.ts:520`) | file (`userData/style-templates/<name>.json`, `ai-ipc.ts:507-525`) | `slides-skill.ts:668` (66169a9a) (`mutated: false`). G6-12 không đổi: thư viện style là lưu trữ ưa thích cục bộ của người dùng (không chứa bản sao tài liệu: chỉ text Style Skill, `topic`, `createdAt`, khung layout), khuyến nghị coi không phải "ra ngoài tài liệu"; Product xác nhận (§9.2) |
| list_style_templates | desktop; web trả `[]` | `{}` → danh sách template | — | không | `slides-skill.ts:678` |
| edit_chart | cả hai | `{slideIndex, sourceId, kind?, categories?, series?, dataSource?, …}` → chart đã sửa | `series` cần `dataSource` | có (`slides-skill.ts:2571`) | `slides-skill.ts:684` |
| apply_ops | cả hai (engine `slides:apply-txn`, `web-slides-api.ts:999`) | `{ops[], dry_run?, isolation?}` → bản ghi op, id mới, audit layout | ≤ 50 op mỗi transaction, kiểm ở `apps/slides/src/session/apply-txn.ts:27-31` (mô tả `slides-skill.ts:757`) | có (`slides-skill.ts:2621`; dry run `mutated: false`) | `slides-skill.ts:741`. Atomic mặc định |
| load_guide | cả hai | `{groups[]}` → tài liệu op group | enum `OP_GROUPS` | không | `slides-skill.ts:770` |
| read_attachment | desktop (web: không có kho đính kèm) | `{index, offset?}` → text đính kèm | 24.000 ký tự/khúc (tương tự sheets) | không | `apps/slides/src/renderer/ai/files-skill.ts:38` |

### 4.8 pdf

Skill: `createPdfSkill` (`apps/pdf/src/renderer/ai/pdf-skill.ts:73-137` (66169a9a)), định nghĩa công cụ `AGENT_TOOLS`
(`apps/pdf/src/renderer/ai/tools.ts:246-1205` (66169a9a)). View-only/mã hóa → chỉ `READ_ONLY_TOOLS` (`pdf-skill.ts:48-58,81-89,124-133` (66169a9a));
`generate_image` ẩn khi không có provider (`pdf-skill.ts:86` (66169a9a)). Từ G6-12: `create_document` ẩn khi tài liệu gắn UniWork (vị từ
`uniworkBound()` lấy từ `uniwork.bound` có sẵn, không thêm IPC; thêm một câu ghi chú trong prompt để văn bản không hứa công cụ
này; bị gọi vẫn thì `isError`; `pdf-skill.ts`, 66169a9a), `generate_image` và `create_document` khai báo `mutated: false`, và
`ask_clarification` có mặt (bị bỏ ở tài liệu view-only, như html). Web: `ocr`, `insertPages` (tới khi có `filePick`) tắt (`web/modules/pdf/install.ts:43-64`); `imageGeneration` mặc định tắt
(`install.ts:55`) nhưng `installModuleBridge` gộp `aiHostGrants` trước `pdfGrants`, nên nó bật khi host cấp `ai` + `imageGeneration`
(`web/docs/bridge/module-bridge.ts:154-165` (66169a9a), `web/docs/bridge/hide.ts:88-96`, `web/modules/shared/ai/web-ai.ts:61-69` (66169a9a)); `pdfTextEdit`/`pdfImageEdit` tắt khi pdfium không chạy được
(`install.ts:109-110`) nhưng **các công cụ AI tương ứng không gate theo capability này** (chỉ `generate_image` có `cap()`,
`AiPanel.tsx:414` (66169a9a)). `createDocument` web là stub (`web/modules/pdf/webapi.ts:995`); `fetchImage` web là stub `null`
(`web/docs/bridge/ai.ts:121`, dùng ở `webapi.ts:1012`).

| tool | host | vào → ra | giới hạn trong code | ghi editor | ghi chú |
| --- | --- | --- | --- | --- | --- |
| read_pages | cả hai | `{start, end?}` → text theo `[Page N]` | ≤10 trang/lần (`tools.ts:1198`), ≤24.000 ký tự (`tools.ts:42,1230`); trang scan dùng OCR nếu có, có nhãn (`tools.ts:1224-1228`) | không | `tools.ts:230` |
| search_text | cả hai | `{query}` → trang + đoạn trích | ≤40 kết quả hiển thị | không | `tools.ts:246` |
| goto_page | cả hai | `{page}` → cuộn tới trang | — | không | `tools.ts:258` |
| markup_text | cả hai | `{page, text, type, all?, …}` → highlight/underline/strikeout | text phải nguyên văn trên trang | có | `tools.ts:267` |
| read_annotations | cả hai | `{start?, end?}` → luồng ghi chú + markup kèm id | — | không | `tools.ts:294` |
| add_note | cả hai | `{page, text, anchor_text?, x?, y?, color?}` → ghi chú mới (tác giả "AI Assistant") | — | có | `tools.ts:306` |
| reply_note | cả hai | `{page, note_id, text}` → trả lời | — | có | `tools.ts:329` |
| edit_note | cả hai | `{page, note_id, text}` → sửa nội dung ghi chú | — | có | `tools.ts:343` |
| delete_markup | cả hai (web: xóa annot đã lưu cần `pdfAnnotDelete`) | `{page, markup_ids?, kind?}` | bỏ ids = cả trang | có | `tools.ts:360` |
| delete_note | cả hai | `{page, note_id}` | — | có | `tools.ts:382` |
| edit_text | cả hai (cần pdfium; không gate) | `{page, old_text, new_text, occurrence?, font_size?, color?, font?, bold?, italic?}` | sửa tại chỗ, không reflow; font chỉ arial/times/courier | có | `tools.ts:395` |
| edit_block | cả hai (cần pdfium) | `{page, paragraph_text, new_text, …, align?}` → viết lại đoạn, reflow trong bề rộng | không đẩy nội dung khác | có | `tools.ts:432` |
| move_text_block | cả hai (cần pdfium) | `{page, paragraph_text, dx, dy}` | — | có | `tools.ts:476` |
| insert_text | cả hai (cần pdfium) | `{page, text, anchor_text?, placement?, x?, y?, font_size?, color?, max_width?, align?, font?, bold?, italic?}` → id `T…` | — | có | `tools.ts:498` |
| add_form_mark | cả hai | `{page, kind, anchor_text?, placement?, x?, y?, size?}` | — | có | `tools.ts:549` |
| list_inserted_text | cả hai | `{page?}` → khối text chưa lưu | — | không | `tools.ts:581` |
| edit_inserted_text | cả hai | `{id, text?, font_size?, color?, align?}` | — | có | `tools.ts:595` |
| move_inserted_text | cả hai | `{id, x?, y?, dx?, dy?}` | — | có | `tools.ts:615` |
| delete_inserted_text | cả hai | `{id}` | — | có | `tools.ts:631` |
| image_search | desktop; web khi grant `imageSearch` | `{query, max_results?}` → imageUrl | mặc định 8 | không | `tools.ts:643` |
| generate_image | desktop (provider); web khi có grant `imageGeneration` (+ công tắc cloud) (`web-ai.ts:61-69` (66169a9a), `module-bridge.ts:154-165` (66169a9a)) | `{prompt, aspectRatio?}` → URL | — | không (khai báo `mutated: false` từ G6-12; trước đó `undeclared`) | `tools.ts:674` (66169a9a); desktop IPC `apps/pdf/src/main/pdf-main.ts:1683-1690` |
| list_page_images | cả hai | `{page?}` → ảnh theo trang, số thứ tự | — | không | `tools.ts:676` |
| insert_image | desktop; web chỉ khi có cách tải (stub `fetchImage` → luôn lỗi) | `{page, url, anchor_text?, placement?, x?, y?, width?, layer?}` | một chỉnh sửa/ảnh/lần lưu (prompt) | có | `tools.ts:690`; tải ở `tools.ts:2811` → `App.tsx:5830-5831` → handler shell `ai:fetch-image` (`apps/docs/src/main/docs-main.ts:3949`, SSRF guard) |
| transform_image | cả hai (cần pdfium) | `{page, image, x?, y?, width?, height?, layer?}` | — | có | `tools.ts:733` |
| rotate_image | cả hai | `{page, image, direction?}` | — | có | `tools.ts:764` |
| replace_image | desktop; web stub tải ảnh | `{page, image, url}` | PNG/JPEG | có | `tools.ts:785`; tải `tools.ts:2995` |
| flip_image | cả hai | `{page, image, axis}` | — | có | `tools.ts:802` |
| set_image_opacity | cả hai | `{page, image, opacity}` | — | có | `tools.ts:824` |
| crop_image | cả hai | `{page, image, left/top/right/bottom 0–1}` | — | có | `tools.ts:845` |
| remove_image_background | cả hai | `{page, image, tolerance?}` | tolerance 0–100 | có | `tools.ts:877` |
| delete_image | cả hai | `{page, image}` | — | có | `tools.ts:897` |
| list_form_fields | cả hai | `{}` → tên/kiểu/lựa chọn field AcroForm | — | không | `tools.ts:913` |
| apply_ops | cả hai | `{ops[], dry_run?}` — `rotatePages`, `deletePage`, `setPageOrder`, `setFormValue`, `setMetadata`, `removeMarkup`, `removeTextInsert`, `setNoteContents` | **≤50 op** (`MAX_APPLY_OPS`, `tools.ts:3215,3245`); một transaction, một bước undo | có | `tools.ts:919` |
| insert_blank_page | cả hai (card xác nhận) | `{after_page}` | — | **file**: lưu mọi chỉnh sửa chờ rồi ghi lại file (desktop) / tạo version mới qua `api.save` (web) | `tools.ts:943`; xem §5(c) |
| set_page_size | cả hai (card) | `{size? \| width, height}` | — | file (như trên) | `tools.ts:959` |
| crop_pages | cả hai (card) | `{pages, left, top, right, bottom}` | — | file (như trên) | `tools.ts:976` |
| extract_pages | cả hai (card) | `{pages}` → file mới (desktop) / tải xuống (web) | — | file | `tools.ts:995`; web `webapi.ts:836` |
| split_pdf | cả hai (card) | `{pages_per_file}` → nhiều file / .zip | 1..số trang−1 | file | `tools.ts:1010`; web `webapi.ts:852` |
| split_pages | cả hai (card) | `{per_page: 2\|4\|9}` → file mới / tải xuống | — | file | `tools.ts:1025` |
| merge_pages | cả hai (card) | `{per_sheet 2–16, direction?, separator?}` → file mới / tải xuống | — | file | `tools.ts:1037` |
| replace_pages | desktop; web khi có `filePick` (không gate) | `{pages}` + bộ chọn file → ghi lại file | — | file | `tools.ts:1059` |
| get_outline | cả hai | `{}` → mục lục | — | không | `tools.ts:1074` |
| set_watermark | cả hai | `{text, angle?, opacity?, color?, size?}` | size 0,02–0,5 | có | `tools.ts:1080` |
| set_header_footer | cả hai | slot header/footer, `page_number?`, `start_at?`, `font_size?`, `color?` | — | có | `tools.ts:1108` |
| create_document | desktop; web **stub** (`webapi.ts:995`, công cụ vẫn khai báo) | `{type: pdf/docx/md/html, title, content}` → file mới | — | file (khai báo `mutated: false` từ G6-12; trước đó `undeclared`) | `tools.ts:1186` (66169a9a); `App.tsx:5850` (66169a9a); main `apps/pdf/src/main/pdf-main.ts:1047`. **Ẩn khi tài liệu gắn UniWork** từ G6-12 (§5 pdf (c), §9 dòng 31); tài liệu cục bộ giữ cũ |
| ask_clarification | cả hai | `questions[]` (≤ 4, mỗi câu ≤ 5 lựa chọn) → câu trả lời của người dùng | `inputSchema` giống từng byte html (hash `7b1327af…`); mô tả riêng pdf: nghĩa/phạm vi/đích trước khi sửa | không (`mutated: false`) | **mới ở G6-12** (§7, §9 dòng 25; `tools.ts:3693` (66169a9a) gọi `askClarificationTool`). Thẻ + hook `use-clarify.ts`; Bỏ qua/Dừng (abort signal)/Chat mới/đổi tài liệu/đóng panel trả `cancelled`; biên nhận dưới tin nhắn người dùng, bỏ khi mở tài liệu khác hoặc khi nạp lại lịch sử. Thẻ đang chờ bị bỏ khi lưu lần đầu một PDF trống (đường dẫn đổi từ rỗng sang có; giống thẻ xác nhận cấp file có sẵn; ghi nhận, §9.2) |

## 5. Kiểm an toàn (spec §6.3)

Bốn kiểm: (a) chạy macro/VBA/DDE/script; (b) tải URL từ nội dung tài liệu hoặc từ công cụ; (c) ghi ra ngoài tài liệu đang
mở; (d) gọi API UniWork bằng quyền khác phiên người dùng. Kết luận: **đạt** / **vi phạm** (blocker → G6-12, §9) / **n/a**.
Cột kết luận ghi tình trạng tại `66169a9a` (sau G6-12): "đã sửa ở G6-12" nghĩa là vi phạm của G6-01 đã được xử lý và nêu commit
+ test; "chờ Product" nghĩa là code giữ nguyên (§9.1). "Với tài liệu gắn UniWork" = công cụ tự ẩn dựa trên trạng thái `bound` sẵn có
của từng app; tài liệu cục bộ giữ hành vi cũ. Phân biệt theo nhà cung cấp UniWork AI (MCP/skills tắt, cloud chỉ khi `office.ai_cloud`)
chưa làm: là predicate `provider = uniwork` do G6-05 sở hữu (§9 dòng 35).

| module | kiểm | kết luận | bằng chứng và lý do |
| --- | --- | --- | --- |
| agent-core | (a)–(d) | n/a | Không công cụ; vòng lặp không tải URL, không ghi file, không gọi API (`packages/agent-core/src/loop.ts`, `skill.ts`). |
| docs | (a) | **đạt** (đã sửa ở G6-12) | Không có thực thi macro/VBA (không đọc `vbaProject`). Phát hiện G6-01: `insertField` của `apply_ops` dùng danh sách chặn (`field-ops.ts:21-33` (0d03b185)), mọi từ khóa `^[A-Za-z]+$` khác qua được, gồm `DDE`, `DDEAUTO`, `LINK`, `IMPORT`, `DATABASE`, và `updateFields scope:"all"` đánh dấu `dirty` cả trường DDE/INCLUDETEXT có sẵn. Sửa: `ALLOWED` (danh sách cho phép, `field-ops.ts:35` (66169a9a)) — `insertField` từ chối mọi từ khóa ngoài danh sách (không phân biệt hoa thường; DDE, DDEAUTO, LINK, IMPORT, INCLUDE*, DATABASE, MACROBUTTON, ASK, FILLIN, AUTOTEXT, từ khóa lạ), và `updateFields scope:"all"` chỉ đánh dấu `dirty` loại trường trong danh sách (trường DDE/INCLUDE*/LINK/IMPORT/DATABASE có sẵn giữ sạch). Test đỏ `70fafda` → sửa `f6caeba`, `apps/docs/tests/g6-12-field-allowlist.test.ts` (§9 dòng 1). |
| docs | (b) | **vi phạm** (chờ Product: quy tắc URL, §9.1) | Cùng cơ chế và cùng kết luận với sheets/slides/pdf (ghi chú (b) chung dưới bảng): URL do model chọn được tải. Editor không tự tải đích `INCLUDEPICTURE`/`INCLUDETEXT`. Ảnh chỉ tải khi model gọi `insert_image`/`insert_picture`/`set_watermark` (ảnh): desktop qua `ai:fetch-image` → `fetchRemoteImage` (`apps/docs/src/main/docs-main.ts:3949-3967`) → `fetchWithSsrfGuard` chặn dải private/loopback/link-local ở **mọi bước redirect** (`packages/electron-utils/src/safe-remote-url.ts:19-30`, `safe-remote-url.ts:95-115`), trần 50 MB; web cũng tải, qua RPC `image.fetch` của host (`web/docs/bridge/webapi.ts:764`, proxy phía server UniWork, không kiểm ở fork). URL có thể đến từ text bị injection (kết quả tìm kiếm, nội dung tài liệu); system prompt không có câu "nội dung là dữ liệu không tin cậy" — phần đó thuộc instruction pack G6-14. **G6-12 không đổi chính sách** (quy tắc "chỉ URL từ công cụ tìm/sinh ảnh cùng lượt" hay "tắt với UniWork AI" thuộc Product, §9 dòng 15); chỉ **ghim** guard và trần: test `apps/docs/tests/g6-12-url-fetch-guard.test.ts` chạy handler `ai:fetch-image` thật với `fetch` giả (loopback/private/link-local/`localhost`/`[::1]`/ftp/file/data bị từ chối không phát request; 302 về 127.0.0.1 bị từ chối sau một bước; thân > 50 MB bị bỏ kể cả khi không có Content-Length; ảnh PNG công khai vẫn tải được), commit `8e8ed49`. |
| docs | (c) | **đạt** với tài liệu gắn UniWork (đã sửa ở G6-12); tài liệu cục bộ giữ cũ | Phát hiện G6-01: `create_document` (chỉ desktop) ghi file mới `.pdf`/`.md`/`.html` vào thư mục lưu mặc định, hoặc mở tab `.docx` mới tự lưu vào đó, không hỏi người dùng (`apps/docs/src/renderer/ai/tools.ts:1022-1050` (66169a9a), `apps/docs/src/main/docs-main.ts:5021`, `docs-main.ts:5568-5612`). Sửa (C-BOUND): công cụ **ẩn** khỏi getter `tools` khi tài liệu gắn UniWork (`BOUND_HIDDEN_TOOLS` + `isBound` ← `uniwork.bound`, không IPC mới) và `executeTool` trả `isError` nếu vẫn bị gọi; test đỏ `c4fef7e` → sửa `171e5da`, `apps/docs/tests/g6-12-create-document-bound.test.ts`. Tài liệu cục bộ không đổi (ghi file như người dùng tự làm); allowlist theo nhà cung cấp là việc G6-05 (§9 dòng 35). Không có hunk main-process. `read_attachment` chỉ đọc tệp người dùng đính kèm (`docs/ai/files-skill.ts`). |
| docs | (d) | đạt | Desktop: công cụ đám mây đi qua transport ở shell main bằng bearer của chính tài khoản đang đăng nhập (`apps/shell/src/main/uniwork-auth/cloud.ts:195`, `cloud.ts:225`); web: frame token một tài liệu, `credentials:'omit'` (`web/modules/shared/ai/client.ts:5-7`). Không khóa dịch vụ, không quyền cao hơn phiên. |
| markdown | (a) | đạt | Markdown không có macro/script; prompt cấm sinh HTML thô (`md/ai/markdown-skill.ts`, "Never emit raw HTML"). Cách render khối HTML thô/mermaid chưa được kiểm trong lane này. |
| markdown | (b) | **vi phạm** (desktop; chờ Product: quy tắc URL, §9.1) | Như docs: chỉ `insert_image`/`generate_image` tải ảnh, chỉ `^https?://`, PNG/JPG/GIF, qua cùng `fetchRemoteImage` (`md/ai/tools.ts:389` (66169a9a)); link trong tài liệu không bị công cụ tải. Web: `fetchImage` là stub `null` nên không tải gì (`web/modules/markdown/webapi.ts:135` (66169a9a)) → đạt trên web (và từ G6-12 hai công cụ còn bị ẩn trên web, §9 dòng 11). Chính sách không đổi; guard được **ghim** bằng `apps/markdown/tests/g6-12-url-fetch-guard.test.ts` (file/data/ftp/javascript/path bị từ chối trước khi gọi bridge; kênh `ai:fetch-image` dùng handler có guard dùng chung ở docs-main; `readRemoteImage` của markdown-main dùng `fetchRemoteImage` + `readBodyCapped`, không `fetch` thô), commit `c939a37`. |
| markdown | (c) | đạt (ghi chú) | `insert_image`/`generate_image` ghi file ảnh vào thư mục assets **của chính tài liệu** (`apps/markdown/src/main/markdown-main.ts:913-920`; đường dẫn tài liệu lấy từ main, không từ renderer), giống khi người dùng dán ảnh (`apps/markdown/src/renderer/editor/localImage.ts:153`). Assets là một phần tài liệu Markdown (§6.5), nhưng file được ghi **ngay lúc gọi công cụ**, trước khi Lưu, và undo/rollback không xóa nó — xem §6. |
| markdown | (d) | đạt | Như docs. |
| html | (a) | đạt trên web; desktop **đã giao CSP ở G6-09** (nghiệm thu chờ card G6-09); làm sạch HTML do AI viết để sau | Script trong trang chạy trong preview iframe `sandbox="allow-scripts allow-forms allow-popups allow-modals"`, không `allow-same-origin` → không chạm được app (`apps/html/src/renderer/preview/PreviewFrame.tsx:178`). Web: `preview.html` có CSP riêng `connect-src 'none'`, `form-action 'none'` và iframe `credentialless` (`web/docs/build/modules.ts:121-127`). Desktop: giao thức `html-preview://` từng trả về không kèm CSP (`apps/html/src/main/preview-protocol.ts:45`) → script trong trang (kể cả script AI vừa viết qua `apply_ops`/`write_document`, vốn không được làm sạch) được dùng mạng, có thể gửi nội dung trang ra ngoài. **Đã giao ở G6-09** (nhánh `feature/UNI-1374-g6-09-ai-edit-undo`, commit `76f493780`): mọi phản hồi `html-preview://` nay mang `PREVIEW_CONTENT_SECURITY_POLICY` (`preview-protocol.ts:38-52`), cùng bộ directive với chính sách preview của web (`web/docs/build/modules.ts`, `documents` `/preview.html`), hai khác biệt: sáu danh sách nguồn (`script-src`, `style-src`, `img-src`, `font-src`, `media-src`, `base-uri`) được thêm `html-asset:` — tài nguyên tương đối của desktop đi qua `html-asset://`, bản web không cần; và header của web khai thêm directive `sandbox` (bốn cờ đó ở desktop nằm trên iframe, `PreviewFrame.tsx:178`). Nghiệm thu chờ card G6-09. Còn lại: handler `html-asset://` (`html-main.ts:1243`) chưa gửi CSP; làm sạch HTML do AI viết để sau (§9 dòng 10). |
| html | (b) | đạt (ghi chú) | Không công cụ AI nào của html tải URL (không có `insert_image`). `fetchImage` của main (`apps/html/src/main/html-main.ts:1651`) chỉ `^https?:` + `fetchRemoteImage`, dùng cho thao tác UI; web là stub `null` (`web/modules/html/webapi.ts:156`). Tài nguyên trang do preview tải là phần (a). |
| html | (c) | đạt | `apply_ops`/`plan_page`/`write_document` chỉ đổi bộ đệm editor (`apps/html/src/renderer/App.tsx:480-520`). Tham chiếu `attachment://` được thay bằng ảnh trong `assets/` của tài liệu hoặc `data:` (`html/ai/tools.ts:397`, `tools.ts:486`). |
| html | (d) | đạt | Như docs. |
| sheets | (a) | **đạt** (đã xác minh WEBSERVICE) | không có đường thực thi VBA/DDE; xlsm chỉ là phần mở rộng được nhận (`merge-skill.ts:14` (66169a9a)), không có interpreter macro. `WEBSERVICE`/`FILTERXML`: G6-01 chưa xác minh; G6-12 xác minh bằng test chạy engine thật. **Desktop:** Univer `@univerjs/engine-formula` 0.25.1 không có executor cho hai hàm (`FUNCTION_NAMES_WEB` chỉ có `ENCODEURL` được hiện thực); `=WEBSERVICE(…)`, `=FILTERXML(…)` và dạng lồng đều ra `#NAME?`; `IFERROR` cho giá trị dự phòng; `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` bị giả để ghi lại và **không cái nào được gọi**; đối chứng `ENCODEURL` cho `a%20b` nên engine đang chạy (`apps/sheets/tests/g6-12-webservice-engine.test.ts`, commit `ab10f4a`). Fallback IronCalc của desktop (`ironcalc 0.7.1`): đọc mã nguồn, không có hiện thực hai hàm và không có crate HTTP/mạng. **Web:** engine WASM xlsx (IronCalc) nạp qua `EngineHost` thật, `recalc_cells` cho `#NAME?` ở cả ba dạng, `IFERROR` cho dự phòng, đối chứng `3-ok`; module chỉ import `wasi_snapshot_preview1`, **không import `sock_*`** nên không thể mở socket; crate `ironcalc_base` 0.7.1 không có `webservice`/`filterxml`; test KHÔNG bị bỏ qua trong vòng cloud (7/7, `web/modules/sheets/g6-12-webservice-web-engine.test.ts`, commit `05f5aef7`; cần build WASM trước, test dùng `describe.skipIf(!wasmAvailable)`). Kết luận: **không có phát hiện §6.3 (b) ở cả desktop lẫn web**; Advisor đã chấp nhận. Công cụ AI gọi tên hai hàm này là "unsupported function" (§4.6). |
| sheets | (b) | **vi phạm** (phần URL, chờ Product); phần đường dẫn cục bộ đã sửa ở G6-12 | op `add_image` của `propose_operations` tải URL do model đưa: desktop main `ai:fetch-image` (SSRF guard, ≤20 MB; nối ở `apps/sheets/src/main/sheets-main.ts:3866-3868` (66169a9a), thân và trần ở `apps/sheets/src/main/ai-fetch-image.ts:12-38` (66169a9a); trước G6-12 cả hai nằm trong `sheets-main.ts:3866-3880,1638` (0d03b185)), web qua proxy host `image.fetch` (`web/modules/sheets/bridge.ts:868-878`); URL có thể đến từ nội dung tài liệu/kết quả tìm kiếm (prompt injection). Chính sách URL chưa đổi (§9 dòng 16, 15); guard + trần 20 MB được **ghim** bằng `apps/sheets/tests/g6-12-fetch-image-guard.test.ts` (loopback/10.x/192.168.x/169.254.169.254/`[::1]`/`localhost`/`file:///etc/passwd`/`ftp:` bị từ chối không phát request; redirect công khai → 127.0.0.1 bị từ chối sau một bước; Content-Length > 20 MB bị từ chối; thân chunked không có độ dài dừng ngay sau trần; PNG nhỏ công khai trả về), thân handler chuyển nguyên văn vào `apps/sheets/src/main/ai-fetch-image.ts` để test được (hunk main-process duy nhất, không chạm đường mở/lưu). Đường không-URL đọc file ảnh cục bộ theo đường dẫn tuyệt đối model đưa (`op-executor.ts:208-211` → `sheets-main.ts:2985-3000` (66169a9a), chỉ desktop): với workbook gắn UniWork `propose_operations` từ chối **cả lô** nếu `add_image` có đường dẫn không phải `http(s)://`, `data:image/`, `file://` và không phải đúng đường dẫn một tệp đính kèm; `file://` đã được BE reviewer xác nhận chỉ mở trong kho ảnh sinh ra của main (FE F2 bị bác); test đỏ `547cce1` → sửa `d41e840`, `apps/sheets/tests/g6-12-add-image-guard.test.ts`. Workbook cục bộ không đổi. |
| sheets | (c) | **đạt** với workbook gắn UniWork (đã sửa ở G6-12); desktop cục bộ giữ cũ | `create_document` ghi file mới vào thư mục lưu mặc định (`tools.ts:727` (66169a9a), `sheets-main.ts:1570,3182` (66169a9a)). Sửa: ẩn khỏi getter `tools` và khỏi prompt khi workbook gắn UniWork (`workbookFile.uniworkBound`, không IPC mới; đọc lại trước mỗi request) và `isError` nếu vẫn bị gọi; test đỏ `07ba87e` → sửa `e1d6143`, `apps/sheets/tests/g6-12-create-document-bound.test.ts`. Web: **pass** (`createDocument:false`, `web/modules/sheets/capabilities.ts:32`; stub `bridge.ts:820`). Autosave sau lượt AI chỉ với file cục bộ, tắt với tài liệu UniWork (`App.tsx:639-641,3577-3594` (66169a9a)) → pass cho tài liệu UniWork. |
| sheets | (d) | **đạt** | công cụ cloud desktop dùng bearer của phiên người dùng ở main (`apps/shell/src/main/uniwork-auth/index.ts:210,263`; `packages/ai-provider/src/uniwork-cloud.ts:6-12`); web dùng frame token (`web/modules/shared/ai/web-ai.ts:9-15,207-219`). Chuỗi keyless (DuckDuckGo) không chạm API UniWork |
| slides | (a) | **đạt** | `execute_slide_script` chạy trong interpreter DSL riêng, không `eval`, không global (`slides-skill.ts:306,317`; `layout-script-interpreter.ts:15-49`); không có đường chạy macro pptm |
| slides | (b) | **vi phạm** (chờ Product: quy tắc URL, §9.1) | `insert_web_image`/`replace_image` tải URL do model đưa (desktop main, SSRF guard + trần, `apps/slides/src/main/ai-ipc.ts:344-380,417-449`); `generate_deck`/`regenerate_slide` tải `image_urls` trong pipeline local (`slides-main.ts:1127` (66169a9a)); `analyze_media` nhận URL/đường dẫn cục bộ (trong media roots của tài liệu, `ai-ipc.ts:74-76,309-321`) và gửi cho provider. Web: tải ảnh là stub → pass trên web. Chính sách không đổi (§9 dòng 26); guard + trần byte được **ghim** bằng `apps/slides/tests/g6-12-url-fetch-guard.test.ts` (41 ca với handler main thật và `fetch` giả; kiểm đột biến: thay `fetchRemoteImage` bằng `fetch` thô làm 10 ca đỏ), commit `7cdbd6f`. `analyze_media` chỉ đọc media roots của chính deck: FE review xác nhận, không đổi. |
| slides | (c) | **đạt** với deck gắn UniWork (đã sửa ở G6-12); deck cục bộ giữ cũ | Phát hiện G6-01: `generate_deck`/`regenerate_slide` tự ghi nháp `<Documents>/UniWork Office/<name>.pptx` và chuyển `session.path` sang nháp (`apps/slides/src/main/slides-main.ts:780-810,1222,1274,1320,1350` (0d03b185)), không kiểm `uniworkIsBound` → deck UniWork bị tách thành file cục bộ. Sửa: ở cả bốn kiểu hạ cánh (`append`, `replace_at`, `insert_at`, `replace`) deck gắn UniWork không ghi file nào dưới `<Documents>/UniWork Office`, file gắn không bị đụng, `session.path` giữ nguyên (kiểu `replace` mang đường dẫn sang deck mới), deck đánh dấu dirty, kết quả IPC `path: ''`, không có sidecar `.styleskill.json`; undo giữ nguyên. Hunk main-process chỉ ở đường AI hạ cánh của `slides-main.ts` (`draftLandedPages` ở `slides-main.ts:776` (66169a9a), `saveDraftAfterGenerate` ở `slides-main.ts:818` (66169a9a); vị trí các điểm gọi cũ chỉ còn ở 0d03b185, như trên), không chạm mở/lưu; lý do đặt ở main: việc ghi nháp và đổi đường dẫn nằm trong handler `slides:land-generated-pages`, renderer không thể bảo handler bỏ qua nếu không thêm tham số vào preload (ngoài phạm vi). Phần renderer: sidecar bị bỏ qua khi `DeckAccess.uniworkBound()`. Test đỏ `f160e77` → sửa `e5079d8`; vòng sửa BE: ghi nháp thất bại ở deck cục bộ trả `path: ''` và giữ dirty (`b6f2c357` đỏ → `6a48a186`), test wiring `AiPanel` → `createSlidesSkill` + nguồn `App.tsx` (`bf9d9c0f`), Lưu rõ ràng sau khi hạ cánh ghi đúng các trang (không có lỗi sản phẩm). `save_style_template` ghi `userData/style-templates` (`ai-ipc.ts:507-525`): không đổi, xem §4.7 và §9.2. Web: pass (stub, `web-slides-api.ts:1127-1135`). Còn một bản recovery trong `userData/slides-autosave` do tick 30 giây ghi cho deck gắn còn dirty (§9.2). |
| slides | (d) | **đạt** | như sheets; cloud slide generation tắt cứng (`slides-main.ts:997-1001`) |
| pdf | (a) | **đạt** | pdf.js mở không bật scripting: `getDocument({data, password, ...DOC_OPTS})` (`apps/pdf/src/renderer/App.tsx:1045-1049`, `view-config.ts:33-38`), không có `PDFScriptingManager`/`enableScripting` trong renderer (grep). Link ngoài mở qua main `shell.openExternal` khi người dùng bấm (`LinkLayer.tsx:47`), không phải do công cụ |
| pdf | (b) | **vi phạm** (desktop; chờ Product: quy tắc URL, §9.1) | `insert_image`/`replace_image` tải URL do model đưa qua `ai:fetch-image` (`tools.ts:2908,3092` (66169a9a) → `App.tsx:5831` (66169a9a) → `apps/docs/src/main/docs-main.ts:3949`, SSRF guard). Web: pass (`fetchImage` stub null, `web/docs/bridge/ai.ts:121`). Chính sách không đổi (§9 dòng 32); guard + trần được **ghim** bằng `apps/pdf/tests/g6-12-pdf-fetch-guard.test.ts` (28 ca; nới lỏng cổng scheme của `insert_image` làm 6 ca đỏ), commit `de305c1`. |
| pdf | (c) | **vi phạm** (một phần đã sửa; phần còn lại chờ Product, đợt 3) | `insert_blank_page`/`set_page_size`/`crop_pages`/`replace_pages` lưu chỉnh sửa chờ rồi ghi lại file (`App.tsx:5254-5261` (66169a9a); mô tả `pdf-skill.ts:32-37` (66169a9a)); **trên web tạo version mới qua `api.save`** (`web/modules/pdf/webapi.ts:17-19,472-487,760-785`) — trái §6.4 "một lượt AI không tạo upload/version". `extract_pages`/`split_pdf`/`split_pages`/`merge_pages` ghi file mới (desktop) / tải xuống (web). Có card xác nhận người dùng (`tools.ts:1768-1775` (66169a9a)) — giảm nhẹ, không thay quy tắc. **Đã sửa ở G6-12:** `create_document` ẩn khi tài liệu gắn UniWork (`pdf-skill.ts` + `uniworkBound()` ← `uniwork.bound`; bị gọi vẫn thì `isError`); test đỏ `0abfd42` → sửa `5616a23`, `apps/pdf/tests/g6-12-pdf-bound.test.ts`. **Chưa đổi, chờ Product (đợt 3):** các công cụ pdf cấp file (kể cả tạo version qua `api.save` trên web); khuyến nghị (b) bỏ chúng khỏi tài liệu gắn UniWork ở v1, chưa làm trước khi người dùng ký (§9 dòng 30, 31). |
| pdf | (d) | **đạt** | như sheets |

Ghi chú (b) chung: SSRF guard (`fetchRemoteImage`, `packages/electron-utils/src/remote-image.ts:83`) chặn scheme khác http(s) và
địa chỉ private/link-local, kiểm từng redirect, có trần byte. Đó là giảm nhẹ; quy tắc spec "không tự tải URL" vẫn bị vi phạm khi
URL do model/nội dung tài liệu quyết định, nên ghi blocker để G6-12 quyết (vd chỉ cho URL đến từ `image_search`/`generate_image`
cùng lượt, hoặc tắt với nhà cung cấp UniWork AI). **Kết quả G6-12:** quyết định này thuộc Product (§9.1), nên G6-12 không đổi chính
sách; nó ghim guard và trần hiện có bằng test ở docs, markdown, sheets, slides và pdf (đường dẫn test ở các hàng trên) và không nới
bất kỳ guard nào. Hàng (b) của mỗi module vì vậy vẫn **vi phạm — chờ Product (đợt 3)**.

Kiểm thêm theo spec §6.2: **công cụ đám mây** (`web_search`, `image_search`, `generate_image`, `analyze_media`) gửi query/prompt/ảnh
ra dịch vụ ngoài và tốn credit; chúng đi theo `office.ai_cloud` của tổ chức, không theo allowlist editor.

### 5.1 Sheets: công thức do engine tính hay model

- Công thức ghi bằng `propose_operations` (`set_formula`, `fill_range`, …) được **engine** tính: Univer formula engine trong renderer;
  web dùng xlsx WASM (IronCalc) trong worker cho lưu/recalc (`web/modules/sheets/engine/engine.worker.ts`,
  `web/modules/sheets/engine/stale-values.ts:1-30`); desktop có IronCalc recalc fallback (cap `recalcFallback`, tắt trên web).
  Công cụ đọc lại kết quả tính (≤10 ô, sau 300 ms) và báo lỗi `#REF!`… (`tools.ts:2276-2338` (66169a9a)).
- Thống kê (`aggregate_range`) do JS tính trên giá trị ô (`aggregate.ts:33-70`), không phải model.
- **Không có gì ép** model dùng công thức/aggregate thay vì `set_cell` một số tự nhẩm — chỉ có prompt (`prompts/base.md`). Ghi vào §9. Ở `66169a9a` vẫn đúng: G6-12 thêm công cụ đọc có điều kiện/nhóm (`summarize_range`)
  nhưng không ép; `prompts/base.md` dòng 42 vẫn bảo model viết ô COUNTIFS tạm cho đếm nhiều điều kiện — lời prompt thuộc instruction pack
  G6-14, nên chỉ model về `summarize_range`, quy ước `NOT RECALCULATED` và `[type; raw; format]` (§9.2).
- **Formula cache vs recalc:** chế độ lazy/streaming đọc giá trị từ file (giá trị cache `<v>`) cho vùng engine chưa nạp
  (`tools.ts:87-90,912-922` (66169a9a)); ở bản G6-01 đầu ra `read_range`/`read_cells`/`find_cells` **không đánh dấu** ô nào là cache, ô nào vừa recalc.
  Khi lưu, web làm mới hoặc xóa `<v>` cũ (`stale-values.ts:1-30`) và gateway đặt `fullCalcOnLoad`. Đã sửa ở G6-12 (§9 dòng 22): đầu ra công cụ đọc ghi nguồn giá trị công thức — engine, cache từ file ("cached value from the file — not
  recalculated by this app"), hoặc cache có thể cũ (`NOT RECALCULATED (=công thức)` ở `read_cells`/`read_range`; `find_cells` chưa đổi, vẫn trả giá trị công thức gần nhất; giá trị đã lưu chỉ nằm trong ghi chú "có thể cũ,
  không được đưa làm đáp án"); `aggregate_range`, `summarize_range`, `compare_ranges` giữ kết quả khi dùng cache có thể cũ. Kiểm
  "cũ": mọi sửa đầu vào trong phiên (giá trị ô, fill, thao tác cấu trúc, defined name, xóa sheet) đánh dấu mọi giá trị cache là có thể
  cũ — bảo thủ, chưa kiểm phụ thuộc từng ô. Chính sách "giữ lại" thay vì "hiện kèm cảnh báo" cần Product xác nhận (§9.2).

## 6. Hiển thị và hoàn tác thay đổi AI (spec §6.4)

| module | thay đổi hiện ra thế nào | hoàn tác | một bước undo mỗi lượt? | kết luận §6.5 |
| --- | --- | --- | --- | --- |
| docs | **Theo dõi thay đổi AI tắt mặc định**: bật chỉ khi `localStorage['ai-docs-track-changes'] === '1'` (`docs/ai/AiPanel.tsx:177` (66169a9a), `AiPanel.tsx:426-428` (66169a9a)). Bật: `insert_content`, `write_document`, `replace_blocks`, `replace_selection`, `apply_ops` ghi revision tác giả AI, duyệt ở tab Review (`docs/ai/protocol.ts:1202-1357`, `docs/ai/ops.ts:1495-1509`). **Từ G6-09 (W1):** khi tắt theo dõi, highlight `ai-changed` **không còn bị chấp nhận trong cùng tick** — dấu vùng sửa giữ tới khi người dùng bấm **Accept** (nút cạnh "View changes" của lượt sửa gần nhất) hoặc **Lưu**; autosave giữ dấu, lượt sau chỉ đánh dấu phần của chính lượt đó; dấu không vào bytes đã lưu, không vào Export as HTML, chỉ trên màn hình (print/PDF không tô) (`apps/docs/tests/ai-edit-marker.test.ts`, `html-export.test.ts`). Biểu đồ, ảnh nổi, text box, chú thích, comment, header/footer, page setup, style, watermark không bao giờ được theo dõi. Thẻ edit queue (`docs/ai/edit-queue.ts`, `EditQueueCard.tsx`) là hàng đợi **chỉ dẫn trước khi gửi** (≤ 10 mục, ≤ 500 ký tự; `edit-queue.ts:14-16`), không hiển thị kết quả. **Từ G6-09 (W8):** lượt AI trên tài liệu chưa đặt tên hỏi trước khi lưu (thẻ lưu nháp dùng chung: **Lưu** = lưu lần đầu theo tên gợi ý, **Để sau** = không ghi gì) (`apps/docs/tests/ai-save-offer.test.ts`). | Nút Roll back của mỗi run: snapshot cây `editor.getJSON()` (từ G6-12 qua `captureRunSnapshot`, kèm trạng thái ngoài cây) trước công cụ `mutated` đầu tiên (`AiPanel.tsx:843` (66169a9a), `AiPanel.tsx:855-857` (66169a9a), `AiPanel.tsx:1263-1271` (66169a9a)). **Sửa ở G6-12 (§9 dòng 5):** năm công cụ khai báo `mutated: true` nên có snapshot kể cả khi run chỉ gọi chúng; `AiRunSnapshot {doc, side}` (`run-snapshot.ts`) chụp cả comment, header/footer (và biến thể, section edits), page setup/sections, style tạm, watermark và Roll back trả lại cùng cây ProseMirror (kể cả `sections` của `insert_section_break`, trước đó lệch). **Giới hạn:** người dùng lưu hoặc tải lại file giữa lượt thì rollback chỉ trả cây, phần ngoài cây giữ như file đã lưu (style đã ghi vào styles.xml không xóa được; phát lại bảng style/header/page setup chờ trước khi lưu lên file đã parse lại là sai), **Từ G6-09 (W3):** Roll back sau khi người dùng Lưu giữa lượt hiện thông báo `role="status"` nêu đúng các phần không trả lại được (comment, đầu trang/chân trang, style, page setup, watermark) — panel không còn im lặng; test `apps/docs/tests/g6-12-side-state-rollback.test.ts`, `ai-rollback-after-save.test.ts`. | **Có (từ G6-09 W2).** `createDocsRunHistoryGroup` gom mọi thay đổi của lượt vào **một** bước lịch sử ProseMirror (thay đổi đầu mang `closeHistory`, các thay đổi sau mang meta `appendedTransaction`); lượt không sửa gì không để lại bước, lượt kết thúc bằng lỗi vẫn chỉ một bước; gõ, undo và redo bị giữ trong lúc lượt mở (RFA-3; view không editable, Stop kết thúc lượt); bản nháp `write_document` vẫn ngoài lịch sử (`docs/ai/doc-writer.ts:180`). **Giới hạn:** phần ngoài cây (đầu trang/chân trang, style, page setup, watermark, comment) không nằm trong lịch sử ProseMirror — Ctrl+Z trả phần văn bản, Roll back trả cả hai khi lượt không bị Lưu giữa chừng (`apps/docs/tests/ai-run-undo.test.ts`). | **Đạt** cho hàng DOCX sửa: dấu vùng sửa giữ tới Accept hoặc Lưu; một bước undo mỗi lượt; Roll back nêu phần không trả lại được sau khi Lưu giữa lượt. Giới hạn (không blocker): Ctrl+Z chỉ phủ cây văn bản. |
| markdown | Highlight các khoảng do giao dịch `OP_META.source === 'ai'` đổi (`apps/markdown/src/renderer/editor/aiHighlight.ts`); edit queue như docs (`md/ai/edit-queue.ts:15-17`). Không có mô tả thay đổi dạng diff. **Từ G6-09 (W4 + fix r1):** dấu `ai-changed` giữ tới khi người dùng **Lưu** (autosave giữ) hoặc lượt kế tiếp; không vào bytes đã lưu, bị gỡ trong print/PDF/ảnh (`apps/markdown/tests/g6-09-md-ai-highlight-keep.test.ts`). | Roll back theo run (snapshot thân + frontmatter, `md/ai/AiPanel.tsx:452` (66169a9a)). **Từ G6-09 (N5):** Roll back bỏ ảnh mà lượt đã ghi vào assets — chỉ tên còn `pending` của chính tài liệu; ảnh đã Lưu hoặc do người dùng chèn ở lại (`apps/markdown/tests/g6-09-ai-asset-rollback.test.ts`). | **Có (từ G6-09 W4).** `AiRunHistory` (tiptap) nhóm mọi sửa AI của lượt thành **một** bước; frontmatter đi theo bằng `AiRunStep`; undo của lượt gọi cùng `discardPictures` như Roll back; redo của lượt có ảnh đã bị bỏ **bị từ chối**; người dùng gõ giữa lượt thì lượt tách bước (lịch sử tuần tự, chữ của người dùng không mất) (`apps/markdown/tests/g6-09-md-run-undo.test.ts`). Từ G6-12 `apply_ops` của AI **nguyên tử** (§9 dòng 8): lô hỏng được hoàn tác ngoài lịch sử nên undo không bao giờ áp lại một nửa lô. | **Đạt** (blocker cũ hết): dấu vùng sửa + một bước undo mỗi lượt. Giới hạn: redo của lượt ảnh bị từ chối; undo một Roll back là bước riêng. |
| html | Highlight khoảng AI sửa trong editor mã nguồn (`apps/html/src/renderer/source/SourceEditor.tsx:129`, `SourceEditor.tsx:146`), bị xóa khi người dùng gõ; thẻ brief/clarify/partial trong panel; preview nháp khi stream trang. Không có diff, không hiện trên preview. | Roll back theo run (snapshot `{text}`); Ctrl+Z của CodeMirror (`apps/html/src/renderer/source/cm-setup.ts:83`). | **Có (từ G6-09 W5).** CodeMirror: `history({joinToEvent: aiRunEdit})` + `isolateHistory` — mọi sửa của lượt gộp **một** event, người dùng gõ giữa lượt tách lượt, di chuyển caret không tách; undo đi qua `onChange` nên preview theo (`apps/html/tests/g6-09-html-run-undo.test.ts`). `plan_page`/`write_document` thay cả tài liệu trong một bước. | **Đạt** cho undo (blocker cũ hết): một bước mỗi lượt ở mã nguồn. Giữ nguyên (chấp nhận "theo khả năng từng module"): không có dấu vùng sửa ở preview. |
| sheets | Thay đổi áp ngay vào lưới (không bước xem trước; card preview chỉ là fallback khi apply lỗi, `App.tsx:3579-3610`, `AiChatPanel.tsx:673-680`). Panel hiện "AI đã áp dụng N thay đổi" + nút [Undo] trên tin nhắn trợ lý (`AiChatPanel.tsx:649-666`). Không tô vùng đã sửa; trước G6-09 không liệt kê range/ô bị ghi đè cho người dùng (before→after chỉ đi vào tool output cho model, `tools.ts:787-808`). **Từ G6-09 (W6):** tin nhắn đã áp hiện thêm dòng `Range: A1:B3 · Cells with data overwritten: 4` — ô có dữ liệu hoặc công thức bị ghi đè, chỉ tính lần chạm đầu; fill/copy chỉ liệt kê range nên số là "at least N"; 0 hiện rõ "No existing data overwritten" (`apps/sheets/tests/ai-apply-footprint*.test.ts`). | Nút [Undo] gọi `handleUndo(steps)` (`App.tsx:3819-3845`) và ⌘Z | **Có**: `undoSteps` cộng dồn mọi batch của cùng một tin nhắn trợ lý (`App.tsx:3597-3605,3681-3684`) → một nút hoàn tác cả lượt. Batch quá ngân sách undo → `undoSteps 0`, không có nút (`AiChatPanel.tsx:654-657`); apply lỗi giữa chừng có thể không hoàn tác được (`tools.ts:1374-1379`) | **Đạt** (blocker hàng XLSX-sửa hết): hiển thị + undo theo lượt; target range + số ô bị ghi đè hiện trên tin nhắn đã áp (G6-09 W6, đã ký (b)). Giới hạn: fill/copy chỉ là lower bound; footprint sống cùng phiên chat như nút [Undo] |
| slides | Thay đổi áp ngay lên deck; panel có chip công cụ, card tiến độ khi sinh deck; hàng đợi chỉnh sửa theo phần tử (`EditQueueCard.tsx`, `edit-queue.ts:1-12`, ≤10 mục, ≤500 ký tự, `edit-queue.ts:35-37`) | ⌘Z (lịch sử main process) + nút rollback trên tin nhắn (`AiPanel.tsx:2338-2345`, `aiSnapshotRestore` `AiPanel.tsx:776-791`); web qua engine (`web-slides-api.ts:996-1000`) | **Có**: `beginHistoryBatch` trước mỗi lượt, `endHistoryBatch` sau (`AiPanel.tsx:1717,767-775`); hàng đợi chỉnh sửa: một batch mỗi trang (`AiPanel.tsx:1777-1781,1871-1891`). G6-09 (W9) **ghim** bằng test chạy các handler main thật: một lượt = một bước, lượt chỉ đọc 0 bước, redo trả lại cả lượt (`apps/slides/tests/ai-run-one-undo.test.ts`) | **Đạt** (không tô vùng sửa; chấp nhận theo "theo khả năng từng module"); một bước undo mỗi lượt được ghim bởi test |
| pdf | Mọi chỉnh sửa (trừ thao tác cấp file) ở trạng thái chờ, vẽ trên trang (markup, khối text `T…`, sửa text/ảnh); tóm tắt chờ đi vào context (`App.tsx:5537-5549`); chip công cụ trong panel. Thao tác cấp file có card xác nhận (`AiPanel.tsx:297-317`); **từ G6-09 (fix r1):** sửa tay bị **tạm dừng** trong lúc lượt mở (toast `role="status"`, công cụ AI đi qua `asAi`) | ⌘Z: `pushUndo` chụp snapshot trước mỗi thay đổi, stack 50 (`App.tsx:1822-1828,1986`); `apply_ops` = một bước | **Có (từ G6-09 W7).** `EditHistory` gộp cả lượt thành **một** entry (chỉ khi `mutated` và có khác biệt); ⌘Z, redo và ribbon bị giữ trong lúc lượt mở; nút **Undo this run** dưới câu trả lời (aria-disabled kèm lý do khi có thay đổi nằm trên; "Run undone" sau khi hoàn tác, redo làm nút sẵn lại); lượt dài không còn đẩy mất bước trước lượt; save-reload xóa cả hai stack. Thao tác cấp file **không hoàn tác được** (`tools.ts:1716-1717`; thuộc §5 (c)) (`apps/pdf/tests/g6-09-pdf-run-undo-history.test.ts`, `g6-09-pdf-run-undo-panel.test.ts`) | **Đạt** cho sửa trong tài liệu: hiển thị (chờ áp + chip + tạm dừng sửa tay) + một bước undo mỗi lượt + nút Undo this run. Thao tác cấp file vẫn không hoàn tác → giữ ở §5 (c) (chính sách (b) đã ký, §9.1) |
| agent-core | Cung cấp `snapshotBefore` cho rollback (`packages/agent-core/src/loop.ts:13-21`); không có khái niệm nhóm undo. **Từ G6-09 (W0):** móc `onRunStart(runId)` / `onRunEnd(runId, {mutated, outcome})` + `runHistoryEvents`/`RunHistoryGroup` (`packages/agent-core/src/run-history.ts`) cho editor nhóm lịch sử; lượt bị Stop giữa công cụ tính `mutated=true`. | — | — | Móc "bắt đầu/kết thúc lượt" đã giao ở G6-09 (W0); khái niệm nhóm undo vẫn ở editor. |

**Sau G6-09 (UNI-1374), W11 cập nhật §6.** Các kết luận **blocker** ở bảng trên đã đóng: docs/markdown/html có một bước undo mỗi lượt;
dấu vùng sửa của docs giữ tới Accept hoặc Lưu (autosave giữ), của markdown giữ tới Lưu hoặc lượt kế; Roll back của docs nêu phần không
trả lại được sau khi Lưu giữa lượt, của markdown bỏ ảnh của lượt; sheets hiện target range + số ô bị ghi đè trên tin nhắn đã áp (đã ký
(b)); slides ghim một bước undo mỗi lượt bằng test; pdf gộp undo theo lượt + nút "Undo this run" + tạm dừng sửa tay khi lượt mở;
docs/markdown/html/pdf hỏi trước khi lưu tài liệu chưa đặt tên sau lượt (sheets không ghi ngầm nên không cần). **Giới hạn còn lại (không
blocker):** Ctrl+Z của docs/markdown chỉ phủ cây văn bản (phần ngoài cây do Roll back khi lượt không bị Lưu giữa chừng); redo của lượt
markdown có ảnh bị từ chối; html không có dấu vùng sửa ở preview; thao tác cấp file của pdf không hoàn tác (giữ ở §5 (c)). G6-12 vẫn
sở hữu phần công cụ: `apply_ops` markdown nguyên tử, rollback docs trả lại cả trạng thái ngoài cây, merge sheets có [Undo] và
`mutated: true`, rào vùng sửa (markdown, html).

## 7. Công cụ hỏi lại người dùng

| module | có không | chi tiết |
| --- | --- | --- |
| agent-core | không | Vòng lặp không có công cụ hỏi lại; một skill tự thêm nếu cần. |
| docs | **có** (từ G6-12): `ask_clarification` | `apps/docs/src/renderer/ai/tools.ts:110` (66169a9a) (định nghĩa), `executeTool` nhánh `ask_clarification` ngay trong file (66169a9a); thẻ `components/ClarifyCard.tsx` gắn vào ô composer của `AiPanel`, composer ẩn trong lúc thẻ mở. Chặn run tới khi người dùng trả lời; Bỏ qua, Dừng, Chat mới và đóng panel trả `cancelled`. Chỉ có khi panel có thẻ hỏi; nằm trong `READ_ONLY_TOOLS` (view-only giữ). Biên nhận trả lời gắn vào tin nhắn người dùng của lượt (`clarify-receipts.ts`; chat bị cắt ở 60 mục nên không dùng chỉ số), bỏ khi mở tài liệu khác hoặc khi nạp lại lịch sử, xóa khi Chat mới; tồn tại luật prompt cũ cho luồng comment (`docs/ai/protocol.ts:133`). Test `apps/docs/tests/g6-12-ask-clarification.test.ts`, `g6-12-clarify-receipts.test.ts`. |
| markdown | **có** (từ G6-12): `ask_clarification` | `md/ai/tools.ts:149` (66169a9a), thẻ `components/ClarifyCard.tsx` trong `AiPanel`; cùng hành vi như docs (chặn run, `cancelled` khi Bỏ qua/Dừng/Chat mới/đóng, biên nhận, view-only giữ); chỉ có khi panel có thẻ hỏi. Cột cơ học §3 ghi `yes` cho `editor_write` (§3.1 nhóm C) — code khai báo `mutated: false`. Test `apps/markdown/tests/g6-12-ask-clarification.test.ts`, `g6-12-clarify-receipts.test.ts`. |
| html | **có**: `ask_clarification` | `html/ai/tools.ts:324` (định nghĩa), `tools.ts:772` (thực thi). Hiện thẻ 1–4 câu, mỗi câu ≤ 5 lựa chọn, thẻ tự thêm "để AI quyết" và ô "khác"; **chặn run** tới khi người dùng trả lời (`html/ai/AiPanel.tsx:682-684`); bỏ qua/dừng/chat mới trả `cancelled` (`AiPanel.tsx:808`, `AiPanel.tsx:993`). Dùng trước khi tạo trang mới; `intentSkill` tắt nó khi ý định là "viết nội dung". |
| sheets | **có** (từ G6-12): `ask_clarification` | `apps/sheets/src/renderer/ai/tools.ts` (cuối `WORKBOOK_TOOLS`, nhánh `executeWorkbookTool`), thẻ `ai/ClarifyCard.tsx` dock trong `AiChatPanel`, trạng thái ở `App` (`aiClarify` + resolver) qua `ExcelShell`. Mô tả nhắm vào "xác nhận nghĩa cột / dòng / range đích trước khi tính hoặc ghi" (ví dụ nghiệm thu X/Y/Z). Chặn run; `cancelled` khi Bỏ qua/Dừng/Chat mới/đóng; lần gọi thứ hai hủy thẻ đang mở; panel không đóng được khi đang chờ câu hỏi (`copilot-open.ts`); nằm trong `VIEW_ONLY_TOOLS`. Test `apps/sheets/tests/g6-12-ask-clarification.test.ts`, `g6-12-clarify-panel-open.test.ts`, `g6-12-clarify-receipts.test.ts`. |
| slides | **có**: `ask_clarification` (card câu hỏi, chờ trả lời; `cancelled` khi người dùng bỏ) | `slides-skill.ts:462,1692`; `AiPanel.tsx:1033-1038` |
| pdf | **có** (từ G6-12): `ask_clarification` | `apps/pdf/src/renderer/ai/tools.ts` (`askClarificationTool`, `tools.ts:2825` (66169a9a); gọi ở `:3693` (66169a9a)), thẻ `ai/ClarifyCard.tsx` + hook `ai/use-clarify.ts` trong `AiPanel`. Chặn run bằng promise đậu tới khi trả lời; `cancelled` khi Bỏ qua, Dừng (abort signal), Chat mới, đổi tài liệu, đóng panel; biên nhận dưới tin nhắn người dùng, bỏ khi mở tài liệu khác hoặc nạp lại lịch sử. View-only/mã hóa bỏ công cụ (như html). `confirmFileOp` vẫn chỉ là card xác nhận có/không cho thao tác cấp file, không phải câu hỏi mở (`tools.ts:192,1768` (66169a9a); `AiPanel.tsx:301-323` (66169a9a)); prose của `pdf-skill.ts:41` (66169a9a) còn bảo "hỏi gộp một câu" bằng văn bản (lời prompt thuộc G6-14). Test `apps/pdf/tests/g6-12-pdf-ask.test.ts`, `g6-12-clarify-receipts.test.ts`. |

Chip "Cần làm rõ" của G6-14 có một tín hiệu xác định ở **cả sáu module có công cụ**: docs, markdown, html, sheets, slides, pdf đều
có công cụ tên `ask_clarification` (§3 có sáu dòng cùng tên; bốn dòng mới có cùng `input_schema_sha256` `7b1327af…` với html; slides
giữ schema riêng `c85e7168…`). `agent-core` vẫn không có. Ba điểm G6-14 cần biết: (1) công cụ chỉ có khi panel có thẻ hỏi, nên "có
công cụ" không đồng nghĩa mọi lượt hỏi được; (2) kết quả trả cho model có ba dạng, cùng định dạng chữ với html
(chỉ câu dặn tiếp theo khác giữa các module, vì html nhắc `plan_page`): đã trả lời → `User answers:\n<câu trả lời>\nNow continue with the request following these answers.`;
người dùng bỏ qua (Bỏ qua, Dừng, Chat mới, đóng; nội bộ là `cancelled`) → "The user skipped the questionnaire. Decide sensible defaults yourself and continue.";
panel không có thẻ → lỗi (`isError`) kèm câu của html; (3) mọi
đường trả về khai báo `mutated: false` (riêng markdown: cột cơ học `yes`, §3.1 nhóm C).

## 8. Đối chiếu ma trận tác vụ (spec §6.5)

Mỗi ô: công cụ dùng được (tên ở cột `tool` §3), hoặc `missing: <thiếu gì>`. Hàng XLSX, PPTX, PDF tách theo điểm con ở §8.1.

| hàng | đọc / phân tích | sửa trong editor (xem, hoàn tác, rồi Lưu) |
| --- | --- | --- |
| XLSX | xem §8.1 | xem §8.1 (áp ngay; tin nhắn hiện target range + số ô bị ghi đè từ G6-09) |
| DOCX | Hỏi/tóm tắt: `get_document_context` + `read_blocks` (phân trang). Trích có anchor: chỉ số block từ hai công cụ trên; `read_comments`, `read_notes` trả block neo và text neo; `read_revisions` cho tracked change. Ảnh trong tài liệu: `analyze_media` (cần model media). So sánh/giải thích: `read_revisions`, `read_attachment` cho tệp thứ hai; `missing: công cụ so sánh hai tài liệu` (model tự so trong context). | Viết lại/rút gọn/dịch đoạn chọn: `replace_selection` (trong một block), `replace_blocks` (nhiều block, kể cả bảng — giữ độ rộng, viền, ô không đổi), `apply_ops` (nguyên tử, `dryRun`). Giữ bảng và phần không sửa: công cụ chỉ đổi khoảng được chỉ, kế thừa định dạng. dấu vùng sửa giữ tới Accept hoặc Lưu (G6-09; theo dõi thay đổi vẫn tắt mặc định, tùy chọn), một bước undo mỗi lượt (đã giao ở G6-09), `missing: rào code giới hạn sửa trong vùng chọn` (chỉ prompt; G6-12 làm rào cho markdown và html, **chưa cho docs**), `missing: tôn trọng bảo vệ Word` (§4.2; chờ Product, dòng 6). Hỏi lại khi chưa rõ: `ask_clarification` (từ G6-12, §7). |
| PPTX | xem §8.1 | xem §8.1 |
| PDF có text layer | xem §8.1 | xem §8.1 |
| Markdown | Hỏi/tóm tắt theo heading/source range: `get_document_context` (nhãn `h1`–`h6` trong khung), `read_blocks` (theo chỉ số block), `read_frontmatter`. `missing: tra theo tên heading hoặc theo khoảng ký tự nguồn` (chỉ có chỉ số block). | Sửa vùng chọn: `apply_ops` (vùng chọn báo trong context là "block N..M"), `write_document` với `afterIndex`. Giữ frontmatter: chỉ op `setFrontmatter` ghi nó. Giữ link/assets ngoài vùng: từ G6-12 có **rào code** khi lượt có phạm vi (chip vùng chọn hoặc hàng đợi sửa; đơn vị là block, §4.3): block ngoài rào phải giống hệt từng byte, vi phạm thì hoàn tác cả lô; không rào khi lượt không có phạm vi. `apply_ops` của AI nay **nguyên tử** (§9 dòng 8). Một bước undo mỗi lượt (đã giao ở G6-09; undo của lượt cũng bỏ ảnh của lượt đó). Hỏi lại khi chưa rõ: `ask_clarification`. Ảnh: `insert_image`/`generate_image` chỉ desktop (ẩn trên web). |
| HTML | Hỏi/tóm tắt nội dung: `get_outline`, `read_source` (theo `sid` hoặc dòng), `read_attachment` (desktop). `missing: trích văn bản thuần` (model đọc mã nguồn HTML). | Sửa text/DOM target: `apply_ops` (`set_text`, `set_attr`, `set_style`, `replace_element`, `insert_html`, `remove`, `move`, `str_replace`; nguyên tử, ≤ 40 op), mặc định nhắm phần tử đang chọn. `missing: làm sạch HTML do AI viết` (script, `on*=`, `javascript:`), CSP preview desktop **đã giao ở G6-09** (nhánh `feature/UNI-1374-g6-09-ai-edit-undo`, commit `76f493780`; cùng bộ directive với preview web, khác hai điểm ở §5 html (a); nghiệm thu chờ card G6-09), một bước undo mỗi lượt (đã giao ở G6-09). Từ G6-12 có **rào code** theo `sid` cho Ask AI trên phần tử và hàng đợi sửa (§4.4): patch ngoài phần tử được rào bị từ chối cả lô, và `plan_page`/`write_document` bị từ chối khi có rào; gửi thẳng từ composer khi có phần tử chọn chưa rào (chờ Product, §9.1). `plan_page`/`write_document` thay cả trang — không nằm trong hàng "sửa target", nên ra khỏi allowlist khi lượt chỉ là sửa. |

### 8.1 XLSX, PPTX, PDF theo điểm con

| hàng / điểm con §6.5 | công cụ | thiếu |
| --- | --- | --- |
| XLSX đọc/phân tích: tổng/count/average | `aggregate_range` (sum/avg/min/max/count/distinct, tùy chọn `skipHiddenRows`), `summarize_range` (có điều kiện + nhóm), `read_range`, `get_workbook_context` (extent) | `aggregate_range` vẫn không lọc theo điều kiện (đó là việc của `summarize_range`); không dò hàng tổng trong `aggregate_range` (chỉ `summarize_range`, `compare_ranges`) — đạt từ G6-12 cho tổng/đếm/trung bình có phạm vi rõ |
| XLSX: điều kiện, nhóm | `summarize_range` (chỉ đọc: `where[]` + `groupBy` + coverage; §4.6), `propose_operations` (công thức SUMIFS/COUNTIFS, `add_pivot`), `find_cells` | Đạt từ G6-12 (§9 dòng 21). Distinct-count bằng công thức vẫn bị từ chối (`tools.ts:321` (66169a9a)); nhiều điều kiện chỉ AND |
| XLSX: đối chiếu sheet | `compare_ranges` (chỉ đọc: khớp theo khóa, chênh lệch từng ô, chỉ-trái/chỉ-phải, coverage; §4.6), `read_range`/`read_cells`/`aggregate_range` với `sheetId`, `find_cells` toàn workbook | Đạt từ G6-12 (§9 dòng 24) |
| XLSX: giải thích công thức | `trace_precedents`, `trace_dependents`, `read_cells` (công thức + giá trị) | Defined name không mở rộng (`tools.ts:461,479`) |
| XLSX: phát hiện bất thường | `find_cells errors_only`, `aggregate_range` (min/max/top values), `summarize_range` (đếm ô bị bỏ theo lý do: chữ giống số, trống, boolean, lỗi — kèm ví dụ ô) | `missing: thống kê ngoại lai/kiểu không đồng nhất trong cột` (còn lại; ô bị bỏ theo lý do của `summarize_range` chỉ là một phần) |
| XLSX sửa: công thức/giá trị/cột dẫn xuất trong range | `propose_operations` (`set_formula`, `set_range`, `fill_range`, `copy_range`, `convert_to_values`) | Áp ngay, không xem trước (§6) |
| XLSX: nhãn cột X/Y/Z vs địa chỉ | `read_range` in header chữ cột A,B,…; selection kèm tên header cột (`tools.ts:711-724` (66169a9a)); `ask_clarification` để xác nhận nghĩa cột khi chưa rõ (từ G6-12, §9 dòng 25) | Không có công cụ ánh xạ tên header → địa chỉ cột; model tự suy từ hàng header, hoặc hỏi người dùng |
| XLSX: sheet id/range resolved | Mọi công cụ nhận `sheetId` (kiểm hợp lệ, `tools.ts:581-598`); `propose_operations` bắt buộc id từ `get_workbook_context` | Đạt |
| XLSX: kiểu/locale/percent (10 vs 10%) | `read_formats` (number format), `read_range`, `read_cells` (từ G6-12 in `[type; raw …; format …]` khi chuỗi hiển thị một mình dễ gây hiểu nhầm: `10% [percent; raw 0.1; format 0%]`, `10 [text]`), `summarize_range` | Đạt từ G6-12 (§9 dòng 19): demo và lazy dùng cùng hình `CellRead`; `summarize_range`/`aggregate_range` không ép chữ "1.234,5" thành số — bỏ và đếm theo lý do. Còn: `read_range` giữ lưới nguyên, kiểu/raw chỉ ở danh sách dưới lưới (≤ 200 dòng) |
| XLSX: dòng ẩn/lọc | `read_sheet_features` (AutoFilter, hidden), `read_range` (nhãn `(hidden)`/`(filtered out)` + dòng đếm), `aggregate_range`/`summarize_range`/`compare_ranges` (`skipHiddenRows`, luôn nêu số dòng ẩn và đã gộp hay bỏ) | Đạt từ G6-12 (§9 dòng 20). Mặc định **gộp** dòng ẩn như SUM (không bỏ im lặng); Product có thể đổi sang mặc định bỏ (một dòng `hiddenMode` ở `tools.ts`, §9.2). Còn một biên: dòng ẩn từ file nằm trong bộ lọc đã gỡ trong phiên vẫn tính là ẩn ở aggregate lazy |
| XLSX: hàng tổng/subtotal | `summarize_range`, `compare_ranges` (dò bằng SUBTOTAL/AGGREGATE, SUM khối phía trên, nhãn Total/Subtotal/Tổng cộng/合计…; **loại mặc định** và liệt kê; `includeTotalRows` gộp lại; `ai/total-rows.ts`) | Đạt từ G6-12 (§9 dòng 24) cho hai công cụ này; `aggregate_range` không dò (tổng thô như SUM; có thể thêm sau). "Tổng công ty" là tên, không là nhãn tổng |
| XLSX: recalc vs cache | `propose_operations` đọc lại sau recalc; lưu web làm mới/xóa `<v>`; công cụ đọc ghi nguồn giá trị: engine / cache từ file / `NOT RECALCULATED` (§5.1) | Đạt từ G6-12 (§9 dòng 22); `find_cells` chưa đổi (vẫn giá trị công thức gần nhất); kiểm cũ bảo thủ (mọi sửa đầu vào trong phiên làm mọi cache là "có thể cũ") |
| XLSX: coverage counts | `aggregate_range` (cells/nonEmpty/numericCount, số dòng ẩn), `summarize_range`/`compare_ranges` (dòng xử lý/khớp, ô bị bỏ theo lý do, khóa trống/trùng), `read_cells` báo khi cắt quá 100 địa chỉ (số đã hỏi, đã đọc, chưa đọc, địa chỉ đầu tiên chưa đọc) | Đạt từ G6-12 (§9 dòng 23): không còn cắt im lặng; `read_range` vẫn báo extent |
| XLSX: target range + số ô bị ghi đè trước Lưu | Tin nhắn đã áp hiện `Range: A1:B3 · Cells with data overwritten: N` (G6-09 W6): ô bị ghi đè = ô có dữ liệu hoặc công thức, chỉ tính lần chạm đầu; fill/copy chỉ liệt kê range nên số là "at least N"; 0 hiện rõ "No existing data overwritten" (`apps/sheets/tests/ai-apply-footprint*.test.ts`) | **Đạt**: đã ký (b) và giao ở G6-09 |
| XLSX: workbook vượt giới hạn frame web | `xlsxEngine` cap + màn "mở bằng app" (`apps/sheets/src/renderer/capabilities.ts`, `web/modules/sheets/capabilities.ts:50`) | Đạt (GO-C4) |
| PPTX đọc/tóm tắt theo slide/text shape | `read_slide`, outline trong context (`slides-skill.ts:1128-1131`) | Đạt |
| PPTX sửa/dịch text shape | `execute_slide_script` (`setText`), `apply_ops` (`setText`) | Đạt; `generate_deck`/`regenerate_slide` vượt phạm vi §6.5 ("không hứa tạo layout toàn deck"); vi phạm (c) trên desktop đã sửa cho deck gắn UniWork ở G6-12 (§5 slides (c)), deck cục bộ giữ cũ |
| PDF có text layer: hỏi/tóm tắt với anchor | `read_pages`, `search_text`, `goto_page`, link `pdfnav://page/N` (`pdf-skill.ts:44`) | Trang scan: OCR chỉ desktop (`ocr` tắt trên web), output có nhãn OCR — đạt "không giả có text" |
| PDF text patch | `edit_text`, `edit_block`, `move_text_block`, `insert_text` | Font thay thế chỉ arial/times/courier (`tools.ts:439,477,556` (66169a9a)); trên web cần pdfium — công cụ không gate theo `pdfTextEdit` → `missing: ẩn công cụ sửa text khi pdfium không có` (→ G6-05/G6-03a, §9 dòng 34) |

## 9. Công cụ còn thiếu → G6-12 (tình trạng sau G6-12)

Mỗi dòng: module — cần gì — vì sao — hàng ma trận / kiểm an toàn. Dòng nào cũng kết thúc bằng **Trạng thái** ở `66169a9a`:
**Đã sửa (G6-12)** kèm commit đỏ → commit sửa và test (SHA là commit của nhánh module đã gộp vào nhánh tích hợp; hợp nhất không viết lại
SHA); **→ chủ mới** kèm lý do một dòng; **Chờ Product (đợt 3)** = code giữ nguyên tới khi người dùng ký; **guard đã ghim** = test chỉ khóa
guard hiện có, không đổi chính sách. Test nằm ở `apps/<module>/tests/` (trừ khi ghi khác). Vòng cloud của từng nhánh chạy các test này ở SHA nền (phải đỏ) và ở
đầu nhánh (phải xanh); báo cáo ở `reports/g6-fork_tools/g6-12/cloud-test-*.md`.


1. docs — `insertField` theo **danh sách cho phép** (bỏ `DDE`, `DDEAUTO`, `LINK`, `IMPORT`, `DATABASE`…), và `updateFields` không
   đánh dấu `dirty` trường DDE/INCLUDE có sẵn — chèn DDE qua prompt injection — §5 docs (a).
   **Đã sửa (G6-12).** Danh sách cho phép thay danh sách chặn; `updateFields` giữ sạch trường DDE/INCLUDE*/LINK/IMPORT/DATABASE có sẵn (§5 docs (a)). Test đỏ `70fafda` → sửa `f6caeba`; `apps/docs/tests/g6-12-field-allowlist.test.ts` (16 ca, 12 đỏ trên nền).

2. docs — `create_document` ra khỏi tập công cụ khi nhà cung cấp là UniWork AI (hoặc hỏi người dùng trước khi ghi) — ghi file
   ngoài tài liệu đang mở — §5 docs (c).
   **Đã sửa (G6-12).** Công cụ ẩn khi tài liệu gắn UniWork, bị gọi vẫn thì `isError` (§5 docs (c)). Test đỏ `c4fef7e` → sửa `171e5da`; `apps/docs/tests/g6-12-create-document-bound.test.ts`. Phần còn lại: "hỏi người dùng trước khi ghi" không làm: với UniWork AI công cụ ra khỏi tập; phân biệt theo nhà cung cấp → G6-05 (dòng 35).

3. docs — dấu vùng sửa AI bật mặc định trong lượt UniWork AI (theo dõi thay đổi hoặc highlight còn tới khi Lưu) — thay đổi phải
   thấy được trước khi Lưu — DOCX sửa, spec §6.4.
   **→ G6-09** (chủ mới). Dấu vùng sửa mặc định và theo dõi thay đổi cần móc "bắt đầu/kết thúc lượt" của vòng agent cùng phần hiển thị trong panel mà G6-09 làm; G6-12 chỉ sửa công cụ nên không đụng. Chưa sửa ở G6-12.

4. docs, markdown, html — một bước undo mỗi lượt AI (nhóm lịch sử ProseMirror/CodeMirror theo run) — G6-09 — DOCX, Markdown,
   HTML sửa.
   **→ G6-09** (chủ mới). Nhóm lịch sử ProseMirror/CodeMirror theo run cần cùng móc "bắt đầu/kết thúc lượt" với dòng 3. Chưa sửa ở G6-12; phần liên quan đã làm: `apply_ops` markdown nguyên tử (dòng 8) để undo không bao giờ áp lại nửa lô.

5. docs — khai báo `mutated:true` cho `resolve_comment`, `set_header_footer`, `define_style`, `set_page_setup`, `set_watermark`,
   và rollback trả lại style/page setup/header-footer/watermark — rollback và cột cơ học `editor_write` đúng sự thật — DOCX sửa.
   **Đã sửa (G6-12).** Năm công cụ khai báo `mutated: true`; rollback trả lại cả trạng thái ngoài cây (§6). Test đỏ `6b1fa01` → sửa `d32bd40`; `apps/docs/tests/g6-12-mutated-flags.test.ts`, `g6-12-side-state-rollback.test.ts`. Giới hạn đã chấp nhận (rollback qua một lần lưu giữa lượt chỉ trả cây) → §9.2.

6. docs — truyền bảo vệ Word (chỉ đọc/form/comment/khóa ghi) vào `isReadOnly` của skill — AI không được sửa thứ người dùng không
   sửa được — DOCX sửa.
   **Chờ Product (đợt 3)** — bảo vệ Word có phải chặn công cụ AI không (§9.1). Code chưa đổi.

7. docs, markdown — công cụ hỏi lại người dùng (như `ask_clarification` của html) — chip "Cần làm rõ" xác định được (G6-14) —
   mọi hàng.
   **Đã sửa (G6-12).** docs: test đỏ `3de57a3` → sửa `f793b83`; markdown: `188b913` → `7e1bf4c` (`apps/docs/tests/g6-12-ask-clarification.test.ts`, `apps/markdown/tests/g6-12-ask-clarification.test.ts`; thẻ + 21 ngôn ngữ; §7). Biên nhận trả lời: WC docs/markdown `d80498ed` → `cffdeb66`, `a3e1fb61` → `e87b3819`. Sheets và pdf: dòng 25.

8. markdown — `apply_ops` nguyên tử như docs/html — một lượt hỏng không để lại nửa thay đổi — Markdown sửa.
   **Đã sửa (G6-12).** `apply_ops` của AI nguyên tử, lô UI giữ cũ (§4.3). Test đỏ `7b5b6285` → sửa `35164d10`; `apps/markdown/tests/g6-12-md-atomic-ops.test.ts`.

9. markdown, html — rào code giới hạn sửa trong vùng chọn/target khi lượt là "sửa vùng chọn" — giữ phần ngoài vùng — Markdown,
   HTML sửa.
   **Đã sửa (G6-12) cho markdown và html** (§4.3, §4.4); docs chưa có rào (không thuộc dòng này, còn `missing` ở §8). markdown: đỏ `3bf95c80` → sửa `f220f8e1`; html: đỏ `ca1e50ca` → sửa `bb18f47e`. Vòng sửa thử lại: `96a28bdc` → `c5b076bf`, `244c9677`; `3377276a` → `223c0cc6`; mục khôi phục `549a1b6d` → `6d07a0ec`. Tests `apps/markdown/tests/g6-12-md-edit-fence.test.ts`, `apps/html/tests/g6-12-html-edit-fence.test.ts`.

10. html — làm sạch HTML do AI viết hoặc CSP cho preview desktop — script AI viết có mạng trên desktop — §5 html (a); cần quyết
    định Product.
   **CSP đã giao ở G6-09** (nhánh `feature/UNI-1374-g6-09-ai-edit-undo`, commit `76f493780`; nghiệm thu chờ card G6-09). **Làm sạch HTML do AI viết để sau** (§9.1). Còn lại: handler `html-asset://` chưa gửi CSP.

11. markdown, html — `insert_image` (markdown) và `read_attachment` (html) trên web — hiện là stub luôn lỗi; hoặc ẩn khỏi tập công
    cụ web để model không gọi công cụ chắc chắn hỏng — Markdown/HTML, host web.
   **Đã sửa (G6-12).** Công cụ stub bị bỏ khỏi getter `tools` của web (markdown `insert_image` + `generate_image` qua cap `aiImageFetch`; html `read_attachment` qua cap `attachments`); bị gọi vẫn thì từ chối trước khi stub chạy; desktop không đổi. Test đỏ `317141f3` → sửa `4e39fa93`; `apps/markdown/tests/g6-12-md-web-stub-tools.test.ts`, `apps/html/tests/g6-12-html-web-stub-tools.test.ts`; `web/modules/{markdown,html}/webapi.ts` đặt mặc định `false`. Stub của slides và pdf: dòng 28, 34.

12. markdown — ảnh do AI chèn chỉ ghi vào assets khi Lưu (hoặc dọn khi rollback) — một lượt AI không ghi gì ra đĩa trước Lưu —
    spec §6.4, §5 markdown (c).
   **Chờ Product (đợt 3)** — ảnh vào assets trước khi Lưu: chấp nhận như "một phần tài liệu" hay dời tới lúc Lưu (§9.1). Code chưa đổi.

13. docs — sửa mô tả `define_style` (nhắc `apply_style` không tồn tại) — model gọi công cụ không có — DOCX sửa.
   **Đã sửa (G6-12).** Mô tả nay dùng op `applyStyle` của `apply_ops`. Test đỏ `42a5062` → sửa `9ee493a`; `apps/docs/tests/g6-12-define-style-description.test.ts`.

14. docs — công cụ so sánh hai tài liệu (tùy Product; model hiện so trong context) — DOCX đọc "so sánh và giải thích".
   **Chờ Product (đợt 3)** — công cụ so sánh hai tài liệu hay so trong context là đủ (§9.1). Chưa làm.

15. docs, markdown — `insert_image`/`insert_picture`/`set_watermark` (ảnh)/`generate_image` tải URL do model chọn (docs: desktop và web
    qua `image.fetch`; markdown: desktop) — chỉ cho URL đến từ `image_search`/`generate_image` cùng lượt, hoặc tắt với UniWork AI —
    §5 docs (b), markdown (b).
   **Chính sách chờ Product (đợt 3); guard đã ghim.** Quy tắc "chỉ URL từ công cụ tìm/sinh ảnh cùng lượt" hay "tắt với UniWork AI" chưa chọn nên không đổi gì; test chỉ khóa SSRF guard và trần byte hiện có (không nới): docs `8e8ed49` (`apps/docs/tests/g6-12-url-fetch-guard.test.ts`), markdown `c939a37` (`apps/markdown/tests/g6-12-url-fetch-guard.test.ts`).


16. sheets — `add_image` trong `propose_operations` tải URL do model đưa (desktop + web proxy) và đọc ảnh cục bộ theo đường dẫn tuyệt đối (desktop) — vi phạm §6.3 (b), đọc file ngoài tài liệu — §5 sheets (b).
   **Một phần đã sửa.** Đường dẫn cục bộ tuyệt đối: workbook gắn UniWork từ chối cả lô (§5 sheets (b)); test đỏ `547cce1` → sửa `d41e840`; `apps/sheets/tests/g6-12-add-image-guard.test.ts`. Phần còn lại: URL do model đưa: chính sách chờ Product (như dòng 15), guard ghim bằng `apps/sheets/tests/g6-12-fetch-image-guard.test.ts` (cùng `547cce1`).

17. sheets — `create_document` ghi file mới trên desktop — vi phạm §6.3 (c) — §5 sheets (c). (Web đã tắt.)
   **Đã sửa (G6-12).** Ẩn khi workbook gắn UniWork, `isError` nếu vẫn bị gọi. Test đỏ `07ba87e` → sửa `e1d6143`; `apps/sheets/tests/g6-12-create-document-bound.test.ts`.

18. sheets — hiển thị cho người dùng target range + số ô có dữ liệu bị ghi đè trước Lưu — spec §6.5 XLSX, §6.4 — hàng XLSX sửa.
   **Chờ Product (đợt 3)** — khuyến nghị (b): bắt buộc hiển thị; nếu chọn thì **G6-09** sở hữu phần hiển thị. G6-12 không làm trước khi người dùng ký.

19. sheets — output đọc có kiểu ô, giá trị thô và number format (phân biệt 10 vs 10%), nhất quán giữa chế độ demo/lazy — §6.5 XLSX types/locale.
   **Đã sửa (G6-12).** `read_cells`/`read_range` in kiểu, giá trị thô, number format khi cần; demo và lazy cùng hình `CellRead`. Test đỏ `c863541` → sửa `ac04f87`; `apps/sheets/tests/g6-12-cell-types.test.ts`.

20. sheets — `aggregate_range` cho AI: tùy chọn/mặc định bỏ dòng ẩn/lọc và báo số dòng ẩn đã bỏ; cờ dòng ẩn trong `read_range` — §6.5 XLSX hidden/filtered.
   **Đã sửa (G6-12).** `aggregate_range` có `skipHiddenRows` (mặc định gộp, luôn nêu số dòng ẩn và đã gộp hay bỏ); `read_range` đánh dấu dòng ẩn/lọc. Test đỏ `de4bfb9` → sửa `2fa2ff0` (+ `9a32888`, chỉ chữ schema); `apps/sheets/tests/g6-12-hidden-rows.test.ts`.

21. sheets — công cụ chỉ đọc tính tổng/đếm/trung bình có điều kiện + group-by trên range, trả coverage (dòng xử lý, ô không hợp lệ bị bỏ) — §6.5 XLSX đọc (điều kiện, nhóm, coverage).
   **Đã sửa (G6-12).** Công cụ mới `summarize_range` (§4.6). Test đỏ `02302c1` → sửa `2a33a7d`; `apps/sheets/tests/g6-12-summarize-range.test.ts`.

22. sheets — cờ cache/recalc trên giá trị công thức đọc ở chế độ lazy/streaming — §6.5 XLSX recalc vs cache.
   **Đã sửa (G6-12).** Nguồn giá trị công thức (engine / cache / `NOT RECALCULATED`); cache có thể cũ không bao giờ là đáp án (§5.1). Test đỏ `2efcbc0` → sửa `930b695`; `apps/sheets/tests/g6-12-formula-cache-flag.test.ts`. Kèm hàm không hỗ trợ báo rõ (`unsupported function: X`): `b7ad876` → `8b608cb`, `apps/sheets/tests/g6-12-unsupported-function.test.ts`.

23. sheets — `read_cells` báo khi cắt quá 100 địa chỉ (trước G6-12 cắt im lặng, `apps/sheets/src/renderer/ai/tools.ts:1052` (0d03b185); nay cùng chỗ cắt ở `apps/sheets/src/renderer/ai/tools.ts:1999` (66169a9a) và có báo) — §6.5 coverage.
   **Đã sửa (G6-12).** Cắt quá 100 địa chỉ được báo. Test đỏ `4aa1425` → sửa `5b61bd0`; `apps/sheets/tests/g6-12-read-cells-truncation.test.ts`.

24. sheets — phát hiện hàng tổng/subtotal và so khớp hai range (đối chiếu sheet) dạng chỉ đọc — §6.5 XLSX đọc.
   **Đã sửa (G6-12).** Dò hàng tổng/subtotal trong `summarize_range` (loại mặc định, liệt kê): đỏ `f8f4c145` → sửa `527e2616`, `apps/sheets/tests/g6-12-total-rows.test.ts`. Đối chiếu hai range: công cụ mới chỉ đọc `compare_ranges`: đỏ `552d28bb` → sửa `afacde5f` (+ `7b0f0041` sửa kiểu của mock), `apps/sheets/tests/g6-12-compare-ranges.test.ts`. `aggregate_range` chưa dò hàng tổng (§9.2).

25. sheets, pdf — công cụ hỏi người dùng (`ask_user`/card như `ask_clarification`) cho "xác nhận ý nghĩa cột khi chưa rõ" (ví dụ nghiệm thu X/Y/Z) — §6.5 ví dụ nghiệm thu.
   **Đã sửa (G6-12).** sheets: đỏ `b0b112f` → sửa `6875f13` (+ `a769f3c3` cho typecheck), `apps/sheets/tests/g6-12-ask-clarification.test.ts`; pdf: đỏ `3d2e95c` → sửa `3a17363`, `apps/pdf/tests/g6-12-pdf-ask.test.ts`. Hành vi đủ ở §7; biên nhận: WR pdf `d24c55dc` → `5215bab7`, sheets WC `f4150855` → `66169a9a`; panel sheets không đóng được khi đang chờ: `c028e48c` → `37822ed7`.

26. slides — `insert_web_image`/`replace_image`/pipeline `generate_deck`/`analyze_media` tải URL do model đưa — §6.3 (b).
   **Chính sách chờ Product (đợt 3); guard đã ghim.** `apps/slides/tests/g6-12-url-fetch-guard.test.ts`, commit `7cdbd6f` (41 ca; không nới guard nào). `analyze_media` chỉ đọc media roots của chính deck: giữ nguyên.

27. slides — `generate_deck`/`regenerate_slide` tự ghi nháp `<Documents>/UniWork Office/*.pptx` và đổi `session.path` không kiểm `uniworkIsBound`; sidecar `.styleskill.json`; `save_style_template` ghi userData — §6.3 (c), §6.4.
   **Đã sửa (G6-12)** cho deck gắn UniWork: không nháp, không đổi `session.path`, không sidecar (§5 slides (c)). Test đỏ `f160e77` → sửa `e5079d8`; vòng sửa BE `b6f2c357` → `6a48a186`, `bf9d9c0f`; `apps/slides/tests/g6-12-bound-draft.test.ts`, `g6-12-bound-sidecar.test.ts`, `g6-12-bound-wiring.test.ts`. `save_style_template` không đổi (khuyến nghị: thư viện style là lưu trữ cục bộ), và còn bản recovery 30 giây trong `userData`: §9.2.

28. slides — web khai báo cho model các công cụ chỉ là stub (`insert_web_image`, `replace_image`, `regenerate_slide`, `generate_deck`, `save_style_template`; `web_search`/`image_search` không gate theo grant) — cần gate theo capability như sheets `gateSkill` — §6.2 allowlist ("chỉ công cụ editor của module đang mở").
   **→ G6-05 / G6-03a** (chủ mới). Allowlist v1 khóa theo nhà cung cấp, nên cổng "chỉ công cụ editor của module đang mở" (kể cả ẩn stub web của slides) đặt cùng chỗ với allowlist, không rải từng skill. Không sửa ở G6-12; markdown và html đã có cổng capability nên xong ở dòng 11.

29. slides — `generate_deck`/`regenerate_slide` gọi LLM nội bộ ngoài vòng tool (style, outline, từng trang) — với UniWork AI cần đi qua cùng run id/trần lượt (§6.2 trần vòng tool) hoặc bị loại khỏi allowlist v1.
   **→ G6-05 / G6-03a** (chủ mới). Lượt LLM nội bộ của `generate_deck`/`regenerate_slide` chỉ tính vào trần vòng tool khi đi qua run id/adapter mà G6-05/G6-03a dựng, hoặc bị loại khỏi allowlist v1. Không sửa ở G6-12.

30. pdf — `insert_blank_page`/`set_page_size`/`crop_pages`/`replace_pages` lưu chỉnh sửa chờ và tạo version mới (web `api.save`) / ghi lại file (desktop), không hoàn tác được — §6.3 (c), §6.4 "một lượt AI không tạo upload/version/save".
   **Chờ Product (đợt 3)** — các công cụ pdf lưu/tạo version (`api.save` trên web) và ghi lại file; khuyến nghị (b): bỏ chúng khỏi tài liệu gắn UniWork ở v1. Code chưa đổi theo lệnh Advisor, tới khi người dùng ký (§9.1).

31. pdf — `extract_pages`/`split_pdf`/`split_pages`/`merge_pages`/`create_document` ghi file mới (desktop) / tải xuống (web) — §6.3 (c).
   **Một phần đã sửa.** `create_document` ẩn khi tài liệu gắn UniWork: đỏ `0abfd42` → sửa `5616a23`, `apps/pdf/tests/g6-12-pdf-bound.test.ts`; khai báo `mutated: false` cho `generate_image` và `create_document`: `eec15a2` → `acf24e5`, `apps/pdf/tests/g6-12-pdf-flags.test.ts`. Phần còn lại: `extract_pages`/`split_pdf`/`split_pages`/`merge_pages`: chờ Product (đợt 3), cùng câu hỏi với dòng 30 và card xác nhận (§9.1).

32. pdf — `insert_image`/`replace_image` tải URL do model đưa (desktop) — §6.3 (b).
   **Chính sách chờ Product (đợt 3); guard đã ghim.** `apps/pdf/tests/g6-12-pdf-fetch-guard.test.ts`, commit `de305c1` (28 ca).

33. pdf — undo gộp theo lượt AI + nút hoàn tác lượt (đang một bước/công cụ, stack 50) — §6.4 hiển thị/hoàn tác.
   **→ G6-09** (chủ mới). Undo gộp theo lượt AI và nút hoàn tác lượt cần móc "bắt đầu/kết thúc lượt" như dòng 3, 4; pdf `pushUndo` là lịch sử riêng của app. Không sửa ở G6-12.

34. pdf — gate công cụ sửa text/ảnh theo `pdfTextEdit`/`pdfImageEdit`, `create_document` và tải ảnh trên web (đang khai báo nhưng stub/lỗi) — §6.2 allowlist.
   **→ G6-05 / G6-03a** (chủ mới). Gate sửa text/ảnh theo `pdfTextEdit`/`pdfImageEdit` và ẩn stub web (`create_document`, tải ảnh) là cổng capability/nhà cung cấp cùng loại với dòng 28, nên đi cùng allowlist. Không sửa ở G6-12.

35. sheets, slides, pdf — chưa có cách phân biệt nhà cung cấp UniWork AI trong skill để áp allowlist v1 (MCP/skills tắt, cloud chỉ khi `office.ai_cloud`) — §6.2; G6-12 cần một predicate "provider = uniwork" cho getter `tools`.
   **→ G6-05** (chủ mới): G6-05 sở hữu predicate `provider = uniwork` phía adapter; skill của từng app chỉ cần đọc nó. G6-12 chỉ cho công cụ ẩn theo trạng thái gắn UniWork (`bound`) sẵn có, không thêm predicate. Chưa sửa ở G6-12.

Khai báo cờ `mutated` (đã nêu ở §3.1, không có số dòng riêng ở bản G6-01): html `ask_clarification`: đỏ `1deb942` → sửa `83ff3ec`
(`apps/html/tests/g6-12-html-ask-flag.test.ts`); pdf `generate_image`, `create_document`: `eec15a2` → `acf24e5`; sheets
`merge_attached_workbooks` `mutated: true` + [Undo] của panel: đỏ `f486ec4` → sửa `c833b92`, `apps/sheets/tests/g6-12-merge-mutated.test.ts`, và nối
nút Undo qua `mergePathsWithUndo` + đơn vị độ sâu undo: `bc55591c` → `c8b3e07c`, `apps/sheets/tests/g6-12-merge-undo-wiring.test.ts`.
WEBSERVICE/FILTERXML: không phải phát hiện (§5 sheets (a)).


### 9.1 Nghi vấn còn mở cho Product / owner F

**Đã ký 2026-10-13 ~12:05 UTC+7** (người dùng, "duyệt theo gợi ý"; lô #3 + Q G6-14, run folder
`decisions/batch-3-signed.md`). Đóng G6-D4. Kết quả từng mục dưới đây:

- HTML desktop (#10): **thêm CSP cho preview desktop** để chặn mạng của script AI viết; làm sạch HTML để sau. Chủ: G6-09.
- Markdown ảnh vào assets trước Lưu (#12): **chấp nhận ở v1** với điều kiện ảnh bị dọn khi người dùng hoàn tác hoặc không
  Lưu; ghi ở §9.2. Chủ: G6-09.
- DOCX "so sánh và giải thích" (#14): **so trong context là đủ ở v1**, không thêm công cụ so sánh.
- Bảo vệ Word (#6): **chặn bằng instruction pack ở v1** (G6-14 Q8), ép trong công cụ sau.
- URL ảnh do model chọn: **chỉ URL từ `image_search`/`generate_image` cùng lượt hoặc tệp đính kèm chat** (G6-14 Q5).
- Hiển thị AI sheets: **(b) bắt buộc target range + số ô bị ghi đè**, chủ G6-09 (đã ký 00:55, lô #3 phần G6-12).
- PDF `api.save` trên web: **(b) bỏ khỏi tài liệu gắn UniWork ở v1** (đã ký 00:55).
- PDF thao tác cấp file (`extract_pages`, `split_pdf`, `split_pages`, `merge_pages`): **tắt với tài liệu UniWork ở v1**
  (G6-14 Q7 (b)).

- Hàng review thủ công (owner F + Product) của `docs` `generate_mindmap` và `markdown` `generate_mindmap`, mới ở fork `bf4ff7b0`:
  **đã đóng cả hai** — Advisor decision 2026-10-16 `msg_f4b50f24445b` (Advisor default, user may override). Công cụ chỉ đọc
  (`mutated: false`), không ghi tài liệu hay file.

Phần dưới giữ nguyên văn câu hỏi lúc mở để truy vết.

Mọi mục dưới đây **chờ Product (đợt 3)**: code giữ nguyên tới khi người dùng ký; mỗi mục có phương án và khuyến nghị trong packet G6-12.

Của phần docs/markdown/html:

- HTML desktop: thêm CSP cho preview / làm sạch HTML do AI viết, hay chấp nhận có ghi lý do (§5 html (a); §9 dòng 10)?
- Markdown: ảnh do AI chèn được ghi vào thư mục assets trước khi Lưu — chấp nhận như "một phần tài liệu", hay dời việc ghi tới
  lúc Lưu (§9 dòng 12)?
- DOCX "so sánh và giải thích": cần công cụ so sánh hai tài liệu, hay so trong context là đủ (§9 dòng 14)?
- Bảo vệ Word (chỉ đọc/form/comment) có phải chặn công cụ AI không (§9 dòng 6)?
- Tải URL ảnh do model chọn (mọi module, §5 (b); §9 dòng 15, 16, 26, 32): quy tắc là "chỉ URL từ công cụ tìm/sinh ảnh cùng lượt"
  hay "tắt với UniWork AI"? Guard và trần byte hiện có đã được ghim bằng test ở docs, markdown, sheets, slides và pdf.

Của phần sheets/slides/pdf:

- Hiển thị AI sheets không tô vùng sửa: Product quyết có đủ "theo khả năng từng module" (§6.4) khi đã có nút Undo theo lượt, hay
  bắt buộc dòng 18 ở §9 (target range + ô bị ghi đè) trước nghiệm thu. Khuyến nghị (b) bắt buộc, thuộc G6-09.
- Công cụ pdf lưu/tạo version trên web (`api.save`) và ghi lại file: ngoại lệ có card xác nhận (a) hay bỏ chúng khỏi tài liệu gắn
  UniWork (b). Khuyến nghị (b) cho v1 (§5 pdf (c); §9 dòng 30, 31).
- Card xác nhận của PDF cho thao tác cấp file (`extract_pages`, `split_pdf`, `split_pages`, `merge_pages`): Product quyết có chấp nhận
  như ngoại lệ §6.4 (người dùng tự xác nhận) hay tắt các công cụ đó với tài liệu UniWork (§9 dòng 31).

Đã đóng ở G6-12 (không còn là nghi vấn): `WEBSERVICE`/`FILTERXML` không được engine thực thi và không mở mạng ở cả desktop lẫn web
(§5 sheets (a), Advisor đã chấp nhận); `merge_attached_workbooks` nay khai báo `mutated: true` và nút Undo của panel phủ thao tác merge
(§4.6, wiring có test; giới hạn khi stack undo tràn ở §9.2).

### 9.2 Còn lại và vì sao

Những gì G6-12 cố ý để lại, hoặc quyết định mặc định cần Product xác nhận. Không dòng nào bị bỏ im lặng.

| mục | nguồn | tình huống | chủ | quyết định / lý do |
| --- | --- | --- | --- | --- |
| docs: rollback sau khi lưu giữa lượt | review FE docs-md F1 (minor) | người dùng lưu trong lúc AI chạy; rollback chỉ trả cây, header/style/page setup giữ như file đã lưu, panel không báo | G6-09 (hiển thị/undo theo lượt) | Advisor 2026-10-12: chấp nhận ở G6-12, chuyển G6-09. Phát lại bảng style/header/page setup chờ trước khi lưu lên file đã parse lại là sai, và style đã ghi vào styles.xml không xóa được; một thông báo cần chuỗi 21 ngôn ngữ (đã đề nghị làm sau) |
| extractor: tồn đọng R1-1..R1-3 | review BE extractor (low; 0 ảnh hưởng ở cả hai pin) | R1-1: bag `tools:` lồng trong schema → dòng ma; R1-2: `get tools(): T[]` có chú thích kiểu trả về → công cụ không schema bị bỏ (cũng ở nền); R1-3: `return [` của helper lồng trong thân `get tools()` bị coi là danh sách công cụ | G7-06 (đã sửa ở F `f5b75e1f`) | Đã sửa ở F `f5b75e1f` (`feature/UNI-1378-g7-06-extractor`, blob `94babf94…`, chờ Advisor gộp vào fork main); đầu ra ở `0d03b185`, `66169a9a` và `cb76dde5` không đổi chỗ nào khác. Cùng lúc đóng ô `editor_write` của markdown `ask_clarification` (`yes` → `no`, §3.1 nhóm C). |
| slides: bản recovery trong `userData/slides-autosave` | review BE slides R1-4 (low) | deck gắn UniWork còn dirty sau khi AI hạ cánh, nên tick 30 giây ghi bản recovery vào `userData` | Product (nhận biết) | lead chấp nhận: lưu trữ cục bộ của app, cùng loại với `save_style_template` và với sửa tay đã có từ trước |
| slides: `save_style_template` ghi `userData/style-templates` | WSl mục 2 | thư viện style cục bộ chứa text Style Skill, `topic`, khung layout; không có bản sao tài liệu | Product (xác nhận) | khuyến nghị: không phải "ra ngoài tài liệu", không đổi; nếu Product muốn không có dữ liệu suy từ tài liệu trong `userData` thì bỏ trường `topic` khi gắn UniWork |
| pdf: thẻ hỏi đang chờ bị bỏ ở lần lưu đầu của một PDF trống | review FE pdf-html F1 (minor) | đường dẫn đổi từ rỗng sang có; dọn thẻ giải quyết câu hỏi như đã bỏ qua | không (ghi nhận, ngang hành vi thẻ xác nhận cấp file) | Advisor 2026-10-12: chấp nhận như đã biết |
| markdown/html: đơn vị rào vùng sửa là block | review FE md-html F4 | chọn một phần đoạn văn vẫn cho phép viết lại cả đoạn | không (ghi cho spec) | lead chấp nhận như thiết kế; văn bản ngoài các block được rào giữ nguyên từng byte |
| html: gửi thẳng từ composer khi có phần tử đang chọn | WM "needs decision" 1 | không rào, vì composer html không có chip phạm vi để bỏ rào | Product xác nhận; (b) thuộc G6-14 (chip/UX) | khuyến nghị (a) cho G6-12: chỉ rào Ask AI và hàng đợi sửa |
| sheets: mặc định hàng ẩn | WS1 "needs decision" 1 | `aggregate_range`/`summarize_range`/`compare_ranges` gộp dòng ẩn mặc định, luôn nêu số đếm | Product xác nhận | khuyến nghị gộp (như SUM, không bỏ im lặng); đổi một dòng `hiddenMode` ở `tools.ts` nếu muốn mặc định bỏ |
| sheets: chính sách cache có thể cũ | WS1 "needs decision" 3 | giữ lại tổng (`NOT RECALCULATED`) thay vì hiện kèm cảnh báo; mọi sửa đầu vào trong phiên đánh dấu mọi cache là có thể cũ (bảo thủ) | Product xác nhận | khuyến nghị giữ lại, theo §6.5 "không dùng giá trị cache làm chân lý" |
| sheets: `aggregate_range` chưa dò hàng tổng | WS1b mục 5 | tổng thô như SUM; chỉ `summarize_range` và `compare_ranges` dò | chưa giao | có thể thêm sau; không chặn nghiệm thu |
| sheets: merge làm tràn stack undo của Univer | WS2 mục 4 | Univer giữ 20 mục/đơn vị; merge nhiều độ cao dòng tùy chỉnh vượt; khi đó `undoSteps` = `null` và đầu ra nói thẳng không hoàn tác được | chưa giao (lead/Advisor chọn) | phương án (b) nhỏ và chính xác: một mục undo tùy chỉnh cho cả merge (mẫu `bulk-fill-undo.ts`); chưa làm để giữ hunk hẹp |
| lời prompt / hướng dẫn (instruction pack) | các worker, C-SCOPE | `prompts/base.md` dòng 42 (COUNTIFS tạm), `prompts/guides/charts.md` (`add_image` đường dẫn cục bộ tuyệt đối), prose pdf ("hỏi gộp một câu" bằng văn bản), ghi chú `aiImageFetch` của markdown và các câu từ chối ở mã | G6-14 | văn bản của instruction pack thuộc G6-14; cần trỏ về `summarize_range`, `NOT RECALCULATED`, `[type; raw; format]`, `ask_clarification`, và chỉ cho `add_image` tệp đính kèm/URL ở tài liệu UniWork |
| nút đính kèm của html trên web | WM #11 | công cụ `read_attachment` đã ẩn nhưng nút đính kèm trong composer web chưa ẩn (stub trả rỗng) | chưa giao | việc UI ngoài phạm vi công cụ |
| chuỗi 21 ngôn ngữ do worker viết | WD, WP, WS2 | tiêu đề/Tiếp tục/Bỏ qua/Xác nhận và chip của thẻ hỏi (docs, markdown, pdf, sheets) do worker dịch; các nhãn chung chép từ html | Product / i18n (rà ngôn ngữ) | cần người bản ngữ rà trước khi phát hành |
| `compare_ranges`: lỗi khi đọc dòng | review FE sheets-read F1 (nit) | nếu bộ đọc dòng ném lỗi thì công cụ từ chối thay vì trả `fail()` | không | khả năng thấp, không sửa |

## 10. Ký duyệt cột tay (AC-4)

Cột tay (§2, §4–§9) chờ owner F + Product ký qua Advisor; chữ ký đóng gate G6-D4. Cột cơ học (§3) không cần ký: nó
được kiểm bằng lệnh AC-2 ở §1.

Trạng thái ở `66169a9a` (G6-12): khối §3 và lệnh AC-2 đã chạy lại (§1); cột tay đã làm mới cho mọi hàng G6-12 sửa (§3.1, §4, §5, §6, §7, §8, §9);
G7-06 chạy lại AC-2 và làm mới khối §3 ở `cb76dde5` bằng extractor đã sửa (§1, §3.1 nhóm C đã đóng);
DOC-05 lockstep (2026-10-16) làm mới khối §3 ở `bf4ff7b0` (thêm hai hàng `generate_mindmap`, đã đóng theo Advisor decision `msg_f4b50f24445b`, Advisor default, user may override);
phần chờ ký gồm các mục "chờ Product (đợt 3)" ở §9, §9.1 và các xác nhận mặc định ở §9.2. Hàng chưa ký vẫn là hàng chưa ký — G6-12
không đóng gate G6-D4.
