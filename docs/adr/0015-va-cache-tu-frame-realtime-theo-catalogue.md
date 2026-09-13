# 0015 — Vá cache từ frame realtime, chỉ với trường catalogue khai ở `Patch`

**Trạng thái:** accepted (2026-09-14) — ghi lại quyết định quangpd đã chốt trong brainstorm spec ô Task human-parity (2026-09-12, spec §2, hàng "Độ trễ cảm nhận"). Luật vào `CLAUDE.md` cùng commit với test giữ luật.

## Bối cảnh

Tới ADR này mọi frame realtime chỉ mang id. ADR 0009 §4 đặt luật "payload chỉ mang id
và các trường cần để route; consumer refetch". `CLAUDE.md` nhắc luật đó ở ba chỗ (State
Rules, Audit and Events, Domain Reminders); `scripts/events-catalogue.test.mjs` đỏ khi
một khoá payload không phải id; `packages/core/realtime/use-realtime-sync.test.tsx` ghim
việc client không bao giờ ghi frame vào cache.

Cái giá của luật đó là độ trễ cảm nhận. Một người đổi trạng thái task; người khác đang
mở task đó chỉ thấy thay đổi khi client refetch xong. Trong brainstorm spec ô Task
human-parity (`docs/superpowers/specs/2026-09-12-tasks-human-parity-design.md`), quangpd
chốt: viết ADR cho phép vá cache từ frame realtime, có kiểm soát bằng catalogue (§2, hàng
"Độ trễ cảm nhận"). Spec §4.3 đặt ba ràng buộc: chỉ topic được liệt kê mới có payload
giàu và danh sách trường nằm trong catalogue; client chỉ vá đúng những trường đó, trường
lạ bị bỏ; frame không bao giờ tạo bản ghi mới. ADR này ghi lại quyết định đó, cộng hai
điều kiện mà lượt tiền kiểm mã ngày 2026-09-14 buộc phải thêm.

1. **`revision` của task tăng theo từng câu query, không theo từng lần sửa.**
   `TaskService.Update` chạy `UpdateTask` rồi `SetTaskAssignee`, `SetTaskDueDate`,
   `SetTaskProjectID` cho từng trường đổi, và mỗi query tăng revision một
   (`server/pkg/db/queries/tasks.sql:43,56,67,78`). Nhiều command khác cũng tăng revision
   task: `SetTaskParent` (`tasks.sql:222`), gắn và gỡ nhãn (`task_labels.sql:81,99`), bỏ dự
   án khỏi task khi xoá dự án (`projects.sql:147`), thuộc tính tuỳ biến tăng có điều kiện
   (`task_properties.sql:52,73`). Guard kiểu "revision của frame bằng revision trong cache
   cộng một" gần như không bao giờ đúng, nên vá sẽ không bao giờ chạy.
2. **Nới guard thì mất dữ liệu.** Client lưu bằng revision trong cache:
   `packages/views/tasks/detail/hooks/use-task-field-save.ts` gửi `revision` trong body và
   `If-Match`. Nếu cache nhận revision mới nhưng chỉ vá vài trường, trường còn lại (ví dụ
   mô tả) vẫn cũ trong khi revision đã khớp server. Người dùng sửa mô tả cũ đó sẽ qua kiểm
   revision và ghi đè bản mới của người khác.

Một ràng buộc kỹ thuật nữa: payload outbox là `map[string]string`. `audit.Event.Payload`
có kiểu đó, và `server/internal/outbox/realtime_consumer.go` unmarshal payload vào đúng
kiểu đó. Một giá trị không phải chuỗi làm `Handle` trả lỗi, và dispatcher thử lại mãi.

## Quyết định

1. **`Patch` trong catalogue là nguồn sự thật duy nhất cho nội dung trong frame.**
   `outbox.EventDef` có thêm `Patch []string`. Chỉ hàng có `Patch` mới được mang trường
   không phải id, và chỉ đúng những trường nó liệt kê. Hôm nay chỉ `task.updated` có
   `Patch`, gồm bốn trường: `title`, `status`, `priority`, `due_date`. `Payload` của hàng
   đó thêm `revision_before` và `revision`. Mở `Patch` cho trường khác hay topic khác cần
   ADR mới.
