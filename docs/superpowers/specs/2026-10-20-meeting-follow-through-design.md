# Meetings: Sau cuộc họp — từ nội dung đến công việc

> **Trạng thái:** in-progress — spec đã duyệt ngày 2026-10-20 (chủ sản phẩm trả lời §14 cùng ngày); bản sửa cùng ngày theo spec thư ký AI (đợt 5a cũ thay bằng thư ký AI, 5a + 5b gộp thành đợt 5) đã duyệt cùng spec đó; đợt 1 (UNI-1996) triển khai trên nhánh `feature/UNI-1996-meetings-sau-hop-dot-1-bao-nguoi-duoc-gi`.

**Issue:** UNI-1995 (cha); đợt 1 UNI-1996, đợt 2 UNI-1997, đợt 3 UNI-1998, đợt 4
UNI-1999, đợt 5 UNI-2001 (UNI-2000 bị thay bằng các issue của spec thư ký AI), đợt 6
UNI-2002, đợt 7 UNI-2003, đợt 8 UNI-2004.

**Ghi lời trực tiếp và AI trong phòng họp:** spec
`2026-10-20-meeting-scribe-agent-design.md` (thư ký AI, LiveKit Agents). Spec này chỉ còn
ghi lời file tải lên cho họp trực tiếp không có máy nào trong phòng.

## 1. Mục tiêu

Một cuộc họp chỉ có giá trị khi những gì đã chốt trong đó được làm. Spec này dựng
đủ phần **sau cuộc họp**, dùng chung cho mọi cuộc họp — giao ban, họp dự án, họp
khách hàng, standup, họp trực tiếp tại hội trường hay họp online:

1. **Ghi lời:** cuộc họp nào cũng có lời nói thành văn bản, kể cả họp trực tiếp không
   mở phòng.
2. **Việc:** mọi việc được nhắc tới thành việc đề xuất; người điều hành rà đến hết
   (giao, sửa rồi giao, bỏ qua, thêm tay); không việc nào mất khi tạo lại tóm tắt.
3. **Giao và báo:** việc được giao thành task, người nhận biết ngay và biết việc đến từ
   cuộc họp nào.
4. **Theo dõi:** cuộc họp hiện tiến độ việc của nó; cuộc họp sau thấy việc còn tồn từ
   cuộc họp trước.
5. **Căn cứ:** mỗi kết luận và mỗi việc AI đưa ra trỏ được về đúng đoạn đã nói.
6. **Biên bản:** một tài liệu sửa được, số liệu lấy từ dữ liệu thật, chốt được, xuất
   được DOCX/PDF.

Thành công là: người được giao nhận thông báo ngay khi việc được tạo; danh sách "chờ
xử lý" của một cuộc họp về 0 là xong phần rà soát; tạo lại tóm tắt không làm mất việc
đã giao hay đã bỏ qua; cuộc họp tiếp theo của cùng dự án mở đầu bằng việc còn tồn.

### 1.1 Hiện trạng

Đọc trên checkout ngày 2026-10-20.

- **Tóm tắt.** `Summarize` (`service/meeting_ai.go`): chủ trì hoặc owner/admin
  workspace (`requireHostOrAdmin`), quyền gói `meeting.ai_summary`, cuộc họp
  `IN_PROGRESS` hoặc `ENDED`, cần ít nhất một nguồn (transcript, ghi chú, chat, biểu
  quyết đã đóng). Prompt `meeting_summary@3` (`internal/ai/prompts.go`) đã có luật
  không đoán người phụ trách, không đoán hạn, bọc nội dung người gõ trong
  `<untrusted>`. Mỗi lần chạy thêm một dòng `meeting_summaries`; bản mới nhất thắng.
- **Việc đề xuất.** Là mảng JSON `action_items` (`{title, owner, due}`) trong
  `meeting_summaries`, **không có id**, chỉ có số thứ tự. Liên kết việc → task nằm ở
  `meeting_summary_task_links(summary_id, item_index, task_id)`.
- **Giao việc.** `CreateTasksFromSummary` (`service/meeting_summary_tasks.go`): chủ
  trì/admin chọn tối đa 50 việc, xác nhận người, hạn, dự án, độ ưu tiên; server gợi ý
  người (`meeting_task_resolve.go`: tên tiếng Việt, danh xưng, trùng tên thì không gợi
  ý) và đổi hạn nói thành ngày (`meeting_due_parse.go`) nhưng không tự điền (ADR 0010);
  chặn trùng với task đang mở cùng dự án; mặc định vào dự án của cuộc họp; một
  transaction, audit `meeting_summary.tasks_created`, sự kiện `summary.tasks_linked`.
  Task mang `origin_type='meeting'`, `origin_id=<meeting_id>`.

Những chỗ thiếu, đánh số để các phần sau trỏ tới:

| # | Thiếu | Bằng chứng |
|---|---|---|
| G1 | Task tạo sẵn người phụ trách **không báo cho người đó**, ở mọi đường tạo task (cuộc họp, MCP, chat, email hub, API). | `notification/rules.go`: bảng `rules` không có `task.created`; `createTaskInTx` (`service/task.go`) chỉ phát `task.created`, không bao giờ `task.updated`; `KindTaskAssigned` chỉ phát từ `ruleTaskUpdated`. Không test nào phủ trường hợp này. |
| G2 | Task không cho biết nó đến từ cuộc họp nào. | `origin_type`/`origin_id` (migration 107) chỉ được Work Graph đọc; không có trong SDO task, type TS hay UI. |
| G3 | Không bỏ qua được một việc đề xuất, không thêm việc tay; thư ký không được tóm tắt hay giao việc. | Hai hàm tóm tắt dùng `requireHostOrAdmin`; vai thư ký đã có cho điểm danh/biểu quyết qua `requireMeetingClerk` (`service/meeting_duties.go`). |
| G4 | Tạo lại tóm tắt làm bản mới không biết việc nào đã giao. | Liên kết theo `(summary_id, item_index)`; `describeSummary` chỉ đọc liên kết của đúng bản đang xem; còn mỗi lớp chặn trùng tiêu đề đỡ. |
| G5 | Không có chỗ theo dõi việc sau họp; cuộc họp sau không thấy việc tồn. | Liên kết chỉ hiện trong khối tóm tắt; không truy vấn task theo nguồn. |
| G6 | Ghi lời yếu. | Web Speech chỉ nghe micro máy mình, không tách người nói; STT agent mới là khung (`deploy/meeting-stt-agent/agent.py`); bản ghi (RoomCompositeEgress MP4) không được chuyển thành lời; không tải được file ghi âm; segment không có mốc ms, không khoá chống trùng; `Gateway.CloudTranscribe` chỉ trả văn bản, tối đa 25 MiB, giữ trong bộ nhớ, timeout 3 phút. |
| G7 | Họp trực tiếp không mở phòng thì không bao giờ rời `SCHEDULED`, nên không tóm tắt, không điểm danh, không tải ghi âm được. | `AutoEndOverdue` chỉ xét `IN_PROGRESS`; `End` từ `SCHEDULED` là trạng thái sai. |
| G8 | Tóm tắt không có căn cứ; không kiểm được AI lấy ý từ đâu. | Schema `{summary, decisions[], action_items[]}` không có tham chiếu. |
| G9 | Không có biên bản sửa được; không xuất được. | Tóm tắt chỉ tạo lại, không sửa; tài liệu không gắn được với cuộc họp; trang UniNote không xuất được DOCX/PDF (`office/contract.go`: `ExportTargets` chỉ có `docx → pdf`). |

### 1.2 Tham khảo: smart-commune-hub

Đã khảo sát repo `phanducquanguet/smart-commune-hub` (app Supabase cho UBND xã). Phần
họp của họ là: ghi âm → BytePlus ASR → biên bản JSON do Gemini viết → trích việc chờ
duyệt → task.

**Lấy:** việc đề xuất là dòng riêng có trạng thái chờ/duyệt/loại, duyệt-loại hàng loạt,
thêm tay (`meeting_tasks`); khi trích lại thì giữ kết quả cũ, chỉ bổ sung; mỗi việc có
căn cứ trích từ văn bản gốc (ta làm chặt hơn: căn cứ là id đoạn transcript, server kiểm
được); chuyển lời file dài theo hai pha gửi/hỏi, có trạng thái và báo xong; khoá chống
trùng segment.

**Không lấy:** prompt do client tự dựng rồi gửi function không kiểm quyền; biên bản lưu
thành chuỗi trong một cột, tự lưu nuốt lỗi; duyệt việc không cùng transaction (tạo task
rồi mới đổi trạng thái); để AI đoán thành phần và "đủ số lượng"; function tắt xác thực.

### 1.3 Quyết định đã chốt

Ngày 2026-10-20, chủ sản phẩm đã chốt D1, D2 trong trao đổi, và D3, D12, D14, D15 khi
trả lời §14. Các dòng còn lại là đề xuất của spec, duyệt cùng spec.

