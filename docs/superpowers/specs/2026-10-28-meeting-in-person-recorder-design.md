# Meetings: Họp trực tiếp không giấy — bấm ghi âm, họp xong có biên bản và việc

> **Trạng thái:** in-progress — bản thiết kế viết ngày 2026-10-28, chờ chủ sản phẩm duyệt. Chưa có issue UniAI (cần một issue trước khi viết code).

## 1. Ý định

Họp online đã khá hoàn thiện. Nhiều cuộc họp của đội nhóm Việt Nam vẫn là họp
trực tiếp: ngồi cùng một phòng, một người ghi chép tay, họp xong gõ lại biên bản
và nhắn từng người việc phải làm. Phần đó tốn thời gian, hay sót việc, và biên
bản thường ra muộn hoặc không ra.

Chức năng này cho họp trực tiếp một luồng không cần giấy: **tạo cuộc họp trực
tiếp → đến giờ bấm Bắt đầu, một máy trên bàn ghi âm cả phòng → bấm Kết thúc →
vài phút sau có biên bản nháp và danh sách việc đề xuất**. Chủ trì xem lại, giao
việc, chốt biên bản. Không ai phải ghi chép tay.

Gần hết phần phía sau đã có (§3): ghi lời file ghi âm theo lô, tách người nói,
tóm tắt, việc đề xuất, biên bản. Phần còn thiếu là **ghi âm ngay trong app** và
**cách đánh dấu một cuộc họp là trực tiếp**. Hôm nay người dùng phải ghi bằng app
khác rồi tải file lên qua "Ghi nhận đã họp" + "Tải file ghi âm".

## 2. Mục tiêu, không làm, phản mục tiêu

**Mục tiêu**

- G1. Khi lên lịch hoặc họp ngay, chọn được hình thức **Trực tiếp**. Họp trực
  tiếp không có phòng online, lời mời không kèm link vào phòng.
- G2. Một người được phép (§5 D6) bấm **Bắt đầu ghi âm** trên điện thoại, laptop
  hoặc thiết bị cố định của phòng họp, qua trình duyệt. Máy ghi cả phòng đến khi
  bấm **Kết thúc**.
- G3. Rớt mạng giữa buổi không làm mất bản ghi. Máy vẫn ghi, có mạng lại thì gửi.
- G4. Họp xong, không cần thêm thao tác nào ngoài Kết thúc, hệ thống tự ghi lời,
  tách người nói, tóm tắt và đề xuất việc. Chủ trì nhận thông báo khi xong.
- G5. Chủ trì đi qua một chuỗi bước ngắn để hoàn tất: ai đã dự → tên người nói →
  giao việc → lập và chốt biên bản.

**Thành công:** một buổi họp trực tiếp 60 phút, Wi-Fi văn phòng bình thường, có
biên bản nháp và việc đề xuất **trong vòng 10 phút sau khi bấm Kết thúc**. Không
ai cầm giấy bút.

**Không làm trong vòng này** (chủ sản phẩm đã nghe danh sách này và không sửa)

- Chữ chạy theo lời nói hay việc hiện dần **trong lúc** họp. Chủ sản phẩm chốt: chỉ
  cần họp xong vài phút là có.
- Mẫu biên bản trang trọng (quốc hiệu, chữ ký, đóng dấu). Biên bản chỉ để người
  trong nhóm đọc lại.
- Phát tài liệu họp, biểu quyết tại chỗ, đăng ký phát biểu.
- Ghi âm trong app điện thoại UniChat (`apps/chat-mobile`) hay app desktop.
- Nhiều máy cùng ghi một buổi. Họp lai (một phần online, một phần ngồi trong phòng).
- Ghi được mà **không bao giờ** có mạng: phải có mạng lại thì mới gửi và mới có
  biên bản.

**Phản mục tiêu** (chạy được nhưng vẫn là thất bại)

