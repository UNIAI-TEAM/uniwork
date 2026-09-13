# UniWork — Task human-parity với USF (spec ô)

> **Trạng thái:** in-progress — lát A shipped (plan `../plans/2026-09-12-tasks-human-parity-slice-a.md`); lát B shipped (plan `../plans/2026-09-13-tasks-human-parity-slice-b.md`); lát C shipped (plan `../plans/2026-09-13-tasks-human-parity-slice-c.md`); lát D1 shipped (plan `../plans/2026-09-13-tasks-human-parity-slice-d1.md`)

**Ngày:** 2026-09-12
**Issue:** (tạo khi `writing-plans` — 1 issue ô + 5 sub-issue)
**Parent:** F-05 · UNI-426
**Phụ thuộc:** lát 1–6 và lát 8 của UNI-426 đã ở `develop`
**Umbrella cũ:** `2026-09-07-tasks-work-management-parity-design.md`
**Baseline đối chiếu:** repo `usf` @ `11be78e76` (nằm ngoài cây UniWork)

## 1. Mục tiêu

Đóng khoảng cách trải nghiệm giữa Task của UniWork và Issue của USF **ở phần
con người dùng**, trên host web. Sau spec này, một người làm việc trên UniWork
không còn thiếu thao tác nào so với USF ngoài những thứ thuộc agent runtime.

Khả năng `tasks.agent_runs`, `tasks.vcs`, `tasks.squads`, `tasks.local_workdir`,
`desktop.host`, `mobile.host` **giữ nguyên Unavailable kèm reason_code**. Spec
này không đụng tới F-10 và không mở lát 7.

### 1.1 Bằng chứng khoảng cách (đo trên mã, 2026-09-12)

| Thước đo | UniWork | USF | Tỷ lệ |
| --- | --- | --- | --- |
| LOC UI tasks + my-tasks + projects | 15.720 | 34.755 | 45% |
| LOC test UI | 4.669 | 21.280 | 22% |
| LOC e2e cho task | 189 | 613 | 31% |
| Khóa i18n cho task | 296 | 676 | 44% |
| LOC trang chi tiết (trừ phần agent) | 1.725 | ~7.700 | 22% |
| Hành động phím tắt đã khai báo | 1 | 19 | 5% |

Các chế độ xem tập hợp đã xấp xỉ ngang. Đo theo LOC, vốn chỉ là đại lượng thay
thế thô: bảng 91%, board 80%, swimlane 77%, list 71%, và gantt của UniWork
nhiều hơn USF. Đọc con số này như "đã có mặt và có chiều sâu tương đương",
không phải như phần trăm tính năng. Khoảng cách dồn vào **trang chi
tiết, thread bình luận, picker, bàn phím và lớp tiện nghi nhỏ**.

### 1.2 Hai lỗi thật, không phải thiếu tính năng

| Lỗi | Bằng chứng | Lát |
| --- | --- | --- |
| Reaction trên bình luận không bao giờ hiện; người dùng bấm, API thành công, giao diện không đổi | `packages/views/tasks/detail/components/comment-card.tsx:100` truyền `reactions={[]}` cứng | A |
| Lỗi tải danh sách task hiển thị nhầm thành trạng thái rỗng kèm lời mời tạo mới | controller không expose `isError`; `task-surface.tsx` chỉ có nhánh loading / empty | A |

## 2. Quyết định đã chốt (brainstorm 2026-09-12)

| Chủ đề | Quyết định |
| --- | --- |
| Định nghĩa "ngang USF" | Chỉ phần con người. Agent/VCS/quick-action giữ Unavailable + reason |
| Host | Chỉ web. Desktop và mobile vẫn thuộc lát 7 của UNI-426 |
| Cách làm | **Viết mới**, dùng USF làm đặc tả hành vi. Đọc để biết sản phẩm hứa gì, không chép mã |
| Độ trễ cảm nhận | **Viết ADR cho phép vá cache từ frame realtime**, có kiểm soát bằng catalogue |
| Đóng gói | Một spec ô, 5 lát merge độc lập, mỗi lát một plan và một overlay nghiệm thu |
| Timeline hoạt động | Dùng lại `AuditService.ResourceHistory` đã có; **không** viết endpoint mới |

Lý do chọn viết mới thay vì transplant: trần 500 dòng của repo cộng kiến trúc
slot đã dựng ở `task-detail-editors.tsx` khiến bản transplant bị viết lại gần
hết trong lúc tách file. `issue-detail.tsx` của USF là 3.166 dòng và chrome
agent dệt xuyên suốt. Phần đáng học là hành vi, và hành vi đọc được mà không
cần chép.

## 3. Phạm vi

### 3.1 Trong phạm vi

**Lát A — Vá lỗi và nền.** Không phụ thuộc lát nào.

- Query list comment nhúng mảng reaction; SDO bám hình dạng `ReactionItem` đã
  có trong `packages/ui/components/common/reaction-bar.tsx`.
- `isError` trên `useTaskSurfaceController`; nhánh hiển thị lỗi riêng, tách
  khỏi nhánh rỗng, có nút thử lại.
- `apps/web/app/error.tsx` và `apps/web/app/not-found.tsx`.
- Timeline hoạt động: trộn bình luận với `useResourceHistory(wsId, "task", id)`
  trong `timeline.tsx`, gộp theo thời gian.
- Xóa route `GET /tasks/{taskID}/timeline` và hàm service trả
  `timeline_not_ready`; cập nhật catalogue route và overlay parity.

**Lát B — Thread bình luận.** Chỉ `packages/views/` và `packages/core/`.

- Ô trả lời dưới mỗi bình luận gốc; cây một cấp, đúng mô hình
  `parent_comment_id` đã có từ migration 110.
- Bảng điều hướng luồng và thanh luồng đã giải quyết.
- Composer dính đáy khi cuộn.
- Store nháp bình luận trong `packages/core/tasks/stores/`, qua `StorageAdapter`.

**Lát C — Picker và sửa tại chỗ.**

- `packages/views/tasks/pickers/`: người nhận, độ ưu tiên, nhãn, trạng thái,
  ngày bắt đầu, ngày hết hạn, thuộc tính tùy biến. Mỗi picker một file.
- Menu hành động trên hàng và menu chuột phải, dùng primitive của `packages/ui/`.
- Picker được dùng lại ở ô bảng, thanh hành động hàng loạt, và sidebar chi tiết.

Ngày bắt đầu và thuộc tính tùy biến không có trong lát C đã ship; lý do và việc
cần làm để đóng nằm ở §7quater.

