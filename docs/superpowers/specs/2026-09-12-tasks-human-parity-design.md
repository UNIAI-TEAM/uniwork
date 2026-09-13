# UniWork — Task human-parity với USF (spec ô)

> **Trạng thái:** in-progress — lát A shipped (plan `../plans/2026-09-12-tasks-human-parity-slice-a.md`); lát B shipped (plan `../plans/2026-09-13-tasks-human-parity-slice-b.md`); lát C shipped (plan `../plans/2026-09-13-tasks-human-parity-slice-c.md`)

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
menu chuột phải cho list và board. Các điểm dưới đây còn đúng ở mã khi lát C
merge. Mỗi điểm nói rõ đó là quyết định có chủ đích hay khoảng trống cho lát
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
    chạm picker hay menu hàng. Để đóng: kịch bản E2E mà §6 đã hẹn.

11. **Flake "Group _r_2_ not found"** ở
    `packages/views/layout/animated-right-sidebar.tsx` thỉnh thoảng làm lần chạy
    coverage đầy đủ của `views` thoát 1 dù mọi test xanh. Có từ trước lát C,
    không do lát C gây ra; ghi lại để lần chạy cổng sau không nhận nhầm. Cùng
    loại với nó, cổng lát C gặp thêm ba lỗi thoáng qua có từ trước, không lỗi
    nào tái hiện khi chạy riêng:
    `projects/project-detail-page.test.tsx` và
    `editor/extensions/markdown-paste.test.ts` đỏ khi turbo chạy song song ba
    package (lát B đã gặp y hệt); riêng `markdown-paste` còn hết giờ 30s dưới
    v8 coverage vì dán đồng bộ một chuỗi hơn 50.000 ký tự, chưa đổi từ
    `219130a`. Ở Go, `TestTaskCRUD` (`server/internal/service/task_test.go:186`,
    "missing event task.created") là flake song song: helper `drain` gọi
    `Dispatcher.Process` trên cả database dùng chung, nên dispatcher của package
    test khác chạy cùng lúc có thể nhận mất dòng outbox của test này. Lát C
    không chạm `server/`. Để đóng: cô lập outbox theo test, không nới timeout.

## 8. Việc làm tiếp theo

1. User duyệt file spec này.
2. Chuyển câu hỏi giấy phép ở §7 lên người có thẩm quyền. Không chặn lát A–D.
3. `writing-plans` cho lát A; các lát sau viết plan khi lát trước merge.
4. Tạo issue ô và 5 sub-issue dưới F-05.