| # | Quyết định |
|---|---|
| D1 | **Một luồng cho mọi cuộc họp.** Spec này không thêm "loại họp". Tóm tắt và biên bản khác nhau theo **dữ liệu cuộc họp có**: điểm danh đã chốt thì có phần thành phần, có biểu quyết đã đóng thì có phần biểu quyết, không có thì bỏ phần đó. Loại họp (họp nhà nước, họp đặc thù) bổ sung sau qua điểm mở rộng ở §10. |
| D2 | AI chỉ đề xuất; người chốt người phụ trách, hạn, dự án (ADR 0010). Không đổi. |
| D3 | **Người điều hành sau họp là clerk:** chủ trì, thư ký, owner/admin workspace (`requireMeetingClerk`). Áp cho tóm tắt, việc, ghi lời, biên bản. Vòng đời cuộc họp (bắt đầu, kết thúc, ghi nhận đã họp) vẫn chỉ chủ trì/admin. |
| D4 | **Việc đề xuất thành bảng riêng `meeting_action_items`** có id ổn định, sống theo cuộc họp chứ không theo bản tóm tắt. `meeting_summaries` vẫn append-only và giữ nguyên văn AI trả về. |
| D5 | Trạng thái một việc: **Chờ xử lý / Đã giao / Đã bỏ qua**, suy ra từ cột (`task_id` trỏ tới task còn sống, `dismissed_at`), không lưu cột trạng thái. Task bị xoá thì việc về Chờ xử lý (giữ hành vi hiện nay). |
| D6 | **Tạo lại tóm tắt:** việc AI đang chờ của bản cũ được thay bằng việc của bản mới; việc đã giao, đã bỏ qua, việc thêm tay và việc `LIVE` do thư ký AI rút trong lúc họp giữ nguyên. AI được cho biết các việc đã có để không đề xuất lại; server lọc trùng tiêu đề lần cuối. |
| D7 | **Thông báo:** task tạo sẵn người phụ trách báo cho người đó, ở mọi đường tạo (cuộc họp, MCP, chat, email hub, API). Một lần tạo (một request) giao nhiều task cho cùng một người thì người đó nhận **một** thông báo ("X đã giao bạn 3 việc"), không phải một thông báo mỗi task. |
| D8 | **Việc còn tồn:** cuộc họp có dự án thấy các việc chưa xong từ những cuộc họp đã kết thúc trước nó cùng dự án. Cuộc họp không có dự án thì không hiện (chưa có chuỗi họp). |
| D9 | **Ghi lời có hai đường.** Họp có phòng (online, hoặc một máy đặt trong hội trường): thư ký AI ghi trực tiếp (spec thư ký AI). Họp trực tiếp không có máy nào trong phòng: clerk tải file ghi âm lên, ghi lời theo lô, chạy nền ngoài outbox vì là việc dài, qua `ai.Gateway`, tính phí theo ADR 0029. Không ghi lời file bản ghi MP4. |
| D10 | **Họp trực tiếp:** chủ trì/admin "Ghi nhận đã họp" để chuyển `SCHEDULED → ENDED` mà không mở phòng. |
| D11 | **Căn cứ:** mỗi kết luận và việc AI đưa ra mang tham chiếu tới đoạn transcript, ghi chú hoặc tin nhắn có trong đầu vào; tham chiếu không có trong đầu vào bị server loại. |
| D12 | **Biên bản là một trang UniNote** do cuộc họp tham chiếu (`meetings.minutes_document_id`). Phần số liệu dựng từ bảng, phần diễn giải lấy từ tóm tắt. **"Chốt" = tạo một phiên bản tài liệu và ghi id của nó** (`minutes_finalized_version_id`): trang vẫn nằm trong cây và tìm kiếm, vẫn sửa được để đính chính, cuộc họp chỉ rõ bản đã chốt và báo khi trang đã sửa sau đó. Không dùng "cất trang" (shelve): nó ẩn trang khỏi cây và tìm kiếm, chặn bình luận. Khoá cứng và chữ ký là việc của loại họp (§10). Xem Q1 (§14) vì liên quan ADR 0016. |
| D13 | **Xuất DOCX/PDF làm cho mọi trang UniNote** (office-engine); biên bản là nơi dùng đầu tiên. |
| D14 | **Nhà cung cấp ghi lời file dài là AssemblyAI** (API ghi lời file ghi sẵn, model Universal-3.5 Pro, hai pha gửi/hỏi), cùng nhà cung cấp với ghi lời trực tiếp (spec thư ký AI D13): **một nhà cung cấp STT duy nhất**, không dự phòng. Thay BytePlus ngày 2026-10-21. Chi tiết ở §7.4; điều kiện pháp lý trước khi bật cho khách ở §7.5. |
| D15 | **Ghi lời sau họp mở bằng quyền gói mới `meeting.transcription`**, tách khỏi `meeting.ai_summary`: chi phí theo phút âm thanh, khác hẳn tóm tắt tính theo token. |

## 2. Ngoài phạm vi

- Loại cuộc họp; mẫu biên bản theo loại (ví dụ thể thức Nghị định 30/2020/NĐ-CP);
  chữ ký; duyệt nhiều cấp. Làm ở spec sau, dùng điểm mở rộng §10.
- Chuỗi cuộc họp / họp lặp lại.
- Nhắc hạn task (sắp đến hạn, quá hạn). Hiện không có cho bất kỳ task nào; là việc
  chung của module task, cần spec riêng.
- Hoàn thiện STT agent trực tiếp (spec `2026-09-08-meeting-stt-agents-evaluation.md`).
  Spec này chỉ đổi hợp đồng segment (§5.4) mà agent phải dùng khi được làm.
- Tóm tắt chia khúc rồi gộp cho cuộc họp vượt ngân sách đầu vào (§7.8): spec này nâng
  ngân sách và đánh dấu tóm tắt "chưa đủ" khi vẫn vượt; chia khúc làm sau nếu số liệu
  dùng thật cho thấy cần.
- Sửa nội dung transcript; dịch transcript; chương trình họp (agenda).
- Gửi email tóm tắt cho người tham dự; đồng bộ lịch; app mobile; tool MCP cho việc sau
  họp.

**Thất bại dù chạy đúng kỹ thuật** (anti-goals): AI tự giao việc hoặc tự điền người,
hạn; số liệu trong biên bản (ai có mặt, đủ số lượng, kết quả biểu quyết) do AI đoán; tạo
lại tóm tắt làm mất việc đã xử lý; giao 10 việc cho một người thành 10 thông báo đẩy.

## 3. Luồng nghiệp vụ

```
Họp xong (hoặc "Ghi nhận đã họp" cho họp trực tiếp)
  │
  ├─ Ghi lời: thư ký AI ngay trong phòng, hoặc file tải lên ──► transcript có mốc giờ, người nói
  │
  ▼
1. Tóm tắt: AI viết tóm tắt, kết luận, việc đề xuất (kèm căn cứ)
  │
  ▼
2. Rà soát (clerk): Giao · Sửa rồi giao · Bỏ qua · Thêm tay   — đến khi "chờ" = 0
  │
  ▼
3. Giao: tạo task (một transaction), mỗi người nhận một thông báo
  │
  ▼
4. Theo dõi: mục "Việc sau họp" hiện tiến độ, quá hạn; task hiện "Từ cuộc họp …"
  │
  ├─► 5. Cuộc họp sau cùng dự án mở đầu bằng "Việc còn tồn"
  │
  └─► 6. Biên bản: lập → sửa → chốt → xuất DOCX/PDF
```

Vòng đời một việc đề xuất:

```
                  tạo lại tóm tắt (chỉ việc AI đang chờ)
              ┌──────────────── bị thay ◄──────────────┐
              │                                        │
 AI đề xuất ──┴─► CHỜ XỬ LÝ ───────── giao ──────► ĐÃ GIAO
 Thêm tay ──────►    │   ▲                             │
                  bỏ qua  khôi phục              task bị xoá
                     ▼   │                             │
                  ĐÃ BỎ QUA          CHỜ XỬ LÝ ◄───────┘
```

- Việc thêm tay không bao giờ bị thay khi tạo lại tóm tắt.
- Việc đã bỏ qua không quay lại qua tạo lại tóm tắt (lọc theo tiêu đề, §7.1).
- Giao một việc đang không ở Chờ xử lý → 409, không tạo task.

## 4. Quyền

| Hành động | Ai |
|---|---|
| Xem việc sau họp, việc còn tồn, transcript, trạng thái ghi lời | thành viên workspace (`authorize`) |
| Tạo tóm tắt | clerk (trước đây chủ trì/admin) |
| Thêm, bỏ qua, khôi phục, giao việc | clerk |
| Yêu cầu ghi lời, gán người nói | clerk |
| Ghi nhận đã họp | chủ trì/admin (như `Start`/`End`) |
| Lập biên bản | clerk |
| Chốt / bỏ chốt biên bản | clerk **và** quyền `edit` trên trang biên bản (không mở cửa quyền thứ hai vào tài liệu) |
| Sửa biên bản | theo quyền tài liệu như mọi trang; lúc lập, chủ trì và các thư ký được chia sẻ `edit` (§6.6) |
| Xuất trang ra DOCX/PDF | quyền đọc trang trở lên, như xuất PDF hiện có |