2. **Không vá** `assignee_*`, `position`, `project_id`, `description`. Task mang người phụ
   trách dưới dạng actor do server phân giải; vá id mà không có tên sẽ hiện sai.
   `position` và `project_id` đổi thứ tự và thành viên của list, việc chỉ refetch làm
   đúng. `description` là văn bản dài, giàu định dạng; mang nó là biến outbox thành bản
   sao nội dung task, trái với "mở theo từng topic, không đại trà" ở spec §7.
3. **Server chỉ gửi trường vá khi frame mô tả trọn thay đổi của bước đó.**
   `TaskService.Update` gửi các trường vá đã đổi, kèm `revision_before` và `revision`, chỉ
   khi mọi trường đổi trong bước đều thuộc `Patch`. Có bất kỳ trường nào khác đổi (kể cả
   `description`) thì frame chỉ mang id và hai revision. `revision_before` là revision sau
   cùng trừ số query tăng revision đã chạy trong transaction, không phải revision đọc
   trước transaction. Mọi giá trị là chuỗi; ngày ở dạng `YYYY-MM-DD`; trường nullable bị
   xoá gửi chuỗi rỗng. Service đọc danh sách trường từ `outbox.Lookup("task.updated").Patch`,
   không tự lặp lại danh sách.
4. **Client chỉ vá bản ghi đã có, và chỉ khi revision khớp đầu dưới.** Một bản ghi task
   trong cache được vá khi `revision` của nó bằng `revision_before` của frame; sau khi vá
   nó mang `revision` của frame. Lệch thì không vá và invalidate như trước. Khoá không nằm
   trong `Patch` bị bỏ. Frame không bao giờ tạo bản ghi: `task.created` và `task.deleted`
   vẫn chỉ invalidate. Trang chi tiết đã vá thì không cần refetch. List vẫn invalidate, vì
   trạng thái, độ ưu tiên và ngày hạn đổi thứ tự, cột board và nhóm.
5. **Frame thiếu một trong hai revision là frame id-only.** Những nơi khác phát
   `task.updated` (đổi dự án, nhãn, thuộc tính tuỳ biến, cha và phụ thuộc: `project.go`,
   `task_catalog_labels.go`, `task_catalog_properties.go`, `task_graph.go` trong
   `server/internal/service/`) giữ payload `task_id`, `workspace_id`. Cột `Payload` của hàng
   `task.updated` vì vậy là tập khoá một frame *có thể* mang, không phải tập khoá mọi frame
   mang. Client coi thiếu `revision_before` hoặc `revision` là không vá.

## Hệ quả

Được: người đang mở task thấy tiêu đề, trạng thái, độ ưu tiên và ngày hạn đổi ngay khi
frame tới, không chờ refetch trang chi tiết.

Đánh đổi, viết thẳng:

- **`outbox_events` không còn chỉ là sổ sự kiện.** Từ ADR này bảng mang một phần nội dung
  task: tiêu đề và ba trường phân loại, ở mỗi lần sửa đủ điều kiện. Mọi consumer outbox,
  hôm nay và sau này, đọc được tiêu đề task.
- **An toàn dựa trên một giả định về quyền đọc.** `task.updated` phát theo phạm vi
  workspace, tức tới mọi kết nối trong workspace. Hôm nay quyền đọc task chỉ là thành viên
  workspace: `TaskService.authorizeActor` (`server/internal/service/task.go:285-297`) gọi
  `GetTask` rồi `requireActorMember`, không có task riêng hay quyền theo dự án. Người nhận
  frame vốn đọc được đúng những trường frame mang. **Nếu sau này có task mà quyền đọc hẹp
  hơn workspace** (task riêng, dự án kín, khách), thì trước khi tính năng đó ship phải tắt
  `Patch` của `task.updated` hoặc đổi phạm vi phát cho khớp quyền đọc. Không làm vậy là rò
  tiêu đề task cho người không được xem.
