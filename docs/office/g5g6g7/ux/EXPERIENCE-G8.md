---
name: UniWork Office — G8 collaboration and sign-in linking surfaces
status: draft
updated: 2026-10-13
sources:
  - ../../../superpowers/specs/2026-10-13-office-g8-collab-addendum.md
  - ../../../superpowers/plans/2026-10-12-office-g5-g6-g7.md
  - EXPERIENCE.md
design: DESIGN.md
---

# UniWork Office G8 — Experience Spine (draft)

Spine này là hợp đồng hành vi cho bề mặt UI của G8 (UNI-1331 bình luận, Discussion, mention, Inbox; UNI-1328 liên kết sau
đăng nhập). Nó **nối tiếp** [EXPERIENCE.md](EXPERIENCE.md) (G5/G6/G7, `final`): mọi luật chung ở đó (Foundation, Voice and
Tone, Accessibility Floor › Chung + Vùng live, String catalogue › Số đếm, 21 locale) áp nguyên cho G8 và không chép lại.
Mọi `§` trỏ vào [phụ lục G8](../../../superpowers/specs/2026-10-13-office-g8-collab-addendum.md); mã task trỏ vào plan §5.7.
Trạng thái `draft`: planner r2 (2026-10-13) viết Foundation G8, IA, Accessibility Floor G8 và đầy đủ S16–S18; G8-09 hoàn tất
S12–S15 (bảng chuỗi đầy đủ, mockup) và Advisor duyệt thay người dùng theo ủy quyền.

## Foundation G8

- **Một panel mỗi host (phụ lục bất biến 8 — nguồn duy nhất của luật này).**

  | Host | Tình huống | Panel bình luận (S12) | Panel Discussion (S13) | `?comment=` / mở từ Inbox |
  | --- | --- | --- | --- | --- |
  | Web | Frame editor đang mở và `init` có capability `comments` | Panel của frame (G8-12..15) | Panel của frame (G8-11) | Host gửi `comments.reveal {comment_id}`; host **không** vẽ `DocumentCommentsPanel` |
  | Web | Trang tài liệu không có frame (chưa mở, định dạng không có module, frame cũ không khai `comments`) | Panel D (G8-10), tab Bình luận | Panel D, tab Thảo luận | Panel D mở đúng tab, cuộn + focus thread |
  | Desktop | Tài liệu bind UniWork, đã đăng nhập | Panel của editor (S12) | Panel Discussion của shell (S13), một cho mọi app | Vé launch có `comment_id` → `comments.reveal` sau khi editor sẵn sàng |
  | Desktop | Tệp cục bộ / chưa đăng nhập | Panel bình luận gốc của fork (hành vi cũ, tác giả `"User"`) | Không có | — |

  Không host nào vẽ hai composer cho cùng một luồng. Markdown/HTML: chỉ Discussion.
- **Thay đổi có tên trong fork cho G8 (danh sách duy nhất; nối tiếp danh sách của EXPERIENCE.md › Foundation).**
  `packages/ui/src/collab/*` + `strings-collab-*.ts` (mới, G8-20); `apps/docs/src/renderer/{CommentsPanel.tsx,review-actions.ts,file-actions.ts,editor/comments.ts,ai/comment-ops.ts}`;
  `apps/sheets/src/renderer/{ThreadedCommentsPane.tsx,threaded-comments.ts}`; `apps/slides/src/renderer/CommentsPane.tsx`;
  `apps/pdf/src/renderer/NoteMargin.tsx`; `apps/{slides,pdf,sheets}/src/main/*` (nguồn tác giả, G8-02); preload của sáu app
  (`uniworkComments.*`); `apps/shell/src/main/uniwork-docs/{comments,client,service}.ts`, `uniwork-auth/{index,manager,transport}.ts`,
  handler deep link; `apps/shell/src/renderer/src/` panel Discussion cạnh `UniworkChrome.tsx`, `AccountPane.tsx`,
  `UniworkOpenDialog.tsx`, `uniwork-docs-model.ts`; `web/docs/protocol/*`; `web/modules/shared/` (panel frame). Reviewer fork
  từ chối file ngoài danh sách này trong PR G8. G8-09 sửa danh sách khi tên file thật khác (ghi lý do).
