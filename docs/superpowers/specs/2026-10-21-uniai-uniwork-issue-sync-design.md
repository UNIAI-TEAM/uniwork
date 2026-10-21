# Đồng bộ issue UniAI sang task UniWork

> **Trạng thái:** in-progress — thiết kế đã chốt 2026-10-21, chưa triển khai.

**Ngày:** 2026-10-21

Dự án UniWork trên UniAI (workspace `uni2026`, project `57602a20-04e8-4c08-abd5-415ccd882e05`) có 1.212 issue, mã `UNI-415` đến `UNI-2008`. Công ty chuyển việc sang UniWork. Trong thời gian chuyển, UniAI vẫn là nơi sửa. Một chương trình chép issue sang task UniWork và đẩy tiếp mọi thay đổi.

## 1. Mục tiêu

1. Cả 1.212 issue, kể cả `done` và `cancelled`, có task tương ứng trên một dự án UniWork, giữ cây cha–con.
2. Tiêu đề task chứa mã UniAI. Task UniWork nhận mã `PREFIX-N` của workspace, không giữ số cũ.
3. Sau lần nạp, lịch autopilot đẩy tiếp tiêu đề, mô tả, trạng thái, mức ưu tiên, ngày, người giao, nhãn, comment mới, và issue mới.
4. Server UniAI không bị sửa. Autopilot chỉ chạy một lệnh.

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
| --- | --- |
| Mã | `UNI-nnn` nằm trong tiêu đề. Số task UniWork là số mới |
| Phạm vi lần đầu | Cả 1.212 issue của dự án, giữ cha–con |
| Nội dung | Tiêu đề, mô tả, trạng thái, mức ưu tiên, ngày, cha, nhãn, comment, người giao |
| Người giao | Map theo email, với ba cặp lệch ở §4 |
| Không map được | Để trống assignee, thêm một comment nêu tên bên UniAI |
| Comment | Một tài khoản đăng hết. Dòng nhìn thấy đầu tiên là tác giả gốc |
| Chiều đồng bộ | UniAI sang UniWork. Sửa chỉ trên UniWork giữ nguyên đến khi issue UniAI đổi. Lần UniAI đổi thì các field trong hash được ghi lại theo UniAI |
| Nhịp | Autopilot chế độ chỉ chạy, cron `*/15 * * * *`, `Asia/Ho_Chi_Minh` |
| Ai làm việc chép | Chương trình cố định. Agent không chọn field |
| Nhớ mã task | Hai property trên issue UniAI |

## 3. Kiến trúc

Chương trình nằm ở `scripts/uniai-sync/`. Autopilot trên workspace `uni2026` ở chế độ chỉ chạy, không tạo issue. Runbook là một lệnh, chạy từ gốc repo trên máy có runtime:

```text
node scripts/uniai-sync/sync.mjs
```

Agent không đọc issue và không gọi tool. Chương trình làm bốn việc:

1. Đọc issue, comment và cây cha–con bằng `uniai`.
2. Đọc email thành viên, tạo nhãn còn thiếu, đọc comment đã có, và tìm task theo tiêu đề bằng API thường của UniWork. MCP `list_members` không trả email. `list_tasks` không tìm theo tiêu đề và không quá 50 dòng. `get_task` chỉ trả 50 comment mới nhất.
3. Tạo task, sửa task và thêm comment bằng MCP: `create_task`, `update_task`, `add_comment`.
4. Ghi property trên issue UniAI.

MCP và API thường không nhận chung một token. Máy chạy giữ hai biến môi trường, không đưa vào git:

| Biến | Việc |
| --- | --- |
| `UNIWORK_MCP_TOKEN` | Bearer token MCP, có quyền ghi |
| `UNIWORK_SESSION_TOKEN` | Bearer phiên, chỉ để đọc thành viên, nhãn, comment và tìm task |

`scripts/uniai-sync/config.example.json` ghi các giá trị không bí mật: origin API, `workspace_id`, `project_id` của UniWork đích. File chạy là `scripts/uniai-sync/config.json`, được `.gitignore` bỏ qua. Đích không gắn cứng vào project UniAI.