- Mất bản ghi. Mọi giây đã ghi phải lên được server, hoặc còn trên máy và lấy lại
  được, cho đến khi người ghi tự tay xoá.
- Ghi âm mà người trong phòng không biết: thiếu xác nhận đã báo mọi người, hoặc
  không có dấu hiệu "Đang ghi âm" rõ ràng.
- Hoàn tất cuộc họp tốn công hơn tự ghi chép tay.
- Việc thành task mà không có người xác nhận. AI chỉ đề xuất, người giao (cùng
  tinh thần ADR 0010 / 0044).

## 3. Đã có sẵn — dùng lại, không viết lại

| Mảnh | Ở đâu | Dùng thế nào |
|---|---|---|
| "Ghi nhận đã họp": `SCHEDULED → ENDED` với giờ thật, không cần phòng | `MeetingService.RecordHeld` (`server/internal/service/meeting_transcriptions.go`), `useRecordMeetingHeld` (`packages/core/meetings/transcription-hooks.ts`) | Gọi khi bấm Kết thúc, với giờ bắt đầu/kết thúc ghi |
| Tải file ghi âm lớn theo phiên chia mảnh, tiếp tục được khi đứt | BIGUP (`docs/superpowers/specs/2026-10-17-bigup-upload-sessions-contract.md`), `useUploadMeetingRecording` | Bản ghi trong app thành một `File` rồi đi đúng đường này |
| Ghi lời theo lô, tách người nói, tính phí, xoá bản ở nhà cung cấp | worker `runTranscriptions`, AssemblyAI, cờ `meeting_transcription`, đồng hồ `meeting.transcription` | Không đổi |
| Xác nhận đã báo người dự họp về việc ghi âm | `TranscriptionRequest.Consent`, lưu trong metadata audit | Hỏi **trước khi bấm Bắt đầu**, gửi kèm lúc xếp hàng ghi lời |
| Tóm tắt tự chạy khi có lời thoại | `completeTranscription` → `queueAutoSummary` | Không đổi |
| Gán tên cho "Người nói 1, 2…" | `meeting_speaker_labels`, hộp thoại gán người nói | Không đổi |
| Việc đề xuất → task, người xác nhận | `AiSummaryTasksDialog`, `meeting_action_items` | Không đổi |
| Điểm danh tay và chốt | `MarkAttendance`, `FinalizeAttendance`, `meeting-attendance-panel.tsx` | Bước "Ai đã dự", với gợi ý mặc định đổi cho họp trực tiếp (D12) |
| Biên bản là trang UniNote: lập, chốt, mở lại, cập nhật phần dữ kiện | `CreateMinutes` / `FinalizeMinutes` / refresh, cờ `meeting_minutes` | Bước cuối. Mẫu hiện có là đủ (chủ sản phẩm chốt) |
| Thông báo "đã có tóm tắt" cho **chủ trì và thư ký** khi hệ thống tự tóm tắt | `ruleSummaryCreated` (`server/internal/notification/rules.go`), `KindMeetingSummaryReady` | Đây là thông báo "xong" của G4. Không đổi |
| Thông báo ghi lời xong / hỏng cho **người đã gửi bản ghi** | `ruleTranscription`, `KindMeetingTranscriptReady`, `KindMeetingTranscriptFailed` | Không đổi |

## 4. Luồng người dùng

1. **Tạo.** Ở form lên lịch và hộp thoại họp ngay (`instant-meeting-dialog.tsx`)
   có lựa chọn hình thức **Online / Trực tiếp**, dạng hai ô có icon. Họp trực tiếp
   không mở phòng, ICS không có dòng gọi vào bằng điện thoại. Lời mời và ICS vẫn
   có link tới trang cuộc họp (ICS hôm nay chỉ link tới trang đó). **Họp trực tiếp
   ngay** tạo cuộc họp và mở thẳng màn hình chuẩn bị ghi (D11).