**Lát D — Bàn phím và tiện nghi.** Phụ thuộc C.

- Mở rộng `SHORTCUT_ACTIONS`: tạo task, mở tìm kiếm, tìm trong task, mở điều
  hướng luồng, và các phím đi tới màn hình. Khai báo cả `send`, hiện đang bị
  `title-editor.tsx` gọi mà chưa từng tồn tại.
- Tìm trong trang cho task detail.
- Store: task xem gần đây, ghi nhớ gấp mở sub-task và luồng đã giải quyết.
- Cuộn vô hạn cho list và board, ngang mức bảng đang có.

Lát D được tách thành hai lát khi viết plan. D1 (bàn phím và tiện nghi: ba gạch
đầu dòng đầu) đã ship, giới hạn nằm ở §7quinquies. D2 (cuộn tải thêm cho list,
board và My Tasks) có plan riêng `../plans/2026-09-13-tasks-human-parity-slice-d2.md`.
Lý do tách: list, board và My Tasks đang cắt câm ở 50 task, tức là task biến
khỏi tay người dùng mà giao diện không nói gì. Đó là lỗi đúng đắn, không phải
tiện nghi, và việc sửa chạm `use-task-surface-controller.ts` cùng cache lạc
quan ở `packages/core/tasks/hooks.ts`, hai file D1 không chạm.

**Lát E — ADR vá cache realtime.** Tách được, hoãn được.

- ADR mới trong `docs/adr/` (số kế tiếp là 0015, cấp lúc viết plan): client được vá cache từ frame realtime, **chỉ với
  trường có tên trong `server/internal/outbox/catalogue.go`**; mọi thứ khác vẫn
  invalidate.
- Mở rộng `Payload` theo từng topic task, không mở đại trà.
- `planCacheUpdate` sinh `patch` thật thay vì luôn `invalidate`.
- Đổi test ghim `packages/core/realtime/use-realtime-sync.test.tsx` từ "không
  bao giờ vá" sang "chỉ vá đúng trường đã khai báo".
- Cập nhật mục State Rules trong `CLAUDE.md` trỏ sang ADR mới.

### 3.2 Ngoài phạm vi

- Mọi thứ thuộc agent runtime: agent run, task message, task token, usage
  rollup, pull request, quick action, preview trigger. Thuộc F-10.
- Host desktop và mobile. Thuộc lát 7 của UNI-426 và ADR 0011.
- `quick-create`, `assignee-frequency`, `tasks/move`, `retry-source-context`:
  giữ stub, vì chúng phục vụ luồng agent.
- Refactor rộng ngoài các file lát đang chạm.

## 4. Kiến trúc

### 4.1 Ranh giới không được vượt

Luật cũ, nhắc lại vì lát C dễ vi phạm nhất:

- Picker là thành phần trình bày. Nhận giá trị và hàm đổi từ trên xuống,
  **không tự gọi API**. Mutation ở lớp gọi.
- `packages/core/` không chạm `localStorage`; dùng `StorageAdapter` từ
  `packages/core/platform/`.
- `packages/views/` không import `next/*`; điều hướng qua `useNavigation()`.
- Mỗi file `.ts`/`.tsx` tối đa 500 dòng.

### 4.2 Timeline hoạt động

`AuditService.ResourceHistory` đã chặn bằng `ws.RequireMember`, tức thành viên
workspace đọc được lịch sử task của workspace mình. Đây là đúng mức quyền cần
cho tính năng này, và nó **khác** đường của màn Bảo mật và Nhật ký vốn đòi quản
trị tổ chức. Không mở thêm quyền, không thêm endpoint.

Client trộn hai nguồn ở tầng hiển thị chứ không ở tầng cache: bình luận giữ
query key cũ, hoạt động giữ query key của audit. Gộp và sắp xếp trong
`timeline.tsx`.

### 4.3 Vá cache realtime (lát E)

Frame hiện là `map[string]string` phẳng, sinh từ payload outbox, và
`PublishWorkspace` phát cho mọi người trong workspace. Ba ràng buộc đưa vào ADR:

1. Chỉ topic được liệt kê rõ mới có payload giàu. Danh sách trường nằm trong
   catalogue, và catalogue là nguồn sự thật duy nhất.
2. Client vá đúng những trường đó. Trường lạ trong frame bị bỏ qua, không vá.
3. Frame không bao giờ tạo bản ghi mới trong cache. Vá chỉ sửa bản ghi đã có;
   sự kiện tạo mới vẫn invalidate.

Đánh đổi phải viết thẳng trong ADR: bảng `outbox_events` chuyển từ sổ sự kiện
sang kênh mang nội dung. Với task thì rủi ro lộ dữ liệu thấp vì mọi thành viên
workspace vốn đã đọc được mọi task trong workspace, nhưng tính chất của bảng
thay đổi và ADR phải nói rõ điều đó.

### 4.4 Cấu trúc thư mục đích

```
packages/views/tasks/
  detail/components/     # + reply-input, thread-nav, resolved-thread-bar (lát B)
  pickers/               # mới, lát C
  surface/               # + nhánh isError (lát A)
packages/core/tasks/
  stores/                # + comment-draft, recents, collapse (lát B, D)
  cache-coordinator.ts   # patch thật (lát E)
apps/web/app/
  error.tsx, not-found.tsx   # mới, lát A
docs/adr/                # ADR vá cache (lát E)
```

## 5. Lỗi và stub

| Tình huống | Cách xử lý |
| --- | --- |
| Query danh sách lỗi | Nhánh lỗi riêng, có nút thử lại. Không rơi vào rỗng |
| Mutation lỗi | `toastApiError` như đang làm; nháp bình luận giữ nguyên |
| `revision_conflict` | Toast và refetch, không dựng UI merge |
| Catalog thuộc tính tùy biến thiếu | Picker disabled kèm reason |
| Agent / VCS / quick action | Giữ Unavailable, không đổi một dòng nào |
| Audit trả rỗng | Timeline chỉ hiện bình luận, không hiện khối lỗi |

## 6. Kiểm thử và DoD

- **Go:** list comment kèm reaction, có ca cách ly workspace. Route timeline cũ
  biến mất khỏi catalogue và khỏi test route.
- **Core:** mỗi endpoint đổi có thêm ca malformed. Store mới có test. Lát E có
  test rằng trường ngoài catalogue bị bỏ qua.