`uniai` trên máy đó đã đăng nhập workspace `uni2026`.

Mỗi issue xong thì ghi property ngay. Lượt bị ngắt thì vòng sau tiếp phần chưa có hash. Lần đầu đi nhiều vòng lịch vì chương trình giữ dưới 100 lần gọi MCP mỗi phút. Cùng lệnh chạy tay khi cần đẩy ngay.

Chương trình không viết comment lên issue UniAI. Kết quả in ra stdout cho lượt autopilot: số tạo, số sửa, số bỏ qua, và từng issue lỗi.

## 4. Quy tắc từng field

Mỗi issue thành một task trong `project_id` đã cấu hình.

**Tiêu đề.** `UNI-423: {tiêu đề gốc}`. Tiêu đề gốc đã bắt đầu bằng đúng mã đó thì giữ nguyên. Trần MCP là 500 ký tự. Dài hơn thì giữ mã và cắt phần tiêu đề gốc.

**Mô tả.** Chép Markdown. Trần `create_task` và `update_task` là 16.000 ký tự Unicode. Phần dư sang một comment, đánh dấu `<!-- uniai-description-overflow -->`, rồi tới phần chữ còn lại. Comment này viết một lần. Mô tả gốc đổi sau đó không viết lại comment này.

**Trạng thái.** Chép đúng khóa `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`. Khóa khác thì issue đó lỗi, không bị gán sang khóa gần nghĩa.

**Mức ưu tiên.** Chép `none`, `low`, `medium`, `high`, `urgent`.

**Ngày.** `start_date` và `due_date` dạng `YYYY-MM-DD`. Không có thì để trống. `update_task` xóa ngày bằng `null`.

**Cha–con.** Cha tạo trước. `parent_task_id` của con là id task của cha. Cha chưa có id thì con chờ vòng sau. Cha không thuộc dự án UniWork trên UniAI thì con được báo lỗi mỗi vòng và không được tạo. Chương trình không tự tạo cha ở dự án khác.

**Người giao.** Email UniAI được đổi theo bảng sau, rồi so khớp không phân biệt hoa thường với email thành viên UniWork:

| Email UniAI | Email UniWork |
| --- | --- |
| `tranthihien.attt@gmail.com` | `hien.tran.vietants@gmail.com` |
| `12345mmmin@gmail.com` | `longthldz@gmail.com` |
| `bavinh2803@gmail.com` | `vinhnba2803.work@gmail.com` |

Khớp thì gán `assignee_id`. Không khớp, gồm issue giao cho agent, thì để trống người nhận và thêm một comment. Dòng ẩn giữ id assignee UniAI. Dòng nhìn thấy là:

```text
UniWork giao issue này cho {tên}.
```

Người thì thêm email đã qua bảng lệch, trong ngoặc, cùng dòng. Agent thì chỉ tên agent. Không có tên thì dùng id bên UniAI. Marker:

```text
<!-- uniai-assignee:{id} -->
```

Comment này ở lại khi sau này gán được người, vì chương trình không xóa comment. Đổi sang người map được thì `update_task` đổi assignee. Đổi sang một assignee khác vẫn không map được thì thêm một comment mới cho id mới. Comment của id cũ ở lại.

**Nhãn.** Khớp theo đúng tên (`uw-backend`, `phase-C`, `Uniwork Bug`, và mọi tên khác trên issue). Thiếu thì `POST /api/v1/workspaces/{workspaceID}/task-labels` một lần, `name` giữ nguyên, `color` là `#6b7280`, `description` rỗng. Hai nhãn UniWork trùng một tên thì issue đó lỗi, không chọn hộ. Gắn lúc tạo bằng `label_ids`. Lần sửa thì thêm và gỡ bằng `add_label_ids` và `remove_label_ids`.