Client: `useMeetingPermissions` (`packages/core/permissions/use-resource-permissions.ts`)
trả thêm `canClerk` từ `canClerkMeeting` đã có trong `rules.ts`. Khách không thấy phần
sau họp (họ không là thành viên workspace).

## 5. Mô hình dữ liệu

Theo luật migration của repo: không FK, id ULID `TEXT`, mỗi index một file
`CREATE [UNIQUE] INDEX CONCURRENTLY`, bảng mới có `organization_id TEXT NOT NULL`, có
`created_by` thì có `created_by_kind`, tên file `999<unix-ms>_<name>.{up,down}.sql`,
query nào chạm bảng tenant cũng ràng buộc tenant hoặc mang dòng `-- tenant:`.

### 5.1 `meeting_action_items` (đợt 3)

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | TEXT PK | |
| `organization_id`, `workspace_id` | TEXT NOT NULL | lấy từ cuộc họp |
| `meeting_id` | TEXT NOT NULL | |
| `source` | TEXT NOT NULL, CHECK `AI`/`MANUAL` | |
| `summary_id` | TEXT NULL | bản tóm tắt đề xuất; NULL với `MANUAL` |
| `position` | INT NOT NULL | thứ tự hiển thị: việc AI theo thứ tự trả về, việc tay nối sau |
| `title` | TEXT NOT NULL | cùng giới hạn độ dài với tiêu đề task |
| `owner_text`, `due_text` | TEXT NOT NULL DEFAULT `''` | nguyên văn AI nói (người, hạn); gợi ý người và ngày vẫn tính khi đọc như hiện nay |
| `task_id` | TEXT NULL | task đã tạo |
| `converted_at`, `converted_by` | NULL | |
| `dismissed_at`, `dismissed_by` | NULL | |
| `dismiss_reason` | TEXT NOT NULL DEFAULT `''` | không bắt buộc, tối đa 500 ký tự |
| `created_by`, `created_by_kind` | TEXT NOT NULL | việc AI: `meeting_summary` / `system`; việc tay: người gõ / `human` |
| `created_at`, `updated_at` | TIMESTAMPTZ NOT NULL | |

Đợt 6 thêm cột `evidence TEXT NOT NULL DEFAULT '[]'` (§7.2).

Index (mỗi cái một file): `(meeting_id, position)`; `(task_id) WHERE task_id IS NOT
NULL` (tra ngược task → việc, việc còn tồn). Query ở
`server/pkg/db/queries/meeting_action_items.sql`.

**Trạng thái suy ra** (một hàm Go dùng chung cho đọc và ghi):
`DISMISSED` khi `dismissed_at IS NOT NULL`; ngược lại `CONVERTED` khi `task_id` trỏ tới
task còn sống; còn lại `PENDING`.

**Chuyển dữ liệu cũ** (migration của đợt 3, SQL thuần, dùng
`jsonb_array_elements(action_items::jsonb) WITH ORDINALITY`):

"Liên kết sống" dưới đây là liên kết có task còn tồn tại (join `tasks`; task bị xoá
cứng), đúng như `ListLiveMeetingSummaryTaskLinks` đang làm.

1. Với mỗi cuộc họp, bản tóm tắt mới nhất L: mỗi phần tử của `L.action_items` thành
   một việc `AI` (`summary_id = L.id`, `position` = thứ tự − 1, `created_at =
   L.created_at`); `task_id` lấy từ **liên kết sống cũ nhất** của đúng `(L.id,
   item_index)` nếu có. (Một việc từng được giao lại sau khi task đầu bị xoá thì liên
   kết cũ nhất trỏ vào task đã xoá; lấy nó là mất task thật.)
2. Mỗi **liên kết sống** thuộc một bản tóm tắt **không phải** bản mới nhất: thêm một
   việc từ phần tử tương ứng của bản đó, có `task_id`. Liên kết tới task đã xoá bị bỏ
   qua. Như vậy không việc nào đã giao bị mất và không việc chờ cũ nào sống lại.

Từ đợt 3 không còn code ghi `meeting_summary_task_links`. Migration của đợt 4 **chép bù**
trước khi xoá bảng: chạy lại bước 1–2 cho những liên kết sống chưa có việc nào mang
`task_id` đó (idempotent). Lý do: trong lúc triển khai đợt 3, server cũ có thể còn chạy
sau khi migration đã chép, và còn ghi liên kết mới. Chép bù làm việc này đúng dù có
khoảng chồng đó hay không. Xoá bảng ở đợt 4 cũng giữ migration down của đợt 3 an toàn.

### 5.2 `meetings` — cột mới (đợt 7)

| Cột | Ghi chú |
|---|---|
| `minutes_document_id TEXT NULL` | trang biên bản; trang bị xoá hoặc vào thùng rác thì coi như chưa có (cùng cách xử lý dự án mặc định đã bị xoá trong `CreateTasksFromSummary`) |
| `minutes_finalized_at TIMESTAMPTZ NULL`, `minutes_finalized_by TEXT NULL` | |
| `minutes_finalized_version_id TEXT NULL` | phiên bản tài liệu (`document_versions`) được chốt |

"Ghi nhận đã họp" (đợt 5) không cần cột mới: dùng giờ bắt đầu và kết thúc thực tế đã
có.

### 5.3 `meeting_transcriptions` (đợt 5)

Một lần ghi lời **một file tải lên**. Họp trực tiếp có thể tải lên nhiều phần; mỗi file
một dòng, ghép theo thời gian ở §7.3.

| Cột | Ghi chú |
|---|---|
| `id`, `organization_id`, `workspace_id`, `meeting_id` | |
| `file_id` | file âm thanh/video tải lên được chuyển lời |
| `starts_at TIMESTAMPTZ NOT NULL` | giờ thật ứng với giây 0 của file: giờ bắt đầu thực tế của cuộc họp cộng thời lượng các phần tải trước (các phần nối tiếp nhau) |
| `language` | `vi` / `en` (mặc định theo ngôn ngữ của người yêu cầu) |
| `status` | `QUEUED` / `RUNNING` / `COMPLETE` / `FAILED` |
| `provider`, `model`, `provider_job_id` | |
| `attempts INT`, `lease_until`, `next_attempt_at` | để worker nhận việc và thử lại |
| `error_code TEXT NOT NULL DEFAULT ''` | |
| `audio_seconds`, `usage_event_id` | tính phí |
| `created_by`, `created_by_kind`, `created_at`, `started_at`, `completed_at` | |

Index: `(meeting_id, created_at)`; **unique** `(file_id) WHERE status IN
('QUEUED','RUNNING')`: mỗi file chỉ một lần ghi lời đang chạy.

Segment của lần ghi lời đặt `spoken_at = starts_at + start_ms`, nên mọi nguồn xếp theo
cùng một trục thời gian.

### 5.4 `meeting_transcript_segments` — cột mới (đợt S1 của spec thư ký AI)

Gán nhãn người nói (cả của thư ký AI lẫn file tải lên) nằm ở bảng `meeting_speaker_labels`
của spec thư ký AI §6.3.

| Cột | Ghi chú |
|---|---|
| `source TEXT NOT NULL DEFAULT 'CAPTION'` | `CAPTION` (Web Speech) / `AGENT` (STT agent) / `TRANSCRIPTION` (ghi lời sau họp) |
| `transcription_id TEXT NULL` | với `TRANSCRIPTION` |
| `start_ms INT NULL`, `end_ms INT NULL` | mốc trong file với `TRANSCRIPTION`; với `AGENT` tính từ giờ bắt đầu thực tế |
| `speaker_label TEXT NOT NULL DEFAULT ''` | nhãn tách người nói của nhà cung cấp khi không biết là ai |
| `client_segment_id TEXT NULL` | khoá chống trùng do bên gửi đặt |

Index **unique** `(meeting_id, client_segment_id) WHERE client_segment_id IS NOT NULL`.
Route agent (`POST /meetings/{meetingID}/transcript/agent`) nhận thêm `segment_id`,
`start_ms`, `end_ms`; gửi lại cùng `segment_id` là không làm gì (hiện mỗi lần gửi lại
thêm một dòng trùng).

### 5.5 File âm thanh tải lên (đợt 5)

Thêm purpose `meeting_audio` vào `files/registry.go`: `audio/mpeg`, `audio/mp4`,
`audio/x-m4a`, `audio/wav`, `audio/ogg`, `audio/webm`, `video/mp4`; tối đa 2 GiB. Tải
lên dùng phiên tải chia mảnh có sẵn (BIGUP, `service/document_upload_sessions.go`,
hợp đồng ở `2026-10-17-bigup-upload-sessions-contract.md`). Nếu phiên đó chỉ gắn với
Documents, tách phần lõi để purpose này dùng chung — **không** viết đường tải thứ hai.

## 6. API

