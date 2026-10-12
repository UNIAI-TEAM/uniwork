# UniWork Office — Bảng công cụ agent genoffice (G6-01)

> **Trạng thái:** in-progress — cột cơ học (khối trích xuất tại `0d03b185`) và cột tay đủ bảy module; chờ owner F +
> Product ký cột tay (§10).

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

  Đã chạy ngày 2026-10-12 với script tại fork `e8a692c` (UNI-1363, sau khi sửa lỗi đọc thừa `editor_write`): `AC-2 OK`; đầu ra trùng từng byte với bản W1 giao (sha256 `0df68253…`).

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
<!-- genoffice-tools-extract v1 rev=0d03b185c8060bafc4e2afe7173e0a10260465bd -->
| module | tool | input_schema_sha256 | editor_write | source |
| --- | --- | --- | --- | --- |
| docs | accept_changes | 9af09d4b7b735877e734a81a8d86f6dbd6fe1ba184cd649a13dec3fe2e196fe0 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | add_comment | 2c02b65e695409a1779ba442dfe9c681ef389a3f4e5ad33e47ead67291b7777f | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | analyze_media | 4be9eff4d929769f31dfd25837b4f07af62ea6084cc720a88573d595b8711974 | no | apps/docs/src/renderer/ai/tools.ts |
| docs | apply_ops | acc60f5acf92201819c6ff3f7887e6216bb4f8cf54ca4487ea7d7d0fd8c5f613 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | create_document | 8c956443bbd56633e88e3fc40d47cea47048995ccbf4813023736f14dfbb54cf | no | apps/docs/src/renderer/ai/tools.ts |
| docs | define_style | 18fc6a4f754c0dc3282428b868dba32ea0945ee246839cdcac475fc7b35c6957 | no | apps/docs/src/renderer/ai/style-ops.ts |
| docs | delete_comment | ca077b8285b224249d6df8bf86f4baf458bacca9e50cfa8434c5d5d0f9fdda53 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | delete_note | 83ab8c2ba74a615ceb5d0e472c28c4d5adcdc8f2eb7cdb4d064c33b385ce8c3d | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | edit_chart | c29264bd21515db11818de1199fe3af4e8d87a1aaab711fe9ef1f176fe635a45 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | edit_note | f465830acda36342513258eff25bc94a37c3cfc7868505a0fefcceabb4bfb055 | yes | apps/docs/src/renderer/ai/tools.ts |
| docs | generate_image | f6852b9e5272085ee5e6509a3c6a37dcd28da7f5349151248118e9e4f38c1cde | yes | apps/docs/src/renderer/ai/tools.ts |
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
| docs | resolve_comment | ebe1eaf288ea69a42e0f9ec3fb0a59e79c86d99c6d940fef6733927577da3750 | no | apps/docs/src/renderer/ai/tools.ts |
| docs | set_header_footer | e697d4aab47ae2eda0e96e816204f069edfd5e5fa77b31b614e77ac5e1ca4f6e | no | apps/docs/src/renderer/ai/tools.ts |
| docs | set_page_setup | cdc7c96a266910c5bf472893f8a3bd3b1e4a3bd84ad546d5c1cf355d8a83b996 | no | apps/docs/src/renderer/ai/page-setup.ts |
| docs | set_watermark | 7472f1d51802ae0fa36252afb5ec408d9ed7524430337bea08f6ddf94c810256 | no | apps/docs/src/renderer/ai/floating-ops.ts |
| docs | web_search | 768c0c31293d6717b7345cc108d9bcd69dbbb7e4a695ee3059600e674670cbf4 | no | apps/docs/src/renderer/ai/tools.ts |
| docs | write_document | 72dac356ba2c80721cc2937fff59bece13ddefa491ea862ec4028b832c7ae247 | yes | apps/docs/src/renderer/ai/tools.ts |
| html | apply_ops | 7ceda385ebf30d139a07335e082b922514da756a956ecebe3a80a1692663fbd2 | yes | apps/html/src/renderer/ai/tools.ts |
| html | ask_clarification | 7b1327afd202f0d0d47debc5f922fdcbe4541bad90d6f97efe31db002b3373f7 | undeclared | apps/html/src/renderer/ai/tools.ts |
| html | get_outline | e141e58bb530c31af684002a9588e3bc2a673f1b0816a35f90d7fb7cdf60c985 | no | apps/html/src/renderer/ai/tools.ts |
| html | plan_page | 58fc7bd38c9ce9fe63b3444bd1cb899291b359a85e53f295806b18549de8455f | yes | apps/html/src/renderer/ai/tools.ts |
| html | read_attachment | 8a54dbeec0b943d31f55257b1442d0dbb1b1a1a7138eb41bd6c44677efc8350f | no | apps/html/src/renderer/ai/files-skill.ts |
| html | read_source | 9ed4ae6a05bf9137df0a71a4266f5337a3867e208125c67c64a72c7aae2b179d | no | apps/html/src/renderer/ai/tools.ts |
| html | web_search | 0190a7f984b61a677dd6b5e3bbe3f4b0bacbde61149c05035f4b3da9b05154ba | no | apps/html/src/renderer/ai/search-skill.ts |
| html | write_document | f84f720da1d30d480c519e8dbb46ca81bb3b3d69b12332634bd5b3187c63f313 | yes | apps/html/src/renderer/ai/tools.ts |
| markdown | apply_ops | e796ff6fcf174827819356e0312f2246fd573b42cb7bbb1f0b7052407c1334c3 | yes | apps/markdown/src/renderer/ai/tools.ts |
| markdown | generate_image | ed7b16fa3ca50a85c50bc04b296613c9b84014231d5c3ea987819284f5561c25 | yes | apps/markdown/src/renderer/ai/tools.ts |
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
| pdf | create_document | fe097c873ed74f6402ef15297ef0997bb56954d08b4def2130b0c6b9232f7c3b | undeclared | apps/pdf/src/renderer/ai/tools.ts |
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
| pdf | generate_image | 6adfeeb2b65038a13a35b6e2089714b958bec217b151984033d7fb690a3c0cc0 | undeclared | apps/pdf/src/renderer/ai/tools.ts |
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
| sheets | aggregate_range | 32587dfef46690cf453961d118c003224088ce369027e84716595d8a1b24c551 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | create_document | 125a43f66d295e90404e05abadaa0e82e269fa06eaeddb20841497e3d4a692a7 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | find_cells | 2b150624089aafa5e5f49047d7ff2bb3451971257180529846ea79eb415fe8d2 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | generate_image | df82864f0926591f453c9aaabdd23fb1a9b746228098c5239ecb8ff01f151d69 | no | apps/sheets/src/renderer/ai/image-skill.ts |
| sheets | get_workbook_context | c8a1ac469a826ea3547ac220c7bbfdcd6b58080d4ec596ff2a0149c5ccb9b699 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | image_search | 3f5b97d7c6b3a4519fb63c6c2684b872e6e09c378eeb727d226e710be4dd7135 | no | apps/sheets/src/renderer/ai/image-skill.ts |
| sheets | load_guide | 4b24c5f64409be810b1d584cfd981e98476ef5617a6d2b3f24a3139b2028d6f6 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | merge_attached_workbooks | 23d617b33e9315f6762639a47ccad59f220f6d2edc617b3dcfdf2e2e983aa3c0 | undeclared | apps/sheets/src/renderer/ai/merge-skill.ts |
| sheets | propose_operations | a88b43f46d8b4363aa78db40b7912648b423731861e2e7f31c7cfd3c8374015f | yes | apps/sheets/src/renderer/ai/tools.ts |
| sheets | read_attachment | 681c5f1b81a89e7dffd61d75c1156e2e401fac649ce47c837de86da09797f866 | no | apps/sheets/src/renderer/ai/files-skill.ts |
| sheets | read_cells | 4fc7b92ab7498b96dcc18ac8680f53f8f8cbad07cc9c268d001b8673bcc7d12b | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | read_formats | fadf34ccc70f71a2f554a2675263adfed999de7de9806c634d96fd23ca5b460a | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | read_range | a24cfa6cf4bdfa061ee716a84a3c3f04cbaa912b2fec21bf912db77c3ec4a5d0 | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | read_sheet_features | dbeaf7ccbb6be10d3dcd1b1b0463b3707698c07278731d60e811f2d52499c8cb | no | apps/sheets/src/renderer/ai/tools.ts |
| sheets | select_range | 5c4bc90b431bfb06f9ee24b68846dde2109f76a79be3c9ebf9fb83ef7bab72c2 | no | apps/sheets/src/renderer/ai/tools.ts |
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