**Comment.** Đăng theo thời gian, comment cha trước reply. `reply_to` chỉ đặt khi comment cha đã có id bên UniWork. Cha chưa sang thì reply chờ đến khi cha có id trong cùng vòng hoặc vòng sau.

Dòng nhìn thấy đầu tiên là tác giả. Phía trên là marker id comment UniAI:

```text
<!-- uniai-comment:{id} -->
{Tên} ({email đã qua bảng lệch})

{nội dung}
```

Agent thì ngoặc là `agent`, không có email. Trần MCP là 20.000 ký tự. Dài hơn thì giữ marker và dòng tác giả, cắt nội dung.

**Không mang.** Vị trí trên board, stage, `duplicate_of`, property khác ngoài hai property đồng bộ, người theo dõi, liên kết PR, file đính kèm. Sửa hoặc xóa comment đã sang không được đẩy, vì chương trình không gọi API sửa hoặc xóa comment. Issue xóa bên UniAI không xóa task UniWork.

Lần nạp gán người và đặt trạng thái qua MCP, nên người được giao nhận thông báo của những lần tạo và những lần đổi assignee hoặc trạng thái.

## 5. Nhớ mã và chỉ đẩy phần lệch

Không dùng `updated_at` làm mốc. Ghi property cũng đổi `updated_at` khi giá trị đổi.

Một người tạo hai property kiểu text trên workspace `uni2026` trước lần chạy đầu. Chương trình không tự tạo property. Thiếu property thì dừng trước khi tạo task.

| Property | Giá trị |
| --- | --- |
| `UniWork task` | Id task UniWork |
| `UniWork sync` | SHA-256 hex của JSON chuẩn |

JSON chuẩn là một object, khóa đúng thứ tự bảng dưới, mảng đã xếp, UTF-8, không space sau `:` và `,`:

| Khóa | Giá trị |
| --- | --- |
| `title` | Tiêu đề gốc UniAI |
| `description` | Mô tả đầy đủ bên UniAI, chuỗi rỗng nếu không có |
| `status` | Khóa trạng thái |
| `priority` | Khóa mức ưu tiên |
| `start_date` | `YYYY-MM-DD` hoặc `""` |
| `due_date` | `YYYY-MM-DD` hoặc `""` |
| `assignee_id` | Id assignee UniAI, hoặc `""` |
| `labels` | Tên nhãn, xếp chữ |
| `parent_issue_id` | Id cha UniAI, hoặc `""` |
| `comment_ids` | Id comment UniAI, xếp chữ |

Hash trùng thì bỏ qua issue đó, kể cả khi ai đó vừa sửa task trên UniWork. Chưa có `UniWork task` thì tạo, cha trước con. Hash khác thì `get_task` lấy `revision` rồi `update_task` những field khác UniAI: tiêu đề đã gắn mã, 16.000 ký tự đầu của mô tả, trạng thái, mức ưu tiên, ngày, assignee, cha, nhãn. `description_truncated` thì ghi lại 16.000 ký tự đầu. `revision_conflict` thì `get_task` lại một lần và `update_task` một lần nữa. Vẫn lệch thì issue đó dừng ở vòng này, không ghi hash mới.

Comment đã sang được nhận bằng marker trong nội dung, đọc từ `GET /api/v1/tasks/{taskID}/comments` (cũ nhất trước). `get_task` không dùng để quyết định comment nào đã có. Id đã có marker thì không đăng lại. Cùng lúc đọc đó, chương trình nhớ id comment UniWork của từng marker để đặt `reply_to`. Comment vừa đăng trong vòng này lấy id từ kết quả `add_comment`.

Thứ tự một issue mới:

1. `create_task`.
2. Ghi `UniWork task` ngay.
3. Đăng comment còn thiếu, gồm comment giao việc và phần mô tả dư.
4. Khi issue đã khớp, ghi `UniWork sync`.

Đứt sau bước 1 và trước bước 2: vòng sau tìm bằng `POST /api/v1/workspaces/{workspaceID}/tasks/query`, search đúng tiền tố tiêu đề `UNI-423:`. Đúng một task thì ghi id vào property và đi tiếp từ bước 3. Không có task thì tạo. Hai task trở lên thì dừng issue đó, không tạo thêm, không gắn.