Đăng ký qua wrapper `api` với `apiOp{sdi, sdo}`; DTO ở `handler/dto/sdi|sdo/meeting.go`;
param mới `{actionItemID}`, `{transcriptionID}` cần case trong
`handler/router/openapi.go`. Checklist: `docs/api-sdi-sdo.md`. Mọi lỗi theo dạng
`CodedError` hiện có.

### 6.1 Việc sau họp (đợt 3, 4)

| Method + path | Quyền | Ghi chú |
|---|---|---|
| `GET /meetings/{meetingID}/action-items` | thành viên | §6.2 |
| `POST /meetings/{meetingID}/action-items` `{title, owner_text?, due_text?}` | clerk | Việc tay. Cuộc họp `IN_PROGRESS`/`ENDED`, không thì 409 `invalid_meeting_state`. |
| `POST /meetings/{meetingID}/action-items/{actionItemID}/dismiss` `{reason?}` | clerk | Chỉ từ Chờ xử lý, không thì 409 `action_item_not_pending`. |
| `POST /meetings/{meetingID}/action-items/{actionItemID}/restore` | clerk | Chỉ từ Đã bỏ qua, không thì 409 `action_item_not_dismissed`. |
| `POST /meetings/{meetingID}/action-items/convert` | clerk | §6.3. Thay `POST /meetings/{meetingID}/summary/tasks`. |
| `GET /meetings/{meetingID}/carried-over-items` | thành viên | Đợt 4, §6.5. |

`GET /meetings/{meetingID}/summary` thôi trả việc đề xuất và liên kết task; chỉ còn tóm
tắt và kết luận. `POST /summary/tasks` bị xoá cùng đợt 3. Nếu web và server không triển
khai cùng lúc, giữ route cũ đến hết bản phát hành sau rồi xoá (builder chọn theo cách
triển khai thực tế).

### 6.2 `GET action-items` — dạng trả về

```json
{
  "items": [{
    "id": "…", "source": "AI", "position": 0,
    "title": "…", "owner_text": "anh Hùng", "due_text": "thứ sáu tuần sau",
    "suggested_assignee_id": "… | null", "suggested_due_date": "2026-10-30 | null",
    "status": "PENDING | CONVERTED | DISMISSED",
    "dismiss_reason": "", "dismissed_by": null, "dismissed_at": null,
    "task": { "id": "…", "title": "…", "status": "…", "done": false, "overdue": true,
              "assignee_id": "…", "due_date": "2026-10-30" } ,
    "evidence": [],
    "summary_id": "… | null", "created_at": "…"
  }],
  "counts": { "pending": 3, "converted": 5, "dismissed": 1, "tasks_done": 2, "tasks_overdue": 1 }
}
```

- `suggested_*` chỉ có với việc Chờ xử lý; tính như `describeSummary` hiện nay.
- `task` chỉ có với Đã giao. `done`/`overdue` dùng đúng định nghĩa "xong" của module task
  (builder tìm và dùng lại, không tự định nghĩa).
- `evidence` rỗng cho tới đợt 6.

### 6.3 `POST action-items/convert`

Body: `{items: [{action_item_id, title?, description?, assignee_id?, due_date?,
project_id?, priority?}]}`, 1–50 phần tử, không trùng `action_item_id`. Ngữ nghĩa từng
trường giữ nguyên như `MeetingSummaryTaskItem` hiện nay: `title` rỗng thì dùng tiêu đề
việc; `project_id` vắng thì lấy dự án của cuộc họp nếu dự án còn tồn tại, `""` là không
dự án; server không bao giờ đọc lại `owner_text`/`due_text` vào người hay hạn.

Bổ sung 2026-10-22: mỗi phần tử nhận thêm các trường còn lại của ô soạn task (`status`,
`assignee_kind`, `start_date`, `parent_task_id`, `stage`, `label_ids`, `attachment_ids`,
`properties`), cùng nghĩa và cùng kiểm tra như `POST /tasks` (`createTaskInTx`); chặn
trùng tiêu đề tính theo dự án và task cha như guard của task.

Trong một transaction (`CreateManyWith`):

1. `LockMeetingSummaryChanges(meeting)` — xếp hàng với việc lưu bản tóm tắt mới.
2. Khoá các việc được chọn (`FOR UPDATE`). Việc không thuộc cuộc họp → 404. Việc không ở
   Chờ xử lý → 409 `action_item_not_pending`, `fields.action_item_ids` liệt kê đủ.
3. Kiểm người và dự án (như hiện nay), rồi chặn trùng tiêu đề (`refuseSummaryDuplicates`
   đổi tên, trả `fields.action_item_ids`).
4. Tạo task (`origin_type='meeting'`, `origin_id`), ghi `task_id`, `converted_at`,
   `converted_by` vào từng việc.
5. Audit `meeting.action_items_converted` (metadata `action_item_ids`, `task_ids`); sự
   kiện `action_item.converted`; dòng thời gian `TASKS_CREATED_FROM_SUMMARY` (giữ tên
   cũ để các dòng cũ vẫn hiện đúng nhãn).

Trả về `{links: [{action_item_id, task_id}]}`.

### 6.4 Ghi lời file tải lên (đợt 5)

| Method + path | Quyền | Ghi chú |
|---|---|---|
| `POST /meetings/{meetingID}/held` `{started_at, ended_at}` | chủ trì/admin | Chỉ từ `SCHEDULED`, không thì 409 `invalid_meeting_state`. `ended_at > started_at`, `ended_at` không ở tương lai. Không tạo phiên hội nghị. Ghi giờ thực tế, chuyển `ENDED`, phát `meeting.ended` (kéo theo nhắc tóm tắt hiện có). |
| `POST /meetings/{meetingID}/transcriptions` `{upload_id, language}` | clerk | Cuộc họp `ENDED`. Phiên tải purpose `meeting_audio` đã xong, được nhận vào cuộc họp tại đây, kèm xác nhận đã báo người dự họp về việc ghi âm (§7.5). File đó đang có lần chạy → 409 `transcription_in_progress`. Kiểm quyền gói `meeting.transcription` (D15, hằng mới cạnh `meeting.ai_summary` trong `service/entitlement.go`) và **ước chi phí trước** (§7.4): hạn mức còn lại không đủ → 402 như các lệnh AI khác. |
| `GET /meetings/{meetingID}/transcriptions` | thành viên | Danh sách lần ghi lời, mới nhất trước: trạng thái, file, thời lượng, lỗi. |

Gán người nói cho nhãn của file tải lên dùng route `speaker-labels` của spec thư ký AI
§7.2, với `label_key` dạng `upload:<transcription_id>:<nhãn>`.

Route đọc transcript hiện có trả thêm `start_ms`, `end_ms`, `source`, tên người nói đã
gán, và đọc đúng nguồn theo §7.3.

### 6.5 Việc còn tồn (đợt 4)

`GET carried-over-items` trả `{items: [{action_item_id, meeting: {id, title,
started_at}, task: {…như §6.2}}]}`. Điều kiện: cuộc họp hiện tại có dự án; lấy việc Đã
giao từ các cuộc họp `ENDED` khác cùng tổ chức, workspace, dự án, bắt đầu trước cuộc họp
hiện tại (giờ thực tế nếu có, không thì theo lịch), task chưa xong. Sắp theo hạn (không
hạn xếp cuối), tối đa 100. Cuộc họp không có dự án → `items: []`.

### 6.6 Biên bản (đợt 7) và xuất (đợt 8)

| Method + path | Quyền | Ghi chú |
|---|---|---|
| `POST /meetings/{meetingID}/minutes` `{locale?}` | clerk | Cuộc họp `ENDED`. Đã có biên bản còn sống → 409 `minutes_exist`. Tạo trang qua `CreatePage(Human(clerk), …)` với nội dung `MarkdownToPage(renderMinutes(…))` (§7.6), rồi chia sẻ `edit` cho chủ trì và các thư ký hiện tại (người lập có `manage` như mọi trang; cả workspace có `view`); ghi `minutes_document_id`. Tất cả trong một transaction. |
| `POST /meetings/{meetingID}/minutes/finalize` | clerk + `edit` trên trang | Tạo một phiên bản tài liệu (`CreateDocumentVersion`, reason `manual`) và ghi `minutes_finalized_*` cùng `minutes_finalized_version_id` **trong cùng transaction** (thêm biến thể `…InTx` ở document service nếu chưa có, theo mẫu `CreateOwnedDocumentInTx`). Thiếu `edit` → 403 `minutes_edit_required`. Chốt lại khi đã chốt → tạo phiên bản mới và thay id (đính chính). |
| `POST /meetings/{meetingID}/minutes/reopen` | như trên | Xoá `minutes_finalized_*`; phiên bản đã tạo vẫn ở lịch sử tài liệu. |
| `POST /documents/{documentID}/export` `{format: "docx" \| "pdf"}` | quyền đọc trang | Đợt 8. Chỉ `kind=page`. Ghi nhật ký truy cập `export` như `ExportFramePDF`. Dạng trả về (tải thẳng hay job rồi tải) theo đúng mẫu xuất PDF hiện có. |

## 7. AI và ghi lời