2. **Trang cuộc họp trực tiếp, trước giờ họp.** Nút chính là **Bắt đầu ghi âm**,
   chỉ hiện cho người được ghi (D6) khi tổ chức có ghi lời (`transcription`
   capability). Không có "Vào phòng", không tạo link mời khách. "Ghi nhận đã họp"
   + "Tải file ghi âm" vẫn còn cho ai đã ghi bằng máy khác.
3. **Chuẩn bị ghi** (một màn hình): chọn micro, vạch mức âm để biết micro đang
   thu, ngôn ngữ (mặc định tiếng Việt), ô bắt buộc "Tôi đã thông báo cho người dự
   họp về việc ghi âm". Bấm **Bắt đầu**.
4. **Đang ghi** (toàn màn hình, nhìn được từ xa): dấu "Đang ghi âm" đỏ, đồng hồ,
   sóng âm, **Tạm dừng / Ghi tiếp**, **Kết thúc**. Màn hình được giữ sáng. Rời
   trang thì trình duyệt hỏi trước. Bị ngắt (khoá máy, có cuộc gọi đến, micro mất)
   thì hiện rõ "Ghi âm bị ngắt — Ghi tiếp". Rớt mạng không ảnh hưởng.
5. **Kết thúc** (hỏi lại một lần): cuộc họp thành "đã họp" với giờ thật, bản ghi
   được gửi lên, có thanh tiến độ. Gửi xong quay về trang cuộc họp, hiện "Đang xử
   lý bản ghi…". Mất mạng lúc gửi thì giữ trên máy và gửi tiếp khi có mạng.
6. **Hoàn tất** (trên trang cuộc họp đã họp, thứ tự từ trên xuống, dạng các bước
   có trạng thái): **Ai đã dự** (mặc định mọi người được mời là có mặt, bỏ tích ai
   vắng, chốt) → **Tên người nói** (khi ghi lời xong) → **Việc đề xuất** (sửa, giao)
   → **Biên bản** (một bấm để lập, sửa, chốt).
7. **Bản ghi chưa gửi.** Mở lại trang cuộc họp trên cùng máy, cùng tài khoản, mà
   còn bản ghi chưa gửi (đóng tab giữa chừng, hết pin, mất mạng lúc gửi), trang
   hiện: "Có bản ghi chưa gửi (35 phút) — Gửi / Ghi tiếp / Xoá".

## 5. Quyết định

**Của chủ sản phẩm (trong cuộc trao đổi ngày 2026-10-27/28)**

| # | Quyết định |
|---|---|
| O1 | "Họp offline" là họp trực tiếp: bấm bắt đầu thì ghi âm, sau đó có biên bản và việc đề xuất. |
| O2 | Máy ghi có thể là điện thoại của chủ trì, laptop mở web, hoặc thiết bị cố định của phòng họp. Cả ba đều phải chạy được. |
| O3 | Không cần hiện gì trong lúc họp; họp xong vài phút là có đủ biên bản và việc. |
| O4 | Biên bản chỉ để người trong nhóm đọc lại: dùng mẫu biên bản hiện có, không ký, không mẫu trang trọng. |

**Của người viết bản thiết kế (Claude), chủ sản phẩm sửa được**

