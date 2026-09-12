# UniWork — Task human-parity với USF (spec ô)

> **Trạng thái:** in-progress — spec ô, 5 lát; plan từng lát tạo khi `writing-plans`

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

## 8. Việc làm tiếp theo

1. User duyệt file spec này.
2. Chuyển câu hỏi giấy phép ở §7 lên người có thẩm quyền. Không chặn lát A–D.
3. `writing-plans` cho lát A; các lát sau viết plan khi lát trước merge.
4. Tạo issue ô và 5 sub-issue dưới F-05.