### 7.1 Prompt `meeting_summary@4` (đợt 3)

- Đầu vào thêm khối việc đã có của cuộc họp (đã giao, đã bỏ qua, việc tay), chỉ tiêu đề,
  trong `<untrusted source="existing_action_items">` vì có việc do người gõ.
- Luật thêm: không đề xuất lại việc đã có trong khối này, kể cả khi diễn đạt khác.
- Schema đầu ra giữ nguyên. `@3` giữ lại cho tới khi không còn tham chiếu.
- Lưu bản tóm tắt (`storeSummary`, trong khoá `LockMeetingSummaryChanges` đã có):
  1. Xoá việc `AI` đang Chờ xử lý của cuộc họp (kể cả việc có `task_id` trỏ tới task đã
     xoá).
  2. Thêm việc của bản mới, **bỏ** những việc có `normalizeTaskTitle` trùng với một việc
     còn lại của cuộc họp.
  3. Metadata audit `meeting.summary_created` thêm `replaced_pending`, `kept`,
     `skipped_duplicates`.

### 7.2 Prompt `meeting_summary@5` — căn cứ (đợt 6)

- Mỗi dòng đầu vào mang một nhãn ngắn do server đặt: `[S12]` đoạn transcript, `[N3]`
  ghi chú, `[C5]` tin nhắn chat. Nhãn là số thứ tự trong lần gọi, không phải ULID (đỡ
  token, model không phải chép id dài); server giữ bảng nhãn → id.
- Đầu ra: `decisions` thành `[{text, evidence: ["S12", …]}]`; mỗi `action_items[]` thêm
  `evidence`. Luật: chỉ dẫn nhãn có trong đầu vào; không có căn cứ thì để mảng rỗng.
- Server **loại mọi nhãn không có trong bảng nhãn** của lần gọi đó, rồi lưu dạng
  `[{kind: "segment"|"note"|"chat", id}]` vào `meeting_action_items.evidence` và vào
  kết luận của bản tóm tắt. Một việc không còn căn cứ hợp lệ vẫn được giữ (việc có thể
  đến từ ý tổng hợp), chỉ không có chip căn cứ.
- Bản tóm tắt cũ có `decisions` dạng chuỗi: bên đọc chấp nhận cả hai dạng (schema
  khoan dung, ADR 0003).

Bổ sung 2026-10-22 (prompt `meeting_summary@6`, `meeting_live_items@2`): mỗi việc AI có
thêm `description` — một đến ba câu văn xuôi AI viết lại việc cần làm, lý do và kết quả
mong đợi, chỉ từ nội dung cuộc họp — và `priority` gợi ý (`low`/`medium`/`high`/`urgent`)
chỉ khi cuộc họp nói rõ mức gấp; không có thì để rỗng. Server cắt mô tả ở 1000 ký tự, bỏ
mức độ ngoài bốn giá trị đó, lưu vào hai cột mới `description`, `suggested_priority`
(`TEXT NOT NULL DEFAULT ''`; việc tay luôn rỗng) và trả cùng tên trong §6.2. Ô soạn task
điền sẵn mô tả (kèm các dòng căn cứ client tự lấy) và mức độ từ đó. `@5`, `live_items@1`
vẫn đăng ký cho các dòng usage cũ.

### 7.3 Chọn nguồn transcript

Tóm tắt, biên bản và màn transcript dùng cùng một quy tắc:

1. Lấy hợp của segment `AGENT` (thư ký AI) và segment `TRANSCRIPTION` (với mỗi file tải
   lên, lấy **lần `COMPLETE` mới nhất của file đó**), xếp theo `spoken_at`.
2. Không có cả hai → segment `CAPTION` (Web Speech) như hiện nay.

Tên người nói ưu tiên: tên đã gán ở `meeting_speaker_labels` → tên người tham gia → nhãn
của nhà cung cấp ("Người nói 1"). Luật hiện có của prompt vẫn đúng: không bao giờ dùng nhãn kỹ
thuật làm người phụ trách.

### 7.4 Ghi lời file tải lên qua `ai.Gateway` (đợt 5)

- **Nhà cung cấp:** chỉ `server/internal/ai/provider` nói chuyện với nhà cung cấp. Thêm
  interface cho file dài, không đụng `CloudTranscribe` đang phục vụ tin nhắn thoại:
  `Submit(ctx, audioURL, language, diarize) → jobID` và `Poll(ctx, jobID) → {done,
  segments [{start_ms, end_ms, speaker_label, text}], seconds, model, language}`. Nhà
  cung cấp tải file qua URL ký sẵn (đọc, hạn 6 giờ); server không giữ file trong bộ nhớ.
- **AssemblyAI (D14).** Bản cài đặt duy nhất của interface trên, trong
  `internal/ai/provider` (API ghi lời file ghi sẵn của AssemblyAI).
  - `POST {base}/v2/transcript`, header `authorization: <key>`. Body đúng bốn trường:
    `audio_url`, `speech_models: ["universal-3-5-pro","universal-2"]` (Universal-2 thay
    khi 3.5 Pro không làm được), `language_codes: ["vi","en"]` (tự chuyển Việt–Anh như
    thư ký AI; Universal-2 nhận tối đa hai mã, một mã là `en`), `speaker_labels: true`.
    Trả `id` của nhà cung cấp, là `provider_job_id`. Model đã dùng (`speech_model_used`)
    ghi vào cột `model`, nên thấy được khi rơi về Universal-2.
  - Gửi bị từ chối 400/401/403/422: lỗi vĩnh viễn, việc `FAILED` ngay sau một lần thử,
    ghi log mức error (id và mã HTTP). 429: chờ `Retry-After` (tối đa 10 phút), không
    tính lần thử. 5xx và lỗi mạng: thử lại như cũ (3 lần, có giãn cách).
  - `GET {base}/v2/transcript/{id}`: `status` `queued`/`processing` đang xử lý,
    `completed` xong. `error`: nhà cung cấp không tải được file thì thử lại (URL được ký
    lại), lỗi khác là vĩnh viễn (`FAILED` ngay). HTTP 400/404 (nhà cung cấp không biết
    việc) thì thử lại bằng việc mới; 401, 429, 5xx và lỗi mạng thì hỏi lại lượt sau tới
    hạn chót. Việc nằm `QUEUED` quá 24 giờ kể từ lúc yêu cầu (429 mãi, công tắc cờ
    không mở lại) thành `FAILED` (`timeout`) kèm thông báo. Câu báo lỗi của nhà cung cấp chỉ vào log (URL thay bằng `<url>`), không
    lưu vào DB.
  - Kết quả: `utterances[] {speaker ("A", "B", …), start, end (ms), text}` → segment,
    nhãn người nói là chữ cái. Không có `utterances` mà có chữ thì thành một segment
    không nhãn. Thời lượng tính phí lấy từ `audio_duration` (giây), không có thì ước như
    dưới. Xong mà không có chữ nào là im lặng, không tính phí.
  - **Không có khóa chống gửi trùng (idempotency key).** Chặn bằng `provider_job_id`
    lưu ngay sau khi gửi: dòng đã có id thì chỉ hỏi, không gửi lại. Rủi ro còn lại: câu
    trả lời của lần gửi bị mất (hết giờ, mất lease) thì lần thử sau tạo việc thứ hai ở
    nhà cung cấp; nhà cung cấp tính tiền cả hai, khách chỉ bị tính một lần khi xong.
  - Cấu hình (khai báo trong `.env.example`, `scripts/env-example.test.mjs` giữ):
    `AI_MEETING_TRANSCRIBE_PROVIDER=assemblyai` (hoặc `fake`), `ASSEMBLYAI_API_KEY`
    (cùng tên biến agent thư ký AI đọc), `AI_MEETING_TRANSCRIBE_BASE_URL` (rỗng là
    `https://api.assemblyai.com`, Mỹ; `https://api.eu.assemblyai.com` giữ dữ liệu ở EU).
  - Ước trước cho hạn mức: hộp thoại tải lên đọc thời lượng từ metadata của tệp trên
    trình duyệt và gửi `duration_seconds`; server kẹp vào [dung lượng ÷ trần của loại,
    dung lượng ÷ 1,5 kB/s]. Trần: âm thanh 40 kB/s (320 kbit/s), WAV theo tốc độ PCM
    của header (không tin trường byte rate), video 2,5 MB/s (20 Mbit/s, video 1080p của
    điện thoại). Không có thì ước theo dung lượng như cũ. Phút tính phí vẫn
    lấy từ `audio_duration`.
  - Định dạng: AssemblyAI nhận cả âm thanh và video (mp3, m4a, wav, ogg, webm, mp4, …),
    tối đa 5 GB và 10 giờ mỗi file, nên `meeting_audio` nhận thêm `video/mp4`. Hạn 2 GiB
    của ta vẫn giữ. Không chuyển mã trên server.
