# Meetings: Điểm danh và Biểu quyết cho họp chính thức

> **Trạng thái:** in-progress — spec đã duyệt ngày 2026-09-30; đợt 1 đang triển khai trên nhánh `feature/UNI-892-…`.

**Issue:** UNI-891 (cha), UNI-892 (đợt 1 — Điểm danh), UNI-893 (đợt 2 — Biểu quyết).

## 1. Mục tiêu

Cuộc họp chính thức (giao ban, HĐQT, cơ quan) cần hai thứ mà Meetings chưa có:

- **Điểm danh:** danh sách thành viên triệu tập với trạng thái có mặt / đến muộn /
  vắng có phép / vắng, do chủ trì hoặc thư ký chốt, kèm tỉ lệ có mặt tối thiểu.
- **Biểu quyết:** từng nội dung được bỏ phiếu Tán thành / Không tán thành / Không ý
  kiến, công khai hoặc kín, kiểm phiếu theo ngưỡng cấu hình, ra kết quả Thông qua /
  Không thông qua.

Kết quả hiện trên trang chi tiết cuộc họp và được đưa vào tóm tắt AI dưới dạng số liệu
thật, không để AI tự suy ra.

### 1.1 Hiện trạng

- `meeting_attendance_sessions` (migration 008, 019, 033) đã ghi từng lượt vào/ra
  phòng từ webhook LiveKit (`service/meeting_queries.go` `HandleProviderEvent`),
  nhưng chỉ dùng để đo `meeting.participant_minutes`. Không API/UI nào đọc nó.
- Quyền quản lý cuộc họp là một cổng `requireHostOrAdmin` (`service/meeting.go`):
  chủ trì hoặc owner/admin workspace. Chưa có đồng chủ trì hay thư ký.
- Poll của Chat (`service/chat_poll.go`) lưu trong JSON của tin nhắn, gắn phòng chat
  và user id, không khoá dòng, không audit, không đóng tay, không kín thật. **Không
  tái dùng backend**; chỉ mượn mẫu UI và giới hạn độ dài từ `core/chat/poll-utils.ts`.
- unidigiwork (bản tham khảo) chỉ có theo dõi có mặt tự động, không có điểm danh
  chính thức hay biểu quyết.

### 1.2 Quyết định đã chốt

| # | Quyết định |
|---|---|
| D1 | Dùng cho họp chính thức (không phải poll nhanh kiểu Zoom). |
| D2 | Người tham gia chia **Thành viên** (`MEMBER`: điểm danh, biểu quyết, tính tỉ lệ) và **Dự thính** (`OBSERVER`: ghi có mặt, không biểu quyết). Mặc định: tài khoản → thành viên, khách → dự thính. |
| D3 | Điểm danh tự điền gợi ý từ dữ liệu vào phòng; clerk sửa từng người rồi **Chốt**. |
| D4 | Hai hình thức phiếu: **công khai** (lưu ai chọn gì) và **kín thật** (không lưu ai chọn gì). |
| D5 | Ngưỡng cấu hình mỗi nội dung: quá bán hoặc 2/3, trên số có mặt hoặc tổng thành viên. Tỉ lệ có mặt tối thiểu của cuộc họp chỉ cảnh báo, không chặn. |
| D6 | Người điều hành ("clerk") = chủ trì + **Thư ký** (vai mới) + owner/admin workspace. |
| D7 | Mỗi người một phiếu, không đổi phiếu (cả công khai). |
| D8 | Chỉ bỏ phiếu khi cuộc họp `IN_PROGRESS`, người đó thuộc danh sách cử tri chốt lúc mở (§3.5). Không uỷ quyền. |
| D9 | Khi đang mở chỉ hiện tỉ lệ đã bỏ phiếu (x/y); số đếm chỉ hiện sau khi đóng. |
| D10 | Nội dung soạn trước được (nháp), chỉ mở khi đang họp; mỗi lúc một nội dung mở. |
| D11 | Sau khi họp kết thúc vẫn sửa được điểm danh (có audit); kết quả biểu quyết đã đóng là bất biến. |

## 2. Ngoài phạm vi

