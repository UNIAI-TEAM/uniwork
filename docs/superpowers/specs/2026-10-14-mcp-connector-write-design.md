# UniWork — Connector MCP v2: bộ tool đọc và ghi (Task, Dự án, Cuộc họp, Tài liệu)

> **Trạng thái:** in-progress — spec đã duyệt; plan chờ duyệt (UNI-1567); triển khai theo năm phase ở §12.

**Ngày:** 2026-10-14
**Issue:** UNI-1567 (parent UNI-1308)
**Roadmap ID:** A-13 · P1
**ADR mới:** 0033 — tool ghi qua MCP chạy trực tiếp bằng actor human (§11). Thay §3 của ADR 0031.
**Nối tiếp:** `2026-10-12-mcp-connector-design.md` (v1 chỉ đọc, 5 tool). Mọi phần của v1
không nhắc lại ở đây vẫn giữ nguyên: OAuth, token opaque, grant, cách ly tenant, flag
`mcp_connector`, công tắc tổ chức.
**Liên quan:** ADR 0007 (actor), ADR 0008 (tenant), ADR 0010 (AI không ghi trực tiếp),
ADR 0015 (revision trên `task.updated`), ADR 0031 (OAuth cho client ngoài).

## 1. Mục tiêu

Người dùng làm việc với UniWork ngay trong Claude, ChatGPT, Gemini CLI: không chỉ hỏi mà
còn tạo và sửa task, dự án, lịch họp, tài liệu. Bộ tool ngang với các connector chuẩn,
làm xong trước khi nộp Connectors Directory của Anthropic và Apps của OpenAI (UNI-1428,
làm sau cùng).

**Tiêu chí thành công**

1. Trong Claude: "tạo task 'Gửi báo giá ACME' giao cho Lan, hạn thứ Sáu, vào dự án Bán
   hàng" tạo đúng task; lịch sử task ghi "Vinh (qua Claude)".
2. "Dời cuộc họp giao ban sáng mai sang 10 giờ" sửa đúng giờ theo múi giờ của người dùng;
   nếu ai đó vừa sửa cuộc họp, tool từ chối và model đọc lại thay vì ghi đè.
3. "Thêm mục Rủi ro vào cuối tài liệu Kế hoạch Q4" nối nội dung, tài liệu có version "mcp"
   khôi phục được về trước lần sửa.
4. Người dùng bỏ chọn "Tạo và sửa" ở màn đồng ý: client không thấy tool ghi nào.
5. Admin tắt "Cho phép ghi": tool ghi biến mất và lời gọi bị từ chối, phần đọc vẫn chạy.
6. Không lệnh ghi nào chạm được dữ liệu của tổ chức ngoài grant (`TestIsolationMCP`).
7. Không tồn tại tool xóa.

## 2. Quyết định đã chốt (brainstorm 2026-10-14)

| Chủ đề | Quyết định |
| --- | --- |
| Cách xác nhận ghi | Ghi trực tiếp bằng `service.Human(userID)` của người đã đồng ý. Không qua `action_proposals`. Client (Claude, ChatGPT) hỏi người dùng trước mỗi tool không có `readOnlyHint` |
| Quyền | Scope `write` tách khỏi `read`; người dùng chọn ở màn đồng ý; admin tổ chức bật riêng phần ghi; flag rollout riêng |
| Phạm vi | Task, Dự án, Cuộc họp, Tài liệu (trang). Không chat, không Email Hub, không transcript (ADR 0031 §4 giữ nguyên) |
| Xóa | Không có tool xóa nào |
| Hoàn tác | Mọi tool ghi có đường hoàn tác; hủy họp có lệnh khôi phục mới |
| Ghi đè | Mọi tool `update_*` bắt buộc gửi `revision` đã đọc; lệch thì từ chối |
| Nguồn ghi | Dòng audit ghi `via` (client, grant); lịch sử hiện "(qua <client>)" |
| Chia việc | Phase 0 nền, rồi Task → Dự án → Cuộc họp → Tài liệu; mỗi phase một sub-issue, một PR |

Vì sao không theo ADR 0010: ADR đó chặn **agent tự chạy** ghi dữ liệu mà không người nào
bấm. Qua MCP, actor là chính người đã đồng ý, đang trò chuyện với client và được client
hỏi trước mỗi lệnh ghi. Rủi ro còn lại (prompt injection trong nội dung, model hiểu sai)
được chặn bằng các ràng buộc ở §8, không bằng hàng chờ duyệt trong UniWork.

