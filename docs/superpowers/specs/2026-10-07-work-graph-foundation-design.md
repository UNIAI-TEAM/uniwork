# Work Graph nền (C-11): catalogue, projector, nối tay, panel Liên quan

> **Trạng thái:** Đã duyệt (2026-10-07, quangpd). Thiết kế khái niệm đã chốt cùng chủ sở hữu sản phẩm ngày 2026-10-07 (mười quyết định, xem §1.2). ADR 0019 accepted. Kế hoạch: lát 1 trước, ba vá §9.1 song song. §13 ghi các điều chỉnh sau khi đối chiếu mã ngày 2026-10-07 (chờ xác nhận cùng hai kế hoạch).

**Roadmap:** C-11 (P1). Mở đường cho C-12 Decision record, Goal, Context Engine / A-04, A-01.
**Issue:** chưa tạo.

## 1. Mục tiêu

Work Graph là lớp duy nhất trong UniWork biết **vì sao** một việc tồn tại, **ai** chịu
trách nhiệm, **đến khi nào**, nó **xuất phát từ đâu** và **được bàn ở đâu**. Các module
giữ sự kiện rời rạc; Work Graph nối chúng thành một đồ thị có hướng, có thời gian,
có bằng chứng, và trả lời được bằng truy vấn thay vì bằng trí nhớ con người.

C-11 là nền: catalogue từ vựng, bốn bảng đồ thị, projector qua outbox, bảng nghiệp vụ
cho nối tay, API đọc một bước và dòng thời gian, lệnh dựng lại, panel "Liên quan" trên
sáu trang chi tiết, dòng thời gian trên trang việc. Khi C-11 xong, mọi việc, cuộc họp,
dự án, tài liệu, phòng chat và luồng thư của một tổ chức có mặt trên một đồ thị chung,
dựng lại được từ bảng nguồn và cho kết quả giống hệt.

### 1.1 Hiện trạng

- Repo chưa có lớp quan hệ nào ngoài khoá ngoại rải rác: `tasks.project_id`,
  `tasks.parent_task_id`, `tasks.assignee_type/assignee_id`,
  `tasks.origin_type/origin_id` (giá trị đang dùng: `meeting`, `email_thread`,
  `chat_message`), `task_dependencies` (`blocks` / `blocked_by` / `related`),
  `chat_thread_task_links`, `projects.lead_type/lead_id`,
  `organization_member_profiles.department_id`, `meeting_participants`.
- Ask UNI chấm điểm từ khoá trong bộ nhớ (`service/askuni_sources.go`), không có đồ thị
  để hỏi "vì sao".
- Bản nháp `unidigiwork` có `work_nodes/work_edges`; đã khảo sát 2026-10-06 và chỉ
  mượn nguyên tắc (projection, catalogue, idempotent bằng UNIQUE), không mượn SQL vì mã
  đó trôi khỏi thiết kế ở quyền và nguồn gốc.
- ADR 0019 chốt: đồ thị là projection qua outbox; projector idempotent; khoá duy nhất
  `(từ, loại, tới)`; cấm suy diễn quan hệ; từ vựng có kiểm soát với nguồn gốc người/AI;
  không node cho lượt thực thi trước A-01; quyền node không rộng hơn bản ghi nguồn.

### 1.2 Quyết định đã chốt

| # | Quyết định |
|---|---|
| D1 | Spec đầu tiên của giai đoạn 1 là Work Graph nền. Decision record (C-12), Goal và Context Engine là ba spec sau; catalogue khai đủ loại node cho chúng ngay từ C-11. |
| D2 | Bật projector cho **bảy** loại node có bảng hôm nay: việc, cuộc họp, dự án, actor (thành viên và agent), phòng ban, tài liệu, luồng (phòng chat và luồng thư). |
| D3 | Người dùng nối tay và gỡ ba loại cạnh HUMAN: `EVIDENCED_BY`, `DISCUSSED_IN`, `ORIGINATED_FROM`. Gợi ý AI để giai đoạn 2. |
| D4 | Panel "Liên quan" trên sáu trang chi tiết: việc, cuộc họp, dự án, tài liệu, phòng chat, luồng thư. |
| D5 | Dòng thời gian đọc từ đồ thị trên trang việc. |
| D6 | Kho chiếu trong Postgres; nối tay đi qua bảng nghiệp vụ `work_links` rồi projector chiếu, để chỉ projector ghi đồ thị (phương án A, §3). |
| D7 | Từ vựng đóng, không `RELATED_TO`; mỗi cạnh có một bằng chứng; `OWNED_BY` và hạn là sự thật có thời gian, không phải thuộc tính tĩnh. |
| D8 | Người dùng không xoá cạnh SYSTEM; họ sửa bản ghi nguồn và đồ thị tự theo. |
| D9 | Không chia sẻ đồ thị ra ngoài tổ chức trong bốn giai đoạn. |
| D10 | Ngưỡng cổng khởi điểm: trích dẫn đúng ≥ 90 %, gợi ý AI được xác nhận ≥ 60 %, p95 ≤ 400 ms; C-11 chỉ đo phần của nó (§9). |

## 2. Ngoài phạm vi

Decision record và node `DECISION` có dữ liệu (C-12); `GOAL` và `CUSTOMER` có dữ liệu
(spec Goal, giai đoạn 3); `EXECUTION`, `WORK_PRODUCT`, `KNOWLEDGE`, `COMMITMENT` (A-01,
C-14, spec Knowledge); Context Engine, thẻ tóm tắt, chunks, vector, Ask UNI đọc đồ thị
(spec 4); gợi ý liên kết bằng AI và cạnh `AI_SUGGESTED` / `AI_CONFIRMED` có dữ liệu
(giai đoạn 2); mobile Expo (ADR 0011); chia sẻ ngoài tổ chức; phân vùng bảng theo tenant
(giai đoạn 4); cache gói ngữ cảnh; hiển thị đồ thị dạng vẽ node–cạnh.

## 3. Phương án đã chọn

Ba phương án đã cân nhắc:

- **A. Kho chiếu trong Postgres** (chọn): bảng `graph_*`, consumer projector trên lane
  outbox riêng đọc lại bản ghi nguồn rồi upsert; nối tay ghi `work_links` (audit + outbox
  cùng giao dịch) rồi projector chiếu như mọi nguồn khác.
- **B. Đồ thị ảo**: không bảng, API đọc gộp SQL trên tám bảng nguồn. Không trễ, nhưng
  không có lịch sử người phụ trách (bảng `tasks` không giữ), ba mô hình quyền trong một
  truy vấn, và Context Engine sau này không có kho đồng nhất.
- **C. Lai**: chiếu xương sống, đọc xuyên bằng chứng. Hai đường mã, hai cách lọc quyền.

Chọn A vì cổng 1 đòi "dựng lại cho ra đồ thị giống hệt" và dòng thời gian trên trang
việc; chỉ A làm được cả hai mà vẫn giữ ADR 0019 nguyên vẹn.

## 4. Mô hình dữ liệu

