# 0015 — Vá cache từ frame realtime, chỉ với trường catalogue khai ở `Patch`

**Trạng thái:** accepted (2026-09-14) — ghi lại quyết định quangpd đã chốt trong brainstorm spec ô Task human-parity (2026-09-12, spec §2, hàng "Độ trễ cảm nhận": viết ADR cho phép vá cache từ frame realtime, có kiểm soát bằng catalogue), cùng ba ràng buộc spec §4.3 đặt cho ADR này (chỉ topic được liệt kê mang payload giàu, danh sách trường nằm trong catalogue; client chỉ vá đúng những trường đó, trường lạ bị bỏ; frame không bao giờ tạo bản ghi mới). Mọi lựa chọn khác trong ADR này không do quangpd chốt: đó là lựa chọn của plan lát E (`docs/superpowers/plans/2026-09-14-tasks-human-parity-slice-e.md`), của lượt tiền kiểm mã, hoặc suy luận của agent khi viết ADR, chờ quangpd xác nhận ở review PR trước khi merge. Trong đó có: tập trường vá và các trường không vá; guard hai revision tính theo từng lời gọi; trường vá tính theo "có trong input" chứ không theo "khác bản đọc trước"; hai revision chỉ đứng cạnh trường vá (input hỗn hợp hoặc rỗng thì frame chỉ mang id); client chỉ vá khi frame có ít nhất một khoá `Patch` và đủ hai revision; frame có khoá nội dung ngoài `Patch` (ngoài id và cặp revision) thì client không vá mà invalidate như cũ (review cuối lát E chọn, là cách đọc chặt của ràng buộc 2 spec §4.3 "Trường lạ trong frame bị bỏ qua, không vá"; nếu quangpd chọn cách đọc lỏng thì client quay về bỏ khoá lạ và vá khoá biết); cách mã hoá giá trị (`YYYY-MM-DD`, chuỗi rỗng khi xoá); trang chi tiết đã vá không refetch; điều kiện phải tắt `Patch` trước khi ship quyền đọc task hẹp hơn workspace; việc mở thêm trường hay topic phải cần ADR mới; và giữ `Version` của `task.updated` ở 1. Luật vào `CLAUDE.md` cùng commit với test giữ luật.

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
lạ bị bỏ; frame không bao giờ tạo bản ghi mới. Spec không nêu trường nào được vá. ADR này
ghi lại quyết định đó, cộng tập trường do plan lát E chọn và hai điều kiện mà lượt tiền
kiểm mã ngày 2026-09-14 buộc phải thêm.

1. **`revision` của task tăng theo từng câu query, không theo từng lần sửa.**
   `TaskService.updateTaskInTx` luôn chạy `UpdateTask`, rồi chạy `SetTaskAssignee`,
   `SetTaskDueDate`, `SetTaskProjectID` cho mỗi trường có mặt trong input, dù giá trị có
   đổi hay không (`server/internal/service/task.go:397-470`); mỗi query tăng revision một
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
kiểu đó. Một giá trị không phải chuỗi làm `Handle` trả lỗi; dispatcher thử lại theo lịch
backoff, và sau `MaxAttempts` (10) lần thì đưa hàng vào dead letter
(`server/internal/outbox/outbox.go:33-35,195-200`), nên frame đó không bao giờ tới client.

## Quyết định