## 3. Phạm vi

### 3.1 Trong phạm vi

- Scope `write`, màn đồng ý, công tắc "Cho phép ghi", flag `mcp_connector_write`.
- `via` trên audit; lịch sử task hiện nguồn.
- 21 tool mới (8 đọc, 13 ghi) và mở rộng `search`, `get_task`, `get_meeting` (§5).
- `MeetingService.Restore` (khôi phục cuộc họp đã hủy).
- Bộ chuyển page JSON ↔ Markdown (`server/internal/document/markdown.go`).
- `UpdateTaskInput.ExpectedRevision`, `UpdateMeetingInput.ExpectedVersion`.
- ADR 0033; sửa `CLAUDE.md`, roadmap A-13, spec v1.

### 3.2 Ngoài phạm vi

- Mọi tool xóa (task, dự án, comment, tài liệu, nhãn, status).
- Ghi file docx/xlsx/pptx/pdf; trích text từ docx/pdf.
- Chia sẻ, đổi quyền tài liệu; tạo thư mục.
- Sửa danh mục (tạo status, tạo nhãn, thuộc tính tùy biến).
- Nút hạ scope `write` → `read` trong cài đặt (hôm nay: kết nối lại và bỏ chọn ô ghi, hoặc thu hồi).
- MCP `elicitation`, `resources`, `prompts`; MCP Apps / Apps SDK UI.
- Nộp Directory (UNI-1428).

## 4. Nền ghi (Phase 0)

### 4.1 Scope

- PRM và metadata OAuth (`server/internal/handler/mcp_oauth.go`) khai
  `scopes_supported: ["read", "write"]`.
- Authorize nhận `read`, `write` hoặc `read write` (thứ tự bất kỳ). `write` luôn kéo theo
  `read`. Giá trị khác → `invalid_scope`. Không gửi scope → `read`.
- Grant lưu scope đã cấp (`read` hoặc `read write`). Token không có cột scope: scope hiệu
  lực luôn đọc từ grant tại thời điểm gọi.
- Phản hồi token trả `scope` của grant. Cấp hẹp hơn yêu cầu là hợp lệ (RFC 6749 §3.3).

### 4.2 Màn đồng ý

- Hai dòng quyền: "Đọc task, dự án, cuộc họp, tài liệu" (luôn có) và "Tạo và sửa" (ô
  chọn, **mặc định không chọn**).
- Dòng "Tạo và sửa" chỉ hiện khi yêu cầu có `write` **và** flag `mcp_connector_write` bật
  **và** tổ chức được chọn đã bật ghi. Thiếu một điều kiện → grant chỉ `read`.
- Grant đã có của (user, tổ chức, client): mỗi lần duyệt đặt scope của grant theo lựa
  chọn lần đó. Chọn ghi → `read write`; không chọn (hoặc dòng ghi không hiện) → `read`.
  Scope đổi thì audit `mcp_grant.scope_changed` (`from`, `to`). Vậy kết nối lại và bỏ
  chọn ô ghi là đường hạ scope, cùng với thu hồi.

### 4.3 Bật/tắt (cả ba phải đúng thì tool ghi mới tồn tại)

1. Flag `mcp_connector_write` trong `server/internal/featureflags/keys.go`
   (`Default: false`, `Public: true`, `ReviewAt` 2027-03-31). Override user > tổ chức >
   toàn cục như mọi flag.
2. Cột `organizations.mcp_write_enabled_at` / `mcp_write_enabled_by` (cùng kiểu với
   `mcp_enabled_at/_by`). `SetWritePolicy` chỉ bật được khi connector của tổ chức đang bật
   và flag bật; tắt connector thì `mcp_write_enabled_at` về NULL trong cùng transaction.
   Audit `organization.mcp_write_policy_changed`.
3. Grant có scope `write`.

`tools/list` chỉ liệt kê tool ghi khi đủ ba điều kiện. Gọi thẳng một tool ghi khi thiếu
điều kiện → kết quả lỗi `write_disabled` (thiếu 1 hoặc 2) hoặc `insufficient_scope`
(thiếu 3). Tắt ghi không thu hồi token; phần đọc chạy tiếp.

### 4.4 Ghi nguồn (`via`)