Theo luật migration của repo (`server/migrations/lint_test.go`): không FK, id ULID
TEXT, mỗi index một file `CREATE [UNIQUE] INDEX CONCURRENTLY`, bảng mới có
`organization_id TEXT NOT NULL`, có `created_by` thì có `created_by_kind`, tên file
`999<unix-ms>_name`. Mọi query sqlc có `organization_id = $n` hoặc chú thích
`-- tenant:` (ADR 0008).

### 4.1 Catalogue

`server/internal/graph/catalogue.go` là bản gốc; migration seed bảng
`graph_edge_types`; test `TestGraphCatalogueMatchesSeed` đỏ khi lệch. Trigger
`graph_edges_validate` từ chối cạnh có bộ ba `(edge_type, from_type, to_type)` không có
trong bảng.

**Node (14 loại).** Mỗi node trỏ về đúng một bản ghi nguồn.

| Nhóm | Loại | Bản ghi nguồn | Projector ở C-11 |
|---|---|---|---|
| Xương sống | `MEETING` | `meetings` | có |
| | `DECISION` | `decisions` (C-12) | khai, chưa bật |
| | `TASK` | `tasks` | có |
| | `COMMITMENT` | (spec sau) | khai, chưa bật |
| | `EXECUTION` | (A-01, ADR 0017) | khai, chưa bật |
| | `WORK_PRODUCT` | (C-14) | khai, chưa bật |
| | `KNOWLEDGE` | (spec Knowledge) | khai, chưa bật |
| Neo | `ACTOR` | thành viên tổ chức (`organization_member_profiles`) và `agents` | có |
| | `TEAM` | `departments` | có |
| | `PROJECT` | `projects` | có |
| | `CUSTOMER` | (spec Goal/Customer) | khai, chưa bật |
| | `GOAL` | (spec Goal) | khai, chưa bật |
| Bằng chứng | `DOCUMENT` | `documents` | có |
| | `THREAD` | `chat_rooms` (kind `channel`, `group`, `workspace`; không `dm`) và `email_hub_threads` | có |

`graph_nodes.node_type` có CHECK đủ 14 giá trị ngay từ C-11 để spec sau không đổi
constraint.

**Cạnh (18 loại).** Có hướng, đọc được thành câu. Cột `temporal` = cạnh có thể đóng rồi
mở lại theo thời gian nghiệp vụ.

| `edge_type` | Đọc là | Từ → tới | `human_creatable` | `temporal` |
|---|---|---|---|---|
| `DECIDED_IN` | quyết định được chốt trong cuộc họp | DECISION → MEETING | không | không |
| `DRIVES` | quyết định dẫn tới việc hoặc cam kết | DECISION → TASK, COMMITMENT | không | không |
| `SUPERSEDES` | quyết định mới thay quyết định cũ | DECISION → DECISION | không | không |
| `OWNED_BY` | ai phụ trách | TASK, PROJECT, GOAL → ACTOR | không | có |
| `DUE` | hạn hoàn thành | TASK, COMMITMENT → mốc thời gian (lưu ở `graph_node_facts`, §4.3) | không | có |
| `EXECUTED_BY` | lượt thực thi do ai làm | EXECUTION → ACTOR | không | không |
| `EXECUTES` | lượt thực thi làm việc nào | EXECUTION → TASK | không | không |
| `PRODUCED` | lượt thực thi tạo ra kết quả | EXECUTION → WORK_PRODUCT | không | không |
| `REALIZED_AS` | kết quả được lưu thành tài liệu | WORK_PRODUCT → DOCUMENT | không | không |
| `PROMOTED_TO` | kết quả được duyệt thành tri thức | WORK_PRODUCT → KNOWLEDGE | không | không |
| `INFORMS` | tri thức soi sáng cuộc họp, việc, quyết định sau | KNOWLEDGE → MEETING, TASK, DECISION | có | không |
| `BELONGS_TO` | thuộc về | TASK → PROJECT, TASK (cha); MEETING, PROJECT, DOCUMENT, THREAD → PROJECT; ACTOR, TEAM → TEAM; xương sống → CUSTOMER | không | có |
| `CONTRIBUTES_TO` | đóng góp cho mục tiêu | PROJECT, TASK, DECISION → GOAL | có | có |
| `PARTICIPATED_IN` | tham dự | ACTOR → MEETING | không | có |
| `DISCUSSED_IN` | được bàn trong luồng thư hoặc chat | TASK, MEETING, PROJECT, DECISION → THREAD | có | không |
| `EVIDENCED_BY` | có bằng chứng ở tài liệu hoặc luồng | TASK, MEETING, PROJECT, DECISION → DOCUMENT, THREAD | có | không |
| `ORIGINATED_FROM` | xuất phát từ đâu | TASK, DECISION, PROJECT → THREAD, MEETING, DOCUMENT, CUSTOMER | có | không |
| `DEPENDS_ON` | phụ thuộc vào, bị chặn bởi | TASK, COMMITMENT → TASK, COMMITMENT, DECISION | không (đi qua `task_dependencies`) | có |

Không có `RELATED_TO`. Hệ quả: `task_dependencies.type = 'related'` **không** được chiếu
ở C-11; màn phụ thuộc của Tasks vẫn hiện nó như trước.

**Nguồn gốc của cạnh (`origin`).**

| `origin` | Sinh từ | Độ tin cậy |
|---|---|---|
| `SYSTEM` | khoá ngoại hoặc sự kiện nghiệp vụ | sự thật |
| `HUMAN` | người dùng nối tay (`work_links`) | sự thật |
| `AI_CONFIRMED` | AI đề xuất, người xác nhận (giai đoạn 2) | sự thật, có ghi ai xác nhận |
| `AI_SUGGESTED` | AI đề xuất, chưa ai xác nhận (giai đoạn 2) | gợi ý; không vào ngữ cảnh AI như sự thật |

C-11 chỉ ghi `SYSTEM` và `HUMAN`; hai giá trị còn lại có trong CHECK để giai đoạn 2
không đổi schema.

### 4.2 Bảng

| Bảng | Vai trò | Cột |
|---|---|---|
| `graph_edge_types` | catalogue | `edge_type TEXT, from_type TEXT, to_type TEXT, human_creatable BOOLEAN, temporal BOOLEAN`; `PRIMARY KEY (edge_type, from_type, to_type)` |
| `graph_nodes` | một dòng cho mỗi bản ghi nguồn | `id, organization_id NOT NULL, workspace_id` (NULL với TEAM, ACTOR, THREAD thư), `node_type, source_id, title, status, visibility` (`organization` / `workspace` / `members` / `private`), `reader_ids TEXT[] NOT NULL DEFAULT '{}'`, `occurred_at TIMESTAMPTZ` (thời điểm nghiệp vụ: họp bắt đầu, việc tạo), `source_updated_at, deleted_at, created_at, updated_at` |
| `graph_edges` | quan hệ có thời gian | `id, organization_id NOT NULL, from_node, to_node, edge_type, origin, valid_from TIMESTAMPTZ NOT NULL, valid_to TIMESTAMPTZ, recorded_at, evidence_kind` (`outbox_event` / `work_link` / `source_row`), `evidence_id TEXT NOT NULL, actor_id, actor_kind, attrs JSONB NOT NULL DEFAULT '{}'` |
| `graph_node_facts` | sự thật có thời gian của một node, không phải quan hệ | `id, organization_id NOT NULL, node_id, fact_type` (`due` / `status`), `value TEXT NOT NULL, valid_from, valid_to, recorded_at, evidence_kind, evidence_id, attrs` (với `due`: hạn cũ, hạn mới; lý do khi có) |
| `work_links` | **bảng nghiệp vụ**, nguồn sự thật của cạnh HUMAN | `id, organization_id NOT NULL, workspace_id NOT NULL, from_type, from_id, to_type, to_id, link_type, note TEXT NOT NULL DEFAULT '', created_by, created_by_kind, created_at, removed_at, removed_by, removed_by_kind, removed_reason` |