- **Tên công cụ:** 135 dòng, khớp đúng tập tên của các bảng tay §4 theo từng module — docs 37, markdown 9, html 8, sheets 18,
  slides 18, pdf 45; `agent-core` không có dòng nào. Không thiếu, không thừa, không trùng.
- **`editor_write`:** cột cơ học chỉ đọc khai báo của code, còn cột "ghi editor" ở §4 ghi theo hành vi. Có 19 chỗ hai cột
  khác nhau, chia thành bốn nhóm dưới đây. (Bản trước của tài liệu này có 26 chỗ: 9 ô `editor_write` bị extractor ghi `yes` thừa — docs
  `web_search`, `image_search`, `analyze_media`, `create_document`, `set_watermark`; sheets `find_cells`, `select_range`,
  `trace_precedents`, `trace_dependents`. Lỗi ở script, đã sửa tại fork `e8a692c`; các ô đó nay là `no` trong khối §3.) Cột cơ học không sửa tay; chỗ nào code sai thì sửa ở G6-12, rồi chạy lại script.

| nhóm | module / tool | cơ học | tay | giải thích |
| --- | --- | --- | --- | --- |
| A. Code khai báo `false` nhưng công cụ có đổi tài liệu | docs `resolve_comment`, `set_header_footer`, `define_style`, `set_page_setup`, `set_watermark` | `no` | có | Cột cơ học làm đúng theo khai báo; khai báo sai (§4.2 ghi chú, §9 dòng 5). |
| B. Ghi ra ngoài tài liệu | sheets `create_document`; slides `save_style_template`; pdf `insert_blank_page`, `set_page_size`, `crop_pages`, `extract_pages`, `split_pdf`, `split_pages`, `merge_pages`, `replace_pages` | `no` / `yes` | file | `editor_write` chỉ nói về tài liệu đang mở. Cột tay ghi `file` vì công cụ ghi file, lưu, hoặc tạo version (§5 (c)). Các công cụ cấp file của pdf vừa đổi tài liệu (`yes`) vừa ghi file. |
| C. Code không khai báo gì | html `ask_clarification`, pdf `generate_image` | `undeclared` | không | Hai công cụ này không đổi tài liệu, chỉ thiếu khai báo `mutated: false`. G6-12 nên thêm để cột cơ học thành `no`. |
| C. Code không khai báo gì | sheets `merge_attached_workbooks`, pdf `create_document` | `undeclared` | có / file | `merge_attached_workbooks` ghi sheet vào workbook nhưng không đặt `mutated: true`, nên không có snapshot rollback. `create_document` của pdf ghi file mới. G6-12 cần khai báo đúng. |


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
| read_revisions | cả hai | — → danh sách tracked change | 200 mục trong context (`protocol.ts:627`) | không | view-only giữ |
| accept_changes | cả hai | bộ chọn (all/ids/author/type/block) → id bị ảnh hưởng | bộ chọn được kiểm | có | |
| reject_changes | cả hai | như trên | như trên | có | |
| read_comments | cả hai | — → các luồng comment | 20 luồng trong context (`protocol.ts:708`) | không | view-only giữ |
| reply_comment | cả hai | `parentId`, text → ack | luồng phải tồn tại | có | |
| resolve_comment | cả hai | id → ack | — | có (code khai báo `false`) | |
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

Skill ghép: `composeSkills('sheets+files', …)` tại `apps/sheets/src/renderer/App.tsx:1404-1431` = workbook skill + files (gate
`attachments`) + merge (gate `mergeWorkbooks`) + search (gate `webSearch`) + image (gate `imageGeneration`/`imageSearch`), tất cả
bọc `restrictToReading` (view-only UniWork → chỉ `VIEW_ONLY_TOOLS`, `apps/sheets/src/renderer/ai/view-only-skill.ts:9-24,42-64`).
Web: `createDocument`, `attachments`, `mergeWorkbooks` luôn tắt; `webSearch`/`imageSearch`/`imageGeneration` tắt tới khi host cấp
(`web/modules/sheets/capabilities.ts:27-36,54`).