- `audit.RequestInfo` thêm `Via *Via` với `Via{Kind: "mcp", ClientID, GrantID,
  ClientName}`. Handler `/mcp` gắn vào ctx sau khi xác thực token.
- `Recorder.Record` và `RecordMany` ghi `metadata.via` khi ctx có `Via`. Mọi service ghi
  qua `Recorder` tự có nguồn, không sửa từng lệnh. `actor_kind` vẫn là `human`.
- Lịch sử task (`useResourceHistory` → `GET /api/v1/workspaces/{ws}/resources/{type}/{id}/history`)
  đã trả `metadata` của dòng audit; UI đọc `metadata.via.client_name` và hiện
  "Tên (qua Claude)". Không đổi API.
- Lệnh của MeetingService ghi audit qua `s.record` (lỗi audit chỉ log). Giữ nguyên
  hành vi đó; `via` vẫn vào được vì đi qua `Recorder`.

### 4.5 Định nghĩa tool

- `ai.Tool` thêm `Destructive bool` và `Undo string` (một câu nói cách hoàn tác; bắt buộc
  khác rỗng với tool ghi). `Kind` dùng `ai.ToolWrite` đã có.
- `server/internal/handler/mcp_transport.go` đọc annotation từ tool:
  `ReadOnlyHint = Kind == ToolRead`, `DestructiveHint = Destructive`,
  `OpenWorldHint = false`. Không còn hardcode.
- Tool tạo/nối/comment/mời: `destructiveHint=false`. Tool `update_*`, `cancel_meeting`:
  `destructiveHint=true`.
- Description của mỗi tool ghi nói tool đổi gì, ai thấy thay đổi, và cách hoàn tác.

### 4.6 Kết quả của tool ghi

Mọi tool ghi trả một mục `McpItem` (cùng kiểu tool đọc) của bản ghi sau khi ghi, cộng:

- `url` mở thẳng UniWork.
- `revision` mới.
- `changes`: danh sách `{field, from, to}` cho `update_*` (văn bản dài cắt 1.200 rune,
  ghi rõ đã cắt). Model dùng nó để báo lại và hoàn tác.
- Ngoại lệ cho trường mô tả dài (mô tả task; Phase 2–4 áp cùng mẫu cho mô tả dự án, cuộc
  họp): `from`/`to` không cắt tới `mcpMaxItemRunes` (16.000 rune), để hoàn tác luôn đúng.
  Tool đọc trả nguyên văn mô tả (trường `description`, có cờ khi bị cắt). Tool sửa từ chối
  thay mô tả hiện tại dài hơn giới hạn đó, và từ chối mô tả mới dài hơn giới hạn
  (`McpInvalidArgs`, sửa trong UniWork).

### 4.7 Revision

- Tool đọc trả `revision` cho task, dự án, cuộc họp, tài liệu.
- `update_task`: `UpdateTaskInput.ExpectedRevision *int64`, kiểm trong transaction của
  `TaskService.Update` (cùng chỗ `CheckTaskRevision`). Tool chạy `Update` trước; chỉ khi
  nó thành công mới gắn/gỡ nhãn và đổi task cha. Mỗi bước là một lệnh service riêng; bước
  sau lỗi thì kết quả nói rõ phần nào đã ghi.
- `update_project`: `ExpectedRevision` đã có.
- `update_meeting`: `UpdateMeetingInput.ExpectedVersion *int32` so với `meetings.version`
  trước khi ghi. `cancel_meeting`, `restore_meeting` cũng nhận `revision`.
- `update_document`: `Revision` đã có.
- Lệch → lỗi `revision_conflict` kèm revision hiện tại; model đọc lại rồi quyết định.
  Revision bắt buộc với mọi `update_*`, `cancel_meeting`, `restore_meeting`.

### 4.8 Ngân sách ghi

- 30 lệnh ghi mỗi phút cho mỗi grant, đếm ở handler `/mcp` khi tool được gọi là
  `ToolWrite`, khóa Redis `mcp-write:<grant_id>`. Dùng chung cách đếm của
  `server/internal/middleware/ratelimit.go` (xuất một hàm đếm, không viết bộ đếm thứ
  hai): bỏ qua sau 100ms và cho qua khi Redis lỗi, không có Redis thì không giới hạn.