- **Nội dung bình luận:** phụ lục §4.2 (Markdown con + mention token; chip lấy tên hiện tại theo id).
- **Đồng bộ:** web theo realtime; desktop tải lại khi focus và mỗi 30 s chỉ khi tab hiển thị và panel mở (phụ lục §4.7).
  Tải lại không đổi focus, không phá composer.
- **AI:** chỉ đề xuất bản nháp trong composer; người bấm Gửi (phụ lục bất biến 7). Bản nháp từ AI mang nhãn
  `collabAiDraftLabel` tới khi người dùng sửa hoặc gửi.
- **Vị trí chuỗi:** component dùng chung → `packages/ui/src/strings-collab-*.ts` (21 locale); shell (S13 desktop, S16–S18) →
  `apps/shell/src/renderer/src/i18n/uniwork-documents/*`; web D (panel D, S15) → `packages/core/i18n/locales/{vi,en}/`
  (D chỉ có vi/en). Số đếm: một khóa trung tính với số (EXPERIENCE › String catalogue › Số đếm).

## Information Architecture

| # | Bề mặt | Host | Mở từ | Mục đích | Phụ lục |
| --- | --- | --- | --- | --- | --- |
| S12 | Panel bình luận theo editor (chế độ server) | Web frame + desktop; web không frame: panel D | Nút bình luận của editor; chọn vùng → "Bình luận"; `comments.reveal` | Comment có neo: tạo, trả lời, sửa, xóa, resolve, mở lại; mục "Bình luận trong tệp" chỉ đọc | §4.1–§4.3 |
| S13 | Panel Discussion | Shell desktop + frame web; web không frame: tab của panel D | Nút "Thảo luận" ở thanh tài liệu | Một Discussion mỗi tài liệu, mọi định dạng | §4.1 |
| S14 | Picker mention | Trong composer của S12/S13 | Gõ `@` | Chọn người đọc được tài liệu | §4.2, §4.5 |
| S15 | Màn hình mở từ Inbox | Web (trang tài liệu); desktop qua vé launch | Thông báo Inbox / push | Mở đúng tài liệu + thread + vị trí, hoặc trạng thái ngoại lệ UNI-1389 | §4.6 |
| S16 | Chọn tổ chức sau đăng nhập + khóa theo tổ chức | Desktop (shell) | Đăng nhập thành công với >1 tổ chức chưa chọn; Cài đặt › Tài khoản | Chọn tổ chức làm việc; giải thích khi bị vô hiệu/tạm ngưng | — (UNI-1328/1329) |
| S17 | Thư viện UniWork: "Được chia sẻ với tôi" + bảng thuộc tính | Desktop (`UniworkOpenDialog`) | Mở từ UniWork | Duyệt tài liệu có quyền, xem chủ sở hữu, quyền, phiên bản | — (UNI-1330) |
| S18 | Tạo / đổi tên / lưu trữ từ app | Desktop (`UniworkOpenDialog`, menu tài liệu) | Nút "Tài liệu mới", menu "…" của hàng | Thao tác trên đúng tài liệu UniWork, không bản sao | — (UNI-1330) |

→ Mockup (G8-09): `mockups/collab.html` (S12–S15), `mockups/account-library.html` (S16–S18). Spine thắng khi lệch.

## State Patterns

### S12 / S13 — trạng thái panel (khung; G8-09 hoàn tất chuỗi)

| Trạng thái | Hành vi | Khóa (G8-09 điền vi/en) |
| --- | --- | --- |
| Đang tải lần đầu | Khung xương; không composer | `collabLoading` |
| Rỗng | Câu mời; composer hiện nếu được viết | `collabEmptyComments`, `collabEmptyDiscussion` |
| Danh sách | Thread theo thứ tự neo (S12) hoặc thời gian (S13); thread đã resolve gom cuối, mở được | — |
| Neo `stale` | Nhãn vị trí + chữ "Vị trí có thể đã thay đổi" (không chỉ màu) | `collabAnchorStale` |
| Neo `lost` | Thread vẫn đọc được; nhãn "Nội dung đã bị xoá"; reveal chỉ mở thread | `collabAnchorLost` |
| Comment/thread đã xóa có phản hồi | Khung "Nội dung đã bị xoá", không nút trả lời ở khung | `collabDeleted` |
| Chỉ xem (`view`) | Đọc được; không composer; dòng phụ "Bạn chỉ có quyền xem" | `collabViewOnly` |
| Server không khả dụng | Panel chỉ đọc với dữ liệu đã có; composer giữ nháp, nút Gửi `aria-disabled` + lý do | `collabOffline` |
| Thread đích bị xóa khi đang soạn | Composer giữ văn bản, báo "Bình luận này đã bị xóa.", nút "Sao chép nội dung" | `collabTargetDeleted`, `collabCopyDraft` |
| Bình luận trong tệp (chỉ đọc) | Mục thu gọn cuối panel; không sửa/trả lời | `collabInFileSection` |