- **Views:** smoke cho thread, picker, nhánh lỗi. Mỗi picker có test bàn phím.
- **E2E:** một kịch bản đi hết vòng: mở task, sửa bằng picker, trả lời bình
  luận, thả reaction và thấy nó hiện, xem hoạt động.
- **i18n:** vi và en cân bằng; hiện lệch 8 khóa ở vi và 4 ở en, phải về 0 trước
  khi lát cuối merge.
- **Coverage:** sàn chỉ đi lên, nâng bằng chính lát đã kiếm được nó.
- **Bundle:** trang chi tiết đang lazy-load và trong ngân sách 150 KB gzip;
  không nâng trần để nhét thêm.
- `make check` hoặc `make check-worktree` xanh trước mỗi PR.
- Roadmap F-05: chỉ đổi sang `CÓ` khi cả 5 lát xong **và** lát 7 được quyết
  định riêng. Trước đó giữ `MỘT PHẦN`.

## 7. Rủi ro

| Rủi ro | Giảm thiểu |
| --- | --- |
| **Ghi công và giấy phép.** `usf` phát hành theo Multica License, tức Apache 2.0 cộng điều kiện về thương hiệu và ghi công. UniWork không có `LICENSE`, không có `NOTICE`, và `scripts/no-usf-leak.test.mjs` xóa mọi chuỗi "multica", trong khi lát 1–6 đã transplant mã | **Cần người có thẩm quyền quyết định, không phải kỹ sư.** Spec này chọn viết mới nên không mở rộng vùng mã dính, nhưng không giải quyết được phần đã có. Đưa ra khỏi phạm vi kỹ thuật và chuyển lên |
| Lát E đảo một quyết định đang có test giữ | ADR trước, mã sau. Giới hạn bằng catalogue. Lát E tách rời nên hoãn được mà không chặn A–D |
| Picker tự gọi API và phá ranh giới | Ghi luật ở §4.1; review bắt; lint ranh giới package đã có |
| File chi tiết phình quá 500 dòng | Tách theo thành phần ngay từ đầu, không dồn rồi tách sau |
| Nội dung task vào bảng outbox | Mở theo từng topic, không đại trà; ADR nói rõ đánh đổi |
| Phạm vi trôi sang agent | Không lát nào được sửa `workcapability`; test catalogue giữ |

## 7bis. Giới hạn đã biết của lát A

Lát A sửa hai lỗi người dùng thấy được và hai chỗ giao diện nói sai. Hai giới
hạn dưới đây vẫn còn nguyên sau khi lát A merge; ghi ở đây để changelog không
tự nhận nhiều hơn thực tế, và để lát sau biết chỗ cần cầm.

1. **Chế độ bảng vẫn nuốt lỗi tải danh sách.**
   `packages/views/tasks/surface/use-task-surface-controller.ts` trả `isError: false`
   bất cứ khi nào chế độ bảng bật, đúng theo hình dạng `isLoading` đã có từ
   trước. Hệ quả: mất mạng khi đang ở chế độ bảng vẫn hiện "chưa có công
   việc" thay vì khối lỗi mà lát A vừa dựng cho chế độ danh sách. Sửa được
   bằng cách cho nhánh bảng trả trạng thái lỗi của chính truy vấn bảng, tức
   thêm đường dây riêng cho bảng — việc này nằm ngoài phạm vi lát A. Ai nhận
   tiếp: bắt đầu ở controller, rồi kiểm tra `CollectionPageState` của chế độ
   bảng.

2. **Hoạt động bị cắt bớt trong im lặng.**
   `AuditService.ResourceHistory` chặn số dòng ở `AuditPageMax` (100), còn client
   không truyền `limit` và không phân trang. Trên một công việc nhiều hoạt
   động, các dòng cũ nhất rơi ra ngoài mà giao diện không nói gì và không có
   nút "tải thêm". Sửa được bằng cách cho `useResourceHistory` nhận cursor và
   thêm nút tải thêm dưới timeline, kèm một dòng cho biết danh sách đang bị
   cắt. Ai nhận tiếp: bắt đầu ở `packages/core/audit`, đối chiếu tham số phân
   trang mà endpoint nhật ký tổ chức đã dùng.

## 7ter. Giới hạn đã biết của lát B

Lát B biến bình luận trên task thành cuộc trò chuyện có luồng: trả lời, nháp
bền qua lỗi gửi, gấp luồng đã giải quyết, composer dính đáy, và điều hướng
luồng. Một điểm dưới đây là quyết định sản phẩm có chủ đích, không phải thiếu
sót — ghi lại để không ai "sửa" nhầm nó sau này.

1. **Bảng điều hướng luồng chỉ hiện khi task có từ bốn luồng bình luận trở
   lên.** Dưới ngưỡng đó, cuộn tay đủ nhanh nên bảng chỉ thêm nhiễu thị giác;
   `packages/views/tasks/detail/components/thread-nav-panel.tsx` đọc số luồng
   gốc và tự ẩn dưới bốn. Đây là quyết định có chủ đích từ review giữa lát B
   (commit "nâng ngưỡng bảng điều hướng luồng lên bốn"), không phải một khiếm
   khuyết cần lát sau sửa.

## 7quater. Giới hạn đã biết của lát C

Lát C hợp nhất ba bản cài đặt song song thành một bộ picker trong
`packages/views/tasks/pickers/` (trạng thái, độ ưu tiên, người phụ trách, nhãn)
dùng chung cho ô bảng, sidebar chi tiết và thanh hàng loạt; thêm đặt ngày hạn
cho nhiều task cùng lúc; và thêm menu hành động trên hàng (nút ba chấm) cùng
menu chuột phải cho list và board. Thẻ swimlane cũng có cả hai menu, vì
`packages/views/tasks/modes/swimlane-cell.tsx` dùng lại `DraggableBoardCard`.
Lát C còn sửa kéo-cuộn bảng để một lần nhấn trong menu portal không bắt đầu
kéo-cuộn (`packages/views/tasks/modes/use-board-drag-pan.ts`, d36c132, test
8b96da8), và chặn gửi xoá hai lần: nút xác nhận bỏ qua cú bấm thứ hai khi
request còn treo (1cce781), và mỗi hàng chỉ có một model hành động và một hộp
thoại xoá, nên xoá lại qua lối vào kia cũng bị chặn (ed68ccf). Các điểm dưới
đây còn đúng ở mã khi lát C merge. Mỗi điểm nói rõ đó là quyết định có chủ đích hay khoảng trống cho lát
sau, và cần gì để đóng.