- Vượt → lỗi `write_rate_limited` ("quá nhiều lệnh ghi, thử lại sau một phút").
- Hạn `mcp` 120/phút và `mcp-ip` 1200/phút giữ nguyên.

### 4.9 Lỗi

Một bảng ánh xạ duy nhất trong `mcp_tools` từ lỗi service sang câu cho model:

| Lỗi service | Câu trả model |
| --- | --- |
| `ErrForbidden`, `ErrNotFound`, tổ chức bị khóa/xóa, thành viên bị vô hiệu | Câu "không tìm thấy hoặc không có quyền" chung của v1 (`hidden()`) |
| `revision_conflict` | Đã có người sửa; revision hiện tại là N, đọc lại trước khi ghi |
| `active_duplicate_task`, `duplicate_project_title` | Đã có bản ghi cùng tên; nêu id/link của bản ghi đó nếu đọc được |
| `assignee_not_member` | Người này không thuộc workspace; gợi ý `list_members` |
| `ErrQuotaExceeded` | Tổ chức đã hết hạn mức của gói |
| `parent_cycle`, `cross_workspace_reference` | Lý do cụ thể |
| Lỗi validate khác (thiếu tiêu đề, ngày sai) | Thông điệp validate của service |
| Lỗi hệ thống | "Lỗi máy chủ, thử lại sau"; không lộ chi tiết |

Lỗi trả dạng kết quả tool `isError: true`, không phải lỗi JSON-RPC.

## 5. Danh mục tool

26 tool: 13 đọc (5 của v1, 8 mới), 13 ghi. Mọi tool đi qua `inGrant` (workspace thuộc
tổ chức của grant) và `hidden()` như v1. Tham số id task nhận cả ULID lẫn mã `ABC-12`
(`TaskService.GetByRef`). Mọi danh sách tối đa 50 mục, mỗi mục cắt theo
`mcpMaxItemRunes`.

| Phase | Tool | Loại | Destructive |
| --- | --- | --- | --- |
| v1 | `list_workspaces`, `my_work`, `get_task`, `get_meeting`, `search` | đọc | |
| 1 | `list_members`, `task_options`, `list_tasks` | đọc | |
| 1 | `create_task`, `add_comment` | ghi | không |
| 1 | `update_task` | ghi | có |
| 2 | `list_projects`, `get_project` | đọc | |
| 2 | `create_project` | ghi | không |
| 2 | `update_project` | ghi | có |
| 3 | `list_meetings` | đọc | |
| 3 | `schedule_meeting`, `invite_to_meeting`, `restore_meeting` | ghi | không |
| 3 | `update_meeting`, `cancel_meeting` | ghi | có |
| 4 | `list_documents`, `get_document` | đọc | |
| 4 | `create_document`, `add_document_comment` | ghi | không |
| 4 | `update_document` | ghi | có |

### 5.1 Task (Phase 1)

| Tool | Tham số | Service |
| --- | --- | --- |
| `list_members` | `workspace_id` | Query riêng `ListAssignableMembers` qua `WorkspaceService.AssignableMembers`: thành viên workspace cộng owner/admin tổ chức có quyền ngầm (vai trò `org_owner`/`org_admin`), bỏ người đã bị vô hiệu. Danh sách thành viên của UI không đổi. Trả tên, vai trò, `user_id`. **Không trả email** |
| `task_options` | `workspace_id` | `ListTaskStatuses` (key, tên, nhóm), `ListTaskLabels` (id, tên), danh sách ưu tiên `none/low/medium/high/urgent` |
| `list_tasks` | `workspace_id`, `status?`, `project_id?`, `limit?` | `TaskService.QueryTasks` |
| `create_task` | `workspace_id`, `title`, `description?` (Markdown), `status?`, `priority?`, `assignee_id?`, `start_date?`, `due_date?` (`YYYY-MM-DD`), `project_id?`, `parent_task_id?`, `label_ids?` | `TaskService.Create`; `AllowDuplicate` luôn false |
| `update_task` | `task_id`, `revision`, cùng các trường của `create_task` (bỏ trống = giữ nguyên; `null` = xóa giá trị với người làm, ngày, project), `add_label_ids?`, `remove_label_ids?` | `Update` (với `ExpectedRevision`), rồi `AttachTaskLabel`/`DetachTaskLabel`, `SetParent` (§4.7) |
| `add_comment` | `task_id`, `body` (Markdown), `reply_to?` | `AddCommentSuite` |