| # | Quyết định | Lý do |
|---|---|---|
| D1 | **Ghi trong web app**, giao diện chạy được cả trên điện thoại. Không làm trong UniChat mobile. | Một bản cho cả ba loại máy (O2). App UniChat hiện chỉ có Chat; thêm phần họp là dự án riêng. |
| D2 | **Lưu trên máy trong lúc ghi, gửi lên khi Kết thúc.** Bản ghi cắt thành đoạn ngắn (vài giây) lưu ngay vào IndexedDB. Bấm Kết thúc thì ghép thành một `File` và gửi qua BIGUP có sẵn. Không gửi dần trong lúc họp. | BIGUP cần biết cỡ file khi mở phiên. Gửi dần cần một đường tải mới ở server. Lưu trên máy đã đủ cho G3. Bản ghi tiếng nói 60 phút chỉ vài chục MB, gửi vài chục giây trên Wi-Fi văn phòng, vẫn trong mục tiêu 10 phút. **Khác với lúc trao đổi**: tôi đã nói "gửi dần lên server". Rủi ro còn lại: máy hỏng hoặc mất trước khi gửi thì mất bản ghi. |
| D3 | **Một cột hình thức mới trên `meetings`** (online / trực tiếp, mặc định online). `meeting_type` hiện có là cách tạo (SCHEDULED/INSTANT), không phải hình thức. | Cần để ẩn phòng, bỏ link khỏi ICS và hiện đúng nút. |
| D4 | **Họp trực tiếp không mở phòng**: `Start` từ chối họp trực tiếp. Đổi hình thức chỉ khi cuộc họp còn `SCHEDULED`. | Không bao giờ tạo phòng LiveKit, PIN gọi vào hay link khách cho một cuộc họp không dùng chúng. |
| D5 | **Không thêm cờ mới.** Nút ghi âm theo capability `transcription` (cờ `meeting_transcription` + gói + nhà cung cấp). Lựa chọn hình thức không cần cờ: không có ghi âm thì họp trực tiếp vẫn dùng "Ghi nhận đã họp". | Ghi âm vô dụng khi không ghi lời được. Vẫn phải chờ thỏa thuận xử lý dữ liệu với AssemblyAI (spec cha §7.5) trước khi bật cho khách. |
| D6 | **Ai được ghi: người làm thư ký của cuộc họp** (`requireMeetingClerk`: chủ trì, admin workspace, người được giao thư ký). `RecordHeld` hôm nay chỉ cho chủ trì/admin, **mở rộng ra thư ký**. | Thư ký là người ghi chép trong họp trực tiếp. `RequestTranscription` đã cho thư ký. |
| D7 | **Server không biết "đang ghi".** Trong lúc ghi, cuộc họp vẫn `SCHEDULED`. Khi Kết thúc mới gọi `RecordHeld` với giờ bắt đầu và kết thúc ghi. | Không thêm trạng thái, không thêm sự kiện. Người khác mở trang lúc đang họp chỉ thấy cuộc họp đã lên lịch (O3: không cần hiện gì trong lúc họp). |
| D8 | **Tạm dừng không cắt file**: tắt track micro nên đoạn đó là im lặng. Mốc giờ trong biên bản vẫn đúng giờ thật, cả buổi chỉ một bộ "Người nói 1, 2…". Chỉ khi **bị ngắt** (mất micro, trình duyệt dừng thu) mới bắt đầu một phần mới. | Mỗi lần ghi lời một file có bộ nhãn người nói riêng (`upload:<transcription_id>:<nhãn>`), và file được đặt nối tiếp phần trước, không tính khoảng nghỉ. Cắt file mỗi lần tạm dừng sẽ bắt gán tên nhiều lần và làm lệch giờ. Đổi lại, tạm dừng lâu vẫn tính phút ghi lời (§9). |
| D9 | **Biên bản lập bằng một bấm**, ở bước cuối của Hoàn tất. Không tự lập. | Biên bản lấy điểm danh và tên người nói. Tự lập trước hai bước đó sẽ ra bản sai. Phần dữ kiện đã tự cập nhật sau khi lập (`meeting_minutes_refresh.go`). |
| D10 | **Bản ghi trên máy gắn với tài khoản và cuộc họp.** Chỉ người đã ghi thấy và gửi được. Xoá khỏi máy ngay khi server nhận vào hàng ghi lời, hoặc khi người ghi bấm Xoá. Đăng xuất khi còn bản chưa gửi thì cảnh báo trước. Đăng xuất (kể cả bị đăng xuất vì hết phiên, bị khoá tài khoản) **không xoá**: người đó đăng nhập lại trên máy này thì bản ghi hiện lại. | Thiết bị cố định của phòng họp do nhiều người dùng chung. Không mất bản ghi (phản mục tiêu) được đặt trên việc dọn máy. Rủi ro còn lại: âm thanh nằm trong bộ nhớ trình duyệt của máy dùng chung đến khi được gửi. Giao diện không cho người khác thấy, nhưng ai mở công cụ dành cho lập trình viên của trình duyệt vẫn đọc được. |
| D11 | **Họp trực tiếp ngay** tạo cuộc họp `SCHEDULED` hình thức trực tiếp, **không** mở phòng (đường họp ngay hôm nay tạo phiên phòng và chuyển `IN_PROGRESS` trong cùng transaction: họp trực tiếp bỏ hết phần đó), rồi mở màn hình chuẩn bị ghi. Lựa chọn Trực tiếp trong hộp thoại họp ngay chỉ hiện khi tổ chức có capability `transcription`. | `RecordHeld` chỉ nhận `SCHEDULED` (D7). Không có ghi âm thì một cuộc họp trực tiếp tạo ngay không làm được gì. |
| D12 | **Điểm danh họp trực tiếp mặc định là có mặt.** Gợi ý điểm danh hôm nay dựa vào giờ vào phòng online, nên với họp trực tiếp ai cũng thành vắng. Với họp trực tiếp, server gợi ý **có mặt** cho mọi người được mời. Chủ trì chỉ bỏ tích người vắng rồi chốt. Tỉ lệ có mặt và túc số tính theo điểm danh đã chốt như hiện nay. | Đúng với §4 bước 6. Ít thao tác nhất: mỗi người vắng là một bấm, thay vì mỗi người có mặt là một bấm. |
| D13 | **Tự tóm tắt chờ đủ các phần ghi.** Bản ghi bị ngắt có nhiều phần, gửi cùng lúc khi Kết thúc. Tự tóm tắt hoãn lại chừng nào cuộc họp còn một lần ghi lời đang chờ hoặc đang chạy, để tóm tắt và việc đề xuất phủ cả buổi. Một phần đến muộn sau khi đã có tóm tắt (ví dụ bản ghi chưa gửi được gửi hôm sau) không tự tóm tắt lại: chủ trì tóm tắt lại bằng tay như hiện nay. | Hôm nay tự tóm tắt chạy ngay khi phần đầu tiên xong và không bao giờ chạy lại, nên sẽ chỉ phủ phần 1. |