- **Gateway:** phương thức mới cho capability `meeting_transcribe`. Tính phí khi xong
  theo số giây nhà cung cấp báo, không có thì ước theo dung lượng và MIME (luật ADR 0029,
  `cloud_audio.go`), theo mẫu chốt phí hiện có (`cloud_settle`). Khác `cloudRun` hiện
  nay (chỉ kiểm "chưa vượt" lúc gửi): **lúc nhận yêu cầu, ước chi phí** từ dung lượng
  (`EstimateAudioSeconds`), và
  từ chối nếu hạn mức còn lại không đủ. Một file 3 giờ không được đẩy tổ chức vượt hạn
  mức vài giờ sau.
- **Worker:** chạy trong `MeetingService.RunWorkers` (đã nằm trong chuỗi tắt máy của
  `cmd/server/main.go`), **không** trên outbox: một lần giao việc của outbox tối đa 120
  giây, không đủ cho file một giờ. Nhận việc bằng `FOR UPDATE SKIP LOCKED` + `lease_until`
  (nhiều node không chạy trùng); hỏi kết quả mỗi 15 giây; thời gian tối đa
  `max(2 giờ, 3 × thời lượng)`; thử lại tối đa 3 lần có giãn cách; quá lần thì `FAILED`
  với `error_code`.
- **Khi xong**, trong một transaction: thêm segment (`source='TRANSCRIPTION'`), đặt
  `COMPLETE`, ghi `audio_seconds`, `usage_event_id`, audit
  `meeting.transcription_completed`, sự kiện `transcription.completed`. Lỗi thì audit
  `meeting.transcription_failed` và sự kiện `transcription.failed`.

### 7.5 Dữ liệu cá nhân

Giọng nói là dữ liệu cá nhân (Nghị định 13/2023/NĐ-CP). Tải file lên phải kèm xác nhận
"Tôi đã thông báo cho người dự họp về việc ghi âm" (lưu trong metadata audit của
`meeting.transcription_requested`). Phòng họp đang ghi phải hiện báo hiệu ghi (builder
kiểm cái hiện có).

AssemblyAI xử lý dữ liệu ngoài Việt Nam (Mỹ, hoặc EU qua `api.eu.assemblyai.com`), cho cả
ghi lời trực tiếp lẫn ghi lời file: **một nhà cung cấp, một thỏa thuận xử lý dữ liệu, một
hồ sơ chuyển dữ liệu ra nước ngoài**. **Trước khi bật cờ `meeting_transcription` (và
`meeting_scribe`) cho khách hàng**: ký thỏa thuận xử lý dữ liệu với AssemblyAI, chọn và
xác nhận vùng xử lý và thời gian AssemblyAI giữ file và bản ghi lời, và hoàn tất nghĩa vụ
chuyển dữ liệu cá nhân ra nước ngoài theo quy định hiện hành (hồ sơ đánh giá tác động theo
Nghị định 13/2023/NĐ-CP). Việc này không chặn code; nó chặn việc bật cờ ngoài nội bộ.

Bản ghi lời file tải lên bị xóa ở AssemblyAI (`DELETE /v2/transcript/{id}`) ngay sau khi
server lấy về và lưu xong, và cả việc bị bỏ (quá hạn chót, hoặc lỗi rồi gửi lại bằng việc
mới); xóa hỏng thì ghi log, việc vẫn đi tiếp.

### 7.6 Dựng biên bản (đợt 7)

`renderMinutes(facts, narrative, layout) → Markdown`, hàm thuần, có test snapshot. Spec
này có **một** layout chung. Thứ tự phần và điều kiện hiện:

| Phần | Nguồn | Hiện khi |
|---|---|---|
| Tiêu đề "Biên bản: {tên cuộc họp}" + ngày | cuộc họp | luôn |
| Thời gian (thực tế), chủ trì, thư ký | cuộc họp, người tham gia | luôn (thư ký khi có) |
| Thành phần theo điểm danh + tỉ lệ có mặt | `meeting_attendance_marks` | điểm danh đã chốt |
| Người được mời | người tham gia | điểm danh chưa chốt |
| Nội dung | tóm tắt mới nhất | có tóm tắt (không thì ghi "Chưa có tóm tắt") |
| Kết luận (kèm mốc giờ căn cứ từ đợt 6) | kết luận của tóm tắt | có kết luận |
| Kết quả biểu quyết (phiếu kín không nêu tên) | biểu quyết đã đóng | có biểu quyết đã đóng |
| Việc đã giao: việc, người phụ trách, hạn | `meeting_action_items` Đã giao | có việc đã giao |
| Người lập, ngày lập | clerk | luôn |

Số liệu không đi qua AI. Không có dòng "hình thức (online / trực tiếp)" hay địa điểm:
`meetings` không có cột nào nói điều đó, và suy từ "đã mở phòng" sẽ gọi sai một cuộc họp
hội trường có mở phòng để ghi âm. Người lập tự gõ thêm nếu cần. Tóm tắt bị đánh dấu
"chưa đủ" (§7.8) thì phần Nội dung ghi rõ điều đó.

Ngôn ngữ theo `locale` của yêu cầu, như tóm tắt. Trang đặt ở gốc workspace, cả workspace
xem được (cuộc họp vốn hiện với mọi thành viên), tiêu đề "Biên bản: {tên cuộc họp}
({dd/MM/yyyy})". Biên bản chỉ tạo một lần; sau đó người sửa tay. Muốn dựng lại thì xoá
trang rồi lập lại.

### 7.7 Xuất trang UniNote (đợt 8)

Office-engine (sidecar Node, ADR 0018) thêm thao tác trang → DOCX: đầu vào là
ProseMirror JSON đã qua `document.Sanitize` cùng tiêu đề, đầu ra DOCX. PDF = trang →
DOCX → PDF qua bộ dựng PDF đã có (`apps/office-engine/src/worker/docs-pdf.ts`). Mở rộng
`ExportTargets` trong `office/contract.go`. Bắt buộc: phông có đủ dấu tiếng Việt; tiêu
đề, đoạn, danh sách, bảng, đậm/nghiêng/gạch chân/liên kết; ảnh nếu schema trang có.
Builder chọn thư viện DOCX cho Node.

### 7.8 Cuộc họp dài: ngân sách đầu vào của tóm tắt (đợt S1 của spec thư ký AI)

Hiện `Summarize` đọc tối đa 2.000 đoạn, cắt còn 60.000 ký tự (khoảng 15k token), và
`windowSummaryLines` giữ đầu và cuối, **bỏ phần giữa** (`service/meeting_ai.go`). Một
transcript 1–3 giờ từ thư ký AI hay file tải lên sẽ mất phần giữa, trái mục tiêu "mọi việc được nhắc tới".

- Ngân sách ký tự và số đoạn thành cấu hình, mặc định đủ cho khoảng 4 giờ nói (khoảng
  400.000 ký tự), nhưng không vượt cửa sổ ngữ cảnh của model gateway đang dùng.
  `summaryRunLease` và ngân sách thời gian của lần chạy tăng theo độ dài đầu vào.
- Vẫn vượt → giữ cách cắt hiện tại, và bản tóm tắt ghi `partial = true` (cột mới trên
  `meeting_summaries`, mặc định `false`, đi cùng đợt S1 của spec thư ký AI). UI và biên bản báo "Tóm tắt dựa
  trên một phần cuộc họp".
- Nhãn căn cứ của đợt 6 chỉ đánh trên các dòng thực sự đưa vào prompt.

## 8. Audit, sự kiện, thông báo

### 8.1 Audit

Mọi lệnh ghi audit và outbox cùng transaction với thay đổi; thêm từng action vào
`audit_coverage_test.go` cùng lúc.

| Action | Đợt |
|---|---|
| `meeting.action_item_created` (việc tay) | 3 |
| `meeting.action_item_dismissed` (`changes.reason`) | 3 |
| `meeting.action_item_restored` | 3 |
| `meeting.action_items_converted` — thay `meeting_summary.tasks_created` | 3 |
| `meeting.held_recorded` | 5 |
| `meeting.transcription_requested`, `meeting.transcription_completed`, `meeting.transcription_failed` | 5 |
| `meeting.minutes_created`, `meeting.minutes_finalized` (metadata `version_id`), `meeting.minutes_reopened` | 7 |

Dòng thời gian cuộc họp (`meeting_audit_logs`) thêm `MEETING_RECORDED_HELD`,
`TRANSCRIPTION_COMPLETED`, `MINUTES_FINALIZED`; thêm nhãn ở `core/meetings/status.ts`
và `meeting-activity-display.ts`.

### 8.2 Sự kiện

Payload chỉ id. Sửa đủ ba nơi: `docs/events/CATALOGUE.md`,
`internal/outbox/catalogue.go`, `packages/core/types/events.ts`.

| Topic | Payload | Đợt |
|---|---|---|
| `action_item.created`, `action_item.dismissed`, `action_item.restored` | `meeting_id, action_item_id, workspace_id` | 3 |
| `action_item.converted` (một sự kiện cho một lần giao) | `meeting_id, workspace_id` | 3 |
| ~~`summary.tasks_linked`~~ | xoá | 3 |
| `transcription.requested`, `transcription.completed`, `transcription.failed` | `meeting_id, transcription_id, workspace_id` | 5 |
| `minutes.created`, `minutes.finalized`, `minutes.reopened` | `meeting_id, document_id, workspace_id` | 7 |