1. **Ngày bắt đầu chỉ đọc.** Khoảng trống, cần backend. Task không có đường ghi
   `start_date`: `PatchTaskSDI` trong `server/internal/handler/dto/sdi/task.go`
   không có trường này, `server/internal/handler/task.go` chỉ đọc `due_date` từ
   body PATCH, và service chỉ gọi query sqlc `SetTaskDueDate`. Sidebar chi tiết
   hiện ngày bắt đầu là `DateField` tắt kèm tooltip "chưa sẵn sàng". Để đóng:
   thêm trường vào SDI, query sqlc, lệnh service có audit, rồi bật picker.

2. **Không có picker thuộc tính tùy biến.** Quyết định có chủ đích. Đây không
   phải một picker mà là nối dây cả một danh mục thuộc tính;
   `packages/views/tasks/modes/board-view.tsx` và
   `packages/views/tasks/modes/table-column-picker.tsx` đều đang ghi chú chờ
   cùng năng lực "property catalog". Để đóng: một spec riêng cho danh mục thuộc
   tính, không vá vào bộ picker.

3. **Thanh hàng loạt không gắn được nhãn.** Khoảng trống.
   `BatchUpdateBody.updates` trong `packages/core/api/endpoints/tasks-suite.ts`
   không có trường nhãn, nên thanh chỉ có trạng thái, độ ưu tiên, người phụ
   trách và ngày hạn. Để đóng: endpoint batch nhận nhãn ở server, rồi thêm
   `LabelPicker` vào thanh.

4. **Bảng không có menu chuột phải, chỉ có nút ba chấm.** Khoảng trống.
   `ContextMenuTrigger` render một `div` nên không bọc được `<tr>`; còn tự dựng
   hàng qua `DataTable.renderRow` thì mất `onRowClick` và trạng thái chọn mà
   `packages/ui/components/ui/data-table.tsx` gắn cho hàng mặc định. Để đóng:
   thêm một prop kiểu `getRowProps` hoặc `wrapRow` trên `DataTable`.

5. **Mỗi hàng bảng gửi một request nhãn.** Khoảng trống về hiệu năng.
   `useLabelsOnTask` được gọi trong ô nhãn của từng hàng
   (`packages/views/tasks/modes/table-cell-editors.tsx`), và cột nhãn nằm trong
   `DEFAULT_TABLE_COLUMNS` nên hiện mặc định. Để đóng: server nhúng nhãn vào
   danh sách task, ô đọc từ hàng thay vì tự hỏi.

6. **Menu con "Đổi người phụ trách" chỉ có thành viên người và không có tìm
   kiếm.** Quyết định có chủ đích, hoãn sau vòng sửa của menu hành động hàng.
   Task đang giao cho agent hiện một dòng agent đã chọn nhưng bị tắt, nên không
   gán agent từ menu được; task giao cho người đã rời workspace thì không dòng
   nào được đánh dấu (`packages/views/tasks/row-actions-items.tsx`,
   `packages/views/tasks/pickers/member-options.ts`). Để đóng: đưa agent và ô
   tìm kiếm vào menu con, cùng một dòng cho người phụ trách không còn trong
   danh sách.

7. **Xoá task từ menu hàng làm focus bàn phím rơi về `body`.** Quyết định có
   chủ đích, hoãn. Hộp thoại đóng và trả focus về nút mở menu, rồi refetch gỡ
   hàng nên nút đó biến mất (`packages/views/tasks/row-actions-menu.tsx`).
   Người dùng bàn phím mất vị trí trong danh sách. Để đóng: sau khi xoá thành
   công, chuyển focus sang hàng kế tiếp hoặc liền trước.

8. **Vùng bắt đầu kéo của hàng list hẹp hơn trước.** Quyết định có chủ đích.
   Listener dnd-kit giờ nằm ở div con `flex-1` trong
   `packages/views/tasks/modes/list-row.tsx`, không còn ở hàng ngoài, nên padding
   hai bên và vùng nút ba chấm không bắt đầu kéo. Đổi lại, menu và hộp thoại
   portal không nằm trong listener kéo. Không cần đóng.

9. **Ô ngày hạn ở thanh hàng loạt rộng hơn ba picker kia.** Quyết định có chủ
   đích. `BatchDueDatePicker` trong `packages/views/tasks/views/batch-pickers.tsx`
   đặt một `<label>` hiển thị cạnh `DateField` để đặt tên hành động, thay vì
   thêm prop nhãn trigger vào một component dùng chung. Không cần đóng trừ khi
   `DateField` có prop đó vì lý do khác.

10. **Chưa kiểm trên trình duyệt thật.** Khoảng trống kiểm chứng. Màu chip nhãn,
    nút gỡ nhãn, vị trí nút ba chấm và cơ chế chặn nổi bọt sự kiện qua portal
    lồng nhau của Base UI chỉ được kiểm trên jsdom; `e2e/` chưa có kịch bản nào
    chạm picker hay menu hàng. Việc picker bị tắt không mở được cũng vậy: bằng
    chứng là mã nguồn Base UI (`MenuTrigger` mở ở `mousedown` và chỉ nghe prop
    `disabled` của nó, `@base-ui/react` 1.7.0 `menu/trigger/MenuTrigger.js:161-163`)
    cộng một test jsdom chờ đúng một animation frame. Để đóng: kịch bản E2E mà
    §6 đã hẹn.

11. **Flake "Group _r_2_ not found"** ở
    `packages/views/layout/animated-right-sidebar.tsx`: đã sửa ở lát D1
    (1a0cfc2). Trước đó nó thỉnh thoảng làm lần chạy coverage đầy đủ của `views`
    thoát 1 dù mọi test xanh. Có từ trước lát C, không do lát C gây ra: một
    animation frame còn chờ gọi vào panel group đã gỡ; nay callback đọc lại ref
    của panel khi frame chạy và bỏ qua nếu panel đã gỡ. Cùng loại với nó, cổng
    lát C gặp thêm ba lỗi thoáng qua có từ trước, vẫn còn, không lỗi nào tái
    hiện khi chạy riêng:
    `projects/project-detail-page.test.tsx` và
    `editor/extensions/markdown-paste.test.ts` đỏ khi turbo chạy song song ba
    package (lát B đã gặp y hệt); riêng `markdown-paste` còn hết giờ 30s dưới
    v8 coverage vì dán đồng bộ một chuỗi hơn 50.000 ký tự, chưa đổi từ
    `219130a`. Ở Go, `TestTaskCRUD` (`server/internal/service/task_test.go:186`,
    "missing event task.created") là flake song song: helper `drain` gọi
    `Dispatcher.Process` trên cả database dùng chung, nên dispatcher của package
    test khác chạy cùng lúc có thể nhận mất dòng outbox của test này. Lát C
    không chạm `server/`. Để đóng: cô lập outbox theo test, không nới timeout.