Hash chỉ ghi khi các field và comment đã khớp. Lỗi giữa chừng thì hash cũ còn, vòng sau đẩy phần thiếu.

## 6. Khi lỗi

Một issue lỗi không dừng vòng. Hết vòng, còn issue lỗi thì tiến trình trả mã khác 0. Vòng sau làm lại issue chưa có hash mới.

Dừng cả vòng, và không ghi hash, khi gặp một trong các việc sau:

- MCP hoặc phiên trả 401.
- `workspace_id` hoặc `project_id` sai, hoặc dự án không tồn tại.
- Chưa có property `UniWork task` hoặc `UniWork sync`.

Gọi MCP giữ dưới 100 lần mỗi phút. Bị giới hạn thì chờ rồi thử lại đúng lời gọi đó.

Vòng cha: những issue trong vòng được báo và không tạo task.

## 7. Kiểm tra

`node --test scripts/uniai-sync/sync.test.mjs` thử chương trình với JSON giả và hai máy giả (MCP, API thường). Không gọi UniAI hay UniWork thật. `scripts/check.sh` gọi file này cùng các contract test khác.

Ca phải giữ:

- Tiêu đề thành `UNI-423: …`, không nhân đôi mã, cắt ở 500 ký tự và vẫn còn mã.
- Ba cặp email ra đúng người. Agent và email lạ để trống assignee và có đúng một comment giao việc. Chạy lại không thêm comment đó.
- Cha tạo trước. Con chờ khi cha chưa có id.
- Hash trùng thì không gọi `update_task` dù `updated_at` mới hơn. Hash khác thì sửa. Comment mới được đăng. Marker đã có thì không đăng lại. Sửa nội dung comment cũ không tạo comment mới.
- Mô tả dài hơn 16.000 ký tự tách một comment phần dư, lần sau không tách thêm.
- Sau `create_task` thì ghi property trước comment. Mất property mà tìm thấy đúng một task theo tiêu đề thì gắn lại. Hai task trùng tiền tố thì dừng issue đó.
- `revision_conflict` thử lại một lần rồi để vòng sau. Issue khác trong vòng vẫn chạy. 401 dừng cả vòng và không ghi hash.
- Vòng cha được báo và không tạo task.

Lần chạy thật đầu, trước khi bật lịch: một issue `done` ít comment, một issue có cha, một issue giao cho agent, rồi cả dự án. Autopilot và thông báo cho người được giao không nằm trong bộ thử tự động.

## 8. Một người làm một lần

Trước lần chạy đầu, một người:

1. Tạo trên UniWork workspace đích một dự án nhận các task, ghi `workspace_id` và `project_id` vào cấu hình.
2. Tạo grant MCP có quyền ghi cho tài khoản sẽ đứng tên comment, đưa token vào `UNIWORK_MCP_TOKEN`.
3. Tạo phiên của cùng tài khoản đó cho `UNIWORK_SESSION_TOKEN`.
4. Trên UniAI, tạo hai property text `UniWork task` và `UniWork sync`.
5. Tạo autopilot chế độ chỉ chạy, lịch `*/15 * * * *`, múi giờ `Asia/Ho_Chi_Minh`, runbook là lệnh ở §3. Bật lịch sau lần chạy tay đã xem báo cáo.

## 9. Cố ý không làm

- Sửa server UniAI để chạy agent ngay khi issue đổi.
- Giữ số `UNI-nnn` làm mã task UniWork.
- Để agent tự chọn field hoặc tự gọi MCP.
- Xóa task UniWork khi issue UniAI bị xóa.
- Sửa hoặc xóa comment đã đăng.
- Viết lại comment phần mô tả dư khi mô tả gốc đổi.
- Mang vị trí board, stage, `duplicate_of`, người theo dõi, liên kết PR, file đính kèm.