"Ghi nhận đã họp" phát `meeting.ended` đã có. Phạm vi workspace cho tất cả.

Client (`core/realtime/use-realtime-sync.ts`): `action_item.*` và `summary.created` →
`meetingKeys.actionItems(id)`; `task.updated`/`task.deleted` → gốc
`meetingKeys.actionItems` và `meetingKeys.carriedOver` (chỉ query đang mở mới tải lại);
`transcription.*` → `meetingKeys.transcriptions(id)` và transcript; `minutes.*` → chi
tiết cuộc họp.

### 8.3 Thông báo

- **Đợt 1 — rule `task.created`** (`notification/rules.go`), cho mọi đường tạo task:
  1. Đọc các dòng audit `task.created` cùng `correlation_id` với sự kiện này (query mới
     dạng danh sách, bên cạnh `GetAuditEventByCorrelation`); đọc các task đó.
  2. Gom theo người phụ trách là người (`human`), khác người tạo, còn là thành viên.
  3. Mỗi nhóm chỉ **task có id nhỏ nhất** phát thông báo; sự kiện của các task khác
     trong nhóm không làm gì. Mọi sự kiện tính ra cùng một nhóm và cùng một "task đầu",
     nên kết quả không phụ thuộc thứ tự xử lý, và idempotency theo event id vẫn giữ.
  4. Nhóm một task → `KindTaskAssigned`, group key `task:<id>:assigned` (trùng key với
     lúc đổi người, nên không nhân đôi). Nhóm nhiều task → kind mới `tasks_assigned`,
     params `{actor, count}`, group key `tasks:<correlation_id>:assigned` (mỗi lần tạo
     một key, nên hai lần giao không bị gộp và `count` luôn đúng). Vi: "{{actor}} đã
     giao bạn {{count}} việc". Bấm vào: task đều từ một cuộc họp thì mở mục "Việc sau
     họp" của cuộc họp đó; còn lại mở task đầu.
  5. Sự kiện không có `correlation_id` (việc nền) → coi mỗi task là một nhóm.

  Lần giao từ cuộc họp (`CreateManyWith`) và lô task của email hub (`CreateMany`) đều là
  một request, nên mỗi người nhận một thông báo cho mỗi lần.
- **Đợt 5:** `meeting_transcript_ready` và `meeting_transcript_failed` gửi người yêu
  cầu (actor là hệ thống, không loại trừ).
- Mặc định (`prefs.go`): trong app và email bật như mọi kind; đẩy bật cho
  `tasks_assigned` (như `task_assigned`), tắt cho hai kind ghi lời. Thêm tiêu đề vi/en
  (`titles.go`), thêm vào danh sách kind phía client.

## 9. Web

### 9.1 Core (`packages/core`)

- Endpoint + schema khoan dung + test phản hồi sai định dạng cho mọi route mới:
  `api/endpoints/meeting-action-items.ts`, `meeting-transcriptions.ts`,
  `meeting-minutes.ts`, thêm xuất vào endpoint tài liệu.
- Hook và key: `meetingKeys.actionItems(id)`, `carriedOver(id)`, `transcriptions(id)`.
  Giao việc là mutation chờ server (tạo thì không lạc quan, theo luật State Rules); bỏ
  qua/khôi phục cũng chờ server cho đơn giản.
- Type task thêm `origin_type`, `origin_id` (khoan dung).
- `useMeetingPermissions` thêm `canClerk`.

### 9.2 Trang chi tiết cuộc họp (`packages/views/meetings/meeting-detail-view.tsx`)

Trang là các mục xếp chồng, không có tab. Thêm, theo thứ tự sau `MeetingSummaryPanel`:

1. **Việc sau họp** (`MeetingActionItemsSection`, đợt 3). Hiện khi cuộc họp
   `IN_PROGRESS`/`ENDED` hoặc đã có việc.
   - Đầu mục: chip đếm "Chờ xử lý n · Đã giao n · Đã bỏ qua n"; dòng tiến độ "Đã xong
     x/y · z quá hạn".
   - Nhóm **Chờ xử lý**: mỗi dòng có ô chọn, tiêu đề sửa được, người (gợi ý sẵn), hạn,
     dự án, độ ưu tiên, nút Bỏ qua (popover lý do không bắt buộc); thanh hành động "Giao
     n việc" và "+ Thêm việc". Dùng lại phần sửa từng dòng của `SummaryActionItems`.
   - Nhóm **Đã giao**: tiêu đề (mở task), người, hạn, trạng thái, quá hạn tô cảnh báo,
     chip căn cứ (đợt 6).
   - Nhóm **Đã bỏ qua**: thu gọn mặc định, hiện lý do, nút Khôi phục.
   - Không phải clerk: chỉ đọc.
2. **Việc còn tồn từ các cuộc họp trước** (đợt 4). Hiện cho cuộc họp `SCHEDULED`/
   `IN_PROGRESS` có dự án và có việc; gom theo cuộc họp gốc.
3. **Transcript** (đợt S1 của spec thư ký AI; nút tải file ở đợt 5). Danh sách đoạn có
   giờ và người nói, tải thêm theo trang; trạng thái lần ghi lời file gần nhất; nút cho
   clerk "Tải file ghi âm"; hộp thoại gán người nói (spec thư ký AI §4.3). Bấm giờ của
   một đoạn mở bản ghi tại đúng chỗ khi có bản ghi.
4. **Biên bản** (đợt 7). Nút "Lập biên bản" (clerk, `ENDED`) → mở trang UniNote; chip
   Nháp / Đã chốt (kèm ngày, người chốt, liên kết mở đúng phiên bản đã chốt); cảnh báo
   "Đã sửa sau khi chốt" khi trang có thay đổi mới hơn phiên bản đó; Chốt / Bỏ chốt;
   Xuất DOCX/PDF (đợt 8).

Cũng thêm:

- `MeetingSummaryPanel` thôi hiện việc đề xuất; còn tóm tắt và kết luận (chip căn cứ từ
  đợt 6).
- Hero của cuộc họp `SCHEDULED` đã qua giờ bắt đầu: nút "Ghi nhận đã họp" (chủ trì/admin,
  đợt 5), hộp thoại chọn giờ bắt đầu/kết thúc (mặc định theo lịch).

### 9.3 Phòng họp

Mục "actions" của tab copilot (`meeting-room-copilot-tab.tsx`) hiện
`MeetingActionItemsSection` bản gọn thay `SummaryActionItems`, cộng nhóm "Việc còn tồn"
thu gọn.

### 9.4 Task

Chi tiết task hiện dòng "Từ cuộc họp: {tên} · {ngày}" khi `origin_type='meeting'`, đọc
cuộc họp bằng hook có sẵn, liên kết bằng builder trong `packages/core/paths/`. Cuộc họp
không đọc được (đã xoá) → "Cuộc họp không còn". Đợt 2.

### 9.5 Quy ước

Chuỗi mới vào `vi.json` trước rồi `en`, theo glossary của `docs/conventions.md`; mọi
chữ trong JSX qua `t()`; icon theo `MODULE_ICONS`; loading dùng `<Spinner />`; màu chỉ
qua token ngữ nghĩa.

## 10. Điểm mở rộng cho loại cuộc họp

Spec này không làm loại họp nhưng giữ đường cho nó:

- Biên bản luôn tách **số liệu** (từ bảng) khỏi **diễn giải** (từ AI), và luôn đi qua
  **một** hàm `renderMinutes(facts, narrative, layout)`. Một loại họp sau này mang theo:
  layout (thứ tự phần, tiêu đề, phần đầu như quốc hiệu/tiêu ngữ), dữ liệu bắt buộc (ví
  dụ phải chốt điểm danh trước khi lập biên bản), luồng duyệt (ví dụ chủ trì và thư ký
  ký), bố cục khi xuất.
- Vai clerk và thư ký đã dùng chung, luồng duyệt sau này không phải làm lại.
- Cột `meetings.meeting_type` đã mang nghĩa `SCHEDULED`/`INSTANT`. Cột cho loại họp sau
  này **không** đặt tên `type`/`meeting_type`; đề xuất `template_key`.
- Khi Work Product (C-14, ADR 0016) có, biên bản chuyển thành một Work Product sở hữu
  trang; `minutes_document_id` là chỗ nối.

## 11. Phát hiện bên lề

- Catalogue `participant.invited` (`outbox/catalogue.go`) thiếu `participant_id`, trong
  khi bên phát gửi (`service/meeting_participants.go`) và `ruleParticipantInvited` dùng.
  Sửa ở một PR nhỏ riêng.
- Route agent so secret bằng `!=` (`handler/meeting_ai.go`), không phải so sánh thời gian
  hằng. Route này bị xoá ở đợt S1 của spec thư ký AI (thay bằng token theo cuộc họp).