12. **Picker người phụ trách ở bảng và thanh hàng loạt không có trạng thái
    tải hay lỗi.** Khoảng trống. `TableAssigneeCell` trong
    `packages/views/tasks/modes/table-cell-editors.tsx` và `BatchAssigneePicker`
    trong `packages/views/tasks/views/batch-pickers.tsx` chỉ nhận mảng thành
    viên, nên khi danh sách còn đang tải hoặc tải lỗi, popup chỉ có một dòng
    "Chưa giao", trông như workspace không có ai. Menu con người phụ trách trên
    hàng đã báo đang tải và lỗi (8925d50); hai picker này chưa. Để đóng: truyền
    trạng thái query thành viên vào `AssigneePicker` và hiện dòng tải, dòng lỗi
    bị tắt như menu con.

13. **Ô ngày hạn hàng loạt dùng `disabled` native.** Quyết định có chủ đích,
    hoãn. `BatchDueDatePicker` truyền `disabled` xuống `DateField`
    (`packages/views/tasks/views/batch-pickers.tsx:150`), và `DateField` đặt nó
    thành `disabled` native trên nút, nên khi đang có request hàng loạt ô này
    rời tab order, trái hợp đồng `aria-disabled` của repo. Các nút khác trên
    thanh đã dùng `aria-disabled`. Hoãn vì `packages/views/common/date-field.tsx`
    có 11 module import, sửa nó là thay đổi chung cho mọi màn hình đó chứ không
    phải của lát C. Để đóng: `DateField` nhận `aria-disabled` và tự chặn mở
    popover, kèm test ở `common/`.

## 7quinquies. Giới hạn đã biết của lát D1

Lát D1 thay các listener phím rời bằng một bộ điều phối toàn cục trong shell
workspace (`packages/views/layout/global-shortcuts.tsx`), đọc chord từ store
phím tắt ở `packages/core/shortcuts/`. Lát thêm tab đổi phím tắt trong Settings,
khai báo phím gửi cho composer bình luận và trả lời, thêm tìm trong trang chi
tiết task (⌘F), thêm nhóm task xem gần đây trong palette ⌘K, và ghi nhớ luồng đã
giải quyết đang mở cùng sub-task đang gấp. Lát còn sửa một rò rỉ nội dung giữa
người dùng mà lát B đưa vào: nháp bình luận nay bị xoá khỏi bộ nhớ và storage
khi đăng xuất (6d6b36f), và mọi lần ghi vào store nháp hay store xem gần đây bị
từ chối khi không còn phiên (9176654). Hai store đó còn ghi lại người đã viết dữ
liệu: khi một người khác đăng nhập trên cùng trình duyệt, kể cả sau khi phiên
trước hết hạn mà không qua đăng xuất hay sau khi tải lại trang, dữ liệu bị xoá
khỏi bộ nhớ và storage; chính người đó đăng nhập lại thì còn nguyên. Các điểm
dưới đây còn đúng ở mã khi lát D1 merge; riêng dòng mở đầu bằng "Đã sửa" ghi
lại một lỗi đã đóng trong lát, kèm commit sửa. Mỗi điểm nói rõ đó là quyết định
có chủ đích hay khoảng trống, và cần gì để đóng.

1. **Điều hướng luồng (`openThreadNav`) không có phím mặc định.** Quyết định có
   chủ đích. Chưa kiểm được chord nào không bị trình duyệt hay hệ điều hành giữ
   trên mọi nền tảng, nên `packages/core/shortcuts/definitions.ts` khai báo
   `defaultShortcut: null`; người dùng tự gán trong tab Phím tắt của Settings.
   Để đóng: kiểm một chord trên macOS, Windows, Linux ở cả web lẫn desktop rồi
   đặt làm mặc định.

2. **Thu gọn sidebar không phải một action đổi phím được.** Quyết định có chủ
   đích. Primitive `packages/ui/components/ui/sidebar.tsx` tự nghe ⌘/Ctrl+B trên
   `window`, nên `toggleSidebar` không được khai báo; tab Settings hiện nó là
   một dòng phím cố định. Để primitive và action không cùng chạy, core giữ chỗ
   primary+B và cả Control+B trên macOS: không action nào gán được chord đó
   (6bcadde). Cùng lý do, primary+F và Control+F trên macOS chỉ gán được cho
   `findInTask` (e5e6663): trang chat mở tìm tin nhắn bằng một listener trên
   `window` bỏ qua `defaultPrevented`
   (`packages/views/chat/chat-page-content.tsx`), nên action khác giữ chord đó
   sẽ chạy cùng lúc với tìm tin nhắn. Để đóng: primitive nhận chord từ ngoài
   thay vì tự nghe, rồi khai báo action.

3. **Tìm trong trang chỉ khớp trong một nút chữ.** Quyết định có chủ đích, đánh
   đổi của tìm nhẹ. `collectTextMatches` trong
   `packages/views/tasks/detail/find/use-task-find.ts` so từng text node, nên
   truy vấn vắt qua ranh giới phần tử (một cụm chữ đậm giữa câu, một link) không
   được tìm thấy. Để đóng: nối chữ của một khối trước khi so, rồi ánh xạ vị trí
   về từng nút.

4. **Trình duyệt không có CSS Custom Highlight API thì không tô sáng.**
   Quyết định có chủ đích. Hook dò `CSS.highlights` và `Highlight` trước khi
   dùng; không có thì thanh tìm vẫn đếm, vẫn nhảy tới kết quả kế và cuộn tới nó,
   chỉ không tô màu. Không cần đóng trừ khi phải hỗ trợ trình duyệt thiếu API
   này.

5. **Tìm mở luồng đã giải quyết theo markdown thô.** Khoảng trống nhỏ.
   `packages/views/tasks/detail/find/find-expanded-threads.ts` so truy vấn với
   `comment.body` thô, nên truy vấn chỉ khớp cú pháp markdown hay đích của link
   vẫn mở luồng, trong khi chữ hiển thị không có kết quả nào. Luồng mở vì tìm là
   tạm: đóng thanh tìm thì gấp lại, và không ghi vào store nhớ gấp mở. Để đóng:
   so trên chữ đã render của bình luận thay vì markdown.