Nhãn neo là **một khóa có placeholder** cho mỗi định dạng: `collabAnchorDocx` ("Đoạn: “{quote}”"), `collabAnchorCell`
("Ô {cell}" — `{cell}` gồm cả tên sheet khi khác sheet đang mở), `collabAnchorSlide` ("Slide {slide}"), `collabAnchorPage`
("Trang {page}"); không ghép chuỗi theo thứ tự tiếng Việt.

### S14 — picker mention (khung)

Combobox APG (xem Accessibility Floor G8). Trạng thái: đang tìm (`collabMentionSearching`), không có kết quả
(`collabMentionEmpty`), lỗi (`collabMentionError`, thử lại). Chỉ liệt kê người đọc được tài liệu (G8-06). Mention người chưa
có quyền: phác ở G8-18 khi G8-D3 ký.

### S15 — mở từ Inbox (ngoại lệ UNI-1389)

| Trường hợp | Hiển thị (vi) | en | Khóa |
| --- | --- | --- | --- |
| Neo không còn | Mở thread ở chế độ xem nội dung, không định vị; không mở comment khác | — | (dùng `collabAnchorLost`) |
| Tài liệu không còn | Tài liệu không còn tồn tại hoặc đã bị xóa. | This document no longer exists or was deleted. | `inboxDocGone` |
| Comment đã xóa | Bình luận này đã bị xóa. | This comment was deleted. | `inboxCommentDeleted` |
| Mất quyền | Bạn không có quyền truy cập tài liệu này. | You don’t have access to this document. | `inboxDocNoAccess` |
| Phiên hết hạn | Màn hình đăng nhập lại, sau đó quay lại link | — | (luồng đăng nhập sẵn có) |
| Thread đã xóa | Cuộc thảo luận này đã bị xóa. | This discussion was deleted. | `inboxThreadDeleted` |

Câu ngoại lệ là thông điệp trang (heading + nút "Về Inbox"), focus vào heading khi hiện. Comment đã resolve vẫn mở được.

### S16 — chọn tổ chức sau đăng nhập

| Trạng thái | Hành vi |
| --- | --- |
| Một tổ chức | Không có bước chọn; vào thư viện |
| >1 tổ chức, chưa chọn | Màn hình chọn ngay sau đăng nhập; danh sách tổ chức (tên, vai trò của tôi); không gọi API của tổ chức nào trước khi chọn; nút "Tiếp tục" `aria-disabled` tới khi chọn |
| Đã chọn trước đó | Không hỏi lại; dùng tổ chức đã nhớ (theo tài khoản + máy) |
| Tổ chức đã nhớ không còn (rời/bị xóa) | Hiện lại bước chọn với dòng `uwOrgPickRememberedGone` |
| Hàng tổ chức bị tạm ngưng / tôi bị vô hiệu | Hàng hiện nhưng không chọn được (`aria-disabled` + lý do); chọn được hàng khác |
| Mọi tổ chức đều khóa | Panel khóa: tiêu đề `uwLockOrgTitle` (sẵn có) + câu `uwOrgAllBlocked` + nút Đăng xuất |
| Đổi tổ chức | Cài đặt › Tài khoản › "Tổ chức làm việc" (không có menu tài khoản, OQ-UX7); đổi xong thư viện tải lại; tab tài liệu của tổ chức cũ giữ nguyên tới khi đóng |
| Lỗi tải danh sách | Câu `uwOrgPickError` + "Thử lại" |

### S17 — thư viện UniWork: "Được chia sẻ với tôi" và thuộc tính