- Cờ `meeting_ai_summary` (`featureflags/keys.go`) được khai báo nhưng không nơi nào đọc;
  cuộc họp thực tế được chặn bằng quyền gói. Để chủ cờ quyết định xoá.

## 12. Chia đợt

Một issue cha, mỗi đợt một sub-issue và một PR làm trọn backend + web.

| Đợt | Nội dung | Giải quyết | Phụ thuộc | Cờ |
|---|---|---|---|---|
| 1 | Báo người được giao khi task tạo sẵn người phụ trách, gộp theo lần tạo (§8.3), mọi đường tạo | G1 | — | — |
| 2 | Task hiện "Từ cuộc họp" (SDO + type + §9.4) | G2 | — | — |
| 3 | Bảng việc sau họp + chuyển dữ liệu cũ; API §6.1–6.3; clerk cho tóm tắt và giao việc; prompt `@4`; mục "Việc sau họp" và copilot | G3, G4, một phần G5 | nên sau đợt 1 | — |
| 4 | Việc còn tồn (§6.5, §9.2 mục 2); migration chép bù rồi xoá `meeting_summary_task_links` (§5.1) | G5 | 3 | — |
| 5 | Họp trực tiếp không có máy trong phòng: ghi nhận đã họp; tải file ghi âm (purpose, phiên tải, xác nhận báo người dự họp); bảng và worker ghi lời theo lô; provider AssemblyAI + gateway + ước chi phí trước; hai kind thông báo | G6, G7 | khoá API AssemblyAI; spec thư ký AI S1 (hợp đồng segment) và S2 (bảng nhãn người nói); bật cờ ngoài nội bộ chờ §7.5 | `meeting_transcription` |
| 6 | Căn cứ: prompt `@5`, cột `evidence`, chip căn cứ, mở transcript/bản ghi tại chỗ | G8 | 3; nên sau spec thư ký AI S1 | — |

Ghi lời trực tiếp, phụ đề, micro hội trường, việc trong lúc họp, tóm tắt tự tạo, ngân sách
họp dài (§7.8) và hợp đồng segment (§5.4) nằm ở các đợt S0–S7 của spec thư ký AI.
| 7 | Biên bản: cột trên `meetings`, `renderMinutes`, lập/chốt/mở lại, mục Biên bản; thêm một dòng vào phần hệ quả của ADR 0016 (§14) | G9 | 3 | `meeting_minutes` |
| 8 | Xuất trang UniNote ra DOCX/PDF | G9 | — | `page_export` |

Cờ mới khai báo trong `featureflags/keys.go` với `review_at` 90 ngày sau ngày bật. Đợt 1,
2, 4, 6 chạy thẳng: không có khả năng mới để giấu. Đợt 3 đổi hành vi có sẵn, nên
`@4` và chuyển dữ liệu đi cùng nhau, không đặt cờ.

## 13. Kiểm thử

### 13.1 Go (DB test)

- **Đợt 1:** tạo task có người phụ trách → đúng một `task_assigned` cho người đó; tự giao
  cho mình → không có; người phụ trách là agent → không có; tạo rồi đổi người → vẫn một
  dòng chưa đọc (group key trùng). Một request tạo 3 task cho A và 1 cho B (qua
  `CreateManyWith` và qua `CreateMany` của email hub) → A một `tasks_assigned`
  `count=3`, B một `task_assigned`; xử lý sự kiện theo thứ tự đảo ngược cho cùng kết
  quả; xử lý lại một sự kiện không sinh thêm dòng; hai lần giao liên tiếp cho A → hai
  thông báo, mỗi cái đúng `count`.
- **Đợt 3:**
  - Chuyển dữ liệu: bản mới nhất có 3 việc, 1 đã giao; một bản cũ có 1 việc đã giao →
    đúng 4 việc, đúng `task_id`, đúng trạng thái. Một việc giao hai lần (task đầu đã
    xoá) → mang task còn sống. Liên kết của bản cũ tới task đã xoá → không sinh việc.
    Chép bù của đợt 4 chạy hai lần → không trùng.
  - Tạo lại tóm tắt: việc đã giao, đã bỏ qua, việc tay còn nguyên; việc AI đang chờ bị
    thay; tiêu đề trùng việc đã bỏ qua không quay lại; việc có task đã xoá bị thay.
  - Giao: việc đã giao / đã bỏ qua → 409 với đủ `action_item_ids`; trùng tiêu đề task
    đang mở → 409 với `action_item_ids`; 20 goroutine giao cùng một việc → đúng một task.
  - Đua giữa giao và lưu tóm tắt: không có task nào trỏ tới việc đã bị thay.
  - Quyền: thư ký được tóm tắt, thêm, bỏ qua, giao; thành viên thường → 403.
- **Đợt 4:** chỉ việc chưa xong, cùng dự án, từ cuộc họp `ENDED` bắt đầu trước; cuộc họp
  không dự án → rỗng; không lộ việc của workspace khác.
- **Đợt 5:** worker với provider giả: nhận việc, hỏi kết quả, xong trong một
  transaction; lease hết hạn thì node khác nhận tiếp; lỗi 3 lần → `FAILED`; tính phí
  theo giây nhà cung cấp báo, không có thì theo dung lượng; một lần đang chạy mỗi file
  (409); ước chi phí vượt hạn mức còn lại → 402, không nhận việc. Chọn nguồn §7.3: hai
  file tải lên, mỗi file lần `COMPLETE` mới nhất, ghép đúng thứ tự thời gian cùng đoạn
  `AGENT`. Ghi nhận đã họp chỉ từ `SCHEDULED`; giờ sai → 422; tải lên thiếu xác nhận →
  422. Test provider AssemblyAI bằng httptest (gửi, hỏi xong/lỗi, 4xx/5xx, body hỏng, segment tiếng Việt có nhãn người nói).
- **Đợt 6:** nhãn không có trong bảng nhãn bị loại; bản tóm tắt cũ dạng chuỗi vẫn đọc
  được.
- **Đợt 7:** `renderMinutes` snapshot cho năm trường hợp (đủ dữ liệu; không điểm danh
  chốt; không biểu quyết; không tóm tắt; tóm tắt `partial`); phiếu kín không tên; chủ
  trì và thư ký có `edit` trên trang vừa lập, người khác `view`; chốt thiếu `edit` → 403;
  chốt tạo đúng một phiên bản và ghi id của nó; chốt lại thay id; bỏ chốt giữ phiên bản
  trong lịch sử; trang bị xoá → lập lại được.
- **Mọi đợt:** `TestIsolationMatrix` (route mới tự được phủ; thêm `isoReferences` cho
  `action_item_id`, `assignee_id`, `project_id`, `upload_id`,
  `user_id`), `audit_coverage_test.go`, `scripts/events-catalogue.test.mjs`, lint
  migration, `TestEveryQueryNamesItsTenant`, snapshot prompt `@4`/`@5` trong `ai_test.go`.

### 13.2 Web (vitest)

- Schema và test phản hồi sai định dạng cho mọi endpoint mới.
- `MeetingActionItemsSection`: ba nhóm, chip đếm, giao nhiều việc, bỏ qua có lý do,
  khôi phục, thêm việc, chỉ đọc khi không phải clerk.
- Dòng "Từ cuộc họp" trên task, kể cả cuộc họp đã xoá.
- Parity i18n.

### 13.3 E2E

Một spec `e2e/meetings-follow-through.spec.ts`, dùng AI giả của môi trường test: kết
thúc một cuộc họp có ghi chú → tóm tắt → giao 2 việc, bỏ qua 1, thêm 1 việc tay → người
được giao thấy thông báo và dòng "Từ cuộc họp" trên task → tạo lại tóm tắt, việc đã xử
lý còn nguyên → cuộc họp mới cùng dự án hiện việc còn tồn. Chỉ chạy spec này; bộ đầy đủ
do người review chạy. Cổng cuối mỗi đợt: `make check`.

## 14. Câu hỏi đã chốt

Chủ sản phẩm trả lời ngày 2026-10-20; kết quả đã ghi vào §1.3.

| # | Câu hỏi | Trả lời |
|---|---|---|
| Q1 | Biên bản là trang UniNote do cuộc họp tham chiếu, hay chờ module Work Product (C-14) theo ADR 0016? | Trang UniNote ngay (D12); chuyển sang Work Product khi C-14 có. Không trái quyết định "một kho duy nhất" của ADR 0016: trang vẫn nằm ở Document, cuộc họp chỉ tham chiếu, "chốt" chỉ là một phiên bản tài liệu. Đợt 7 ghi một dòng vào phần hệ quả của ADR 0016 để không ai hiểu nhầm. |
| Q2 | Nhà cung cấp ghi lời file dài? | AssemblyAI, cùng nhà cung cấp với ghi lời trực tiếp (D14, §7.4; thay BytePlus ngày 2026-10-21). |
| Q3 | Ghi lời sau họp tính vào quyền gói nào? | Quyền mới `meeting.transcription` (D15). |
| Q4 | Thư ký được chạy tóm tắt (tốn hạn mức AI của tổ chức)? | Có (D3). |