`get_task` (v1) trả thêm `revision`, nhãn, project, task cha. Mô tả task lưu Markdown như
editor web; server không chuyển đổi.

### 5.2 Dự án (Phase 2)

| Tool | Tham số | Service |
| --- | --- | --- |
| `list_projects` | `workspace_id`, `query?`, `status?`, `include_closed?` | `ListProjects`; có `query` thì `SearchProjects` |
| `get_project` | `project_id` | `GetProject`, `ProjectStats`, 20 task đầu theo thứ tự của `QueryTasks` (khóa trạng thái theo chữ cái, rồi vị trí) |
| `create_project` | `workspace_id`, `title`, `description?`, `status?`, `priority?`, `lead_id?`, `start_date?`, `due_date?` | `CreateProject` với `CreateChannel=false` |
| `update_project` | `project_id`, `revision`, cùng các trường | `UpdateProject` (gate `authorizeProjectEdit`) |

Gắn task vào dự án qua `project_id` của `create_task` / `update_task`.

### 5.3 Cuộc họp (Phase 3)

| Tool | Tham số | Service |
| --- | --- | --- |
| `list_meetings` | `workspace_id`, `from`, `to` (ISO 8601 có offset, cách nhau tối đa 92 ngày), `hosted_by_me?`, `status?` | `MeetingService.ListFiltered` theo `starts_at` |
| `schedule_meeting` | `workspace_id`, `title`, `description?`, `starts_at`, `ends_at` (ISO có offset), `timezone?`, `attendee_ids?`, `project_id?` | `MeetingService.Create`. `timezone` trống → múi giờ trong hồ sơ người dùng (`PeopleService`), không có thì `Asia/Ho_Chi_Minh` |
| `update_meeting` | `meeting_id`, `revision`, `title?`, `description?`, `starts_at?`, `ends_at?`, `timezone?`, `project_id?` | `MeetingService.Update` với `ExpectedVersion`. Chỉ host hoặc admin; đang họp không đổi giờ |
| `invite_to_meeting` | `meeting_id`, `user_ids` (tối đa 20) | `MeetingService.Invite` từng người; trả kết quả từng người |
| `cancel_meeting` | `meeting_id`, `revision`, `reason?` | `MeetingService.Cancel` |
| `restore_meeting` | `meeting_id`, `revision` | `MeetingService.Restore` (mới) |

`get_meeting` (v1) trả thêm người dự và `revision`.

**`MeetingService.Restore(ctx, userID, meetingID, expectedVersion)`** (mới):

- Gate `requireHostOrAdmin`. Chỉ từ `CANCELED`, và `ends_at` còn ở tương lai; khác →
  `errInvalidState`.
- Đưa về `SCHEDULED`, xóa `canceled_at`/`canceled_by`/`cancel_reason`, tăng `version`,
  ghi `updated_by`.
- Audit `meeting.restored` (vào `audit_coverage_test.go`); phát `meeting.updated` (chỉ
  id, đã có trong catalogue). Hủy hiện không có rule thông báo, nên khôi phục cũng không.
- UI web có nút "Khôi phục" ở cuộc họp đã hủy cho host/admin (cùng lệnh, cùng gate).

`invite_to_meeting` báo cho từng người được mời trong app (rule `participant.invited`), và
description của nó nói rõ điều đó. `schedule_meeting` thêm người trong `attendee_ids` vào cuộc
họp nhưng không báo ai, vì `MeetingService.Create` không phát `participant.invited` (đường tạo
họp trên web cũng vậy). Description của nó nói rõ điều này và chỉ sang `invite_to_meeting`.
Đổi giờ, hủy và khôi phục cũng không báo ai: không có rule cho `meeting.updated` hay
`meeting.canceled`. Tạo lịch không mở phòng LiveKit và không ghi lịch Google.

### 5.4 Tài liệu (Phase 4)