## 6. Thay đổi phía server

1. **Cột hình thức** trên `meetings` (D3): migration `ALTER TABLE ... ADD COLUMN ...
   NOT NULL DEFAULT ...` + CHECK hai giá trị. Tên theo `docs/conventions.md`. Đưa vào
   `CreateMeetingInput`, đường họp ngay (`CreateInstant*`), `Update` (chỉ khi
   `SCHEDULED`), SDI/SDO, diff audit của create/update và schema phía client.
2. **`Start` từ chối họp trực tiếp** (D4) bằng một mã lỗi có tên, theo cách các mã
   lỗi `coded(...)` khác làm. Không cấp PIN gọi vào hay luật SIP cho họp trực tiếp,
   nếu hiện chúng được cấp lúc tạo.
3. **Họp trực tiếp ngay** (D11): đường `CreateInstant*` với hình thức trực tiếp
   tạo cuộc họp `SCHEDULED`, không tạo phiên phòng, không `StartMeeting`, không
   đảm bảo phòng, thư ký AI hay gọi vào. Hình thức nằm trong dấu vân tay
   idempotency của route họp ngay.
4. **ICS** (`CalendarICS`, `server/internal/service/meeting_ai.go`): họp trực tiếp
   bỏ dòng "Gọi vào bằng điện thoại". Link tới trang cuộc họp giữ nguyên.