6. **⌘F khi focus ở ô nhập của sidebar thuộc tính mở tìm của trình duyệt.**
   Quyết định có chủ đích. "Trong trang" nghĩa là trong container cuộn của trang
   chi tiết: `packages/views/tasks/detail/hooks/use-task-detail-shortcuts.ts` bỏ
   qua đích soạn thảo nằm ngoài container và ngoài thanh tìm, để ⌘F không lấn ô
   tìm của palette hay ô nhập ở chỗ khác. Sidebar thuộc tính nằm ngoài container
   đó. Focus ở một nút trong sidebar thì ⌘F vẫn mở thanh tìm của task. Để đóng:
   coi sidebar thuộc tính là một phần của trang chi tiết.

7. **Đang xem trước tệp đính kèm mà focus không nằm trong modal thì phím tắt của
   trang vẫn chạy dưới modal.** Khoảng trống. Modal xem trước
   (`packages/views/editor/attachment-preview-modal.tsx`) là portal
   `role="dialog"` `aria-modal="true"` tự dựng, không phải Dialog của Base UI,
   nên không đặt `data-base-ui-inert`, và không chuyển focus vào trong khi mở.
   Hàm chặn lớp popup `isPortalLayerShortcutTarget` chỉ nhận ra lớp modal qua
   dấu đó hoặc khi đích phím nằm trong `[role="dialog"]`. Mở xem trước từ một
   nút rồi nhấn phím thì:
   - C mở hộp tạo task đè lên.
   - Trên trang chi tiết task, ⌘F mở thanh tìm của task nằm dưới modal và chặn
     tìm của trình duyệt.
   - ⌘[ và ⌘] điều hướng lùi, tới; mọi action `go*` đã gán phím cũng điều
     hướng.

   Chỉ kiểm trên mã, chưa tái hiện trên trình duyệt. Mã giữ nguyên trong PR
   này vì sửa là đổi hành vi, ngoài đợt sửa sau review. Việc sửa không đụng tới
   ⌘K và ⌘J (mục 18): dispatcher chỉ gọi `isPortalLayerShortcutTarget` cho
   action không được phép trong editor
   (`packages/views/layout/global-shortcuts.tsx:75-77`), nên thêm điều kiện "đang
   có `[aria-modal="true"]` hiện trên trang" vào hàm đó chỉ chặn C, ⌘F, ⌘[, ⌘]
   và `go*`. Để đóng: thêm điều kiện đó kèm test (modal đã đóng không chặn),
   hoặc cho modal xem trước chuyển focus vào trong khi mở, hoặc dùng Dialog
   của Base UI.

8. **⌘/Ctrl+Enter trong editor mô tả task chèn ngắt dòng.** Cần người quyết,
   không phải lỗi của D1. HardBreak của TipTap bind `Mod-Enter`
   (`@tiptap/extension-hard-break` `src/hard-break.ts:117`), và editor mô tả
   không truyền `onSubmit` nên extension phím gửi nhường cho nó. Kết quả tuỳ vị
   trí con trỏ:
   - Giữa đoạn: ngắt dòng đổi markdown, nên sau 1,5 giây autosave mô tả
     (`packages/views/tasks/detail/components/task-detail-editors.tsx`) gửi PUT
     `/api/v1/tasks/{id}` kèm `If-Match` (`use-task-field-save.ts` →
     `usePutTask`).
   - Đầu đoạn, chỗ test ghim đặt con trỏ: ngắt dòng serialize ra đúng markdown
     cũ, nên không có gì để lưu và không có request nào.

   Hành vi có từ trước lát; test ghim nó lại để thay đổi phải có chủ ý. Để đóng:
   quyết định ⌘Enter trong mô tả nên làm gì (không làm gì, hay lưu ngay), rồi
   tắt HardBreak cho chord đó.

9. **Mục "Gần đây" của task đã bị xoá hoặc chuyển đi vẫn hiện trong palette tới
   khi được mở.** Khoảng trống. Palette chỉ đọc store
   (`packages/views/search/search-command.tsx`), không hỏi server. Mục chỉ bị gỡ
   khi trang chi tiết nhận đúng lỗi 404
   (`packages/views/tasks/detail/hooks/use-record-task-visit.ts`). Lỗi 403 giữ
   mục, vì có thể tạm thời (tổ chức bị treo, thành viên bị vô hiệu). Phản hồi hỏng
   thì `getTask` trả `null` qua `parseWithFallback` mà không ném lỗi: trang hiện
   "không tìm thấy" nhưng không gỡ mục. Để đóng: gỡ mục khi nhận sự kiện xoá
   task, hoặc kiểm lại danh sách gần đây khi mở palette.

10. **Khoá lưu trữ theo workspace không được xoá khi đăng xuất hay xoá workspace.**
    Có từ trước nhánh, định tuyến cho người. Đăng xuất nay xoá mọi khoá nháp toàn
    cục (6d6b36f), nhưng `clearWorkspaceStorage`
    (`packages/core/platform/storage-cleanup.ts`) không có nơi gọi nào ngoài
    test, nên `uniwork_navigation:<slug>` và mọi store `workspaceScoped: true`
    sống qua cả hai sự kiện. Để đóng: gọi nó khi xoá workspace, và khi đăng xuất
    với danh sách slug của người dùng.

11. **Đăng xuất từ sidebar workspace không xoá cache TanStack Query.** Có từ
    trước nhánh, ngoài phạm vi, định tuyến cho người.
    `packages/views/layout/app-sidebar.tsx` gọi thẳng `logout` của auth store rồi
    điều hướng phía client, không qua `useLogout` (hook có `qc.clear()`). Trên
    cùng một tab, người đăng nhập sau có thể thấy dữ liệu cache của người trước
    tới khi refetch. Để đóng: sidebar dùng `useLogout().mutateAsync()`, giữ điều
    hướng về trang đăng nhập trong `finally`.

12. **Đăng xuất gặp lỗi mạng chỉ dọn cục bộ; phiên ở server không bị thu hồi.**
    Có từ trước nhánh, định tuyến cho người. `logout` trong
    `packages/core/api/endpoints/auth.ts` nuốt lỗi của request đăng xuất rồi vẫn
    xoá access token, nên `logout` của auth store
    (`packages/core/auth/store.ts`) vẫn đặt `anon` và gọi callback dọn nháp, và
    sidebar chuyển sang trang đăng nhập. Server không nhận được lệnh, nên phiên
    chưa bị thu hồi và cookie refresh vẫn nằm trong trình duyệt: lần tải trang
    sau, `initialize` làm mới phiên từ cookie đó và người vừa đăng xuất có thể
    được đăng nhập lại. Để đóng: quyết định đăng xuất lỗi mạng thì chấp nhận
    phiên server còn sống, hay báo lỗi và cho thử lại thay vì chuyển trang.