| Tool | Tham số | Service |
| --- | --- | --- |
| `search` (mở rộng) | như v1 | Thêm tài liệu qua `ListDocuments{Query}`; mỗi mục có `type: task/meeting/document` và snippet |
| `list_documents` | `workspace_id`, `parent_id?`, `cursor?` | `ListDocuments` theo thư mục |
| `get_document` | `document_id` | `GetDocument`. Trang → Markdown + `revision` + `lossy`. File md/html → nội dung text (cắt `mcpMaxItemRunes`). File khác → metadata và link |
| `create_document` | `workspace_id`, `title`, `content` (Markdown), `parent_id?` | `CreatePage` với `Kind=page`; quyền hiển thị kế thừa thư mục cha |
| `update_document` | `document_id`, `revision`, `title?`, `content?` (Markdown), `mode` (`append` mặc định, hoặc `replace`) | `CreateDocumentVersion` (lý do `mcp`, bỏ qua khi `document_version_unchanged`) rồi `UpdateDocument`. `append` nối nội dung mới vào cuối nội dung hiện có |
| `add_document_comment` | `document_id`, `body` | `AddDocumentComment` |

Tài liệu do Work Product sở hữu không xuất hiện trong `search`/`list_documents` (ADR 0016,
`owner_id IS NULL`) nhưng `get_document` theo id vẫn đi qua quyền của chủ sở hữu như UI.

**Bộ chuyển `server/internal/document/markdown.go`** (hai hàm thuần, không I/O):

- `PageToMarkdown(content json.RawMessage) (md string, lossy bool, err error)`.
- `MarkdownToPage(md string) (json.RawMessage, error)`; kết quả đi qua sanitize hiện có
  trước khi lưu, nên vẫn chịu đủ giới hạn kích thước và độ sâu.
- Phủ đủ schema đóng (`server/internal/document/schema.go`): đoạn văn, heading 1–3, danh
  sách thường/số/task (`- [ ]`), trích dẫn, khối code, kẻ ngang, xuống dòng cứng, bảng
  (GFM), bold/italic/underline/strike/code/link.
- Mention ↔ `[@Tên](uniwork://user/<id>)` (tương tự `task`, `document`, `meeting`).
  Ảnh ↔ `![alt](asset://<id>)`; `MarkdownToPage` chỉ nhận `asset://` đã tồn tại trong
  nội dung cũ của chính tài liệu, ảnh URL ngoài thành link thường.
- Underline không có trong Markdown: viết `<u>…</u>` và chỉ nhận đúng thẻ này; HTML khác
  thành văn bản thường.
- `lossy = true` khi ô bảng chứa nhiều khối (nhiều đoạn, danh sách). `update_document`
  `mode=replace` trên tài liệu `lossy` → lỗi "tài liệu có nội dung Markdown không giữ
  được, dùng append". Dữ liệu không mất vì một vòng đọc rồi ghi lại.
- Thư viện: `server/go.mod` chưa có parser Markdown; thêm `github.com/yuin/goldmark`
  (CommonMark + extension GFM table/tasklist/strikethrough), ghim phiên bản. Chiều
  page → Markdown tự viết, không cần thư viện.

## 6. Hoàn tác

| Tool | Cách hoàn tác |
| --- | --- |
| `create_task` | Người dùng xóa trên UI, hoặc `update_task` đổi status |
| `update_task` | `update_task` với `from` trong `changes` |
| `add_comment`, `add_document_comment` | Tác giả xóa trên UI |
| `create_project` | Người dùng xóa trên UI |
| `update_project` | `update_project` với giá trị cũ |
| `schedule_meeting` | `cancel_meeting` |
| `update_meeting` | `update_meeting` với giá trị cũ |
| `invite_to_meeting` | Host gỡ người dự trên UI |
| `cancel_meeting` | `restore_meeting` |
| `restore_meeting` | `cancel_meeting` |
| `create_document` | Người dùng đưa vào thùng rác trên UI (khôi phục được) |
| `update_document` | Khôi phục version `mcp` trong lịch sử phiên bản |

Chuỗi trong `ai.Tool.Undo` là cột phải của bảng; test bắt buộc mọi tool ghi có nó.

## 7. Giao diện web

- **Màn đồng ý** (`packages/views/auth/connect-consent.tsx`): hai dòng quyền, ô "Tạo và
  sửa" (§4.2). API consent trả thêm `write_available`.
- **Ứng dụng đã kết nối** (cá nhân) và danh sách grant của tổ chức: cột/nhãn scope "Chỉ
  đọc" / "Đọc và ghi".
- **Settings › AI access** (`packages/views/settings/components/ai-access-tab.tsx`):
  công tắc thứ hai "Cho phép tạo và sửa", `aria-disabled` khi connector tắt hoặc flag
  ghi tắt, giải thích một dòng.