| Phần | Hành vi |
| --- | --- |
| Mục "Được chia sẻ với tôi" | Mục mới cạnh danh sách workspace; liệt kê tài liệu được chia sẻ trực tiếp (route `shared-with-me` sẵn có); rỗng → `uwLibSharedEmpty` |
| Danh sách workspace | Tên + vai trò của tôi (`uwLibWsRole`) |
| Bảng thuộc tính | Mở bằng nút "Thông tin" của hàng hoặc tab đang mở; trường: chủ sở hữu, người tạo + thời gian, người cập nhật + thời gian, quyền của tôi (`my_level` → nhãn), phiên bản hiện tại + người cập nhật; trường thiếu từ server hiện "—" |
| Mất quyền khi đang xem | Hàng biến mất ở lần tải sau; tab đang mở theo S11 (EXPERIENCE) |

### S18 — tạo, đổi tên, lưu trữ

| Thao tác | Hành vi |
| --- | --- |
| Tài liệu mới | Hộp thoại: tên (bắt buộc), loại (DOCX/XLSX/PPTX), nơi lưu (workspace/thư mục); tạo xong mở tab theo id; không tạo bản sao cục bộ thứ hai |
| Tải lên | Chọn tệp → nơi lưu; tiến trình theo pattern Progress của EXPERIENCE |
| Đổi tên | Sửa tại chỗ trong hàng hoặc hộp thoại; Enter lưu, Esc hủy; tên rỗng/trùng → lỗi tại trường (`uwDocNameEmpty`, `uwDocNameTaken`) |
| Lưu trữ / khôi phục | Menu "…"; lưu trữ có xác nhận một bước; không có "Xóa vĩnh viễn" trong app |
| Quyền `view` | Mục thao tác không hiện (không phải `aria-disabled`: người xem không có hành động này) |
| Đổi tên ở nơi khác | Tiêu đề tab đổi ở lần làm mới metadata (feed hoặc khi focus); câu polite `uwDocRenamedAnnounce` |
| Lỗi server | Toast lỗi + thao tác không áp; tên trong hàng trở về tên cũ |

## Accessibility Floor G8

Bổ sung Accessibility Floor của EXPERIENCE.md (luật chung, vùng live cố định, `aria-disabled`, vùng chạm áp nguyên).

- **S12/S13 panel:** `aside` có `aria-labelledby` = tiêu đề panel; danh sách thread là `role=list`, mỗi thread `role=listitem`
  với tên = tác giả + nhãn neo + trạng thái. Nhãn neo `stale`/`lost` và "đã resolve" có chữ, không chỉ màu/biểu tượng.
- **Focus:** mở từ `comments.reveal` hoặc `?comment=` → focus vào thread đích (heading của thread, `tabindex=-1`), editor không
  mất vùng chọn neo; `comments.changed` và tải lại định kỳ **không** di chuyển focus và không cướp focus khỏi editor/composer.
  Danh sách tải lại có thay đổi → câu polite `collabUpdatedAnnounce` một lần (vùng live của cửa sổ). Đóng panel → focus về nút mở.
- **Composer:** `textarea`/editor có nhãn; Gửi = Ctrl/⌘+Enter, Esc đóng picker trước rồi mới hủy composer (hủy có nháp thì
  hỏi). Nút Gửi bận/không chạy dùng `aria-disabled` + lý do.
- **S14 picker:** combobox APG — ô nhập `role=combobox` `aria-expanded` `aria-controls` → `role=listbox`, `aria-activedescendant`;
  ↑↓ di chuyển, Enter chọn, Esc đóng (giữ chữ đã gõ). Kết quả đếm đọc qua vùng polite (`collabMentionCount`, một khóa trung tính).
- **Phím tắt:** mở panel bình luận Ctrl/⌘+Alt+M (chốt ở G8-09 sau khi đối chiếu phím tắt sẵn có của từng editor); phím tắt
  không ghi đè phím của editor.
- **S15:** heading ngoại lệ nhận focus khi trang tải; nút "Về Inbox" là điểm Tab đầu tiên sau heading.
- **S16:** danh sách tổ chức là radio group (`role=radiogroup`, mũi tên đổi lựa chọn); hàng khóa `aria-disabled` + `aria-describedby`
  lý do; focus đầu vào hàng đầu tiên chọn được.
- **S17:** bảng thuộc tính là `dl` trong dialog không modal hoặc panel bên, `aria-labelledby` = tên tài liệu.
- **S18:** hộp thoại modal theo pattern dialog của fork (focus trap, Esc hủy, focus trả về nút mở); lỗi trường qua
  `aria-invalid` + `aria-describedby`.