13. **Phiên hết hạn mà không qua đăng xuất làm mất tối đa 1,5 giây chữ gõ cuối
    trong ô bình luận.** Quyết định có chủ đích. Refresh lỗi đặt phiên về `anon`,
    và `draftWriteOwner` (`packages/core/drafts/cleanup-registry.ts`) từ chối
    mọi lần ghi vào store nháp khi không còn `authed`. Lần ghi nháp debounce 1,5
    giây còn đang chờ lúc đó bị bỏ; nháp đã lưu trước đó còn nguyên cho chính
    người đó đăng nhập lại, còn người khác đăng nhập thì nháp bị xoá. Chốt chặn
    tập trung ở store vì nó phủ mọi đường ghi (flush khi unmount, timer debounce,
    gửi xong sau khi đã đăng xuất). Không cần đóng.

14. **Token chết đúng giữa lúc bình luận được chấp nhận và `onAccepted` chạy thì
    có thể còn một nháp của chữ đã đăng.** Quyết định có chủ đích, không mất dữ
    liệu. `useComposerSubmit` gọi `onAccepted` ngay sau khi gửi được chấp nhận
    (`packages/views/editor/use-composer-submit.ts`), và `clearDraft` trong
    `packages/views/tasks/detail/components/comment-composer.tsx` bị chốt ở mục
    13 từ chối. Chỉ còn nháp khi debounce đã kịp lưu chữ đó trước lúc gửi; gửi
    trong 1,5 giây sau phím cuối thì lần ghi đang chờ bị huỷ và không còn gì. Lần
    mở composer sau hiện lại chữ đã đăng làm nháp. Thêm chốt riêng ở đó sẽ trùng
    chốt đã tập trung. Không cần đóng.

15. **Phím, tìm trong trang, lưu trữ và luồng đăng xuất chỉ được kiểm trên
    jsdom, trừ ⌘J.** Khoảng trống kiểm chứng. Chỉ có bằng chứng jsdom cho:
    - mọi đường phím của D1: bộ điều phối toàn cục, ⌘F, điều hướng luồng, phím
      gửi, ghi phím trong Settings;
    - hình học và tô sáng của tìm trong trang: jsdom không dàn trang và không có
      CSS Custom Highlight API, nên test thay `getClientRects` bằng stub và chỉ
      chạy nhánh không tô; luật `::highlight(task-find)` và
      `::highlight(task-find-active)` trong `packages/ui/styles/base.css` chỉ
      được kiểm là có mặt, chưa từng được render;
    - lưu trữ của store nháp, store gần đây và store nhớ gấp mở, cùng các luồng
      đăng xuất và phiên hết hạn;
    - sửa khung hình trễ của sidebar (1a0cfc2).

    Riêng ⌘J mở hộp Hỏi UNI, gửi câu hỏi
    và nhận câu trả lời có nguồn đã được kiểm trên Chromium thật, với
    `AI_PROVIDER=fake`, bằng một bản chẩn đoán tạm của `e2e/ask-uni.spec.ts` bỏ
    phần tạo task. Bản chẩn đoán không được commit. Chính spec đó đang đỏ trước
    khi tới ⌘J, vì hai lý do có từ trước D1:
    - `getByLabel("Tiêu đề")` khớp cả ô tiêu đề của hộp "Việc mới" lẫn vùng
      `aria-label` tiêu đề của trang chi tiết (886184c).
    - Workspace mới đã có sẵn task chào mừng "Bắt đầu với UniWork"
      (`server/internal/service/templates/welcome_task.go`), nên người thứ hai
      nhận câu trả lời trích task đó của chính mình thay vì "Chưa đủ dữ liệu".
      Không có dữ liệu nào lọt sang tổ chức khác.

    Để đóng: sửa hai kỳ vọng của spec, rồi thêm kịch bản e2e cho C, ⌘F có tô
    sáng, phím gửi, và đăng xuất rồi đăng nhập người khác trên cùng trình duyệt.

16. **Trang chi tiết task và route Settings vượt ngân sách bundle, D1 làm tăng
    thêm.** Khoảng trống, có từ trước D1. Đo bằng
    `node scripts/bundle-budget.mjs --print` trên bản build production, so với
    bản build ở gốc D1 (f26e621):

    | Route | Gốc D1 | Sau D1 | Trần |
    | --- | --- | --- | --- |
    | Initial JS | 261.0 KB | 262.6 KB | 250 KB |
    | Trang chi tiết task | 171.5 KB | 173.4 KB | 150 KB (§6) |
    | Settings | 182.4 KB | 184.6 KB | 154 KB (`scripts/bundle-budget.json`) |

    Mọi route trong workspace tăng đều 1,9–2,2 KB gzip, dấu hiệu của chunk shell
    dùng chung (bộ điều phối phím, store phím tắt, nhóm gần đây của palette). Mọi
    route vượt trần hôm nay đều đã vượt từ trước D1, và không trần nào bị nâng.
    Để đóng: tách phần shell chỉ cần khi tương tác (tab Phím tắt, palette) ra
    khỏi chunk ban đầu, rồi hạ trần theo số mới.