- **Lịch sử task**: "Tên (qua Claude)" khi dòng có `via`.
- **Cuộc họp đã hủy**: nút "Khôi phục" cho host/admin.
- Endpoint mới hoặc đổi ở `packages/core/api/endpoints/` có schema lenient và test
  malformed-response. Key i18n vi/en theo `docs/conventions.md`.

## 8. Bảo mật

| Mối đe dọa | Chặn bằng |
| --- | --- |
| Prompt injection trong nội dung task/tài liệu xúi model ghi | Client hỏi người dùng trước mỗi lệnh ghi; không có tool xóa; ngân sách 30 lệnh ghi/phút/grant; mọi lệnh có hoàn tác và `via` để lần ra |
| Ghi vào tổ chức khác | `inGrant` và `RequireMember` như v1; `TestIsolationMCP` thêm ca ghi |
| Tự nâng scope | Scope đọc từ grant tại lúc gọi; lên `write` chỉ qua màn đồng ý; admin và flag là hai lớp độc lập |
| Ghi đè thay đổi của người khác | `revision` bắt buộc với mọi `update_*` |
| Mất nội dung tài liệu khi chuyển Markdown | `lossy` chặn `replace`; version `mcp` trước mỗi lần sửa |
| Lộ email qua tra cứu người | `list_members` không trả email |
| Tạo hàng loạt | Không có tool batch; ngân sách ghi; duplicate guard của task và dự án luôn bật |
| Chèn HTML/script qua Markdown | `MarkdownToPage` chỉ sinh node của schema đóng và đi qua sanitize; mô tả/comment task là Markdown hiển thị qua renderer hiện có |

## 9. Audit, sự kiện, vận hành

- Mọi lệnh ghi dùng lại audit và outbox của service gọi tới; thêm `metadata.via`.
- Hành động audit mới: `mcp_grant.scope_changed`, `organization.mcp_write_policy_changed`,
  `meeting.restored` (vào `server/internal/service/audit_coverage_test.go`).
- Không thêm topic outbox; không đổi catalogue sự kiện.
- Metric tool hiện có thêm nhãn `kind` (`read`/`write`); span gắn `mcp.scope`.
- Không log input/output của tool (giữ quy ước v1, `scripts/no-pii-log.test.mjs`).
- Migration mới: hai cột ở `organizations` (theo luật migration của `CLAUDE.md`).
- Runbook MCP thêm mục "tắt riêng phần ghi": override flag `mcp_connector_write` = false
  ở `/admin/flags`, hoặc công tắc của tổ chức.

## 10. Test

| Luật | Test |
| --- | --- |
| Tool đọc không ghi | `TestMCPReadToolsDoNotMutate` (thay `TestMCPToolsAreReadOnly`): mọi tool `ToolRead` chạy xong, số dòng `audit_events` và `outbox_events` không đổi |
| Tool ghi cần đủ ba điều kiện | `TestMCPWriteToolsNeedScopeFlagAndPolicy`: thiếu từng điều kiện → không có trong `tools/list` và lời gọi bị từ chối đúng mã |
| Không có tool xóa | `TestMCPHasNoDeleteTool`: không tên `delete_*`/`remove_*`; arch test `TestMcpToolsCallNoDelete`: `mcp_tools*.go` không gọi `Delete*`, `BatchDelete*`, `ArchiveDocument` |
| Mọi tool ghi có hoàn tác | `TestMCPWriteToolsDeclareUndo` |
| Annotation đúng | `TestMcpToolListCarriesAnnotationsAndSchemas` mở rộng: `readOnlyHint`, `destructiveHint` theo bảng §5 |
| Cách ly tenant | `TestIsolationMCP` thêm mọi tool ghi: id của tổ chức A qua grant của B bị từ chối bằng câu chung, hash dòng của A không đổi; grant của A làm control |
| Revision | Mỗi `update_*`: revision cũ → `revision_conflict`, không ghi |
| Nguồn ghi | Lệnh ghi qua `/mcp` có `metadata.via.grant_id`; lệnh qua REST không có |
| Ngân sách | Lệnh ghi thứ 31 trong một phút bị từ chối; lệnh đọc không bị tính |
| Bộ chuyển Markdown | Golden test từng node/mark; khứ hồi page → Markdown → page bằng nhau trên các tài liệu mẫu không `lossy`; `lossy` đúng với ô bảng nhiều khối; đầu vào HTML/script không sinh node lạ |
| Khôi phục họp | Đã hủy + còn hạn → `SCHEDULED`; quá giờ hoặc chưa hủy → lỗi; người không phải host/admin → từ chối |
| Web | Consent có/không có ô ghi; công tắc ghi; nhãn scope; test malformed-response cho endpoint mới; E2E đồng ý có quyền ghi |