Index (mỗi cái một file):

- `graph_nodes`: UNIQUE `(organization_id, node_type, source_id)`; `(organization_id, workspace_id, node_type, updated_at)`; GIN `(reader_ids)`.
- `graph_edges`: UNIQUE `(organization_id, from_node, to_node, edge_type, valid_from)`; partial `(from_node, edge_type) WHERE valid_to IS NULL`; partial `(to_node, edge_type) WHERE valid_to IS NULL`; `(organization_id, evidence_kind, evidence_id)`.
- `graph_node_facts`: `(node_id, fact_type, valid_from)`; partial `(node_id, fact_type) WHERE valid_to IS NULL`.
- `work_links`: partial UNIQUE `(organization_id, from_type, from_id, to_type, to_id, link_type) WHERE removed_at IS NULL`; `(organization_id, from_type, from_id)`; `(organization_id, to_type, to_id)`.

Không phân vùng ở C-11; `organization_id` đứng đầu mọi index để giai đoạn 4 phân vùng
LIST không đổi truy vấn.

### 4.3 Thời gian hai trục và bằng chứng

- `valid_from` / `valid_to` là thời gian nghiệp vụ (từ khi nào A phụ trách);
  `recorded_at` là lúc hệ thống biết. Câu "tại ngày D ai phụ trách" là
  `valid_from <= D AND (valid_to IS NULL OR D < valid_to)`.
- Đổi người phụ trách không xoá cạnh cũ: đóng `valid_to` rồi mở cạnh mới. Hạn đổi
  cũng vậy trên `graph_node_facts`.
- `DUE` trong catalogue khái niệm là cạnh tới "mốc thời gian"; trong dữ liệu nó là
  `graph_node_facts(fact_type = 'due')` vì mốc thời gian không phải node. `OWNED_BY` giữ
  là cạnh vì đích là `ACTOR`.
- `evidence_kind` + `evidence_id` không được rỗng: sự kiện outbox đã tạo cạnh, dòng
  `work_links`, hoặc bản ghi nguồn khi dựng lại. Mỗi cạnh giải thích được "vì sao tôi tồn
  tại", và dựng lại từ bảng nguồn cho ra đúng cạnh đó.

### 4.4 Quyền trên node

`visibility` và `reader_ids` được projector tính từ bản ghi nguồn:

| Loại | `visibility` | `reader_ids` |
|---|---|---|
| TEAM, ACTOR | `organization` | rỗng |
| TASK, MEETING, PROJECT | `workspace` | rỗng |
| THREAD chat kind `workspace` hoặc `visibility = 'public'` | `workspace` | rỗng |
| THREAD chat `private` hoặc `group` | `members` | thành viên phòng đang hoạt động |
| DOCUMENT `visibility = 'workspace'` hoặc có share còn hiệu lực tới workspace / tổ chức | `workspace` | rỗng |
| DOCUMENT `restricted` | `members` | chủ (`owner_id` / `acl_owner_id`) + share theo user còn hiệu lực |
| THREAD thư | `private` | chủ tài khoản (`email_hub_accounts.user_id`) |

Sự kiện share / thu hồi / thêm bớt thành viên chỉ cập nhật hai cột này, không chạm
cạnh. Cạnh chỉ hiện khi **cả hai** đầu qua được lọc (§6.2).

## 5. Projector, outbox và dựng lại

### 5.1 Gói mã và arch test

- `server/internal/graph/catalogue.go`: node, cạnh, cặp hợp lệ, cờ.
- `server/internal/graph/projector/`: **nơi duy nhất** gọi các query ghi `Graph*`
  (`GraphUpsertNode`, `GraphOpenEdge`, `GraphCloseEdge`, `GraphUpsertFact`, …). Arch
  test `TestGraphTablesWrittenOnlyByProjector` theo mẫu `TestAIPackageOnlyCallsAiQueries`
  (`server/internal/arch_test.go`), cho phép thêm `cmd/graph-rebuild`.
- `server/internal/graph/service.go`: đọc (§6) và lệnh nối tay (§5.5). `work_links` chỉ
  ghi qua service này cùng `internal/audit` (luật đã có cho mọi bảng nghiệp vụ).
- `server/pkg/db/queries/graph.sql`, `work_links.sql` cho sqlc.

### 5.2 Đánh dấu bẩn và worker chiếu