5. **`RecordHeld` cho thư ký** (D6): đổi `requireHostOrAdmin` thành `requireMeetingClerk`.
   Hành động audit giữ nguyên.
6. **Gợi ý điểm danh họp trực tiếp** (D12): `suggestAttendance` / chỗ gọi nó trả có
   mặt cho người được mời khi cuộc họp là trực tiếp. Báo cáo điểm danh, chốt và
   biên bản đọc từ đó như hiện nay.
7. **Tự tóm tắt chờ đủ phần** (D13): `runAutoSummary` hoãn (`deferAutoSummary` có
   sẵn) khi cuộc họp còn lần ghi lời `QUEUED`/`RUNNING`. Lần ghi lời hỏng hẳn không
   giữ tóm tắt lại.
8. **Giờ của phần ghi thứ hai trở đi** (chỉ khi bị ngắt, D8): hôm nay server đặt
   phần sau nối ngay sau phần trước (`MeetingTranscriptionFileStart`), nên khoảng
   bị ngắt bị bỏ qua và giờ phía sau lệch. Yêu cầu: mốc giờ trong biên bản đúng
   giờ thật. Người làm chọn cách (§9).

Không có route mới nếu mục 8 chỉ thêm một trường vào route sẵn có. Mọi trường
thêm vào body đi qua `TestEveryBodyIDFieldHasAReferenceCase` / ma trận cô lập như
thường lệ.

## 7. Thay đổi phía web

- **core** (`packages/core/meetings/`, `api/endpoints/`): trường hình thức trong
  schema cuộc họp và input tạo/sửa, kèm ca phản hồi hỏng. Hook mutation cho đổi
  hình thức nếu `Update` chưa có sẵn.
- **views** (`packages/views/meetings/`):
  - Lựa chọn hình thức ở form tạo và `instant-meeting-dialog.tsx` (ở hộp thoại họp
    ngay chỉ khi có `transcription`, D11; tạo xong thì mở màn hình chuẩn bị ghi).
  - Trang chi tiết họp trực tiếp: nút theo §4 bước 2, ẩn phần phòng và link mời khách.
  - **Màn hình ghi** (mới): chuẩn bị → đang ghi → kết thúc, như §4 bước 3–5. Dùng
    `MediaRecorder` (Chrome cho `audio/webm`, Safari cho `audio/mp4`, cả hai nằm
    trong `meetingAudioMIMETypes`), Screen Wake Lock, `beforeunload`,
    `visibilitychange`, sự kiện `ended`/`mute` của track.
  - Kho đoạn ghi trên máy (IndexedDB) và mục "Bản ghi chưa gửi" (§4 bước 7, D10).
  - Kết thúc: `useRecordMeetingHeld` → `useUploadMeetingRecording` với `File` ghép
    từ các đoạn, `consent: true` (đã hỏi ở bước chuẩn bị) và `durationSeconds` của
    bản ghi.
  - **Hoàn tất**: xếp các khối có sẵn thành chuỗi bước §4 bước 6. Phần lớn là
    sắp xếp và trạng thái từng bước, không viết lại các khối.
- **i18n**: khoá mới ở `vi.json` và `en.json`, giọng văn theo `docs/conventions.md`.
  Ít chữ, dùng icon và chip (màn hình ghi nhìn từ xa).

## 8. Ràng buộc từ repo

- Lớp và ranh giới package như `CLAUDE.md`: `views` không đụng `next/*`, `core`
  không dùng `localStorage`/`sessionStorage`/`react-dom`. Code dùng API trình duyệt
  (MediaRecorder, IndexedDB, Wake Lock) đặt ở chỗ hợp luật lint.
- Migration: không FK, `ADD COLUMN` có mặc định, theo `server/migrations/lint_test.go`.
- Mọi lệnh đổi trạng thái đã ghi audit + outbox. Các mục ở §6 chỉ đổi lệnh có
  sẵn, nên `audit_coverage_test.go` không thêm dòng, trừ khi người làm thêm lệnh.