Mỗi phase còn chạy checklist thủ công trên Claude, ChatGPT (developer mode) và Gemini CLI
trước khi merge: liệt kê tool, một lệnh ghi thành công, một lệnh bị `revision_conflict`,
tắt ghi giữa chừng.

## 11. ADR 0033

Tiêu đề: "Tool ghi qua MCP chạy trực tiếp bằng actor human của người đã đồng ý". Ghi:

1. Thay §3 của ADR 0031: tool ghi qua MCP không đi qua `action_proposals`; nó gọi service
   bằng `service.Human(userID)` của người đã đồng ý, qua `RequireMember` như màn hình.
2. ADR 0010 vẫn nguyên cho agent runtime của UniWork; ranh giới là ai khởi động lệnh
   (người qua client vs agent tự chạy), không phải có model ở giữa hay không.
3. Điều kiện bắt buộc: scope `write` do người dùng chọn; admin tổ chức bật riêng; không
   có tool xóa; mọi tool ghi có hoàn tác; `revision` cho mọi lệnh sửa; audit ghi `via`.
4. Dự án và tài liệu thêm vào dữ liệu connector được đọc và ghi; chat, Email Hub,
   transcript vẫn ngoài phạm vi (ADR 0031 §4).

ADR 0031 đổi dòng trạng thái: vẫn `accepted`, ghi chú §3 bị thay bởi 0033.

## 12. Giai đoạn và issue

Mỗi phase là một sub-issue của UNI-1308 (`make issue-sub`), một nhánh, một PR vào
`develop`, merge sau CI xanh và checklist thủ công. Phase sau bắt đầu từ `develop` đã có
phase trước.

| Phase | Nội dung | Phụ thuộc |
| --- | --- | --- |
| 0 | ADR 0033 có hiệu lực trong code: scope, consent, flag, công tắc tổ chức, `via`, annotation theo tool, ngân sách, bảng lỗi, bốn test luật, sửa `CLAUDE.md` | — |
| 1 | Task: 6 tool, `ExpectedRevision`, `list_members` đủ người, `get_task` mở rộng, lịch sử "(qua …)" | 0 |
| 2 | Dự án: 4 tool | 1 (`list_tasks`, `project_id`) |
| 3 | Cuộc họp: 6 tool, `Restore`, nút Khôi phục, `ExpectedVersion` | 0 |
| 4 | Tài liệu: bộ chuyển Markdown, 5 tool, `search` mở rộng | 0 |
| — | UNI-1428 nộp Directory | 0–4 |

Spec này và ADR 0033 merge trước Phase 0, dưới UNI-1567.

## 13. Rủi ro và việc sau

| Rủi ro | Giảm thiểu |
| --- | --- |
| Client không hỏi người dùng trước lệnh ghi (cấu hình "luôn cho phép") | Ngân sách ghi, không có xóa, hoàn tác, `via`; admin tắt được tức thì |
| Model chọn nhầm người (trùng tên) | `list_members` trả vai trò; kết quả ghi nêu tên người được giao để người dùng thấy ngay |
| Bộ chuyển Markdown thiếu trường hợp | `lossy` mặc định an toàn (chặn `replace`); version `mcp` |
| 26 tool làm model chọn sai tool | Description ngắn, động từ rõ; `title` cho mọi tool (UNI-1460) |
| Directory soi kỹ tool ghi | `destructiveHint` đúng, description nói rõ hoàn tác, không có xóa |

**Việc sau (spec riêng)**

1. Nút hạ scope `write` → `read` trong cài đặt.
2. Trích text từ docx/pdf cho `get_document`.
3. Tool tạo thư mục, chia sẻ tài liệu.
4. MCP Apps / Apps SDK: thẻ task tương tác.

## 14. Bước tiếp theo

1. Người dùng duyệt spec này và ADR 0033.
2. `writing-plans` → `docs/superpowers/plans/2026-10-14-mcp-connector-write.md`; mỗi
   phase một sub-issue của UNI-1308.