Xuất biên bản .docx/.pdf/Excel; uỷ quyền bỏ phiếu; đổi phiếu; lựa chọn tuỳ ý ngoài ba
lựa chọn cố định; tự đóng biểu quyết theo đồng hồ; điểm danh bằng QR hay tự xác nhận;
tổng hợp điểm danh/biểu quyết trên trang danh sách cuộc họp; gắn gói cước hoặc feature
flag.

## 3. Mô hình dữ liệu

Theo luật migration của repo (`server/migrations/lint_test.go`): không FK, id ULID
TEXT, mỗi index một file `CREATE [UNIQUE] INDEX CONCURRENTLY`, bảng mới có
`organization_id TEXT NOT NULL`, có `created_by` thì có `created_by_kind`, tên file
`999<unix-ms>_<name>.{up,down}.sql`. Query ở `server/pkg/db/queries/meeting_governance.sql`,
chạy `make sqlc`.

### 3.1 `meeting_participants` — cột mới

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `standing` | `TEXT NOT NULL DEFAULT 'MEMBER'` | `MEMBER` \| `OBSERVER`. Migration: `UPDATE … SET standing='OBSERVER' WHERE principal_type='GUEST'`. |
| `is_secretary` | `BOOLEAN NOT NULL DEFAULT false` | Chỉ `principal_type='USER'` được `true` (kiểm ở service). |

Không dùng lại cột `role`: nó quyết định quyền phát trên LiveKit
(`meetings/media_permissions.go`), trộn vào sẽ làm đổi quyền mic/camera.

Hai đường tạo khách phải ghi `standing='OBSERVER'` ngay khi insert:
`materializeFromLink` và `ApproveJoinRequest` (`service/meeting_admission.go`).

### 3.2 `meetings` — cột mới

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `quorum_percent` | `SMALLINT` NULL | 1–100; NULL = không yêu cầu. |
| `attendance_finalized_at` | `TIMESTAMPTZ` NULL | |
| `attendance_finalized_by` | `TEXT` NULL | user id. |

### 3.3 `meeting_attendance_marks`