*(Điều chỉnh 2026-10-07, xem §13 #1.)* Không thêm `LaneGraph`. Theo luật "một topic
chạy theo lane chậm nhất trong các consumer của nó" (`outbox.go:142-155`), một lane graph
xếp sau notify sẽ kéo khoảng 45 topic, cùng frame realtime và thông báo của chúng, xuống
nhịp batch 8 của projector. Một lỗi projector cũng sẽ bắt cả dòng retry và gửi lại frame
realtime. Thay vào đó, việc chiếu chia hai bước:

- **`projector.Marker`**, một consumer outbox đăng ký trên lane realtime bằng
  `dispatcher.Register`. Với mỗi sự kiện, nó suy ra từ payload (chỉ có id) các node bị
  ảnh hưởng, rồi ghi **một** lệnh upsert vào bảng `graph_dirty`, khoá
  `(organization_id, node_type, source_id)`, `mark_seq` tăng mỗi lần đánh dấu. Không đọc
  bảng nguồn, không gọi gì bên ngoài. Tổ chức chưa bật flag `graph` thì bỏ qua.
- **`projector.Worker`**, một goroutine nền (2 vòng, batch 8, `FOR UPDATE SKIP LOCKED`,
  thuê 60 s), có trong trình tự tắt của `main.go`. Mỗi dòng bẩn được chiếu trong một giao
  dịch: khoá tư vấn theo node → đọc lại nguồn → đối chiếu (§5.3) → xoá dòng bẩn nếu
  `mark_seq` chưa đổi. Lỗi thì lùi lịch theo cấp số nhân, tối đa 5 phút.

Nhiều sự kiện dồn vào một node chỉ cho một lần chiếu. Idempotent theo node: chiếu hai
lần cùng một nguồn không ghi thêm cạnh hay fact nào.

Topic marker nghe (tên đúng theo `server/internal/outbox/catalogue.go`):

| Nhóm | Topic | Node đánh dấu |
|---|---|---|
| Việc | `task.created`, `task.updated`, `task.deleted`, `chat.thread.linked`, `chat.thread.unlinked` | TASK `task_id` |
| Cuộc họp | `meeting.created`, `meeting.updated`, `meeting.started`, `meeting.ended`, `meeting.canceled`, `meeting.deleted`, `participant.invited`, `participant.removed`, `join_request.approved` | MEETING `meeting_id` |
| Dự án | `project.created`, `project.updated`, `project.deleted` | PROJECT `project_id` |
| Thành viên | `member.joined`, `member.deactivated`, `member.reactivated`, `member.left`, `profile.updated` | ACTOR `user_id` |
| Agent | `agent.created`, `agent.updated`, `agent.archived` (mới) | ACTOR `agent_id` |
| Phòng ban | `department.created`, `department.updated`, `department.archived` | TEAM `department_id` |
| Chat | `chat.channel.created`, `chat.channel.updated`, `chat.channel.archived`, `chat.room.created`, `chat.room.member_added`, `chat.room.member_removed` | THREAD `room_id` |
| Lát 2 | `document.*`, `email_hub.new_mail` | DOCUMENT, THREAD thư |
| Lát 3 | `work_link.created`, `work_link.removed` | đầu `from` của liên kết |

Topic mới, thêm ở ba nơi của catalogue (`scripts/events-catalogue.test.mjs` giữ):
`agent.created`, `agent.updated`, `agent.archived` (payload `organization_id`, `agent_id`,
phạm vi organization như `department.*`), và `chat.thread.unlinked` (payload `room_id`,
`thread_root_id`, `task_id`, phạm vi room như `chat.thread.linked`). Gỡ đồng bộ thread ↔
việc hiện là `ChatService.UnsyncThreadTask` (route
`DELETE …/chat/threads/{messageID}/task-sync`), đang xoá dòng mà không ghi audit lẫn phát
sự kiện. C-11 bọc nó trong giao dịch có `Record` và `chat.thread.unlinked`.
`UnlinkChatMessage` chạm bảng khác (`chat_message_links`), không liên quan
`DISCUSSED_IN`.

Những thay đổi không phát sự kiện (tạo phòng mặc định, đổi tên phòng, đổi tên hiển thị,
xoá tài khoản, mời qua link họp, kick khỏi nhóm) được bù bằng ba đường. Projector chiếu
node đích khi một cạnh cần nó (`resolvePeer`). Lớp 2 chặn quyền cũ. `graph-rebuild` sửa
tên lệch.

### 5.3 Một lượt xử lý

1. Đọc lại bản ghi nguồn theo id trong payload (payload chỉ có id, ADR 0009). Nguồn
   không còn hoặc đã xoá mềm → bước 4.
2. Tính **trạng thái mong muốn**: node (title, status, visibility, reader_ids,
   occurred_at), tập cạnh đang mở theo `(edge_type, to_node)` và facts đang mở.
3. So với hiện trạng trong `graph_*`:
   - cạnh có trong hiện trạng mà không còn mong muốn → đóng, `valid_to` = thời điểm sự
     kiện (`outbox_events.created_at`), `evidence_id` của việc đóng ghi vào `attrs.closed_by`;
   - cạnh mong muốn mà chưa có → mở, `valid_from` = thời điểm sự kiện,
     `evidence_kind = 'outbox_event'`, `evidence_id` = id sự kiện;
   - giống nhau → không ghi gì.
   Facts xử lý cùng cách.
4. Nguồn bị xoá hoặc lưu trữ → node đặt `deleted_at`, mọi cạnh và facts đang mở của nó
   đóng. Không xoá vật lý để dòng thời gian còn đọc được.

Idempotent vì cùng một sự kiện chạy hai lần cho cùng trạng thái mong muốn, và UNIQUE
chặn cạnh trùng. Sự kiện đến muộn hơn một sự kiện mới hơn của cùng nguồn chỉ làm
projector đọc lại bản ghi hiện tại, nên kết quả vẫn hội tụ về nguồn.

Quy tắc chiếu cho bảy loại node (golden test theo từng dòng):

| Node | Cạnh / facts SYSTEM |
|---|---|
| `TASK` | `BELONGS_TO` → PROJECT (`project_id`); `BELONGS_TO` → TASK cha (`parent_task_id`); `OWNED_BY` → ACTOR (`assignee_type` ∈ {`member`, `agent`}, `assignee_id`; `squad` bỏ qua ở C-11); `DEPENDS_ON` → TASK (`task_dependencies` loại `blocks` chiều việc bị chặn → việc chặn, `blocked_by` cùng chiều đó); `ORIGINATED_FROM` → MEETING (`origin_type = 'meeting'`), THREAD thư (`email_thread`), THREAD chat (`chat_message`: node THREAD của **phòng** chứa tin nhắn; luồng con không có node riêng ở C-11); `DISCUSSED_IN` → THREAD chat (`chat_thread_task_links`); facts `due` (giá trị là `due_date`, trường trang việc gọi là "Hạn", dạng `YYYY-MM-DD` với `attrs.precision = 'date'` — không đổi múi giờ; khi `due_date` NULL thì là `due_at` dạng ISO timestamp với `attrs.precision = 'datetime'`, xem §13 #19), `status` |
| `MEETING` | `BELONGS_TO` → PROJECT (`meetings.project_id`, migration 008; backend đã có `requireMeetingProject`, UI chưa có ô chọn dự án); ACTOR `PARTICIPATED_IN` → MEETING cho `meeting_participants` có `user_id` và `removed_at IS NULL`; khách (`guest_id`) không có node |
| `PROJECT` | `OWNED_BY` → ACTOR (`lead_type`, `lead_id`); facts `status` |
| `ACTOR` | `BELONGS_TO` → TEAM (`organization_member_profiles.department_id`); agent không có TEAM ở C-11 |
| `TEAM` | `BELONGS_TO` → TEAM cha (`parent_id`) |
| `DOCUMENT` | không có cạnh SYSTEM tới việc; `BELONGS_TO` → PROJECT khi Documents có khoá dự án (hiện chưa, ghi là hệ quả) |
| `THREAD` | không có cạnh SYSTEM ra; là đích của `DISCUSSED_IN`, `ORIGINATED_FROM`, `EVIDENCED_BY` |

### 5.4 Dựng lại

`server/cmd/graph-rebuild --org <id> | --all [--verify] [--dry-run]`, theo mẫu
`cmd/files-backfill`, kết nối DB bằng vai trò nền như các cmd khác.

- Quét bảng nguồn của một tổ chức, kể cả `work_links` còn hiệu lực, tính trạng thái
  mong muốn toàn tổ chức bằng **cùng** hàm với projector.
- `--verify`: in lệch (node thiếu / thừa / khác visibility, cạnh mở lệch, facts mở
  lệch), thoát mã ≠ 0 khi lệch > 0.
- Mặc định: áp dụng — mở cạnh thiếu với `evidence_kind = 'source_row'`,
  `evidence_id` = id bản ghi nguồn; đóng cạnh thừa với `valid_to = now()`.
- Cạnh đã đóng trong lịch sử giữ nguyên, vì bảng nguồn không giữ lịch sử người phụ
  trách; chỉ so cạnh đang mở.
- Cạnh HUMAN sống sót vì `work_links` là nguồn.

Cổng 1 "dựng lại giống hệt" đo bằng `--verify` trả 0 lệch ngay sau khi projector bắt kịp.

### 5.5 Nối tay (`work_links`)

- `POST /api/v1/graph/links`, SDI `{from: {type, id}, to: {type, id}, link_type, note?}`;
  `DELETE /api/v1/graph/links/{id}` với `reason?`.
- Service kiểm: `link_type` ∈ {`EVIDENCED_BY`, `DISCUSSED_IN`, `ORIGINATED_FROM`}; cặp
  loại hợp lệ theo catalogue (`human_creatable = true`); người gọi có quyền **sửa** đầu
  `from` (việc, họp, dự án: `WorkspaceService.RequireMember`; tài liệu:
  `effectiveLevel ≥ edit`) và **xem** đầu `to` qua đúng cổng của module (tài liệu
  `CanReadDocument`, phòng chat `authorizeRoomRead`, luồng thư: chủ tài khoản, cuộc họp
  `RequireMember`).
- Ghi `work_links` + `audit_events` + outbox `work_link.created` trong một giao dịch
  (`internal/audit`). Gỡ là `removed_at` + audit + `work_link.removed`.
- Nối trùng (cùng cặp, cùng loại, còn hiệu lực) trả về dòng đã có, HTTP 200.
- Chỉ `actor_kind = human` ở C-11; agent muốn nối thì đi qua đề xuất của A-01 (ADR 0010).
- Projector chiếu `work_links` → cạnh `origin = 'HUMAN'`, `evidence_kind = 'work_link'`,
  `evidence_id` = id dòng, `valid_from = created_at`, `actor_id/actor_kind = created_by*`;
  gỡ → đóng với `valid_to = removed_at`.

Cặp hợp lệ cho người nối:

| `link_type` | từ | tới |
|---|---|---|
| `EVIDENCED_BY` | TASK, MEETING, PROJECT | DOCUMENT, THREAD |
| `DISCUSSED_IN` | TASK, MEETING, PROJECT | THREAD |
| `ORIGINATED_FROM` | TASK, PROJECT | MEETING, THREAD, DOCUMENT |

`DEPENDS_ON` người dùng vẫn tạo qua màn phụ thuộc có sẵn của Tasks; không đi qua
`work_links`.

### 5.6 Quan sát

Metric `uniwork_graph_projector_events_total{topic,result}`,
`uniwork_graph_projector_lag_seconds` (histogram, từ `created_at` sự kiện tới lúc ghi),
`uniwork_graph_rebuild_drift_total{kind}`, `uniwork_graph_layer2_dropped_total{node_type}`.
Log có `correlation_id` của sự kiện. Thêm panel vào dashboard outbox hiện có; runbook
`docs/ops/RUNBOOK_OUTBOX.md` thêm mục "lane graph tụt" và "khi nào chạy rebuild".

## 6. API đọc và quyền hai lớp

### 6.1 Endpoint

Đăng ký trong `server/internal/handler/router/graph.go`, SDI/SDO trong
`handler/dto/sdi/graph.go` và `dto/sdo/graph.go` theo `docs/api-sdi-sdo.md`. Tất cả
`GET`, cần đăng nhập, tenant lấy từ `RequireMember`, không từ request.

*(Điều chỉnh 2026-10-07, xem §13 #4.)* Mọi route nằm dưới tiền tố workspace, để tenant
lấy từ `RequireMember` của workspace trong đường dẫn. Cách này làm `TestIsolationMatrix`
khớp như mọi route cha/con, và làm ACTOR (id người dùng) không mơ hồ giữa các tổ chức.
`{nodeType}` viết hoa đúng như catalogue (`TASK`).

| Endpoint | Trả về | Tham số | Lát |
|---|---|---|---|
| `GET /api/v1/workspaces/{workspaceID}/graph/nodes/{nodeType}/{nodeID}/neighbors` | node gốc và hàng xóm một bước đang hiệu lực; mỗi mục: node (type, id, subtype, title, status, workspace_id, workspace_slug), `edge_type`, `direction`, `origin`, `valid_from`, `backfilled`; `link_id` khi là cạnh HUMAN (lát 3) | `edge_types` (phân cách bằng dấu phẩy), `direction` (`out` / `in` / `both`), `at` (RFC 3339, mặc định bây giờ), `cursor` (`<micros>.<edge id>`), `limit` ≤ 100 | 1 |
| `GET …/graph/nodes/{nodeType}/{nodeID}/history` | lịch sử cạnh và facts của một node: `OWNED_BY`, `due`, `status`, `ORIGINATED_FROM`, `DEPENDS_ON`, `BELONGS_TO`; sắp theo `valid_from`; client dựng câu từ dữ liệu có cấu trúc. Tên `history` thay cho `timeline` vì `TestTimelineRouteIsGone` chặn mọi route đuôi `/timeline` | `from`, `to` (RFC 3339) | 1 |
| `GET …/graph/nodes/{nodeType}/{nodeID}/path` | đường nhân quả ngược (`ORIGINATED_FROM`, `DRIVES` ngược, `DECIDED_IN`), `max_depth` ≤ 3, `truncated` | `to_type`, `max_depth` | C-12 (chỉ có ý nghĩa khi có DECISION) |
| `GET/POST …/graph/links`, `DELETE …/graph/links/{linkID}` | `work_links` của một thực thể; nối; gỡ | §5.5 | 3 |

Node không tồn tại hoặc người gọi không được xem → 404, không phân biệt (không lộ sự tồn
tại). Người không phải thành viên workspace trong đường dẫn nhận câu trả lời của
`RequireMember` (403), như mọi route workspace. `href` do client dựng từ `{type, id,
subtype, workspace_slug}` bằng `packages/core/paths`, theo quy ước client hiện có.

### 6.2 Quyền hai lớp

- **Lớp 1, trong SQL:** node cùng `organization_id` với người gọi và `visibility`
  khớp: `organization` → thành viên tổ chức; `workspace` → `workspace_id` thuộc tập
  workspace người gọi là thành viên (truyền vào query dưới dạng mảng); `members` /
  `private` → `actor_id = ANY(reader_ids)`. Cạnh chỉ trả về khi cả hai đầu qua lớp 1.
- **Lớp 2, trong service, trước khi trả:** đọc lại từng node qua cổng của module
  (`RequireMember` cho việc / họp / dự án / phòng chat public, `CanReadDocument` cho tài
  liệu, `authorizeRoomRead` cho phòng chat, chủ tài khoản cho luồng thư). Node trượt lớp
  2 bị loại và đếm vào `uniwork_graph_layer2_dropped_total`; đường nhân quả gặp node bị
  loại thì dừng và trả `truncated: true`.
- Quyền bị thu hồi có hiệu lực ngay nhờ lớp 2, dù `reader_ids` chưa kịp cập nhật.
- Bốn route đọc và hai route links vào `TestIsolationMatrix`; thêm trường hợp riêng:
  tài liệu `restricted` và phòng chat private không lộ qua hàng xóm của một việc cho
  người không có quyền.

### 6.3 Hiệu năng

Hàng xóm một bước là một `SELECT` trên index partial `(from_node, edge_type) WHERE
valid_to IS NULL` (và chiều ngược) cộng một `IN` trên `graph_nodes`; mục tiêu p95 ≤ 200 ms
như API đọc chung. Không cache ở C-11.

## 7. Giao diện

- `packages/views/graph/related-panel.tsx` ("Liên quan"), nhận `{type, id}`, gắn vào
  sáu trang: `tasks/surface/task-surface-page`, `meetings/meeting-detail-aside`,
  `projects/project-detail-page`, `documents/document-detail-view`, trang phòng chat
  (`chat/chat-page-content-*`), luồng thư trong Email Hub.
- Panel nhóm hàng xóm theo loại cạnh với câu tiếng Việt ("Xuất phát từ", "Được bàn
  trong", "Bằng chứng", "Phụ thuộc vào", "Người phụ trách", "Thuộc dự án", "Tham dự");
  mỗi mục mang nhãn nguồn gốc (hệ thống / người nối kèm tên) và nút **Gỡ** chỉ trên cạnh
  HUMAN do chính người đó hoặc người có quyền sửa đầu `from` tạo.
- Nút **Liên kết** mở picker: chọn loại cạnh (ba loại) rồi tìm đích bằng ô tìm sẵn có
  của từng module, chỉ hiện đích người dùng xem được.
- Panel ghi "cập nhật … trước" và tải lại khi nhận realtime `task.updated` /
  `document.updated` / `meeting.updated` của thực thể gốc, vì đồ thị có trễ (ADR 0019);
  không trình bày như số liệu tức thời.
- `packages/views/graph/node-timeline.tsx` trên trang việc, đọc `/timeline`: mỗi dòng là
  một câu có ngày ("Giao cho Lan từ 03/10", "Hạn đổi 15/10 → 22/10", "Xuất phát từ cuộc
  họp giao ban 01/10"), nhãn nguồn gốc, bấm vào mở thực thể liên quan.
- Chuỗi qua `packages/views/i18n` (vi, en); không hard-code. Theo
  `docs/engineering` và các primitive hiện có; không thêm thư viện vẽ đồ thị.
- Cả hai phần sau feature flag `graph_ui` (gói `featureflags`).

## 8. Kiểm thử

| Lớp | Kiểm gì |
|---|---|
| Unit Go | `TestGraphCatalogueMatchesSeed`; trạng thái mong muốn cho từng loại nguồn (golden); chạy hai lần cùng sự kiện → không ghi thêm; đổi người phụ trách / hạn → đóng rồi mở với đúng `valid_from`; xoá nguồn → `deleted_at` + đóng cạnh; `visibility` / `reader_ids` cho bảy trường hợp ở §4.4 |
| Arch | `TestGraphTablesWrittenOnlyByProjector`; `work_links` chỉ ghi qua service + `internal/audit`; `TestAuditAndOutboxWritesGoThroughTheAuditPackage` mở rộng |
| Tích hợp DB | `graph-rebuild --verify` = 0 lệch sau khi projector bắt kịp seed; cạnh HUMAN sống sót qua rebuild; không cạnh nào nối hai `organization_id` (test tenant hiện có mở rộng cho bốn bảng mới); trigger từ chối cạnh ngoài catalogue |
| Isolation | sáu route trong `TestIsolationMatrix`; `TestEveryQueryNamesItsTenant` cho `graph.sql`, `work_links.sql` |
| Hợp đồng | `scripts/events-catalogue.test.mjs` cho `work_link.*`, `agent.*`; `swagger_test.go` cho route mới |
| e2e | `e2e/graph-related-panel.spec.ts`: tạo việc từ họp → panel hiện "Xuất phát từ"; nối tài liệu → hiện với nhãn người nối → gỡ; đổi người phụ trách → dòng thời gian có hai dòng |
| Tải | seed 1 triệu cạnh một tổ chức; p95 hàng xóm ≤ 200 ms; rebuild một tổ chức 100 k node dưới 10 phút |

## 9. Cổng nghiệm thu của C-11

| Tiêu chí | Cách đo |
|---|---|
| Mọi việc có `origin_type = 'meeting'` có cạnh `ORIGINATED_FROM` tới cuộc họp | SQL đếm trên seed và trên một tổ chức thật sau rebuild |
| Dựng lại giống hệt | `graph-rebuild --verify` trả 0 lệch |
| Cách ly | `TestIsolationMatrix` xanh với sáu route; trường hợp tài liệu `restricted` và phòng chat private |
| Trễ | `uniwork_graph_projector_lag_seconds` p95 ≤ 5 s (mục tiêu outbox hiện có) |
| Hiệu năng | p95 hàng xóm ≤ 200 ms ở 1 triệu cạnh |

Phần "Ask UNI trả lời có trích dẫn qua Context Engine" của cổng 1 trong tài liệu kiến
trúc thuộc spec Context Engine, không đo ở C-11.

### 9.1 Điều kiện dữ liệu

Đồ thị chỉ có giá trị khi các luồng "nguồn → việc" thực sự ghi nguồn gốc. Khảo sát mã
ngày 2026-10-07 cho thấy backend của ba luồng đã có nhưng dữ liệu sẽ thưa vì ba lý do;
ba vá dưới đây là **điều kiện để đo cổng 1**, làm song song với lát 1 (§10), mỗi vá một
sub-issue, không nằm trong code của projector.

| # | Hiện trạng | Vá | Dữ liệu đồ thị thu được |
|---|---|---|---|
| V1 | Tóm tắt cuộc họp chỉ chạy khi chủ trì bấm (`handler/meeting_ai.go` → `MeetingService.Summarize`); không ai bấm thì không có việc nào mang `origin_type = 'meeting'` | Luật mới `meeting.ended` trong consumer thông báo (lane notify) tạo thông báo kind `meeting_summary_reminder` cho chủ trì, dẫn tới `…/meetings/<id>?section=summary`. Điều kiện: cuộc họp có transcript, ghi chú, chat hoặc biểu quyết đã đóng (đúng điều kiện của `Summarize`); chưa có tóm tắt; tổ chức có gói `meeting.ai_summary` và server có model. Dựng `Draft` trực tiếp vì chủ trì thường là actor của sự kiện. Không tự gọi model, để không tốn token ngoài ý người dùng và không đổi quy tắc AI chạy trong request (`docs/ops/RUNBOOK_AI.md`). Đo bằng SQL: tỉ lệ cuộc họp đã kết thúc có tóm tắt trong 24 giờ (`summary.created` là ephemeral, không có trong outbox) | `ORIGINATED_FROM` việc → cuộc họp |
| V2 | `meetings.project_id` có từ migration 008 và service đã kiểm `requireMeetingProject`, nhưng màn tạo/sửa cuộc họp chưa có ô chọn dự án; bỏ chọn qua PATCH đang ghi `''` thay vì NULL; diff audit của `meeting.updated` thiếu `project_id` | Thêm ô chọn dự án (tuỳ chọn, ẩn khi capability `tasks.projects` tắt) vào form tạo và sửa, dùng select dạng form của Email Hub, gom thành `ProjectSelect` dùng chung; thêm dòng "Dự án" ở khung chi tiết; `UpdateMeeting` ghi NULL khi nhận `''`; diff audit có `project_id`; việc tạo từ tóm tắt kế thừa dự án của cuộc họp. Chỉ sửa được khi cuộc họp chưa kết thúc (`meetingEditable`) | `BELONGS_TO` cuộc họp → dự án; nhờ đó dòng thời gian dự án có cả cuộc họp |
| V3 | **Đã có màn** từ 2026-09-24 (`4132dec2`): `EmailHubAiPanel` → `EmailHubCreateSummaryTasksDialog` gọi `createEmailHubSummaryTasks`, service ghi `origin_type = 'email_thread'`. Chỉ thiếu test | Thêm test service giữ `origin_type`/`origin_id` và test views giữ thân POST. Dữ liệu thưa ở đây là do mức dùng (workspace bật AI, chủ hộp thư bấm nút), không do thiếu màn | `ORIGINATED_FROM` việc → luồng thư (chiếu ở lát 2) |

Không thuộc điều kiện dữ liệu, ghi để không nhầm: việc tạo tay sau cuộc họp không có
`origin`; lát 3 (nối tay `ORIGINATED_FROM`) bù chỗ này. Quyết định của cuộc họp vẫn là
JSON hiển thị (`meeting-decisions-block.tsx`), chưa xác nhận và chưa nối tới việc;
đó là C-12, đi ngay sau C-11.

## 10. Triển khai và hoàn tác

Ba lát, mỗi lát một kế hoạch và một PR có thể bật riêng; ba vá §9.1 chạy song song với
lát 1.

| Lát | Nội dung | Điều kiện bắt đầu |
|---|---|---|
| 1 | Catalogue, bốn bảng, projector cho việc · cuộc họp · dự án · actor · phòng ban · phòng chat, `graph-rebuild`, API hàng xóm + dòng thời gian, panel "Liên quan" và dòng thời gian trên trang việc sau flag | spec duyệt; hai giả định §5.2 đã kiểm (`task.updated` phát khi đổi người phụ trách và `due_at`) |
| 2 | Tài liệu và luồng thư vào projector; panel trên năm trang còn lại | C-01 G2 (ACL, share) đã merge, để không chiếu một mô hình quyền đang đổi |
| 3 | `work_links`, API links, nút Liên kết và Gỡ | lát 1 xong |

Trình tự bật:

1. Migration lát 1: `graph_edge_types` (seed catalogue), `graph_nodes`, `graph_edges`,
   `graph_node_facts`, `graph_dirty`, trigger, index (mỗi index một file). `work_links`
   vào migration của lát 3.
2. Marker và worker luôn được nối. Marker hỏi flag `graph` theo tổ chức của sự kiện
   (`featureflag.EvalContext{OrganizationID}`, cache 30 s), nên bật theo tổ chức không
   cần khởi động lại. Tổ chức đang tắt thì sự kiện của nó không được đánh dấu.
3. Bật `graph` cho một tổ chức, rồi `graph-rebuild --org <id>` để backfill (hoặc `--all`
   khi bật toàn cục).
4. Bật `graph_ui` theo tổ chức. Web đọc flag theo tổ chức bằng
   `GET /api/v1/config?organization_id=` (mẫu `useOfficeEnabled`); route đọc kiểm
   `graph_ui` trong service, với `OrganizationID` lấy từ `RequireMember`.

Hoàn tác: tắt hai flag; bảng để nguyên (không xoá), rebuild lại khi bật.

## 11. Tác động tới module khác

- Meetings: V1 (thông báo nhắc tóm tắt sau `meeting.ended`) và V2 (ô chọn dự án, NULL
  khi bỏ chọn, audit `project_id`), §9.1.
- Email Hub: V3 chỉ thêm test, §9.1.
- `agents`: thêm ba topic outbox `agent.*`; `Update` sang `archived` phát
  `agent.archived`, mọi thay đổi khác phát `agent.updated`; hành động audit giữ nguyên.
- Tasks: không đổi; projector đọc `tasks`, `task_dependencies`.
- Chat: lệnh gỡ có sẵn (`UnsyncThreadTask`), nên thêm topic `chat.thread.unlinked` cùng
  hành động audit `chat.thread.task_unlinked` và bọc lệnh trong giao dịch.
- Documents: không đổi schema; projector đọc `documents`, `document_shares`.
- Email Hub: không đổi; projector đọc `email_hub_threads`, `email_hub_accounts`.
- Catalogue sự kiện: ba nơi thêm hàng mới.

## 12. Câu hỏi mở

Không còn. Hai điểm kỹ thuật từng để ngỏ đã chốt trong §5.3: hạn từ `due_date` lưu
dạng ngày với `precision = 'date'` thay vì đổi múi giờ; `chat_message` origin trỏ về
node THREAD của phòng, vì luồng con chưa có node riêng ở C-11.

## 13. Điều chỉnh sau khi đối chiếu mã (2026-10-07)

Bảy agent đọc mã `develop` để viết kế hoạch. Các điểm dưới đây sửa chỗ spec nói khác
mã, hoặc chỗ làm theo spec sẽ làm đỏ một test đang có. Thiết kế khái niệm (§1.2, mười
quyết định) không đổi.

| # | Mục | Spec cũ | Điều chỉnh | Vì sao |
|---|---|---|---|---|
| 1 | §5.2 | `LaneGraph` sau notify | Marker trên lane realtime ghi `graph_dirty`; worker nền chiếu | Lane chậm nhất thắng: lane graph kéo khoảng 45 topic realtime/notify xuống batch 8; lỗi projector làm retry cả dòng (`outbox.go:67-71, 142-155`) |
| 2 | §5.2 | `meeting.participant_*`; thiếu `meeting.started`, `join_request.approved`, `member.left`, `profile.updated`, `chat.channel.updated` | Tên topic thật và danh sách đủ (bảng §5.2) | `meeting.participant_*` là tên hành động audit; đổi phòng ban phát `profile.updated` (`people.go:299`) |
| 3 | §5.2, §11 | Gỡ chat ↔ việc đi qua `chat.message.linked` | `UnsyncThreadTask` phát `chat.thread.unlinked` | `UnlinkChatMessage` chạm `chat_message_links`; `UnsyncThreadTask` xoá `chat_thread_task_links` không audit, không sự kiện |
| 4 | §6.1 | `/api/v1/graph/nodes/{type}/{id}/…` | Tiền tố `/workspaces/{workspaceID}`; `{nodeType}/{nodeID}`; `/history` thay `/timeline`; `path` sang C-12 | `TestTimelineRouteIsGone`; lượt "thành viên cả hai" của `TestIsolationMatrix`; ACTOR = id người dùng mơ hồ giữa tổ chức |
| 5 | §4.2 | Không có | `graph_nodes.subtype` (`member` / `agent` / `chat_room` / `email_thread`) | Client cần phân biệt THREAD chat với thư và ACTOR người với agent để dựng icon và đường dẫn |
| 6 | §4.2 | UNIQUE `(…, valid_from)` trên cạnh | UNIQUE một phần `(organization_id, from_node, to_node, edge_type, origin) WHERE valid_to IS NULL`; fact tương tự `(organization_id, node_id, fact_type) WHERE valid_to IS NULL`; index lịch sử `(from_node, valid_from)`, `(to_node, valid_from)` | Hai worker mở cùng một cạnh với `valid_from` khác nhau sẽ lọt khoá cũ; đọc lịch sử cần index không partial |
| 7 | §4.1 | `DUE` là một dòng catalogue | `DUE` không seed vào `graph_edge_types`; là `graph_node_facts(fact_type='due')`; seed 64 bộ ba của 17 loại cạnh | Bảng catalogue cần `to_type` là một loại node |
| 8 | §4.2, §8 | GIN `reader_ids` + `= ANY` | Lọc bằng `reader_ids @> ARRAY[$user]` | GIN array_ops không phục vụ `= ANY` |
| 9 | §5.1 | Service đọc/nối ở `internal/graph/service.go` | `internal/service/graph.go`; `internal/graph` chỉ còn catalogue; projector ở `internal/graph/projector` | `authorizeRoomRead`, `effectiveLevel` không xuất; `TestActorConstructedOnlyInService`; test phủ audit ở package `service` |
| 10 | §5.3 | `valid_from` = `created_at` của sự kiện | `valid_from` = `last_event_at` của dòng bẩn (sự kiện mới nhất dồn vào); rebuild tạo node mới thì lấy thời điểm nghiệp vụ của nguồn với `attrs.backfill = true`, sửa node có sẵn thì lấy `now()`. Node "mới" là node chưa có dòng sống, hoặc có dòng mà chưa có cạnh trong phạm vi hay fact nào đang mở (do `resolvePeer` vừa tạo); trên đường worker, dòng đó còn phải được tạo sau `last_event_at` (cả hai theo đồng hồ DB), vì node đã có từ lâu vẫn có thể trơ (thành viên chưa vào phòng ban, nhóm cấp cao nhất) và cạnh đầu tiên của nó là thay đổi lúc sự kiện. Worker cũng làm vậy với node mới khi thời điểm nghiệp vụ của nguồn sớm hơn `last_event_at` quá 1 phút (`backfillMargin`), còn lại lấy `last_event_at` | Gộp sự kiện; backfill không được bịa ngày giao việc. Nguồn bị sửa giữa lúc bật `graph` và lúc rebuild chạy tới nó (§10 bước 3) đến worker trước; nếu lấy ngày sự kiện thì ngày giao việc, ngày vào dự án thành hôm nay mãi, vì rebuild không ghi lại cạnh đã khớp. Còn một giới hạn đã biết: node mà chính rebuild tạo làm điểm nối (`resolvePeer`) trước khi tới lượt nó, nếu nguồn bị sửa trong cửa sổ đó, vẫn lấy ngày sự kiện, không backfill. Sửa trọn cần mốc “rebuild lần đầu xong” theo tổ chức, để ở lát sau |
| 11 | §5.3 | Mỗi cạnh do projector của "nguồn" ghi | Mỗi loại cạnh SYSTEM thuộc đúng một đầu: TASK giữ `BELONGS_TO`, `OWNED_BY`, `DEPENDS_ON` ra, `ORIGINATED_FROM`, `DISCUSSED_IN`; MEETING giữ `BELONGS_TO` và `PARTICIPATED_IN` vào; PROJECT giữ `OWNED_BY`; ACTOR và TEAM giữ `BELONGS_TO`. Chiếu TASK đánh dấu bẩn các việc ở đầu kia của phụ thuộc | Sự kiện phụ thuộc chỉ mang một `task_id`; `blocks(A,B)` là cạnh B → A |
| 12 | §5.3 | Hủy = xoá | MEETING `CANCELED` giữ node, fact `status = CANCELED` | `meeting.deleted` phát cùng `meeting.canceled` mỗi lần hủy; không phân biệt được |
| 13 | §5.3 | ORIGINATED_FROM → THREAD thư ở lát 1 | Sang lát 2 cùng node thư | Lát 1 không chiếu THREAD thư |
| 14 | §5.4 | "vai trò nền", `config.Load` | `graph-rebuild` chỉ đọc `DATABASE_URL`; thêm vào `server/Dockerfile` | Không có vai trò nền; `config.Load` đòi cả bộ biến API; image chỉ có `server`, `migrate` |
| 15 | §5.6 | `uniwork_graph_rebuild_drift_total`, `…projector_events_total{topic,result}` | `…marked_total{topic}`, `…projected_total{node_type,result}`, `…projector_lag_seconds`, `…layer2_dropped_total{node_type}`, gauge `…dirty_pending`, `…dirty_oldest_seconds`; drift của rebuild qua mã thoát và báo cáo; cảnh báo `GraphProjectorLagHigh` | CLI không bị Prometheus scrape |
| 16 | §7 | `tasks/surface/task-surface-page`, `packages/views/i18n`, nút "Liên kết" | Trang chi tiết việc là `tasks/detail/task-detail-suite-page.tsx` (panel trong `components/properties-sidebar.tsx`, dòng thời gian trong `components/task-detail-editors.tsx`); chuỗi ở `packages/core/i18n/locales`; nút lát 3 là "Gắn" theo glossary | Đường dẫn và từ vựng thật |
| 17 | §9.1 | V3 chưa có màn | V3 đã có; chỉ thêm test | `4132dec2` |
| 18 | §10 | Flag `graph` = consumer không đăng ký | Marker hỏi flag theo tổ chức | Đăng ký consumer chỉ xảy ra lúc khởi động, không có ngữ cảnh tổ chức |
| 19 | §5.3 | Fact `due` lấy `due_at` khi có, `due_date` khi `due_at` NULL | Fact `due` theo `due_date` (`precision = 'date'`), trường mà trang việc gọi là "Hạn"; chỉ khi `due_date` NULL mới lấy `due_at` (`precision = 'datetime'`, dòng thời gian in kèm giờ:phút theo múi giờ người xem) | Kéo ô trong Lịch đặt cả `due_date` lẫn khung giờ `due_at` (`calendar/slot-prefill.ts`); thanh bên chỉ sửa `due_date` (`SetTaskDueDate` không đụng `due_at`). Theo `due_at` thì đổi Hạn không bao giờ vào dòng thời gian, còn dời khung giờ trong ngày hay thả lên hàng cả ngày (`calendar-drop-patch.ts` xoá `due_at`) lại ra dòng "Hạn đổi 15 thg 10 → 15 thg 10" |