- **Guard không được nới.** Kịch bản mất dữ liệu nếu client vá khi "revision frame lớn
  hơn cache": A và B cùng mở task ở revision 5. A sửa mô tả (revision 6), rồi đổi tiêu đề
  (revision 7). Frame thứ nhất chỉ mang id; frame thứ hai mang tiêu đề. Nếu B vá tiêu đề
  và nhận revision 7 trước khi refetch xong, cache của B có revision 7 cùng mô tả cũ. B sửa
  mô tả từ bản cũ đó, gửi `If-Match: 7`, server chấp nhận, và mô tả của A mất mà không ai
  thấy `revision_conflict`. Guard hai đầu chặn đúng chỗ này: frame thứ hai có
  `revision_before` 6, cache của B đang 5, nên B không vá và refetch.
- **Vì sao `revision_before` phải tính trong transaction.** `Update` đọc task (`before`)
  trước khi mở transaction. Hai lần sửa đồng thời có thể cùng đọc revision 5: A đổi tiêu
  đề và commit 5→6; B đổi độ ưu tiên, chờ khoá hàng, rồi commit 6→7. Nếu B khai
  `revision_before` bằng `before.Revision` (5), một client còn ở 5 (chưa nhận frame của A)
  sẽ vá độ ưu tiên và nhận revision 7 trong khi tiêu đề vẫn cũ — lại đúng kịch bản mất dữ
  liệu ở trên. Lấy revision sau cùng trừ số query tăng revision trong transaction thì
  đúng, vì hàng bị khoá từ câu UPDATE đầu tiên tới lúc commit: B khai 6, client ở 5 không vá.
- **Cache trễ thì quay về refetch, không sai.** Frame của những command tăng revision mà
  không mang trường vá khiến client invalidate. Nếu frame đó mất hoặc tới muộn, bản ghi
  trong cache lệch `revision_before` của frame vá kế tiếp, và frame đó cũng rơi về
  invalidate. Vá chỉ chạy khi cache đã theo kịp server; lúc cache trễ, trải nghiệm y như
  trước ADR này.
- **List vẫn refetch.** Hàng trong list đổi ngay, nhưng thứ tự, cột board và nhóm chỉ đúng
  sau refetch. ADR này không cho client tự sắp xếp lại list từ frame.
- **`Version` của `task.updated` giữ 1.** Thêm khoá là thay đổi cộng thêm: consumer chỉ
  đọc id vẫn đúng với frame mới.
- **Luật trong `CLAUDE.md` đổi ở hai nhịp.** "payload chỉ mang id" (§ Audit and Events,
  § Domain Reminders) đổi cùng commit với ADR này và test catalogue. "frame không bao giờ
  ghi vào cache" (§ State Rules) vẫn đúng cho tới khi client vá thật, và chỉ đổi cùng
  commit với test giữ luật phía client.

## Test giữ luật

- `scripts/events-catalogue.test.mjs` (cùng commit với ADR này): khoá payload là id hoặc
  revision; chỉ `task.updated` được khai `Patch`, kể cả so với hàng hạ tầng; hàng có
  `Patch` phải có `revision_before` và `revision`; tập trường vá đúng bốn trường ở Quyết
  định 1; `server/internal/outbox/catalogue.go` và `docs/events/CATALOGUE.md` khớp nhau cả
  ở cột `Patch`. Giữ luật ở `CLAUDE.md` § Audit and Events và § Domain Reminders.
- `server/internal/service/task_realtime_patch_test.go` (mới, lát E Task 2): đổi riêng
  trường vá được thì frame mang trường đó cùng hai revision đúng; có trường khác đổi thì
  không mang trường vá; hai lần sửa đồng thời không sinh hai khoảng
  `[revision_before, revision]` chồng nhau; mọi giá trị là chuỗi.
- `packages/core/tasks/realtime-task-patch.test.ts` (mới) và
  `packages/core/realtime/use-realtime-sync.test.tsx` (lát E Task 3): khoá lạ bị bỏ; lệch
  revision không vá; frame không tạo bản ghi; vá trang chi tiết thì không invalidate khoá
  chi tiết, list vẫn invalidate. Giữ luật ở `CLAUDE.md` § State Rules, đổi cùng commit
  với hai test này.