| Cột | Kiểu |
|---|---|
| `id` | `TEXT PRIMARY KEY` |
| `organization_id` | `TEXT NOT NULL` |
| `meeting_id` | `TEXT NOT NULL` |
| `participant_id` | `TEXT NOT NULL` |
| `status` | `TEXT NOT NULL` — `PRESENT` \| `LATE` \| `EXCUSED` \| `ABSENT` |
| `note` | `TEXT NOT NULL DEFAULT ''` — ≤ 200 ký tự |
| `source` | `TEXT NOT NULL` — `AUTO` \| `MANUAL` |
| `marked_by` | `TEXT` NULL — NULL khi `AUTO` |
| `marked_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |

Index: `UNIQUE (meeting_id, participant_id)`.

### 3.4 Trạng thái điểm danh hiệu lực

Với mỗi người tham gia `ACTIVE`:

1. Có dòng trong `meeting_attendance_marks` → dùng dòng đó.
2. Không có (chỉ xảy ra khi chưa chốt) → **gợi ý tự động** từ
   `meeting_attendance_sessions`:
   - không có phiên nào → `ABSENT`;
   - `min(joined_at) > mốc + 10 phút` → `LATE`;
   - còn lại → `PRESENT`.

   `mốc` = `starts_at` với họp lên lịch, `actual_start_at` với họp tức thì
   (`meeting_type='INSTANT'`). Đúng 10:00 sau mốc vẫn là `PRESENT`. Hằng số
   `attendanceLateGrace = 10 * time.Minute`, không cấu hình.

**Chốt** (`finalize`): trong một transaction, upsert một dòng `source='AUTO'` cho mọi
người chưa có dòng, rồi set `attendance_finalized_*`. Sau khi chốt, lượt vào phòng mới
không đổi trạng thái; API vẫn trả giờ vào thực tế để clerk tự sửa.
**Mở lại** (`reopen`): xoá các dòng `source='AUTO'`, xoá `attendance_finalized_*`;
dòng `MANUAL` giữ nguyên.

Dự thính cũng có trạng thái (chỉ để ghi có mặt), nhưng không vào tổng hợp thành viên
và không tính tỉ lệ.

### 3.5 `meeting_motions`

| Cột | Kiểu / giá trị |
|---|---|
| `id`, `organization_id`, `workspace_id`, `meeting_id` | `TEXT NOT NULL` |
| `title` | `TEXT NOT NULL` — 1–200 ký tự |
| `description` | `TEXT NOT NULL DEFAULT ''` — ≤ 2000 ký tự |
| `position` | `INTEGER NOT NULL` |
| `ballot_mode` | `PUBLIC` \| `SECRET` |
| `threshold` | `MAJORITY` \| `TWO_THIRDS` |
| `base` | `PRESENT` \| `ALL_MEMBERS` |
| `status` | `DRAFT` \| `OPEN` \| `CLOSED` |
| `total_members` | `INTEGER` NULL — snapshot lúc mở: số `MEMBER` `ACTIVE` |
| `roll_size` | `INTEGER` NULL — snapshot lúc mở: số cử tri (§3.6) |
| `yes_count`, `no_count`, `abstain_count` | `INTEGER NOT NULL DEFAULT 0` |
| `outcome` | `TEXT` NULL — `PASSED` \| `FAILED`, set khi đóng |
| `opened_at`, `opened_by`, `closed_at`, `closed_by` | NULL |
| `created_by`, `created_by_kind`, `created_at`, `updated_at` | |
| `version` | `INTEGER NOT NULL DEFAULT 1` |

Index: `(meeting_id, position)`; `UNIQUE (meeting_id) WHERE status='OPEN'` — mỗi cuộc
họp tối đa một nội dung đang mở, DB giữ bất biến.

Vòng đời: `DRAFT → OPEN → CLOSED`. Chỉ `DRAFT` sửa/xoá được (xoá cứng). `CLOSED` bất
biến.

### 3.6 `meeting_motion_ballots`

| Cột | Kiểu |
|---|---|
| `id`, `organization_id`, `meeting_id`, `motion_id`, `participant_id` | `TEXT NOT NULL` |
| `choice` | `TEXT` NULL — `YES` \| `NO` \| `ABSTAIN` |
| `cast_at` | `TIMESTAMPTZ` NULL |

Index: `UNIQUE (motion_id, participant_id)`.

Không có cột `ballot_mode` trên bảng này nên không đặt được CHECK chéo bảng; bất biến
"phiếu kín thì `choice` NULL" do service giữ (câu `UPDATE` của nhánh kín không set
`choice`) và test DB khẳng định (§8).

**Danh sách cử tri:** khi mở, tạo một dòng (`cast_at` NULL) cho mỗi người tham gia
`ACTIVE`, `standing='MEMBER'`, có trạng thái hiệu lực `PRESENT` hoặc `LATE`. Người
vào sau khi mở, dự thính, vắng có phép không có dòng → không bỏ phiếu nội dung đó.
Cách này làm điều kiện bỏ phiếu kiểm được, x/y đếm thẳng từ bảng, và mẫu số "có mặt"
không trôi.

**Bỏ phiếu:** trong một transaction:

1. `SELECT … FROM meeting_motions WHERE id=$1 FOR UPDATE`; `status` phải `OPEN`,
   meeting phải `IN_PROGRESS`.
2. `UPDATE meeting_motion_ballots SET cast_at=now(), choice=$c WHERE motion_id=$1 AND
   participant_id=$2 AND cast_at IS NULL` (nhánh kín: không set `choice`).
3. 0 dòng → phân biệt bằng một `SELECT`: có dòng mà đã bỏ → 409 `already_voted`;
   không có dòng → 403 `not_on_roll`.
4. `UPDATE meeting_motions SET <choice>_count = <choice>_count + 1`.

### 3.7 Tính kết quả

`mẫu = roll_size` nếu `base='PRESENT'`, `total_members` nếu `ALL_MEMBERS`.

- `MAJORITY`: `PASSED` ⇔ `yes_count * 2 > mẫu`
- `TWO_THIRDS`: `PASSED` ⇔ `yes_count * 3 >= mẫu * 2`

Người không bỏ phiếu coi như không tán thành. `mẫu = 0` → `FAILED`.
Hàm thuần `motionOutcome(threshold, base, counts, rollSize, totalMembers)` để test bảng.

### 3.8 Giới hạn của phiếu kín

Không bảng nào nối người với lựa chọn; audit chỉ ghi "đã bỏ phiếu"; API không trả số
đếm khi đang mở (chặn suy luận từ biến động số đếm). Phiếu kín **không** chống được
người có quyền đọc log truy vấn hoặc WAL của Postgres ngay lúc bỏ phiếu. Service không
log `choice` ở nhánh kín (kể cả `slog` và log request body — handler không log body).

## 4. Quyền

- `requireMeetingClerk(ctx, userID, meetingID)`: cho qua `requireHostOrAdmin`, hoặc
  người tham gia `ACTIVE`, `principal_type='USER'`, `is_secretary=true` của cuộc họp
  đó.
- Chỉ **chủ trì/admin**: đổi `standing`, giao/bỏ thư ký, sửa `quorum_percent` (qua
  `Update` hiện có).
- Clerk: điểm danh, chốt/mở lại, soạn/sửa/xoá/mở/đóng biểu quyết.
- Đọc điểm danh: thành viên workspace (`authorize`).
- Đọc biểu quyết và bỏ phiếu: thành viên workspace hoặc khách đang `ACTIVE`
  (`authorizeActiveParticipant`) — khách được chủ trì nâng lên `MEMBER` phải bỏ phiếu
  được.
- Client mirror: `packages/core/permissions/rules.ts` thêm `canClerkMeeting`, dùng
  trong `useMeetingPermissions`.

## 5. API

Đăng ký qua wrapper `api` với `apiOp{sdi, sdo}`; DTO ở `handler/dto/sdi|sdo/meeting.go`;
param mới `{motionID}` cần case trong `handler/router/openapi.go`. Checklist:
`docs/api-sdi-sdo.md`.

### 5.1 Nhóm đã đăng nhập (`registerMeetings`)

| Method + path | Quyền | Ghi chú |
|---|---|---|
| `PATCH /meetings/{meetingID}/participants/{participantID}` `{standing?, is_secretary?}` | chủ trì/admin | Khách + `is_secretary=true` → 422. |
| `GET /meetings/{meetingID}/attendance` | thành viên workspace | §5.3 |
| `PUT /meetings/{meetingID}/attendance/{participantID}` `{status, note}` | clerk | Meeting `IN_PROGRESS` hoặc `ENDED`, không thì 409 `invalid_state`. `note` chỉ lưu khi `EXCUSED`. |
| `DELETE /meetings/{meetingID}/attendance/{participantID}` | clerk | Trả về gợi ý tự động; khi đã chốt → 409. |
| `POST /meetings/{meetingID}/attendance/finalize` | clerk | Idempotent. |
| `POST /meetings/{meetingID}/attendance/reopen` | clerk | |
| `POST /meetings/{meetingID}/motions` | clerk | Tạo `DRAFT`, `position` = max+1. Meeting không được `CANCELED`/`ENDED`. |
| `PATCH /meetings/{meetingID}/motions/{motionID}` | clerk | Chỉ `DRAFT`; sửa cả `position`. |
| `DELETE /meetings/{meetingID}/motions/{motionID}` | clerk | Chỉ `DRAFT`. |
| `POST /meetings/{meetingID}/motions/{motionID}/open` | clerk | Meeting `IN_PROGRESS`; đã có nội dung mở → 409 `motion_already_open`; danh sách cử tri rỗng vẫn mở được (UI cảnh báo). |
| `POST /meetings/{meetingID}/motions/{motionID}/close` | clerk | Tính kết quả §3.7. |

### 5.2 Nhóm thành viên-hoặc-khách (`registerPublicMeetings`, có rate limit)

| Method + path | Rate limit | Ghi chú |
|---|---|---|
| `GET /meetings/{meetingID}/motions` | `credentialLimit` | §5.4. Khách/người không phải clerk không thấy `DRAFT`. |
| `POST /meetings/{meetingID}/motions/{motionID}/ballot` `{choice}` | `joinLimit` | §3.6. |

### 5.3 `GET attendance` — dạng trả về

```jsonc
{
  "finalized_at": "…" | null, "finalized_by": "user_id" | null,
  "quorum_percent": 60 | null,
  "summary": { "members": 18, "present": 12, "late": 2, "excused": 1, "absent": 3, "quorum_met": true | null },
  "rows": [{
    "participant_id": "…", "principal_type": "USER", "user_id": "…", "display_name": "…",
    "standing": "MEMBER", "is_secretary": false,
    "status": "PRESENT", "source": "AUTO" | "MANUAL" | "SUGGESTED", "note": "",
    "first_joined_at": "…" | null, "last_left_at": "…" | null,
    "present_seconds": 3120, "session_count": 2
  }]
}
```

`source='SUGGESTED'` = chưa có dòng, đang dùng gợi ý tự động (§3.4 bước 2).
`quorum_met` = `(present + late) * 100 >= quorum_percent * members`; NULL khi không đặt
tỉ lệ. `present_seconds` cộng các phiên (phiên đang mở tính tới `now()`).

### 5.4 `GET motions` — dạng trả về mỗi phần tử

```jsonc
{
  "id": "…", "title": "…", "description": "…", "position": 1,
  "ballot_mode": "SECRET", "threshold": "MAJORITY", "base": "PRESENT",
  "status": "OPEN", "opened_at": "…", "closed_at": null,
  "roll_size": 14, "total_members": 18, "cast_count": 9,
  "result": null,          // chỉ có khi CLOSED: { yes, no, abstain, outcome, required }
  "voters": null,          // chỉ khi CLOSED và PUBLIC: { yes: [names], no: [...], abstain: [...] }
  "my_ballot": { "on_roll": true, "cast": false, "choice": null }  // choice chỉ khi PUBLIC
}
```

Khi `OPEN`, `result` luôn `null` với mọi người, kể cả chủ trì (D9). `required` = số phiếu
tán thành tối thiểu để thông qua, để UI ghi "cần > 7/14".

## 6. Audit, sự kiện, realtime

### 6.1 Audit

Mọi lệnh đi qua `s.record(ctx, tx, …)` cùng transaction với thay đổi (audit + outbox
nguyên tử). Thêm vào `meetingActionFor` (`service/meeting.go`):

| Topic realtime | Action audit |
|---|---|
| `participant.updated` | `meeting.participant_updated` |
| `attendance.marked` | `meeting.attendance_marked` |
| `attendance.finalized` | `meeting.attendance_finalized` |
| `attendance.reopened` | `meeting.attendance_reopened` |
| `motion.created` | `meeting.motion_created` |
| `motion.updated` | `meeting.motion_updated` |
| `motion.deleted` | `meeting.motion_deleted` |
| `motion.opened` | `meeting.motion_opened` |
| `motion.closed` | `meeting.motion_closed` |
| `motion.ballot_cast` | `meeting.ballot_cast` |

`meeting.ballot_cast`: `ResourceType="meeting_motion"`; phiếu công khai có
`changes.choice`, phiếu kín **không có** `changes`. Actor là người bỏ phiếu. Khách chưa
có loại actor nào (`audit.Kind` chỉ có `human`/`agent`/`system`; Chat trong phòng không
audit nên chưa gặp): thêm `audit.KindGuest = "guest"` + `audit.Guest(guestID)`.
`audit_events.actor_kind` không có CHECK nên không cần migration; trang audit admin
hiển thị nhãn "Khách" cho kind này. Đây là lệnh đầu tiên của khách được audit.

Dòng thời gian hoạt động (bảng `meeting_audit_logs` qua `writeAudit`) thêm ba loại:
`ATTENDANCE_FINALIZED`, `MOTION_OPENED` (payload `{title}`), `MOTION_CLOSED` (payload
`{title, outcome}`); thêm vào `activityLabelKey` (`core/meetings/status.ts`) và
`meeting-activity-display.ts`.

### 6.2 Sự kiện

Payload chỉ id: `{meeting_id, workspace_id, version?}`, thêm `motion_id` cho `motion.*`,
`participant_id` cho `participant.updated` và `attendance.marked`. **`motion.ballot_cast`
không mang id người bỏ phiếu.**

- Outbox (phạm vi workspace): mọi topic ở §6.1.
- Chép sang scope `meeting` cho khách (`realtime/publisher.go` `meetingLobbyEventTypes`
  + `core/realtime/use-meeting-lobby-sync.ts`): `motion.*` và `participant.updated`.
  Điểm danh không chép (khách không xem điểm danh).
- Phù du: webhook `conference.participant_joined/left` gọi thêm
  `s.pub.Publish(ws, {"attendance.updated", {meeting_id}})` để màn điểm danh cập nhật;
  không audit (không phải lệnh người dùng).
- Thêm đủ ba nơi: `docs/events/CATALOGUE.md`, `internal/outbox/catalogue.go`,
  `packages/core/types/events.ts` (`scripts/events-catalogue.test.mjs` so khớp).
- Client (`core/realtime/use-realtime-sync.ts`): `attendance.*` → invalidate
  `meetingKeys.attendance(id)`; `motion.*` → `meetingKeys.motions(id)`;
  `participant.updated` → `meetingKeys.participants(id)` + `attendance(id)`.

### 6.3 Kết thúc họp

`End()` (`service/meeting_lifecycle.go`) và `AutoEndOverdue`: trong cùng transaction
chuyển trạng thái, đóng mọi nội dung `OPEN` (tính kết quả §3.7, `closed_by` = actor;
auto-end → `closed_by` NULL, actor kind system), ghi `motion.closed` cho từng nội dung.
Điểm danh **không** tự chốt.

## 7. Web

### 7.1 Core (`packages/core`)

- `api/endpoints/meetings.ts`: hàm cho mọi endpoint §5, schema zod qua
  `parseWithFallback`, test phản hồi sai định dạng trong `meetings.test.ts`.
- File mới `meetings/governance-hooks.ts` (`hooks.ts` đã 486 dòng), re-export từ
  `hooks.ts`: `useMeetingAttendance`, `useMarkAttendance`, `useClearAttendanceMark`,
  `useFinalizeAttendance`, `useReopenAttendance`, `useUpdateMeetingParticipant`,
  `useMeetingMotions`, `useCreateMotion`, `useUpdateMotion`, `useDeleteMotion`,
  `useOpenMotion`, `useCloseMotion`, `useCastBallot`. Khoá mới trong `meetingKeys`:
  `attendance(id)`, `motions(id)`. Khách truyền guest session như `useMeetingChat`.
- `meetings/motion-utils.ts`: giới hạn độ dài (200/2000), `requiredYes(...)` giống
  server để hiển thị "cần > n".

### 7.2 Phòng họp (`packages/views/meetings`)

- **Tab "Biểu quyết"**: `MeetingSidebarTab` thêm `"motions"` (`meeting-room-sidebar.tsx`
  union + `panelContent` + `tabLabel`). Hiện với clerk luôn; với người khác (kể cả khách)
  khi có ≥1 nội dung không phải `DRAFT`. Huy hiệu khi có nội dung `OPEN` mà
  `my_ballot.on_roll && !cast`.
- `meeting-motions-tab.tsx`: danh sách theo `position`.
  - Nháp (clerk): Thêm / Sửa / Xoá / Lên / Xuống; `meeting-motion-form-dialog.tsx` với
    tiêu đề, mô tả, hình thức (Công khai/Kín), ngưỡng (Quá bán/2/3), mẫu số (Số có
    mặt/Tổng thành viên). Nút **Mở biểu quyết** → hộp xác nhận "N thành viên có mặt sẽ
    được bỏ phiếu"; chưa đủ tỉ lệ tối thiểu → cảnh báo màu warning, không chặn; N = 0 →
    cảnh báo rõ.
  - Đang mở: tiến độ "Đã bỏ phiếu 9/14"; cử tri thấy ba lựa chọn; clerk có **Đóng biểu
    quyết** (xác nhận thêm nếu còn người chưa bỏ).
  - Đã đóng: thanh ba đoạn Tán thành (success) / Không tán thành (danger) / Không ý kiến
    (neutral) kèm số và %; pill **Thông qua**/**Không thông qua**; dòng "cần > 7/14";
    phiếu công khai có mục mở rộng xem ai chọn gì.
- `meeting-motion-card.tsx`: một thẻ cho ba trạng thái, dùng chung với trang chi tiết.
- `meeting-vote-prompt.tsx` + hook `use-meeting-vote-prompt.ts`: thẻ nổi trên sân khấu
  phía trên thanh điều khiển khi có nội dung `OPEN` mình thuộc danh sách mà chưa bỏ.
  Hai bước: chọn (radiogroup) → **Gửi phiếu**, dòng "Không thể thay đổi sau khi gửi".
  Sau khi gửi: "Đã ghi nhận phiếu", tự ẩn. Ẩn tay được (vẫn bỏ trong tab).
  `role="region"` + `aria-live="polite"`, không cướp focus. Khi `motion.closed` → toast
  kết quả cho mọi người. `meeting-conference.tsx` (đã 528 dòng) chỉ thêm một chỗ gắn.
- **Điểm danh trong tab Người tham gia** (`meeting-room-people-tab.tsx`): clerk có nút
  chuyển "Trong phòng | Điểm danh".
  - `meeting-attendance-panel.tsx` (prop `density: "room" | "compact"`): dải tổng hợp,
    chip tỉ lệ ("Đủ tỉ lệ có mặt" / "Chưa đủ tỉ lệ (cần 60%)"), danh sách thành viên
    (avatar, giờ vào, bộ chọn bốn trạng thái; `EXCUSED` → ô lý do; nhãn "Tự động" với
    `SUGGESTED`/`AUTO`; nút trả về gợi ý), nhóm **Dự thính** thu gọn, nút **Chốt điểm
    danh** / "Đã chốt lúc … bởi …" + **Mở lại**.
  - Chế độ "Trong phòng": nhãn **Thư ký** / **Dự thính** cạnh tên cho mọi người; menu
    mỗi người (chủ trì/admin) thêm "Chuyển thành dự thính/thành viên", "Giao vai thư ký /
    Bỏ vai thư ký".

### 7.3 Trang chi tiết

- Hộp sửa cuộc họp (`meeting-edit-dialog.tsx`): ô "Tỉ lệ có mặt tối thiểu (%)" không bắt
  buộc.
- Danh sách tham gia (`MeetingParticipantsSection`): nhãn + menu như §7.2.
- Cột chính: thẻ **Biểu quyết** (`meeting-motions-section.tsx`) giữa
  `MeetingJoinRequestsPanel` và `MeetingSummaryPanel`, dùng `meeting-motion-card`. Trước
  họp: clerk soạn nháp; đang mở: chỉ tiến độ (bỏ phiếu trong phòng). Không có nội dung
  và không phải clerk → ẩn thẻ.
- Cột phải: thẻ **Điểm danh** dưới danh sách tham gia khi `IN_PROGRESS`/`ENDED`, dùng
  `meeting-attendance-panel` `density="compact"`.
- `MeetingSummaryPanel`, phần "Quyết định": nhóm **"Đã biểu quyết"** ở đầu, render từ
  dữ liệu motion `CLOSED` (không qua AI).

### 7.4 Quy ước

Token ngữ nghĩa và bộ ba signal có sẵn (không màu mới); icon lucide; chuỗi qua `t()`
dưới `meetings.governance.*`, `vi.json` trước rồi `en.json`, số nhiều `_one/_other`;
file ≤ 500 dòng.

## 8. Tóm tắt AI

- Prompt mới `meeting_summary@2` (`internal/ai/prompts.go`), `@1` giữ lại cho tới khi
  không còn tham chiếu. Biến mới:
  - `attendance`: `{members, present, late, excused, absent, quorum_percent, quorum_met,
    finalized, names_by_status}` (chỉ thành viên).
  - `motions`: nội dung `CLOSED` — `{title, ballot_mode, yes, no, abstain, required,
    outcome}`.
- Prompt dặn: dùng đúng số liệu này; không suy ra kết quả biểu quyết từ transcript; phiếu
  kín không nêu tên.
- `Summarize` (`service/meeting_ai.go`): nạp thêm hai nguồn trong `errgroup`; điều kiện
  `nothing_to_summarize` nới ra: có ≥1 motion `CLOSED` thì vẫn tóm tắt được.
- `ai_test.go`: cập nhật bảng prompt, test render có hai biến mới.

## 9. Chia đợt

Một issue cha "Meetings: Điểm danh và Biểu quyết", hai sub-issue, mỗi đợt một PR làm
trọn backend + web:

1. **Điểm danh** — §3.1–3.4, §4, API §5.1 phần participants/attendance, §6 phần
   attendance/participant, §7.2 phần điểm danh, §7.3 trừ thẻ Biểu quyết, mốc
   `ATTENDANCE_FINALIZED`.
2. **Biểu quyết** — §3.5–3.8, API motions/ballot, §6.2 chép scope meeting, §6.3, §7.2
   phần biểu quyết, thẻ Biểu quyết + nhóm "Đã biểu quyết", §8.

Đợt 2 phụ thuộc đợt 1 (`standing` và trạng thái hiệu lực để lập danh sách cử tri).

## 10. Kiểm thử

### 10.1 Go (DB test)

- Gợi ý tự động: không vào → `ABSENT`; vào đúng mốc+10:00 → `PRESENT`; mốc+10:01 →
  `LATE`; họp tức thì dùng `actual_start_at`.
- Dòng tay thắng gợi ý; chốt ghi snapshot đủ người; vào phòng sau chốt không đổi; mở lại
  xoá `AUTO`, giữ `MANUAL`; `DELETE` khi đã chốt → 409.
- `present_seconds` cộng nhiều phiên, phiên mở tính tới now.
- Quyền: thư ký được điểm danh/soạn/mở/đóng; thư ký không đổi `standing`, không giao thư
  ký, không `End`; khách không làm thư ký (422); không phải clerk → 403.
- Khách mặc định `OBSERVER` qua `materializeFromLink` và `ApproveJoinRequest`; migration
  backfill khách cũ.
- Danh sách cử tri lúc mở: thành viên có mặt/muộn có; dự thính, vắng có phép, vắng, vào
  sau khi mở không có.
- Đua: 20 goroutine cùng một người bỏ phiếu → đúng 1 thành công, còn lại 409; nhiều người
  bỏ song song → tổng số đếm = số phiếu.
- Phiếu kín: `choice` NULL trong DB; audit `meeting.ballot_cast` không có `changes`; khi
  `CLOSED` không trả `voters`; khi `OPEN` không trả `result` kể cả cho chủ trì.
- `motionOutcome` bảng: quá bán đúng một nửa → `FAILED`; 2/3 với 10/15 → `PASSED`, 9/15
  → `FAILED`; cả hai `base`; `mẫu=0` → `FAILED`.
- Một nội dung mở mỗi lúc (409); sửa/xoá ngoài `DRAFT` → 409; mở khi meeting chưa
  `IN_PROGRESS` → 409; bỏ phiếu sau khi đóng → 409.
- `End()` và `AutoEndOverdue` đóng + kiểm phiếu nội dung đang mở trong cùng transaction.
- Handler: validate SDI (độ dài, enum), OpenAPI có route mới, khách bỏ phiếu bằng
  `X-Guest-Session`.
- `audit_coverage_test`, `events-catalogue.test.mjs`, lint migration.
- `ai_test.go`: prompt `@2` render đủ biến.

### 10.2 Web (vitest)

- Schema zod + phản hồi sai định dạng cho mọi endpoint mới.
- `meeting-motion-card`: nháp/đang mở/đã đóng; bản kín không có danh sách người.
- `meeting-vote-prompt`: hai bước, radiogroup, không lấy focus, ẩn sau khi gửi.
- `meeting-attendance-panel`: đổi trạng thái, `EXCUSED` hiện ô lý do, trả về gợi ý, chip
  tỉ lệ, chốt/mở lại.
- Luật hiện tab Biểu quyết; `requiredYes` khớp server.
- Parity i18n.

### 10.3 E2E

Một spec `e2e/meetings-governance.spec.ts`. Local không chạy webhook LiveKit, nên spec
đánh dấu có mặt bằng `PUT attendance` (đúng đường điểm danh tay của sản phẩm):
chủ trì giao thư ký và đặt tỉ lệ → bắt đầu họp → điểm danh → thư ký soạn và mở một nội
dung → người dùng thứ hai bỏ phiếu qua thẻ mời → đóng → kiểm kết quả trên trang chi tiết
và mốc trên dòng thời gian. Chỉ chạy spec này; bộ đầy đủ do người review chạy.

Cổng cuối: `make check`. Chụp phòng họp và trang chi tiết ở sáng/tối bằng spec
Playwright tạm.