17. **Lỗi gặp khi chạy cổng D1.** Hai dòng đầu có từ trước lát và còn mở; hai
    dòng sau đã sửa trong lát.
    - Ba test Go so ngày "hôm qua" theo giờ máy với "hôm nay" theo UTC, nên đỏ
      tất định khi chạy local từ 00:00 đến 07:00 giờ +07:
      `TestUsageWindowSurvivesADatabaseClockAhead`,
      `TestSearchScoringOverdueAndMembers`, `TestAskCitesOnlyPermittedSources`
      (`server/internal/service/askuni_test.go`). Cùng khuôn với chúng là
      `TestAIEndpoints` (`server/internal/handler/ai_test.go`), trong khi service
      tính hôm nay bằng `s.now().UTC()`
      (`server/internal/service/askuni_sources.go`). Với `TZ=UTC` cả bốn xanh.
      CI chạy ở UTC nên không gặp.
    - Cũng vì những test đó dừng sớm, sàn coverage Go đọc dưới 59% khi chạy
      ban đêm. `scripts/test-go.sh` thoát trước bước đọc sàn mỗi khi có test Go
      đỏ, nên máy local chưa từng báo điều này.
    - Đã sửa: flake "Group _r_2_ not found" (§7quater mục 11) từng rơi vào test
      D1 "does not submit on primary+Enter in the description editor" của
      `packages/views/tasks/detail/task-detail-suite-page.test.tsx` và làm lần
      chạy coverage `views` thoát 1. Gốc không nằm ở test đó mà ở frame trễ của
      sidebar do một test trước bấm mở (1a0cfc2). Test mô tả cũng không còn để
      treo timer autosave 1,5 giây: nó tự unmount rồi khẳng định không có lần
      ghi nào (b5e1d32).
    - Đã sửa: flake do chính D1 viết ở
      `packages/views/tasks/detail/find/task-find-bar.test.tsx`, test "bình luận
      lưu dạng NFD khớp truy vấn gõ dạng NFC", đỏ thoáng qua khi máy tải nặng
      với `range.getClientRects is not a function`. Vitest 4 chạy `afterEach`
      ngược thứ tự đăng ký, nên hook của file gỡ stub hình học `Range` trước khi
      cleanup của RTL unmount trang, và effect cuộn tới kết quả đang chọn còn
      chờ chạy lúc unmount. Test gõ ba ký tự cùng file kết thúc theo cùng cách.
      Hook nay gọi `cleanup()` trước (ee943a3).

    Để đóng: các test Go tính ngày bằng UTC.

18. **⌘K và ⌘J mở được trên dialog modal và từ trong editor.** Quyết định có
    chủ đích, trước đây chưa ghi. `openSearch` và `ai.askUni` khai báo
    `allowInEditable: true` (`packages/core/shortcuts/definitions.ts`), và bộ
    điều phối (`packages/views/layout/global-shortcuts.tsx`) chỉ kiểm đích soạn
    thảo và lớp popup cho action không có cờ đó. Vì vậy hai phím chạy cả khi
    focus ở ô nhập, trong editor hay trong một dialog modal đang mở: palette tìm
    kiếm và hộp Hỏi UNI mở ra trong khi dialog vẫn mở. ⌘J chỉ bị bỏ qua khi
    workspace không bật AI. Không cần đóng.

19. **Store nhớ gấp mở của trang chi tiết không được dọn khi đăng xuất hay đổi
    người dùng.** Quyết định có chủ đích, hoãn để không nới phạm vi PR.
    `packages/core/tasks/stores/task-detail-ui-store.ts` persist
    `uniwork_task_detail_ui` nhưng không đăng ký với `registerDraftCleanup`
    (`packages/core/drafts/cleanup-registry.ts`), nên người đăng nhập sau trên
    cùng trình duyệt thấy lại luồng đã giải quyết đang mở và sub-task đang gấp
    mà người trước để lại, nếu mở cùng task. Store chỉ giữ ULID của task và của
    bình luận gốc, không có nội dung. Để đóng: ghi id người sở hữu cạnh dữ liệu
    như store nháp và store gần đây, rồi đăng ký với sổ dọn kèm `isOwnedBy`;
    khoảng 10 dòng.

20. **Hai test phím chạy trên bản sao listener thật, và ⌘Enter của composer
    không có test với editor thật.** Khoảng trống kiểm chứng. Nếu mã thật đổi
    điều kiện, các test dưới đây vẫn xanh:
    - Test "trang chat giữ ⌘F" trong
      `packages/views/tasks/detail/find/task-find-bar.test.tsx` chép điều kiện
      listener của `packages/views/chat/chat-page-content.tsx` vào một component
      thử thay vì mount trang chat.
    - Test "stops the recorded key reaching window listeners that ignore
      defaultPrevented" trong
      `packages/views/settings/components/keyboard-shortcuts-tab.test.tsx` dùng
      một listener trên `window` giống primitive sidebar, không phải chính
      primitive.
    - ⌘Enter của composer bình luận chỉ được chứng minh qua
      `packages/views/editor/extensions/submit-shortcut.test.ts` (hàm quyết định
      chord có gửi không) và `packages/views/editor/use-composer-submit.test.tsx`
      (gọi `submit()` trực tiếp), vì
      `packages/views/tasks/detail/components/comment-composer.test.tsx` mock
      editor.

    Để đóng: test mount trang chat và primitive sidebar thật, và một test
    composer với editor thật nhấn ⌘Enter.

21. **Khi thanh tìm đang mở, mọi thay đổi DOM trong trang làm tìm đi lại cả
    trang, không debounce.** Khoảng trống hiệu năng, chưa đo.
    `MutationObserver` trong `packages/views/tasks/detail/find/use-task-find.ts`
    lên lịch một lượt đi với độ trễ 0 cho mỗi thay đổi trong container. Thay đổi
    cùng tick gộp thành một lượt, nhưng mỗi tick có thay đổi (editor render lại,
    bình luận mới tới, nội dung rich hiện xong) là một lượt `TreeWalker` qua mọi
    text node của trang và dựng lại mọi `Range`. Debounce 150 ms chỉ áp cho lúc
    gõ truy vấn. Để đóng: đo trên task nhiều bình luận; nếu tốn, thêm debounce
    cho nhánh mutation.

22. **Dư lượng của chốt phiên hết hạn: tab thứ hai có thể ghi dữ liệu của người
    trước trở lại storage.** Khoảng trống nhỏ. `isOwnedBy` của store nháp và
    store gần đây chỉ đọc state trong bộ nhớ của tab đang chạy
    (`packages/core/tasks/stores/comment-draft-store.ts`,
    `packages/core/tasks/stores/recent-tasks-store.ts`). Khi B đăng nhập ở một
    tab, sổ dọn xoá dữ liệu của A khỏi bộ nhớ và storage của tab đó. Một tab
    khác còn phiên A vẫn giữ dữ liệu A trong bộ nhớ, và lần ghi kế tiếp của tab
    đó (`persist` ghi cả state) đưa dữ liệu A trở lại storage. Tab của B không
    đọc lại storage nên không hiện; lần tải lại kế tiếp của tab B bỏ dữ liệu đó,
    vì chủ ghi trong storage là A. Để đóng: nghe sự kiện `storage`, hoặc so chủ
    với người đăng nhập mỗi lần hydrate.

## 8. Việc làm tiếp theo

1. User duyệt file spec này.
2. Chuyển câu hỏi giấy phép ở §7 lên người có thẩm quyền. Không chặn lát A–D.
3. `writing-plans` cho lát A; các lát sau viết plan khi lát trước merge.
4. Tạo issue ô và 5 sub-issue dưới F-05.