- **Vùng chạm:** nút trong panel, hàng thread, mục picker ≥ 24px, ≥ 44px khi `pointer: coarse`.

## String catalogue G8 (vi / en)

S12–S15: G8-09 điền đủ các khóa nêu ở State Patterns (bảng S15 ở trên đã có câu vi/en theo UNI-1389). S16–S18 (shell,
`uniwork-documents`), 19 locale còn lại dịch máy có review theo EXPERIENCE › Ngôn ngữ:

| Khóa | vi | en |
| --- | --- | --- |
| `uwOrgPickTitle` | Chọn tổ chức để làm việc | Choose an organization |
| `uwOrgPickBody` | Tài khoản của bạn thuộc nhiều tổ chức. Bạn có thể đổi sau trong Cài đặt › Tài khoản. | Your account belongs to several organizations. You can change this later in Settings › Account. |
| `uwOrgPickRole` | Vai trò: {role} | Role: {role} |
| `uwOrgPickContinue` | Tiếp tục | Continue |
| `uwOrgPickRememberedGone` | Tổ chức bạn chọn lần trước không còn khả dụng. Hãy chọn lại. | The organization you chose last time is no longer available. Choose again. |
| `uwOrgRowSuspended` | Tổ chức đang bị tạm ngưng | The organization is suspended |
| `uwOrgRowDeactivated` | Tài khoản của bạn đã bị vô hiệu hóa trong tổ chức này | Your account is deactivated in this organization |
| `uwOrgAllBlocked` | Bạn chưa thể làm việc ở tổ chức nào. Hãy liên hệ quản trị viên. | You can’t work in any organization yet. Contact your admin. |
| `uwOrgPickError` | Không tải được danh sách tổ chức. | Couldn’t load your organizations. |
| `uwOrgSettingsLabel` | Tổ chức làm việc | Working organization |
| `uwLibShared` | Được chia sẻ với tôi | Shared with me |
| `uwLibSharedEmpty` | Chưa có tài liệu nào được chia sẻ trực tiếp với bạn. | Nothing has been shared with you directly yet. |
| `uwLibWsRole` | {workspace} · {role} | {workspace} · {role} |
| `uwDocInfo` | Thông tin | Details |
| `uwDocInfoOwner` / `uwDocInfoCreated` / `uwDocInfoUpdated` / `uwDocInfoMyAccess` / `uwDocInfoVersion` | Chủ sở hữu / Tạo / Cập nhật / Quyền của tôi / Phiên bản | Owner / Created / Updated / My access / Version |
| `uwDocInfoByAt` | {name}, {time} | {name}, {time} |
| `uwDocNew` | Tài liệu mới | New document |
| `uwDocUpload` | Tải lên | Upload |
| `uwDocName` / `uwDocType` / `uwDocLocation` | Tên / Loại / Nơi lưu | Name / Type / Location |
| `uwDocRename` | Đổi tên | Rename |
| `uwDocArchive` / `uwDocRestore` | Lưu trữ / Khôi phục | Archive / Restore |
| `uwDocArchiveConfirm` | Lưu trữ “{name}”? Bạn có thể khôi phục sau. | Archive “{name}”? You can restore it later. |
| `uwDocNameEmpty` | Hãy nhập tên tài liệu. | Enter a document name. |
| `uwDocNameTaken` | Đã có tài liệu cùng tên ở đây. | A document with this name already exists here. |
| `uwDocRenamedAnnounce` | Tài liệu đã được đổi tên thành {name}. | The document was renamed to {name}. |
| `uwDocActionFailed` | Không thực hiện được. Hãy thử lại. | That didn’t work. Try again. |

Nhãn quyền `my_level` dùng lại khóa sẵn có của thư viện nếu có (G8-16 kiểm), không thì thêm `uwAccessView`/`uwAccessEdit`/
`uwAccessManage` (Xem / Chỉnh sửa / Quản lý — View / Edit / Manage).

## Open questions

Không có câu nào chặn S16–S18. Phím tắt mở panel (Accessibility Floor G8) chốt ở G8-09. Thông điệp mention người chưa có quyền:
G8-18 khi G8-D3 ký.