- File `.ts/.tsx` ≤ 500 dòng. `meeting-recording-upload.tsx` đã 450 dòng: màn hình
  ghi là module riêng.
- Coverage chỉ tăng. Mỗi endpoint đổi có ca phản hồi hỏng.
- Bật cho khách ngoài nội bộ vẫn theo điều kiện pháp lý của cờ `meeting_transcription`.

## 9. Để người làm quyết

- Tên cột và giá trị hình thức, tên mã lỗi khi `Start` họp trực tiếp.
- Cách sửa giờ cho phần ghi sau khi bị ngắt (§6 mục 8). Ví dụ: `RequestTranscription`
  nhận thêm giờ bắt đầu thật của phần đó (kiểm nằm trong giờ họp thật), hoặc cách
  khác cho cùng kết quả.
- Bitrate ghi (tiếng nói: khoảng 32–64 kbit/s là đủ), độ dài mỗi đoạn lưu IndexedDB,
  định dạng theo trình duyệt.
- Tạm dừng rất lâu (ví dụ nghỉ trưa): giữ im lặng (tốn phút ghi lời) hay tự cắt
  thành phần mới sau một ngưỡng.
- Đồng hồ máy ghi lệch giờ: `RecordHeld` từ chối giờ kết thúc ở tương lai quá 1
  phút. Ví dụ: tính giờ bắt đầu bằng giờ server lúc Kết thúc trừ độ dài bản ghi.
- Hai máy cùng bấm ghi một cuộc họp (ngoài phạm vi, nhưng không được hỏng): máy
  thứ hai kết thúc khi cuộc họp đã `ENDED` thì bỏ qua `RecordHeld` và chỉ gửi file.
- Màn hình ghi là route riêng hay lớp phủ trên trang cuộc họp.
- Chia đợt. Gợi ý: (1) hình thức họp, server + web + ICS, tự nó đã có ích;
  (2) màn hình ghi, lưu trên máy, kết thúc và gửi, `RecordHeld` cho thư ký;
  (3) chuỗi Hoàn tất và sửa giờ phần ghi bị ngắt.

## 10. Kiểm thử

- **Go**: tạo/sửa họp trực tiếp, đổi hình thức sau `SCHEDULED` bị từ chối; `Start`
  họp trực tiếp bị từ chối; họp trực tiếp ngay ở lại `SCHEDULED`, không có phiên
  phòng; ICS họp trực tiếp không có dòng gọi vào; thư ký gọi `RecordHeld` được,
  thành viên thường không; điểm danh họp trực tiếp chốt ra có mặt khi không ai
  bỏ tích; hai phần ghi chỉ cho một tóm tắt tự tạo sau khi cả hai xong; cách sửa
  giờ ở §6 mục 8.
- **core**: schema với trường hình thức, ca phản hồi hỏng.
- **views**: máy trạng thái màn hình ghi với `MediaRecorder` giả (bắt đầu, tạm
  dừng, bị ngắt, kết thúc); không bắt đầu được khi chưa xác nhận đã báo; kết thúc
  gọi `RecordHeld` rồi tải lên; bản ghi chưa gửi hiện lại sau khi tải lại trang và
  bị xoá sau khi gửi xong; người khác trên cùng máy không thấy.
- **e2e**: Chromium với micro giả (`--use-fake-device-for-media-stream`): tạo họp
  trực tiếp, ghi vài giây, kết thúc, thấy "Đang xử lý bản ghi". CI không có nhà
  cung cấp ghi lời, nên dừng ở hàng chờ.
- **Thử tay trước khi bật**: một buổi họp thật 60 phút trên iPhone Safari, Android
  Chrome và laptop. Đo thời gian từ Kết thúc tới khi có biên bản nháp. Thử khoá
  máy, tắt Wi-Fi giữa buổi, đóng tab rồi mở lại.