| tool | host | vào → ra | giới hạn trong code | ghi editor | ghi chú |
| --- | --- | --- | --- | --- | --- |
| get_workbook_context | cả hai | `{}` → danh sách sheet (id/tên/extent), sheet active, selection (đóng băng lúc gửi), merge, chart, ô đã biết | ô đã biết ≤200, merge ≤50 (`tools.ts:712,726`) | không | `tools.ts:269`. Báo chế độ streaming và sheet READ-ONLY vượt trần save-patch (`tools.ts:661-692`) |
| read_range | cả hai | `{range, sheetId?}` → lưới giá trị/công thức có nhãn cột A,B,… và số dòng | ≤2000 ô (`MAX_READ_RANGE_CELLS`, `tools.ts:255,832`); phải nằm trong data extent (`tools.ts:847`) | không | `tools.ts:276`. Ở chế độ lazy (xlsx nhập) giá trị là **chuỗi hiển thị** (`workbook-readers.ts:434-440`), không trả `rawValue` |
| aggregate_range | cả hai | `{range, sheetId?, topValues?}` → cells, nonEmpty, distinct, numeric count/sum/avg/min/max, top values | ≤1.000.000 ô (`tools.ts:256,925`); topValues 0–50 (`tools.ts:257,944`); distinct ngừng sau 200.000 (`aggregate.ts:10`) | không | `tools.ts:298`. Tính bằng JS (`aggregate.ts:33-70`), không phải model. AI gọi **không** bỏ dòng ẩn (`App.tsx:1692` không truyền `skipFileHiddenRows`; status bar thì có, `App.tsx:2066`) |
| load_guide | cả hai | `{guides[]}` → văn bản hướng dẫn op (prompts/guides/*.md) | danh mục cố định (`guides.ts`) | không | `tools.ts:325` |
| read_formats | cả hai | `{range, sheetId?}` → định dạng tường minh (bold, màu, number format, căn lề, viền) | ≤200 ô (`tools.ts:263,980`) | không | `tools.ts:342`. Là chỗ duy nhất thấy number format (vd `0%`) |
| read_sheet_features | cả hai | `{sheetId?}` → AutoFilter, CF, DV, defined names, freeze, hidden/protected, shape/ảnh, page setup | — | không | `tools.ts:360`; `workbook-readers.ts:28` |
| read_cells | cả hai | `{addresses[], sheetId?}` → giá trị/công thức từng ô | ≤100 địa chỉ (`tools.ts:253,1052`, cắt bớt im lặng); streaming: bao ≤2000 ô (`tools.ts:1098-1101`) | không | `tools.ts:377` |
| find_cells | cả hai | `{query?, regex?, look_in?, sheetId?, errors_only?, max_results?}` → `Sheet!Addr` + nội dung | mặc định 50, tối đa 200 (`tools.ts:264-265,1129`); báo truncated/sheet chưa index xong | không | `tools.ts:398`; `workbook-search.ts`. Giá trị công thức = giá trị tính gần nhất |
| select_range | cả hai | `{range, sheetId?}` → chọn + cuộn tới vùng | — | không (đổi selection của người dùng) | `tools.ts:438` |
| trace_precedents | cả hai | `{address, sheetId?}` → tham chiếu của công thức + mẫu giá trị + cờ lỗi | độ sâu 1; defined name không mở | không | `tools.ts:457`; `formula-audit.ts` |
| trace_dependents | cả hai | `{address, sheetId?}` → mọi công thức đọc ô | không thấy phụ thuộc qua defined name | không | `tools.ts:475` |
| propose_operations | cả hai | `{operations[] (workbook DSL), summary}` → "Auto-applied N change(s)" + before→after (≤20 ô) + đọc lại ≤10 ô công thức sau 300 ms | ≤2000 thay đổi ô mở rộng; op bulk ≤200.000 ô; op cấu trúc không chung batch (mô tả `tools.ts:508-511`, kiểm ở `plan()` của xlsx-gateway); batch all-or-nothing; `MAX_READBACK_FORMULAS=10`, `FORMULA_RECALC_DELAY_MS=300` (`tools.ts:260-262`); streaming: ngân sách ~50.000 ô tham chiếu (`tools.ts:665`) | có (`mutated: true`, `tools.ts:1328,1363`) | `tools.ts:493`. **Áp dụng ngay** (`App.tsx:3579-3610` `autoApplySafePlan`), không có bước xem trước. Zod `workbookOperationSchema` kiểm op (`tools.ts:1283`). Gồm cả `add_image` tải URL (xem §5) |
| create_document | desktop (gated `createDocument`; web luôn tắt, bridge stub `web/modules/sheets/bridge.ts:820`) | `{type: xlsx/csv/docx/pdf/md/html, sheetId?, title?, content?}` → file mới trong thư mục lưu mặc định, mở tab mới | content rỗng/echo bị từ chối (`tools.ts:1433-1438`) | file | `tools.ts:527`; gate ở `workbook-skill.ts:16-21` và `tools.ts:1390`; ghi đĩa ở `apps/sheets/src/main/sheets-main.ts:1524,1570,3184` |
| read_attachment | desktop (gated `attachments`; web tắt) | `{index, offset?}` → text trích của file đính kèm, phân trang | 24.000 ký tự/khúc (`files-skill.ts:12`) | không | `files-skill.ts:34`. Đọc file cục bộ người dùng đã đính kèm |
| merge_attached_workbooks | desktop (gated `mergeWorkbooks`; web tắt) | `{indexes?}` → nhập mọi sheet của file đính kèm (xlsx/xlsm/xls/csv/tsv) vào workbook đang mở | chỉ phần mở rộng bảng tính (`merge-skill.ts:13`) | có (cờ: không đặt `mutated` → extractor `undeclared`) | `merge-skill.ts:42`; công thức nguồn nhập thành giá trị |
| web_search | desktop luôn; web khi có grant `webSearch` + công tắc cloud | `{query, maxResults?}` → title/url/snippet (+ answer) | mặc định 6; web cắt query 400 ký tự, kết quả 1–10 (`web-ai.ts:677-679,576-577`) | không | `search-skill.ts:20`. Desktop: UniWork cloud nếu bật, nếu không chuỗi keyless Serper/DuckDuckGo (`packages/ai-search/src/search-tools.ts:4-5,36`; IPC `sheets-main.ts:3843-3853`) |
| image_search | desktop luôn; web khi có grant `imageSearch` | `{query, maxResults?}` → danh sách imageUrl + kích thước | mặc định 8 | không | `image-skill.ts:38`; `sheets-main.ts:3855-3864` |
| generate_image | desktop khi có model media BYOK hoặc cloud; web khi có grant `imageGeneration` | `{prompt, aspectRatio?}` → URL ảnh (web: `data:` URL) | web: prompt ≤4000 ký tự (`web-ai.ts:727`) | không (chỉ trả URL; chèn qua `add_image`) | `image-skill.ts:52`; gate `App.tsx:1424-1429` |

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
| regenerate_slide | desktop; web **stub** (`landGeneratedPages`/`localGeneratePage` unavailable, `web-slides-api.ts:1127-1129`) | `{slideIndex, brief, title?, layout?, image_urls?, dataSource?}` → trang mới thay tại chỗ | — | có (`slides-skill.ts:1839`) + **file** (desktop tự ghi nháp, §5) | `slides-skill.ts:542`. Gọi LLM nội bộ thêm (sinh trang local) |
| generate_deck | desktop; web stub | `{topic?, approx_pages?, context?, core_hook?, style?, pages?, insert_mode?, style_template?, builtin_template?, dataSource?}` → deck mới / trang nối thêm | `approx_pages` ≤200 (`MAX_APPROX_PAGES`, `slides-skill.ts:33,595`) | có (`slides-skill.ts:2529`) + **file** (nháp `<Documents>/UniWork Office/*.pptx` và sidecar `.styleskill.json`, §5) | `slides-skill.ts:577`. Nhiều lượt LLM nội bộ (style, outline, từng trang); cloud slide generation tắt cứng (`apps/slides/src/main/slides-main.ts:997-1001`) |
| save_style_template | desktop; web stub (`web-slides-api.ts:1133`) | `{name}` → lưu style + skeleton | tên ≤64 ký tự sau khi lọc (`ai-ipc.ts:520`) | file (`userData/style-templates/<name>.json`, `ai-ipc.ts:507-525`) | `slides-skill.ts:663` (`mutated: false`) |
| list_style_templates | desktop; web trả `[]` | `{}` → danh sách template | — | không | `slides-skill.ts:678` |
| edit_chart | cả hai | `{slideIndex, sourceId, kind?, categories?, series?, dataSource?, …}` → chart đã sửa | `series` cần `dataSource` | có (`slides-skill.ts:2571`) | `slides-skill.ts:684` |
| apply_ops | cả hai (engine `slides:apply-txn`, `web-slides-api.ts:999`) | `{ops[], dry_run?, isolation?}` → bản ghi op, id mới, audit layout | ≤ 50 op mỗi transaction, kiểm ở `apps/slides/src/session/apply-txn.ts:27-31` (mô tả `slides-skill.ts:757`) | có (`slides-skill.ts:2621`; dry run `mutated: false`) | `slides-skill.ts:741`. Atomic mặc định |
| load_guide | cả hai | `{groups[]}` → tài liệu op group | enum `OP_GROUPS` | không | `slides-skill.ts:770` |
| read_attachment | desktop (web: không có kho đính kèm) | `{index, offset?}` → text đính kèm | 24.000 ký tự/khúc (tương tự sheets) | không | `apps/slides/src/renderer/ai/files-skill.ts:38` |

### 4.8 pdf

Skill: `createPdfSkill` (`apps/pdf/src/renderer/ai/pdf-skill.ts:70-131`), định nghĩa công cụ `AGENT_TOOLS`
(`apps/pdf/src/renderer/ai/tools.ts:228-1160`). View-only/mã hóa → chỉ `READ_ONLY_TOOLS` (`pdf-skill.ts:48-58,77-83,118-127`);
`generate_image` ẩn khi không có provider (`pdf-skill.ts:80-82`). Web: `ocr`, `insertPages` (tới khi có `filePick`) tắt (`web/modules/pdf/install.ts:43-64`); `imageGeneration` mặc định tắt
(`install.ts:55`) nhưng `installModuleBridge` gộp `aiHostGrants` trước `pdfGrants`, nên nó bật khi host cấp `ai` + `imageGeneration`
(`web/docs/bridge/module-bridge.ts:142-153`, `web/docs/bridge/hide.ts:88-96`, `web/modules/shared/ai/web-ai.ts:59-67`); `pdfTextEdit`/`pdfImageEdit` tắt khi pdfium không chạy được
(`install.ts:109-110`) nhưng **các công cụ AI tương ứng không gate theo capability này** (chỉ `generate_image` có `cap()`,
`AiPanel.tsx:392`). `createDocument` web là stub (`web/modules/pdf/webapi.ts:995`); `fetchImage` web là stub `null`
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
| generate_image | desktop (provider); web khi có grant `imageGeneration` (+ công tắc cloud) (`web-ai.ts:59-67`, `module-bridge.ts:142-153`) | `{prompt, aspectRatio?}` → URL | — | không | `tools.ts:656`; desktop IPC `apps/pdf/src/main/pdf-main.ts:1683-1690` |
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
| create_document | desktop; web **stub** (`webapi.ts:995`, công cụ vẫn khai báo) | `{type: pdf/docx/md/html, title, content}` → file mới | — | file | `tools.ts:1141`; `App.tsx:5849`; main `apps/pdf/src/main/pdf-main.ts:1047` |

## 5. Kiểm an toàn (spec §6.3)

Bốn kiểm: (a) chạy macro/VBA/DDE/script; (b) tải URL từ nội dung tài liệu hoặc từ công cụ; (c) ghi ra ngoài tài liệu đang
mở; (d) gọi API UniWork bằng quyền khác phiên người dùng. Kết luận: **đạt** / **vi phạm** (blocker → G6-12, §9) / **n/a**.

| module | kiểm | kết luận | bằng chứng và lý do |
| --- | --- | --- | --- |
| agent-core | (a)–(d) | n/a | Không công cụ; vòng lặp không tải URL, không ghi file, không gọi API (`packages/agent-core/src/loop.ts`, `skill.ts`). |
| docs | (a) | **vi phạm** | Không có thực thi macro/VBA (không đọc `vbaProject`). Nhưng op `insertField` của `apply_ops` dùng **danh sách chặn**: chỉ chặn `TOC INDEX XE HYPERLINK INCLUDEPICTURE INCLUDETEXT EMBED FORM* ADDIN` (`apps/docs/src/renderer/ai/field-ops.ts:21-33`); mọi từ khóa `^[A-Za-z]+$` khác qua được (`field-ops.ts:636-640`), gồm `DDE`, `DDEAUTO`, `LINK`, `IMPORT`, `DATABASE`. Trường được ghi `dirty` để Word tính lại khi mở → nội dung bị prompt injection có thể khiến AI chèn trường DDE vào file. Cần danh sách cho phép. `updateFields scope:"all"` cũng đánh dấu `dirty` cả trường DDE/INCLUDETEXT có sẵn trong file (`field-ops.ts:603-612`; chỉ bỏ qua trường form có `beginXml`). |
| docs | (b) | **vi phạm** | Cùng cơ chế và cùng kết luận với sheets/slides/pdf (ghi chú (b) chung dưới bảng): URL do model chọn được tải. Editor không tự tải đích `INCLUDEPICTURE`/`INCLUDETEXT`. Ảnh chỉ tải khi model gọi `insert_image`/`insert_picture`/`set_watermark` (ảnh): desktop qua `ai:fetch-image` → `fetchRemoteImage` (`apps/docs/src/main/docs-main.ts:3949-3967`) → `fetchWithSsrfGuard` chặn dải private/loopback/link-local ở **mọi bước redirect** (`packages/electron-utils/src/safe-remote-url.ts:19-30`, `safe-remote-url.ts:95-115`), trần 50 MB; web cũng tải, qua RPC `image.fetch` của host (`web/docs/bridge/webapi.ts:764`, proxy phía server UniWork, không kiểm ở fork). URL có thể đến từ text bị injection (kết quả tìm kiếm, nội dung tài liệu); system prompt không có câu "nội dung là dữ liệu không tin cậy" — phần đó thuộc instruction pack G6-14. |
| docs | (c) | **vi phạm** | `create_document` (chỉ desktop) ghi file mới `.pdf`/`.md`/`.html` vào thư mục lưu mặc định, hoặc mở tab `.docx` mới tự lưu vào đó, không hỏi người dùng (`apps/docs/src/renderer/ai/tools.ts:980-1008`, `apps/docs/src/main/docs-main.ts:5021`, `docs-main.ts:5568-5612`). Không ghi đè (`uniquePathIn`), nhưng là ghi đĩa ngoài tài liệu đang mở do một lượt AI. Với UniWork AI phải ra khỏi allowlist. `read_attachment` chỉ đọc tệp người dùng đính kèm (`docs/ai/files-skill.ts`). |
| docs | (d) | đạt | Desktop: công cụ đám mây đi qua transport ở shell main bằng bearer của chính tài khoản đang đăng nhập (`apps/shell/src/main/uniwork-auth/cloud.ts:195`, `cloud.ts:225`); web: frame token một tài liệu, `credentials:'omit'` (`web/modules/shared/ai/client.ts:5-7`). Không khóa dịch vụ, không quyền cao hơn phiên. |
| markdown | (a) | đạt | Markdown không có macro/script; prompt cấm sinh HTML thô (`md/ai/markdown-skill.ts`, "Never emit raw HTML"). Cách render khối HTML thô/mermaid chưa được kiểm trong lane này. |
| markdown | (b) | **vi phạm** (desktop) | Như docs: chỉ `insert_image`/`generate_image` tải ảnh, chỉ `^https?://`, PNG/JPG/GIF, qua cùng `fetchRemoteImage` (`md/ai/tools.ts:319`); link trong tài liệu không bị công cụ tải. Web: `fetchImage` là stub `null` nên không tải gì (`web/modules/markdown/webapi.ts:133`) → đạt trên web. |
| markdown | (c) | đạt (ghi chú) | `insert_image`/`generate_image` ghi file ảnh vào thư mục assets **của chính tài liệu** (`apps/markdown/src/main/markdown-main.ts:913-920`; đường dẫn tài liệu lấy từ main, không từ renderer), giống khi người dùng dán ảnh (`apps/markdown/src/renderer/editor/localImage.ts:153`). Assets là một phần tài liệu Markdown (§6.5), nhưng file được ghi **ngay lúc gọi công cụ**, trước khi Lưu, và undo/rollback không xóa nó — xem §6. |
| markdown | (d) | đạt | Như docs. |
| html | (a) | đạt trên web; **vi phạm** trên desktop (chờ Product) | Script trong trang chạy trong preview iframe `sandbox="allow-scripts allow-forms allow-popups allow-modals"`, không `allow-same-origin` → không chạm được app (`apps/html/src/renderer/preview/PreviewFrame.tsx:178`). Web: `preview.html` có CSP riêng `connect-src 'none'`, `form-action 'none'` và iframe `credentialless` (`web/docs/build/modules.ts:121-127`). Desktop: giao thức `html-preview://` trả về không kèm CSP (`apps/html/src/main/preview-protocol.ts:45`) → script trong trang (kể cả script AI vừa viết qua `apply_ops`/`write_document`, vốn không được làm sạch) được dùng mạng, có thể gửi nội dung trang ra ngoài. Đây là hành vi có chủ ý của preview (trang dùng CDN), nhưng với lượt AI nó là đường rò; Product quyết: CSP cho preview desktop, làm sạch HTML do AI viết, hoặc chấp nhận có ghi lý do. |
| html | (b) | đạt (ghi chú) | Không công cụ AI nào của html tải URL (không có `insert_image`). `fetchImage` của main (`apps/html/src/main/html-main.ts:1651`) chỉ `^https?:` + `fetchRemoteImage`, dùng cho thao tác UI; web là stub `null` (`web/modules/html/webapi.ts:156`). Tài nguyên trang do preview tải là phần (a). |
| html | (c) | đạt | `apply_ops`/`plan_page`/`write_document` chỉ đổi bộ đệm editor (`apps/html/src/renderer/App.tsx:480-520`). Tham chiếu `attachment://` được thay bằng ảnh trong `assets/` của tài liệu hoặc `data:` (`html/ai/tools.ts:397`, `tools.ts:486`). |
| html | (d) | đạt | Như docs. |
| sheets | (a) | **đạt** | không có đường thực thi VBA/DDE; xlsm chỉ là phần mở rộng được nhận (`merge-skill.ts:13`), không có interpreter macro. `WEBSERVICE` chỉ có trong danh sách tiền tố `_xlfn` (`packages/xlsx-gateway/src/gateway/future-functions.ts:122`); **chưa xác minh** engine công thức (Univer/IronCalc) có thực thi nó không — không có `node_modules` ở checkout để đọc |
| sheets | (b) | **vi phạm** | op `add_image` của `propose_operations` tải URL do model đưa: desktop main `ai:fetch-image` (SSRF guard, ≤20 MB, `apps/sheets/src/main/sheets-main.ts:3866-3880,1638`), web qua proxy host `image.fetch` (`web/modules/sheets/bridge.ts:868-878`); URL có thể đến từ nội dung tài liệu/kết quả tìm kiếm (prompt injection). Thêm: đường không-URL đọc **file ảnh cục bộ bất kỳ** theo đường dẫn tuyệt đối model đưa (`apps/sheets/src/renderer/op-executor.ts:208-211` → `sheets-main.ts:2987-3002`, chỉ desktop) |
| sheets | (c) | **vi phạm** (desktop) | `create_document` ghi file mới vào thư mục lưu mặc định (`tools.ts:527`, `sheets-main.ts:1570,3184`). Web: **pass** (`createDocument:false`, `web/modules/sheets/capabilities.ts:32`; stub `bridge.ts:820`). Autosave sau lượt AI chỉ với file cục bộ, tắt với tài liệu UniWork (`App.tsx:635-637,3530-3547`) → pass cho tài liệu UniWork |
| sheets | (d) | **đạt** | công cụ cloud desktop dùng bearer của phiên người dùng ở main (`apps/shell/src/main/uniwork-auth/index.ts:210,263`; `packages/ai-provider/src/uniwork-cloud.ts:6-12`); web dùng frame token (`web/modules/shared/ai/web-ai.ts:9-15,207-219`). Chuỗi keyless (DuckDuckGo) không chạm API UniWork |
| slides | (a) | **đạt** | `execute_slide_script` chạy trong interpreter DSL riêng, không `eval`, không global (`slides-skill.ts:306,317`; `layout-script-interpreter.ts:15-49`); không có đường chạy macro pptm |
| slides | (b) | **vi phạm** | `insert_web_image`/`replace_image` tải URL do model đưa (desktop main, SSRF guard + trần, `apps/slides/src/main/ai-ipc.ts:344-380,417-449`); `generate_deck`/`regenerate_slide` tải `image_urls` trong pipeline local (`slides-main.ts:1092`); `analyze_media` nhận URL/đường dẫn cục bộ (trong media roots của tài liệu, `ai-ipc.ts:74-76,309-321`) và gửi cho provider. Web: tải ảnh là stub → pass trên web |
| slides | (c) | **vi phạm** (desktop) | `generate_deck`/`regenerate_slide` tự ghi nháp `<Documents>/UniWork Office/<name>.pptx` và chuyển `session.path` sang nháp (`apps/slides/src/main/slides-main.ts:780-810,1222,1274,1320,1350`), **không kiểm `uniworkIsBound`** → deck UniWork bị tách thành file cục bộ; sidecar `.styleskill.json` cạnh nháp (`ai-ipc.ts:487-503`); `save_style_template` ghi `userData/style-templates` (`ai-ipc.ts:507-525`). Web: pass (stub, `web-slides-api.ts:1127-1135`) |
| slides | (d) | **đạt** | như sheets; cloud slide generation tắt cứng (`slides-main.ts:997-1001`) |
| pdf | (a) | **đạt** | pdf.js mở không bật scripting: `getDocument({data, password, ...DOC_OPTS})` (`apps/pdf/src/renderer/App.tsx:1045-1049`, `view-config.ts:33-38`), không có `PDFScriptingManager`/`enableScripting` trong renderer (grep). Link ngoài mở qua main `shell.openExternal` khi người dùng bấm (`LinkLayer.tsx:47`), không phải do công cụ |
| pdf | (b) | **vi phạm** (desktop) | `insert_image`/`replace_image` tải URL do model đưa qua `ai:fetch-image` (`tools.ts:2811,2995` → `App.tsx:5830` → `apps/docs/src/main/docs-main.ts:3949`, SSRF guard). Web: pass (`fetchImage` stub null, `web/docs/bridge/ai.ts:121`) |
| pdf | (c) | **vi phạm** | `insert_blank_page`/`set_page_size`/`crop_pages`/`replace_pages` lưu chỉnh sửa chờ rồi ghi lại file (`App.tsx:5254-5261`; mô tả `pdf-skill.ts:32-37`); **trên web tạo version mới qua `api.save`** (`web/modules/pdf/webapi.ts:17-19,472-487,760-785`) — trái §6.4 "một lượt AI không tạo upload/version". `extract_pages`/`split_pdf`/`split_pages`/`merge_pages` ghi file mới (desktop) / tải xuống (web). `create_document` ghi file (desktop). Có card xác nhận người dùng (`tools.ts:1720-1727`) — giảm nhẹ, không thay quy tắc |
| pdf | (d) | **đạt** | như sheets |

Ghi chú (b) chung: SSRF guard (`fetchRemoteImage`, `packages/electron-utils/src/remote-image.ts:83`) chặn scheme khác http(s) và
địa chỉ private/link-local, kiểm từng redirect, có trần byte. Đó là giảm nhẹ; quy tắc spec "không tự tải URL" vẫn bị vi phạm khi
URL do model/nội dung tài liệu quyết định, nên ghi blocker để G6-12 quyết (vd chỉ cho URL đến từ `image_search`/`generate_image`
cùng lượt, hoặc tắt với nhà cung cấp UniWork AI).

Kiểm thêm theo spec §6.2: **công cụ đám mây** (`web_search`, `image_search`, `generate_image`, `analyze_media`) gửi query/prompt/ảnh
ra dịch vụ ngoài và tốn credit; chúng đi theo `office.ai_cloud` của tổ chức, không theo allowlist editor.

### 5.1 Sheets: công thức do engine tính hay model

- Công thức ghi bằng `propose_operations` (`set_formula`, `fill_range`, …) được **engine** tính: Univer formula engine trong renderer;
  web dùng xlsx WASM (IronCalc) trong worker cho lưu/recalc (`web/modules/sheets/engine/engine.worker.ts`,
  `web/modules/sheets/engine/stale-values.ts:1-30`); desktop có IronCalc recalc fallback (cap `recalcFallback`, tắt trên web).
  Công cụ đọc lại kết quả tính (≤10 ô, sau 300 ms) và báo lỗi `#REF!`… (`tools.ts:1307-1366`).
- Thống kê (`aggregate_range`) do JS tính trên giá trị ô (`aggregate.ts:33-70`), không phải model.
- **Không có gì ép** model dùng công thức/aggregate thay vì `set_cell` một số tự nhẩm — chỉ có prompt (`prompts/base.md`). Ghi vào §9.
- **Formula cache vs recalc:** chế độ lazy/streaming đọc giá trị từ file (giá trị cache `<v>`) cho vùng engine chưa nạp
  (`tools.ts:74-77,661-671`); đầu ra `read_range`/`read_cells`/`find_cells` **không đánh dấu** ô nào là cache, ô nào vừa recalc.
  Khi lưu, web làm mới hoặc xóa `<v>` cũ (`stale-values.ts:1-30`) và gateway đặt `fullCalcOnLoad`. Thiếu: cờ cache/recalc trong
  output công cụ (§8, §9).

## 6. Hiển thị và hoàn tác thay đổi AI (spec §6.4)

| module | thay đổi hiện ra thế nào | hoàn tác | một bước undo mỗi lượt? | kết luận §6.5 |
| --- | --- | --- | --- | --- |
| docs | **Theo dõi thay đổi AI tắt mặc định**: bật chỉ khi `localStorage['ai-docs-track-changes'] === '1'` (`docs/ai/AiPanel.tsx:167`, `AiPanel.tsx:392-394`). Bật: `insert_content`, `write_document`, `replace_blocks`, `replace_selection`, `apply_ops` ghi revision tác giả AI, duyệt ở tab Review (`docs/ai/protocol.ts:1202-1357`, `docs/ai/ops.ts:1495-1509`). Tắt: highlight vàng bị chấp nhận ngay trong cùng tick, không còn dấu (`AiPanel.tsx:805-808`). Biểu đồ, ảnh nổi, text box, chú thích, comment, header/footer, page setup, style, watermark không bao giờ được theo dõi. Thẻ edit queue (`docs/ai/edit-queue.ts`, `EditQueueCard.tsx`) là hàng đợi **chỉ dẫn trước khi gửi** (≤ 10 mục, ≤ 500 ký tự; `edit-queue.ts:14-16`), không hiển thị kết quả. | Nút Roll back của mỗi run: snapshot `editor.getJSON()` trước công cụ `mutated` đầu tiên (`AiPanel.tsx:790`, `AiPanel.tsx:802-804`, `AiPanel.tsx:1208-1219`). Không trả lại style/page setup/header-footer/watermark (ngoài cây ProseMirror) và không có snapshot nếu run chỉ gọi công cụ khai báo `mutated:false`. | **Không bảo đảm.** Không có `closeHistory`/nhóm lịch sử trong `apps/docs/src/renderer/ai`; mỗi công cụ là một giao dịch, lịch sử ProseMirror chỉ gộp theo cửa sổ thời gian mặc định. Chỉ bản nháp `write_document` không vào lịch sử (`docs/ai/doc-writer.ts:180`). | **blocker** cho hàng DOCX sửa: mặc định không có dấu vùng sửa trước khi Lưu; undo không theo lượt; rollback không đủ. |
| markdown | Highlight các khoảng do giao dịch `OP_META.source === 'ai'` đổi (`apps/markdown/src/renderer/editor/aiHighlight.ts`); edit queue như docs (`md/ai/edit-queue.ts:15-17`). Không có mô tả thay đổi dạng diff. | Roll back theo run (snapshot thân + frontmatter, `md/ai/AiPanel.tsx:397`). File ảnh đã ghi vào assets không bị xóa. | **Không bảo đảm.** Mỗi op một giao dịch (`apps/markdown/src/renderer/editor/ops.ts:552-555`), không nhóm lịch sử; `apply_ops` không nguyên tử. | **blocker** một phần: có dấu vùng sửa; thiếu undo một bước mỗi lượt. |
| html | Highlight khoảng AI sửa trong editor mã nguồn (`apps/html/src/renderer/source/SourceEditor.tsx:129`, `SourceEditor.tsx:146`), bị xóa khi người dùng gõ; thẻ brief/clarify/partial trong panel; preview nháp khi stream trang. Không có diff, không hiện trên preview. | Roll back theo run (snapshot `{text}`); Ctrl+Z của CodeMirror (`apps/html/src/renderer/source/cm-setup.ts:83`). | **Không bảo đảm.** Sửa của AI chỉ mang annotation `External` (`SourceEditor.tsx:118`), vào lịch sử CodeMirror mỗi lần dispatch; nhiều lượt gọi công cụ = nhiều bước undo. `plan_page`/`write_document` thay cả tài liệu trong một bước. | **blocker** một phần: có dấu vùng sửa ở mã nguồn, không ở preview; thiếu undo một bước mỗi lượt. |
| sheets | Thay đổi áp ngay vào lưới (không bước xem trước; card preview chỉ là fallback khi apply lỗi, `App.tsx:3579-3610`, `AiChatPanel.tsx:673-680`). Panel hiện "AI đã áp dụng N thay đổi" + nút [Undo] trên tin nhắn trợ lý (`AiChatPanel.tsx:649-666`). Không tô vùng đã sửa; không liệt kê range/ô bị ghi đè cho người dùng (before→after chỉ đi vào tool output cho model, `tools.ts:787-808`) | Nút [Undo] gọi `handleUndo(steps)` (`App.tsx:3819-3845`) và ⌘Z | **Có**: `undoSteps` cộng dồn mọi batch của cùng một tin nhắn trợ lý (`App.tsx:3597-3605,3681-3684`) → một nút hoàn tác cả lượt. Batch quá ngân sách undo → `undoSteps 0`, không có nút (`AiChatPanel.tsx:654-657`); apply lỗi giữa chừng có thể không hoàn tác được (`tools.ts:1374-1379`) | Có hiển thị + undo theo lượt. **Thiếu cho §6.5 XLSX**: target range + số ô bị ghi đè hiển thị cho người dùng → blocker hàng XLSX-sửa (§9) |
| slides | Thay đổi áp ngay lên deck; panel có chip công cụ, card tiến độ khi sinh deck; hàng đợi chỉnh sửa theo phần tử (`EditQueueCard.tsx`, `edit-queue.ts:1-12`, ≤10 mục, ≤500 ký tự, `edit-queue.ts:35-37`) | ⌘Z (lịch sử main process) + nút rollback trên tin nhắn (`AiPanel.tsx:2338-2345`, `aiSnapshotRestore` `AiPanel.tsx:776-791`); web qua engine (`web-slides-api.ts:996-1000`) | **Có**: `beginHistoryBatch` trước mỗi lượt, `endHistoryBatch` sau (`AiPanel.tsx:1717,767-775`); hàng đợi chỉnh sửa: một batch mỗi trang (`AiPanel.tsx:1777-1781,1871-1891`) | Đạt (không tô vùng sửa; chấp nhận theo "theo khả năng từng module") |
| pdf | Mọi chỉnh sửa (trừ thao tác cấp file) ở trạng thái chờ, vẽ trên trang (markup, khối text `T…`, sửa text/ảnh); tóm tắt chờ đi vào context (`App.tsx:5537-5549`); chip công cụ trong panel. Thao tác cấp file có card xác nhận (`AiPanel.tsx:297-317`) | ⌘Z: `pushUndo` chụp snapshot trước mỗi thay đổi, stack 50 (`App.tsx:1822-1828,1986`); `apply_ops` = một bước | **Không**: một bước undo cho mỗi lần gọi công cụ, không gộp theo lượt; không có nút hoàn tác lượt AI; lượt > 50 thay đổi đẩy bước cũ ra khỏi stack. Thao tác cấp file **không hoàn tác được** (`tools.ts:1716-1717`) | Hiển thị có. **Thiếu**: undo gộp theo lượt (đề xuất G6-12, không blocker theo §6.4 vì vẫn undo được từng bước); thao tác cấp file không undo → nằm trong violation (c) ở §5 |
| agent-core | Cung cấp `snapshotBefore` cho rollback (`packages/agent-core/src/loop.ts:13-21`); không có khái niệm nhóm undo. | — | — | Chỗ hợp lý để G6-09 thêm móc "bắt đầu/kết thúc lượt" cho editor nhóm lịch sử. |

## 7. Công cụ hỏi lại người dùng

| module | có không | chi tiết |
| --- | --- | --- |
| agent-core | không | Vòng lặp không có công cụ hỏi lại; một skill tự thêm nếu cần. |
| docs | **không** | Không có `ask_clarification` hay tương đương; model hỏi bằng văn bản trả lời rồi kết thúc lượt. Chỉ có luật prompt cho luồng comment (`docs/ai/protocol.ts:133`). |
| markdown | **không** | Prompt bảo model hỏi giá trị còn thiếu bằng văn bản (`md/ai/markdown-skill.ts`). |
| html | **có**: `ask_clarification` | `html/ai/tools.ts:324` (định nghĩa), `tools.ts:772` (thực thi). Hiện thẻ 1–4 câu, mỗi câu ≤ 5 lựa chọn, thẻ tự thêm "để AI quyết" và ô "khác"; **chặn run** tới khi người dùng trả lời (`html/ai/AiPanel.tsx:682-684`); bỏ qua/dừng/chat mới trả `cancelled` (`AiPanel.tsx:808`, `AiPanel.tsx:993`). Dùng trước khi tạo trang mới; `intentSkill` tắt nó khi ý định là "viết nội dung". |
| sheets | **không** | không có công cụ hỏi; chỉ hỏi bằng văn bản trả lời (không có `ask_*` trong `apps/sheets/src/renderer/ai/`) |
| slides | **có**: `ask_clarification` (card câu hỏi, chờ trả lời; `cancelled` khi người dùng bỏ) | `slides-skill.ts:462,1692`; `AiPanel.tsx:1033-1038` |
| pdf | **không** | prompt bảo hỏi bằng văn bản (`pdf-skill.ts:41`); `confirmFileOp` chỉ là card xác nhận có/không cho thao tác cấp file, không phải câu hỏi mở; `tools.ts:185,1720`; `AiPanel.tsx:297-317` |

Chip "Cần làm rõ" của G6-14 cần một tín hiệu xác định: module không có công cụ hỏi lại thì kết quả "cần làm rõ" chỉ nhận ra
được từ văn bản — mục G6-12 ở §9.

## 8. Đối chiếu ma trận tác vụ (spec §6.5)

Mỗi ô: công cụ dùng được (tên ở cột `tool` §3), hoặc `missing: <thiếu gì>`. Hàng XLSX, PPTX, PDF tách theo điểm con ở §8.1.

| hàng | đọc / phân tích | sửa trong editor (xem, hoàn tác, rồi Lưu) |
| --- | --- | --- |
| XLSX | xem §8.1 | xem §8.1 (áp ngay, chưa hiện target range + số ô bị ghi đè) |
| DOCX | Hỏi/tóm tắt: `get_document_context` + `read_blocks` (phân trang). Trích có anchor: chỉ số block từ hai công cụ trên; `read_comments`, `read_notes` trả block neo và text neo; `read_revisions` cho tracked change. Ảnh trong tài liệu: `analyze_media` (cần model media). So sánh/giải thích: `read_revisions`, `read_attachment` cho tệp thứ hai; `missing: công cụ so sánh hai tài liệu` (model tự so trong context). | Viết lại/rút gọn/dịch đoạn chọn: `replace_selection` (trong một block), `replace_blocks` (nhiều block, kể cả bảng — giữ độ rộng, viền, ô không đổi), `apply_ops` (nguyên tử, `dryRun`). Giữ bảng và phần không sửa: công cụ chỉ đổi khoảng được chỉ, kế thừa định dạng. `missing: dấu vùng sửa mặc định trước khi Lưu` (theo dõi thay đổi tắt mặc định), `missing: undo một bước mỗi lượt`, `missing: rào code giới hạn sửa trong vùng chọn` (chỉ prompt), `missing: tôn trọng bảo vệ Word` (§4.2). |
| PPTX | xem §8.1 | xem §8.1 |
| PDF có text layer | xem §8.1 | xem §8.1 |
| Markdown | Hỏi/tóm tắt theo heading/source range: `get_document_context` (nhãn `h1`–`h6` trong khung), `read_blocks` (theo chỉ số block), `read_frontmatter`. `missing: tra theo tên heading hoặc theo khoảng ký tự nguồn` (chỉ có chỉ số block). | Sửa vùng chọn: `apply_ops` (vùng chọn báo trong context là "block N..M"), `write_document` với `afterIndex`. Giữ frontmatter: chỉ op `setFrontmatter` ghi nó. Giữ link/assets ngoài vùng: chỉ nhờ prompt. `missing: rào code giới hạn op trong vùng chọn`, `missing: apply_ops nguyên tử`, `missing: undo một bước mỗi lượt`. Ảnh: `insert_image`/`generate_image` chỉ desktop. |
| HTML | Hỏi/tóm tắt nội dung: `get_outline`, `read_source` (theo `sid` hoặc dòng), `read_attachment` (desktop). `missing: trích văn bản thuần` (model đọc mã nguồn HTML). | Sửa text/DOM target: `apply_ops` (`set_text`, `set_attr`, `set_style`, `replace_element`, `insert_html`, `remove`, `move`, `str_replace`; nguyên tử, ≤ 40 op), mặc định nhắm phần tử đang chọn. `missing: làm sạch HTML do AI viết` (script, `on*=`, `javascript:`), `missing: CSP preview desktop` (§5 html (a)), `missing: undo một bước mỗi lượt`. `plan_page`/`write_document` thay cả trang — không nằm trong hàng "sửa target", nên ra khỏi allowlist khi lượt chỉ là sửa. |

### 8.1 XLSX, PPTX, PDF theo điểm con

| hàng / điểm con §6.5 | công cụ | thiếu |
| --- | --- | --- |
| XLSX đọc/phân tích: tổng/count/average | `aggregate_range` (sum/avg/min/max/count/distinct), `read_range`, `get_workbook_context` (extent) | Không có điều kiện/nhóm trong một công cụ (SUMIF/GROUP BY) — phải ghi công thức qua `propose_operations` hoặc đọc thô; `aggregate_range` không lọc theo điều kiện |
| XLSX: điều kiện, nhóm | `propose_operations` (công thức SUMIFS/COUNTIFS, `add_pivot`), `find_cells` | `missing: công cụ tính tổng/đếm có điều kiện + group-by chỉ đọc (không ghi workbook)`; distinct-count bằng công thức bị từ chối (`tools.ts:303`) |
| XLSX: đối chiếu sheet | `read_range`/`read_cells`/`aggregate_range` với `sheetId`, `find_cells` toàn workbook | `missing: công cụ so khớp hai range (join/diff) chỉ đọc` |
| XLSX: giải thích công thức | `trace_precedents`, `trace_dependents`, `read_cells` (công thức + giá trị) | Defined name không mở rộng (`tools.ts:461,479`) |
| XLSX: phát hiện bất thường | `find_cells errors_only`, `aggregate_range` (min/max/top values) | `missing: thống kê ngoại lai/kiểu không đồng nhất trong cột` |
| XLSX sửa: công thức/giá trị/cột dẫn xuất trong range | `propose_operations` (`set_formula`, `set_range`, `fill_range`, `copy_range`, `convert_to_values`) | Áp ngay, không xem trước (§6) |
| XLSX: nhãn cột X/Y/Z vs địa chỉ | `read_range` in header chữ cột A,B,…; selection kèm tên header cột (`tools.ts:693-706`) | Không có công cụ ánh xạ tên header → địa chỉ cột; model tự suy từ hàng header |
| XLSX: sheet id/range resolved | Mọi công cụ nhận `sheetId` (kiểm hợp lệ, `tools.ts:581-598`); `propose_operations` bắt buộc id từ `get_workbook_context` | Đạt |
| XLSX: kiểu/locale/percent (10 vs 10%) | `read_formats` (number format), `read_range` | Chế độ lazy trả **chuỗi hiển thị** (`workbook-readers.ts:434-440`), demo trả giá trị thô — không nhất quán; không trả kiểu ô (number/date/text/percent), không có `rawValue` trong output. `aggregate_range` chỉ cộng ô kiểu number, text "1.234,5" không được parse locale → `missing: kiểu ô + giá trị thô + number format trong cùng output đọc` |
| XLSX: dòng ẩn/lọc | `read_sheet_features` (AutoFilter, hidden) | `aggregate_range` của AI **tính cả dòng ẩn** (`App.tsx:1692`) và output không nói; `read_range` không đánh dấu dòng ẩn → `missing: cờ dòng ẩn/lọc + tùy chọn bỏ dòng ẩn cho AI` |
| XLSX: hàng tổng/subtotal | — | `missing: phát hiện hàng tổng/SUBTOTAL để không cộng trùng` |
| XLSX: recalc vs cache | `propose_operations` đọc lại sau recalc; lưu web làm mới/xóa `<v>` | `missing: cờ cache/recalc trên giá trị đọc` (§5) |
| XLSX: coverage counts | `aggregate_range` trả cells/nonEmpty/numericCount; `read_range` báo extent | `read_cells` cắt >100 địa chỉ **im lặng** (`tools.ts:1052`); không có "số dòng xử lý / bỏ qua vì không hợp lệ" |
| XLSX: target range + số ô bị ghi đè trước Lưu | Tool output cho model có before→after ≤20 ô (`tools.ts:787-808`); panel chỉ "N thay đổi" | `missing: hiển thị cho người dùng target range + số ô có dữ liệu bị ghi đè` → blocker hàng XLSX-sửa (spec §6.4/§6.5) |
| XLSX: workbook vượt giới hạn frame web | `xlsxEngine` cap + màn "mở bằng app" (`apps/sheets/src/renderer/capabilities.ts`, `web/modules/sheets/capabilities.ts:50`) | Đạt (GO-C4) |
| PPTX đọc/tóm tắt theo slide/text shape | `read_slide`, outline trong context (`slides-skill.ts:1128-1131`) | Đạt |
| PPTX sửa/dịch text shape | `execute_slide_script` (`setText`), `apply_ops` (`setText`) | Đạt; `generate_deck`/`regenerate_slide` vượt phạm vi §6.5 ("không hứa tạo layout toàn deck") và vi phạm (c) trên desktop |
| PDF có text layer: hỏi/tóm tắt với anchor | `read_pages`, `search_text`, `goto_page`, link `pdfnav://page/N` (`pdf-skill.ts:44`) | Trang scan: OCR chỉ desktop (`ocr` tắt trên web), output có nhãn OCR — đạt "không giả có text" |
| PDF text patch | `edit_text`, `edit_block`, `move_text_block`, `insert_text` | Font thay thế chỉ arial/times/courier (`tools.ts:421,459,538`); trên web cần pdfium — công cụ không gate theo `pdfTextEdit` → `missing: ẩn công cụ sửa text khi pdfium không có` |

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
15. docs, markdown — `insert_image`/`insert_picture`/`set_watermark` (ảnh)/`generate_image` tải URL do model chọn (docs: desktop và web
    qua `image.fetch`; markdown: desktop) — chỉ cho URL đến từ `image_search`/`generate_image` cùng lượt, hoặc tắt với UniWork AI —
    §5 docs (b), markdown (b).

16. sheets — `add_image` trong `propose_operations` tải URL do model đưa (desktop + web proxy) và đọc ảnh cục bộ theo đường dẫn tuyệt đối (desktop) — vi phạm §6.3 (b), đọc file ngoài tài liệu — §5 sheets (b).
17. sheets — `create_document` ghi file mới trên desktop — vi phạm §6.3 (c) — §5 sheets (c). (Web đã tắt.)
18. sheets — hiển thị cho người dùng target range + số ô có dữ liệu bị ghi đè trước Lưu — spec §6.5 XLSX, §6.4 — hàng XLSX sửa.
19. sheets — output đọc có kiểu ô, giá trị thô và number format (phân biệt 10 vs 10%), nhất quán giữa chế độ demo/lazy — §6.5 XLSX types/locale.
20. sheets — `aggregate_range` cho AI: tùy chọn/mặc định bỏ dòng ẩn/lọc và báo số dòng ẩn đã bỏ; cờ dòng ẩn trong `read_range` — §6.5 XLSX hidden/filtered.
21. sheets — công cụ chỉ đọc tính tổng/đếm/trung bình có điều kiện + group-by trên range, trả coverage (dòng xử lý, ô không hợp lệ bị bỏ) — §6.5 XLSX đọc (điều kiện, nhóm, coverage).
22. sheets — cờ cache/recalc trên giá trị công thức đọc ở chế độ lazy/streaming — §6.5 XLSX recalc vs cache.
23. sheets — `read_cells` báo khi cắt quá 100 địa chỉ (đang cắt im lặng, `tools.ts:1052`) — §6.5 coverage.
24. sheets — phát hiện hàng tổng/subtotal và so khớp hai range (đối chiếu sheet) dạng chỉ đọc — §6.5 XLSX đọc.
25. sheets, pdf — công cụ hỏi người dùng (`ask_user`/card như `ask_clarification`) cho "xác nhận ý nghĩa cột khi chưa rõ" (ví dụ nghiệm thu X/Y/Z) — §6.5 ví dụ nghiệm thu.
26. slides — `insert_web_image`/`replace_image`/pipeline `generate_deck`/`analyze_media` tải URL do model đưa — §6.3 (b).
27. slides — `generate_deck`/`regenerate_slide` tự ghi nháp `<Documents>/UniWork Office/*.pptx` và đổi `session.path` không kiểm `uniworkIsBound`; sidecar `.styleskill.json`; `save_style_template` ghi userData — §6.3 (c), §6.4.
28. slides — web khai báo cho model các công cụ chỉ là stub (`insert_web_image`, `replace_image`, `regenerate_slide`, `generate_deck`, `save_style_template`; `web_search`/`image_search` không gate theo grant) — cần gate theo capability như sheets `gateSkill` — §6.2 allowlist ("chỉ công cụ editor của module đang mở").
29. slides — `generate_deck`/`regenerate_slide` gọi LLM nội bộ ngoài vòng tool (style, outline, từng trang) — với UniWork AI cần đi qua cùng run id/trần lượt (§6.2 trần vòng tool) hoặc bị loại khỏi allowlist v1.
30. pdf — `insert_blank_page`/`set_page_size`/`crop_pages`/`replace_pages` lưu chỉnh sửa chờ và tạo version mới (web `api.save`) / ghi lại file (desktop), không hoàn tác được — §6.3 (c), §6.4 "một lượt AI không tạo upload/version/save".
31. pdf — `extract_pages`/`split_pdf`/`split_pages`/`merge_pages`/`create_document` ghi file mới (desktop) / tải xuống (web) — §6.3 (c).
32. pdf — `insert_image`/`replace_image` tải URL do model đưa (desktop) — §6.3 (b).
33. pdf — undo gộp theo lượt AI + nút hoàn tác lượt (đang một bước/công cụ, stack 50) — §6.4 hiển thị/hoàn tác.
34. pdf — gate công cụ sửa text/ảnh theo `pdfTextEdit`/`pdfImageEdit`, `create_document` và tải ảnh trên web (đang khai báo nhưng stub/lỗi) — §6.2 allowlist.
35. sheets, slides, pdf — chưa có cách phân biệt nhà cung cấp UniWork AI trong skill để áp allowlist v1 (MCP/skills tắt, cloud chỉ khi `office.ai_cloud`) — §6.2; G6-12 cần một predicate "provider = uniwork" cho getter `tools`.

### 9.1 Nghi vấn còn mở cho Product / owner F

Của phần docs/markdown/html:

- HTML desktop: thêm CSP cho preview / làm sạch HTML do AI viết, hay chấp nhận có ghi lý do (§5 html (a))?
- Markdown: ảnh do AI chèn được ghi vào thư mục assets trước khi Lưu — chấp nhận như "một phần tài liệu", hay dời việc ghi tới
  lúc Lưu (§9 dòng 12)?
- DOCX "so sánh và giải thích": cần công cụ so sánh hai tài liệu, hay so trong context là đủ (§9 dòng 14)?
- Bảo vệ Word (chỉ đọc/form/comment) có phải chặn công cụ AI không (§9 dòng 6)?
- Tải URL ảnh do model chọn (mọi module, §5 (b)): quy tắc G6-12 là "chỉ URL từ công cụ tìm/sinh ảnh cùng lượt" hay "tắt với
  UniWork AI"?

Của phần sheets/slides/pdf:

- `WEBSERVICE` (Excel) có được engine công thức thực thi không: không xác minh được vì checkout không có `node_modules`
  (Univer `engine-formula`, IronCalc). Đề xuất G6-12 thêm test "WEBSERVICE/FILTERXML trả lỗi, không mở mạng".
- `merge_attached_workbooks` ghi vào workbook nhưng không đặt `mutated` → extractor W1 sẽ ra `undeclared`; nút Undo của panel có
  phủ thao tác merge hay không chưa đọc tới (`mergeAttachedWorkbooks`, `App.tsx:1413-1420`).
- Hiển thị AI sheets không tô vùng sửa: Product quyết có đủ "theo khả năng từng module" (§6.4) khi đã có nút Undo theo lượt, hay
  bắt buộc dòng 18 ở §9 (target range + ô bị ghi đè) trước nghiệm thu.
- Card xác nhận của PDF cho thao tác cấp file: Product quyết có chấp nhận như ngoại lệ §6.4 (người dùng tự xác nhận) hay tắt các
  công cụ đó với tài liệu UniWork.

## 10. Ký duyệt cột tay (AC-4)

Cột tay (§2, §4–§9) chờ owner F + Product ký qua Advisor; chữ ký đóng gate G6-D4. Cột cơ học (§3) không cần ký: nó
được kiểm bằng lệnh AC-2 ở §1.