1. **`Patch` trong catalogue là nguồn sự thật duy nhất cho nội dung trong frame.**
   `outbox.EventDef` có thêm `Patch []string`. Chỉ hàng có `Patch` mới được mang trường
   không phải id, và chỉ đúng những trường nó liệt kê. Hôm nay chỉ `task.updated` có
   `Patch`, gồm bốn trường: `title`, `status`, `priority`, `due_date` (tập do plan lát E
   chọn, spec không nêu; chờ quangpd xác nhận ở review PR). `Payload` của hàng
   đó thêm `revision_before` và `revision`. Mở `Patch` cho trường khác hay topic khác cần
   ADR mới. Quyết định này thu hẹp Quyết định 4 của ADR 0009
   (`docs/adr/0009-audit-va-outbox-cung-transaction.md:25-27`, "payload chỉ mang id và các
   trường cần để route"), chỉ ở đúng ngoại lệ là trường một hàng khai ở `Patch`; phần còn
   lại của ADR 0009 vẫn đứng, và ADR 0015 không thay thế nó.
2. **Không vá** `assignee_*`, `position`, `project_id`, `description`.
   - `assignee_*`: task mang người phụ trách dưới dạng actor do server phân giải; vá id mà
     không có tên sẽ hiện sai.
   - `position`, `project_id`: đổi thứ tự và thành viên của list, việc chỉ refetch làm đúng.
   - `description`: *suy luận của agent khi viết ADR; spec không nêu `description`, plan và
     research lát E chỉ ghi quyết định không vá mà không ghi lý do — chờ quangpd xác nhận ở
     review PR.* Cột là `TEXT` không giới hạn độ dài
     (`server/migrations/002_tasks.up.sql:5`); mang nó đưa văn bản dài nhất của task vào mọi
     hàng `outbox_events` và mọi frame workspace, trong khi lợi ích độ trễ nằm ở các trường
     phân loại ngắn.
3. **Server chỉ gửi trường vá khi frame mô tả trọn thay đổi của lời gọi phát nó.** Nơi
   phát là `TaskService.updateTaskInTx` (`server/internal/service/task.go:397`), có hai
   người gọi: `TaskService.Update` (`task.go:372`, một task trong một transaction) và
   `TaskService.BatchUpdateTasks` (`server/internal/service/task_mutations.go:106-152`, tới
   100 id trong một transaction, không khử id trùng). Mỗi lời gọi gửi mọi trường vá có
   trong input của nó, kèm `revision_before` và `revision`, chỉ khi mọi trường có trong
   input đều thuộc `Patch`. "Có trong input", không phải "khác bản đọc trước": `before`
   được đọc trước khoá hàng, so với nó có thể giấu trường chính lời gọi này ghi; trường vá
   gửi lại với giá trị không đổi là vô hại vì giá trị lấy từ hàng dưới khoá. Input có bất
   kỳ trường nào khác (kể cả `description`, dù giá trị không đổi), hoặc input rỗng, thì
   frame chỉ mang `task_id`, `workspace_id`, không có hai revision (Quyết định 5).
   `updated_at`, `last_activity_at` đổi ở mọi lời gọi và không nằm trong frame. Hai
   revision thuộc về đúng một lời gọi, cho đúng task của lời gọi đó: `revision` là revision
   của hàng mà query cuối của lời gọi trả về (RETURNING), tức task ngay sau lời gọi;
   `revision_before` là `revision` của hàng ngay sau `UpdateTask` trừ một, tức task ngay
   trước lời gọi. `UpdateTask` luôn chạy, khoá hàng và tăng revision đúng một
   (`server/pkg/db/queries/tasks.sql:43`); khoá giữ tới lúc commit, nên không người ghi nào
   chen vào giữa hai đầu. Không đếm số query tăng revision mà lời gọi đã chạy: cách đếm vỡ
   im lặng nếu một `Set*` sau này tăng có điều kiện. Không tính theo cả transaction: lô
   `[X, X]` gọi hai lần cho cùng task, và lời gọi thứ hai khi đó sẽ khai `revision_before`
   bằng revision trước cả lô, tức khoảng của nó trùm lên khoảng của lời gọi thứ nhất, trong
   khi guard ở Quyết định 4 chỉ an toàn khi mỗi khoảng mô tả trọn thay đổi bên trong nó.
   Cũng không dùng revision đọc trước transaction (xem Hệ quả). Mọi giá trị là chuỗi; ngày ở dạng `YYYY-MM-DD`; trường
   nullable bị xoá gửi chuỗi rỗng. Service lấy danh sách trường từ `Patch` của `EventDef`
   mà `outbox.Lookup("task.updated")` trả về (hàm trả `(EventDef, bool)`,
   `server/internal/outbox/catalogue.go:246`), không tự lặp lại danh sách.
4. **Client chỉ vá bản ghi đã có, và chỉ khi revision khớp đầu dưới.** Client chỉ vá khi
   frame có ít nhất một khoá thuộc `Patch` và đủ cả `revision_before` lẫn `revision`. Khi
   đó một bản ghi task trong cache được vá nếu `revision` của nó bằng `revision_before` của
   frame; sau khi vá nó mang `revision` của frame. Thiếu một điều kiện, hoặc lệch revision,
   thì không vá và invalidate như trước. Frame có khoá nội dung ngoài `Patch` (ngoài
   `task_id`, `workspace_id` và cặp revision) thì không vá, invalidate như cũ. Frame không
   mang event version (`packages/core/api/ws-types.ts`), nên khoá lạ là dấu hiệu duy nhất
   cho thấy server đã mở `Patch` rộng hơn bản client đang chạy; vá các trường client biết
   rồi nhận revision mới sẽ để trường mới cũ sau một revision hiện hành. Nhờ luật này, mở
   thêm một trường `Patch` bằng ADR sau an toàn với client đã deploy (tab web chạy bundle
   cũ, app mobile dùng chung hàm thuần theo ADR 0011): chúng refetch thay vì vá. Frame không bao giờ tạo bản ghi: `task.created` và `task.deleted`
   vẫn chỉ invalidate. Trang chi tiết đã vá thì không cần refetch. List vẫn invalidate, vì
   trạng thái, độ ưu tiên và ngày hạn đổi thứ tự, cột board và nhóm.
5. **Frame thiếu một trong hai revision, hoặc không có khoá `Patch` nào, là frame id-only.**
   Những nơi khác phát `task.updated` (xoá dự án, nhãn, thuộc tính tuỳ biến, cha và phụ
   thuộc: `project.go`, `task_catalog_labels.go`, `task_catalog_properties.go`,
   `task_graph.go` trong `server/internal/service/`) giữ payload `task_id`, `workspace_id`.
   `updateTaskInTx` cũng gửi đúng payload đó cho lần sửa hỗn hợp (input có trường ngoài
   `Patch`) và lần sửa rỗng (Quyết định 3). Cột `Payload` của hàng `task.updated` vì vậy là
   tập khoá một frame *có thể* mang, không phải tập khoá mọi frame mang. Client coi thiếu
   `revision_before` hoặc `revision`, hoặc không có khoá `Patch` nào, là không vá.

## Hệ quả

Được: người đang mở task thấy tiêu đề, trạng thái, độ ưu tiên và ngày hạn đổi ngay khi
frame tới, không chờ refetch trang chi tiết.

Đánh đổi, viết thẳng:

- **`outbox_events` không còn chỉ là sổ sự kiện.** Từ ADR này bảng mang một phần nội dung
  task: tiêu đề và ba trường phân loại, ở mỗi lần sửa đủ điều kiện. Mọi consumer outbox,
  hôm nay và sau này, đọc được tiêu đề task.
- **An toàn dựa trên một giả định về quyền đọc.** `task.updated` phát theo phạm vi
  workspace, tức tới mọi kết nối trong workspace. Hôm nay quyền đọc task chỉ là thành viên
  workspace: `TaskService.authorizeActor` (`server/internal/service/task.go:354-366`) gọi
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
  liệu ở trên. Lấy `revision` của hàng `UpdateTask` trả về (RETURNING) trừ một thì đúng:
  `UpdateTask` là câu UPDATE đầu tiên của lời gọi, luôn chạy và tăng revision đúng một, và
  hàng bị khoá từ câu đó tới lúc commit. B khai 6, client ở 5 không vá.
- **Cache trễ thì quay về refetch, không sai.** Frame của những command tăng revision mà
  không mang trường vá khiến client invalidate. Nếu frame đó mất hoặc tới muộn, bản ghi
  trong cache lệch `revision_before` của frame vá kế tiếp, và frame đó cũng rơi về
  invalidate. Vá chỉ chạy khi cache đã theo kịp server; lúc cache trễ, trải nghiệm y như
  trước ADR này.
- **List vẫn refetch.** Hàng trong list đổi ngay, nhưng thứ tự, cột board và nhóm chỉ đúng
  sau refetch. ADR này không cho client tự sắp xếp lại list từ frame.
- **`Version` của `task.updated` giữ 1.** *(Suy luận của agent khi viết ADR; spec và plan
  không nói tới `Version` — chờ quangpd xác nhận ở review PR.)* Thêm khoá là thay đổi cộng
  thêm: hai consumer của topic (`server/internal/outbox/realtime_consumer.go`,
  `server/internal/notification/consumer.go`) giải mã vào `map[string]string` và chỉ đọc
  khoá mình cần; client (`packages/core/api/ws-client.ts`) chỉ kiểm `type`; không consumer
  nào từ chối sự kiện vì khoá lạ (decoder vá ở client gặp khoá lạ thì chỉ không vá và
  invalidate như cũ, Quyết định 4). Chiều ngược lại — hàng outbox ghi trước deploy, thiếu hai revision —
  rơi vào Quyết định 5: không vá.
- **Luật trong `CLAUDE.md` đổi ở hai nhịp.** "payload chỉ mang id" (§ Audit and Events,
  § Domain Reminders) đổi cùng commit với ADR này và test catalogue. "frame không bao giờ
  ghi vào cache" (§ State Rules) vẫn đúng cho tới khi client vá thật, và chỉ đổi cùng
  commit với test giữ luật phía client.

## Test giữ luật

- `scripts/events-catalogue.test.mjs` (cùng commit với ADR này): khoá payload của hàng có
  người nghe là id hoặc khoá revision; ở mọi hàng, kể cả hàng hạ tầng,
  `revision_before`/`revision` chỉ được đứng ở hàng có `Patch`; chỉ `task.updated` được
  khai `Patch`, kể cả so với hàng hạ tầng; hàng có `Patch` phải có `revision_before` và
  `revision`; tập trường vá đúng bốn trường ở Quyết định 1;
  `server/internal/outbox/catalogue.go` và `docs/events/CATALOGUE.md` khớp nhau cả ở cột
  `Patch`; sau khi bỏ comment `//` và `/* */`, mọi hàng Go ở đúng hình dạng một dòng mà
  test đọc được, để không hàng nào lọt khỏi các luật trên và không comment nào đứng thay
  một hàng. Từ lát E Task 3 (`4911cb7`), test cũng đỏ khi danh sách trường client giải mã
  (`TASK_PATCH_FIELDS` trong `packages/core/tasks/realtime-task-patch.ts`) khác `Patch` của
  `task.updated` (`the client decodes exactly the fields task.updated lists in Patch`). Giữ
  luật ở `CLAUDE.md` § Audit and Events và § Domain Reminders.
- `server/internal/service/task_realtime_patch_test.go` (lát E Task 2): đổi riêng trường
  vá được thì frame mang trường đó cùng hai revision đúng; input hỗn hợp (có trường ngoài
  `Patch`) hoặc input rỗng thì frame chỉ mang id, không trường vá, không hai revision
  (`TestRealtimePatchCarriesOnlyAWholeChange`); hai lần sửa đồng thời không sinh hai khoảng
  `[revision_before, revision]` chồng nhau (`TestRealtimePatchConcurrentUpdatesDoNotOverlap`);
  lô `BatchUpdateTasks` lặp cùng một id sinh các khoảng nối tiếp, không chồng nhau
  (`TestRealtimePatchBatchRepeatingATaskChainsRanges`); người ghi xen giữa lần đọc `before`
  và khoá hàng không giấu được trường lời gọi ghi lại về giá trị cũ, dù là `description`
  (frame chỉ id, `TestRealtimePatchStaleReadCannotHideAChange`) hay trường vá (frame vẫn mang
  trường đó, `TestRealtimePatchStaleReadCannotHideAPatchField`); frame nhãn vẫn chỉ id
  (`TestRealtimePatchOtherEmittersStayIDsOnly`); mọi giá trị là chuỗi. Từ đợt sửa sau review
  cuối lát E, vế "mọi trường có trong input đều thuộc `Patch`" fail closed: trường nào của
  `UpdateTaskInput` ngoài bốn trường vá cũng làm frame chỉ mang id, không qua danh sách viết
  tay; hai ca bảng ghim input hỗn hợp mà trước đó không test nào ghim (bỏ `position`,
  `project_id` khỏi danh sách viết tay mà test vẫn xanh)
  (`TestRealtimePatchCarriesOnlyAWholeChange/status_beside_position`,
  `TestRealtimePatchCarriesOnlyAWholeChange/title_beside_project_id`).
- `packages/core/tasks/realtime-task-patch.test.ts` và
  `packages/core/realtime/use-realtime-sync.test.tsx` (lát E Task 3, và đợt sửa sau review
  cuối lát E): frame có khoá nội dung ngoài `Patch` (ngoài id và cặp revision) thì không vá,
  cache không nhận revision mới và khoá chi tiết vẫn invalidate
  (`is ids-only when the frame also carries %s, a content key outside Patch`, trong đó có
  `start_date`;
  `does not patch, keeps the cached revision and invalidates when the frame carries a content key outside Patch`); lệch
  revision không vá; frame không tạo bản ghi; vá trang chi tiết thì không invalidate khoá
  chi tiết, list vẫn invalidate; frame có đủ hai revision mà không có khoá `Patch` nào thì
  không vá, cache giữ revision cũ và khoá chi tiết vẫn invalidate
  (`keeps the cached revision and invalidates when the revisions match but no Patch field is present`,
  `is ids-only when the frame has both revisions but no Patch field`); trang chi tiết đang
  fetch hoặc đã bị đánh invalidated thì không vá và khoá chi tiết vẫn invalidate
  (`leaves an entry that is already refetching to that refetch`,
  `leaves an entry already marked invalidated to its pending refetch`); entry dạng list
  đang idle mà đã bị invalidate thì không vá và vẫn giữ cờ invalidated, còn entry dạng list
  đã bị invalidate mà đang refetch thì vẫn được vá
  (`leaves an idle list-style entry that an earlier wave invalidated unpatched and still invalidated, yet patches one already refetching`).
  Giữ luật ở `CLAUDE.md` § State Rules, đổi cùng commit với hai test này.
