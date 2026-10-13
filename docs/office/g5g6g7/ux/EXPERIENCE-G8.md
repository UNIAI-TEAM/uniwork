---
name: UniWork Office — G8 collaboration and sign-in linking surfaces
status: final
updated: 2026-10-13
sources:
  - ../../../superpowers/specs/2026-10-13-office-g8-collab-addendum.md
  - ../../../superpowers/plans/2026-10-12-office-g5-g6-g7.md
  - ../contract-collab.md
  - EXPERIENCE.md
design: DESIGN.md
---

# UniWork Office G8 — Experience Spine

Spine này là hợp đồng hành vi cho bề mặt UI của G8 (UNI-1331 bình luận, Discussion, mention, Inbox; UNI-1328 liên kết sau
đăng nhập). Nó **nối tiếp** [EXPERIENCE.md](EXPERIENCE.md) (G5/G6/G7, `final`): mọi luật chung ở đó (Foundation, Voice and
Tone, Accessibility Floor › Chung + Vùng live, String catalogue › Số đếm, 21 locale) áp nguyên cho G8 và không chép lại.
Mọi `§` trỏ vào [phụ lục G8](../../../superpowers/specs/2026-10-13-office-g8-collab-addendum.md); "hợp đồng mục n" trỏ vào
[contract-collab.md](../contract-collab.md); mã task trỏ vào plan §5.7.
Trạng thái `final`: người dùng ký G8-09 theo khuyến nghị (2026-10-13): không phím tắt panel ở v1, panel web D không tạo
bình luận gốc, chữ S12/S13 trung tính, S15 phân biệt theo `params.kind`, các đổi chữ D giao G8-10. Lịch sử: planner r2 (2026-10-13) viết Foundation G8, IA, Accessibility Floor G8 và đầy đủ S16–S18; G8-09
(2026-10-13) hoàn tất S12–S15 (bảng trạng thái, chuỗi vi/en, định dạng khóa), sửa danh sách file fork theo cây fork
`origin/main` `63cd2771`, chốt phím tắt và đóng mọi câu hỏi mở; bản vá catalogue (2026-10-13) thêm các khóa mà mockup S16–S18
phải tự đặt, ghi rõ khóa sẵn có được dùng lại và bên sở hữu, và ghi điều gì ràng buộc khi spine lệch bản G8-16 đã ship; bản vá review r1 (2026-10-13) đối chiếu danh sách file với đầu nhánh G8-08/G8-16/G8-17, đưa chữ dùng chung S12/S13 về trung tính, chốt tab Bình luận chỉ cho định dạng neo được và quyết định từng khóa `documents.comments.*`. Người dùng đã ký (packet-G8-09, mục Decisions). Bản vá FD-01 (UNI-1461, 2026-10-13, sau khi người dùng ký FD-D10 = a của UNI-1425): S18 bỏ ca tên trùng cho tài liệu, `uwDocNameTaken` không còn dùng cho tài liệu, mockup `account-library.html` bỏ hai khung S18 "tên trùng"; tên quá 500 là lỗi tại trường `uwDocNameTooLong` (khóa của G8-17 đã ship, fork main `404d820c`; sửa sau review FE FD-01 r1); lane G8-09 đã đóng nên FD-01 mang bản vá này.
Chính tả: chữ UI mới viết "xóa" (`docs/conventions.md`, hợp đồng › Chính tả).

## Foundation G8

- **Một panel mỗi host (phụ lục bất biến 8 — nguồn duy nhất của luật này).**

  | Host | Tình huống | Panel bình luận (S12) | Panel Discussion (S13) | `?comment=` / mở từ Inbox |
  | --- | --- | --- | --- | --- |
  | Web | Frame editor đang mở và `init` có capability `comments` | Panel của frame (G8-12..15) | Panel của frame (G8-11) | Host gửi `comments.reveal {comment_id}`; host **không** vẽ `DocumentCommentsPanel` |
  | Web | Trang tài liệu không có frame (chưa mở, định dạng không có module, frame cũ không khai `comments`) | Panel D (G8-10), tab Bình luận — **chỉ** với định dạng neo được (docx, xlsx, pptx, pdf); định dạng khác không có tab này | Panel D, tab Thảo luận | Panel D mở đúng tab, cuộn + focus thread |
  | Desktop | Tài liệu bind UniWork, đã đăng nhập | Panel của editor (S12) | Panel Discussion của shell (S13), một cho mọi app | Vé launch có `comment_id` → `comments.reveal` sau khi editor sẵn sàng |
  | Desktop | Tệp cục bộ / chưa đăng nhập | Panel bình luận gốc của fork (hành vi cũ, tác giả `"User"`) | Không có | — |

  Không host nào vẽ hai composer cho cùng một luồng. **Tab Bình luận chỉ tồn tại cho định dạng neo được (docx, xlsx, pptx, pdf).** Mọi định dạng khác
  (Markdown, HTML và định dạng không có module frame) chỉ có Discussion: panel D không tablist, một vùng duy nhất `collabDiscussion`. Lý do:
  bình luận có neo cần editor; định dạng không có editor trên web thì tab Bình luận không bao giờ có nội dung và câu giải thích sẽ trỏ tới một trình soạn thảo không có.
- **Thay đổi có tên trong fork cho G8 (danh sách duy nhất; nối tiếp danh sách của EXPERIENCE.md › Foundation).** Đối chiếu
  với cây fork `origin/main` `63cd2771` (2026-10-13); "(mới)" = file chưa có trên `main`, task ghi bên cạnh tạo nó. Reviewer fork
  từ chối file ngoài danh sách này trong PR G8 (test của chính các file được phép).

  | Nhóm | File | Task |
  | --- | --- | --- |
  | Component dùng chung | `packages/ui/src/collab/*` (mới), `packages/ui/src/strings-collab-panel.ts` + `strings-collab-mention.ts` (mới) | G8-20 |
  | Docs | `apps/docs/src/renderer/components/CommentsPanel.tsx`, `review-actions.ts`, `file-actions.ts`, `editor/comments.ts`, `editor/marks.ts`, `ai/comment-ops.ts` (cùng thư mục `apps/docs/src/renderer/`) | G8-12 |
  | Sheets | `apps/sheets/src/renderer/{ThreadedCommentsPane.tsx,threaded-comments.ts,threaded-comment-actions.ts,threaded-comment-marker.ts}` | G8-13 |
  | Slides | `apps/slides/src/renderer/components/CommentsPane.tsx` | G8-14 |
  | PDF | `apps/pdf/src/renderer/{NoteMargin.tsx,note-threads.ts,note-margin-layout.ts}` | G8-15 |
  | Nguồn tác giả (đã vào `main`) | `apps/slides/src/main/electron-host-io.ts`, `apps/pdf/src/main/pdf-main.ts`, `apps/sheets/src/main/{sheets-main.ts,comment-author.ts}`, `apps/{docs,sheets,slides,pdf}/src/renderer/comment-author.ts` | G8-02 |
  | Cầu desktop | preload sáu app `apps/{docs,sheets,slides,pdf,markdown,html}/src/preload/index.ts`; `packages/electron-utils/src/{comments-bridge,comments-ipc,comments-poll,comments-reply}.ts` (mới) + `packages/electron-utils/src/index.ts` + `packages/electron-utils/package.json`; `apps/docs/vitest.config.ts` (alias ba mô-đun `comments-*` mới cho test); `apps/shell/src/main/uniwork-docs/{comments,comments-wiring}.ts` (mới), `{service,parse,wiring,launch}.ts`; `apps/shell/src/main/index.ts` | G8-08 |
  | Liên kết sau đăng nhập | `apps/shell/src/main/uniwork-auth/{index,manager,transport,mapping,session-core}.ts`, `apps/shell/src/main/uniwork-docs/{client,service,parse,wiring}.ts` (`service`, `parse`, `wiring` cũng ở hàng Cầu desktop: G8-16/G8-17 thêm IPC thư viện vào đó), `apps/shell/src/preload/index.ts`, `apps/shell/src/shared/home-api.ts`; renderer `apps/shell/src/renderer/src/{AccountPane.tsx,AccountEntry.tsx,OrgChoiceStep.tsx,UniworkDocInfoPanel.tsx,UniworkOpenDialog.tsx,uniwork-docs-model.ts,uniwork-library-api.ts,home.css,settings.css}` (mới: `OrgChoiceStep.tsx`, `UniworkDocInfoPanel.tsx`, `uniwork-library-api.ts`); chỉ G8-17: `apps/shell/src/renderer/src/UniworkDocActions.tsx` (mới, hộp thoại và menu "…" của S18) + `apps/shell/src/renderer/src/UniworkChrome.tsx` (chỉ nối menu tài liệu tới các thao tác đó); chỉ G8-17, main process: `apps/shell/src/main/uniwork-docs/strings.ts` (chuỗi hộp chọn tệp tải lên của S18) + `apps/shell/src/main/uniwork-sync/{feed/consumer,runtime}.ts` (thông báo đổi mới từ feed cho thư viện: `feed/consumer.ts` nhận sự kiện, `runtime.ts` chuyển tới renderer) | G8-16, G8-17 |
  | Panel Discussion | `apps/shell/src/renderer/src/UniworkDiscussionPanel.tsx` (mới, cạnh `UniworkChrome.tsx`; `UniworkChrome.tsx` chỉ thêm nút mở — G8-17 cũng sửa file này, xem hàng Liên kết sau đăng nhập); `web/modules/shared/collab/*` (mới, panel frame) + `web/modules/shared/capabilities.ts` | G8-11 |
  | Protocol | `web/docs/protocol/{types,endpoint,host,client}.ts` + `web/docs/protocol/README.md` + `web/docs/protocol/test/*`; `web/docs/bridge/testing/mock-port.ts` + `web/docs/bridge/tsconfig.json` (mock port và cấu hình kiểu của bridge chạm hợp đồng mới) | G8-08 |
  | Shard i18n (chỉ khóa G8 của chính lane) | `apps/{docs,sheets,slides,html}/src/renderer/i18n/app/*`; `apps/slides/src/renderer/i18n/panes/*` (chuỗi bình luận của Slides nằm ở đây; G8-02 đã có `paneCommentsNeutralAuthor`, G8-14 chỉ thêm khóa vào đây); `apps/pdf/src/renderer/i18n/strings.ts`; `apps/shell/src/renderer/src/i18n/uniwork-documents/*`; `web/modules/shared/i18n/web/*` + `strings-web.ts` | G8-02, G8-11, G8-14, G8-16, G8-17 |

  File test và fixture của chính lane (`**/tests/**`, `**/test/**`, `*.test.ts`, `web/docs/bridge/testing/*`) không phải liệt kê từng
  file: reviewer cho qua khi chúng kiểm đúng file được phép. Cách đối chiếu trước khi mở PR: `git diff --name-only origin/main...<head>`,
  mọi file không phải test phải nằm trong bảng (đã chạy cho đầu nhánh G8-08, G8-16, G8-17 khi sửa spine này).
  Bảng được đối chiếu với các đầu nhánh lane sau (13-10-2026): G8-08 `7e082de3`, G8-16 `04bc9a66` và `c5984155`, G8-17 `3468e971`; file nào một lane thêm sau các đầu nhánh này thì chính lane đó thêm vào bảng, kèm lý do, trong PR của mình — reviewer fork chặn theo bảng tại merge-base của PR.

  Tên đã sửa so với bản r2 (lý do một dòng):
  - `apps/docs/src/renderer/CommentsPanel.tsx` → `apps/docs/src/renderer/components/CommentsPanel.tsx`: file nằm trong `components/`.
  - `apps/slides/src/renderer/CommentsPane.tsx` → `apps/slides/src/renderer/components/CommentsPane.tsx`: file nằm trong `components/`.
  - `apps/{slides,pdf,sheets}/src/main/*` → tên file cụ thể: G8-02 đã vào `main` và đặt hằng tác giả ở `comment-author.ts` (main của
    sheets, renderer của bốn app) cạnh ba file main đã có; glob `*` cho phép mọi file main là quá rộng cho cổng reviewer.
  - "handler deep link" → `apps/shell/src/main/uniwork-docs/launch.ts` + `apps/shell/src/main/index.ts`: vé launch được đọc ở
    `launch.ts` và nối ở `index.ts` (G8-08 sửa đúng hai file này).
  - Thêm `packages/electron-utils/src/comments-*.ts` và `uniwork-docs/comments-wiring.ts`: G8-08 đặt cầu IPC dùng chung của sáu
    preload trong `electron-utils` (một bản thay vì sáu) và tách phần nối khỏi `comments.ts`.
  - Thêm `uniwork-docs/{parse,wiring}.ts`: G8-08 và G8-16 đọc trường mới của server ở `parse.ts` và nối IPC ở `wiring.ts`.
  - Thêm `uniwork-auth/{mapping,session-core}.ts`, `apps/shell/src/preload/index.ts`, `apps/shell/src/shared/home-api.ts` và năm file
    renderer `AccountEntry.tsx`, `OrgChoiceStep.tsx`, `UniworkDocInfoPanel.tsx`, `uniwork-library-api.ts`, `home.css`/`settings.css`:
    lane G8-16 đặt bước chọn tổ chức, bảng thuộc tính và IPC mới ở đó (nhánh `feature/UNI-1411-g8-16-post-login-links`).
  - Thêm `editor/marks.ts` (Docs), `threaded-comment-{actions,marker}.ts` (Sheets), `note-threads.ts` + `note-margin-layout.ts`
    (PDF): mô hình thread/neo của từng editor nằm ở đó (plan G8-12 "Đầu vào" trỏ `marks.ts`), adapter neo không tránh được chúng.
  - Panel Discussion: tên file cụ thể `UniworkDiscussionPanel.tsx` và `web/modules/shared/collab/*` thay cho "panel cạnh
    `UniworkChrome.tsx`" / "`web/modules/shared/`": cả thư mục `shared` là quá rộng cho cổng; `capabilities.ts` đọc capability `comments`.
  - Shard i18n: `apps/pdf` không có thư mục `i18n/app/` (chuỗi app nằm ở `apps/pdf/src/renderer/i18n/strings.ts`, khóa
    `note*` của G8-02 ở đó); `apps/markdown` không có shard app (chỉ Discussion, chuỗi lấy từ `strings-collab-*`).
- **Nội dung bình luận:** phụ lục §4.2 (Markdown con + mention token; chip lấy tên hiện tại theo id, hợp đồng mục 3).
- **Đồng bộ:** web theo realtime; desktop tải lại khi focus và mỗi 30 s chỉ khi tab hiển thị và panel mở (phụ lục §4.7).
  Tải lại không đổi focus, không phá composer.
- **AI:** chỉ đề xuất bản nháp trong composer; người bấm Gửi (phụ lục bất biến 7). Bản nháp từ AI mang dòng
  `collabAiDraftLabel` tới khi người dùng sửa hoặc gửi.
- **Vị trí chuỗi và định dạng khóa:** String catalogue G8 › Định dạng khóa (nguồn duy nhất). Số đếm: một khóa trung tính với
  số (EXPERIENCE › String catalogue › Số đếm).

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

Bảng trạng thái chỉ dẫn khóa; câu vi/en ở String catalogue G8. "F" = panel trong editor/frame/shell (component G8-20), "D" =
panel D (G8-10). Hàng không ghi host áp cho cả hai.

### S12 — panel bình luận theo editor (chế độ server)

**Khi nào là chế độ server.** Tài liệu bind UniWork **và** capability hiệu lực có `comments` (web: init ack của frame; desktop:
đã đăng nhập, tài liệu bind). Thiếu một trong hai → panel bình luận gốc của fork (hành vi cũ), không chữ nào của spine này.
Frame mới gặp host cũ không có `comments` → ẩn chế độ server, không báo lỗi (hợp đồng mục 10 › Tương thích).

**Cấu trúc panel** (thứ tự DOM = thị giác):

1. Đầu panel: tiêu đề `collabComments` (+ huy hiệu `collabViewOnlyBadge` khi chỉ xem), nút đóng `collabClosePanel`.
2. Dòng trạng thái panel (một dòng, chỉ khi có): `collabViewOnly` / `collabOffline` / `collabServerError` / `collabSignedOut` /
   thông điệp reveal của S15. Dòng là bản nhìn thấy; câu được ghi vào nút live cố định của cửa sổ (EXPERIENCE › Vùng live).
3. Danh sách thread đang mở (chưa giải quyết), theo thứ tự neo: docx theo thứ tự trong tài liệu; xlsx theo thứ tự sheet rồi
   hàng, cột; pptx theo `slide_index`; pdf theo trang rồi từ trên xuống. Thread neo `lost` xếp sau thread còn vị trí, theo thời
   gian tạo.
4. Nhóm "Đã giải quyết" thu gọn (`collabLabelCount` với `{label}` = `collabResolved`), mở ra theo cùng thứ tự.
5. Mục "Bình luận trong tệp" thu gọn (`collabLabelCount` với `{label}` = `collabInFileSection`), chỉ F, chỉ khi tệp có bình luận gốc.
6. Composer gốc không nằm cố định trong panel: bình luận mới bắt đầu từ vùng chọn trong editor (lệnh "Bình luận" sẵn có của
   editor, Accessibility Floor G8 › Phím tắt), composer mở ở vị trí thread mới trong danh sách.

**Hai chỗ không có khóa riêng (dùng lại, không thêm khóa):** nút mở panel Bình luận trên thanh tài liệu mang chữ và `aria-label`
`collabComments` (trạng thái bật = `aria-expanded`), nút mở panel Discussion mang `collabDiscussion`: cùng nghĩa với tiêu đề
panel nên cùng khóa. Hàng neo của thread mới đang soạn (chưa gửi) dùng đúng khóa nhãn neo của vùng chọn
(`collabAnchorDocx` / `collabAnchorCell` / `collabAnchorSlide` / `collabAnchorPage`, bảng Nhãn neo bên dưới) và chưa có nhãn
trạng thái; không có khóa "bình luận mới" riêng, ô soạn dùng `collabComposerComment`.

**Tác giả không còn tên:** khi người viết đã rời tổ chức hoặc bị gỡ (server không trả tên hiển thị), tên tác giả của thread/trả lời hiện `collabFormerMember`;
mention chip của người không còn tồn tại hoặc không đọc được hiện nhãn trong token, không link (phụ lục §4.2), không khóa.

**Một thread:** dòng đầu = tác giả + thời gian + nhãn neo (+ nhãn trạng thái neo) + huy hiệu `collabResolved` khi đã giải quyết;
thân theo phụ lục §4.2; `collabEdited` khi `revision > 1`; trả lời thụt vào, cũ nhất trước; hàng nút: `collabReply`,
`collabGoToAnchor`, menu `collabActions` (`collabEdit`, `collabDelete`, `collabCopyText`, `collabHistory`), `collabResolve` /
`collabReopen` ở gốc. `collabReplyCount` thay danh sách trả lời khi thread thu gọn.

| Trạng thái | Hành vi | Khóa |
| --- | --- | --- |
| Đang tải lần đầu | Khung xương 3 thread; không composer; câu ẩn thị giác cho screen reader | `collabLoading` |
| Rỗng (F) | Câu mời; không composer gốc (bình luận bắt đầu từ vùng chọn) | `collabEmptyComments` |
| Rỗng (D, chỉ định dạng neo được) | Câu giải thích bình luận theo vị trí chỉ tạo được trong trình soạn thảo; D không tạo comment gốc (gốc `kind=comment` cần neo + `base_version_id`, hợp đồng OQ-C2), chỉ trả lời/sửa/giải quyết thread đã có | `collabEmptyCommentsNoEditor` |
| Lỗi tải lần đầu (`internal`/`network`, chưa có dữ liệu) | Thông điệp trong panel + nút Thử lại; không composer | `collabLoadError`, `collabLoadErrorBody`, `collabRetry` |
| Danh sách | Như Cấu trúc panel ở trên | — |
| Neo `exact` | Nhãn neo theo định dạng, không nhãn trạng thái | `collabAnchorDocx` / `collabAnchorCell` / `collabAnchorSlide` / `collabAnchorPage` |
| Neo `stale` | Nhãn neo + chữ trạng thái (không chỉ màu). F: chỉ hiện khi editor không xác nhận được neo trong model đang mở (comment vừa tạo trên bản chưa Lưu vẫn tìm thấy neo nên không gắn nhãn); D: hiện đúng `anchor_state` của server | `collabAnchorStale` |
| Neo `lost` | Thread vẫn đọc, trả lời, giải quyết được; nhãn neo cũ (nếu còn trích dẫn) + chữ `lost`; `collabGoToAnchor` ẩn; reveal chỉ mở thread, không định vị, không mở comment khác. Khác hẳn khung xóa | `collabAnchorLost` |
| Comment/thread đã xóa có trả lời (tombstone) | Khung `collabDeleted` thay thân và tác giả giữ chỗ; không nút trả lời, sửa, xóa, lịch sử ở khung; trả lời con vẫn hiện đủ | `collabDeleted` |
| Xóa comment không có trả lời | Thread/trả lời biến mất ở lần tải sau (web: realtime; desktop: token đổi) | — |
| Đã giải quyết | Thread vào nhóm "Đã giải quyết", huy hiệu chữ; vẫn mở, đọc, trả lời được; gốc có `collabReopen` | `collabResolved`, `collabReopen` |
| Mở lại | Thread về danh sách đang mở đúng thứ tự neo; focus ở lại nút vừa bấm (đã đổi thành `collabResolve`) | `collabResolve` |
| Sửa | Thân thành ô soạn có sẵn nội dung (nhãn ẩn thị giác = `collabEdit`, không placeholder riêng); `collabSave` / `collabCancel`; Esc hủy (có thay đổi → hỏi `collabDiscardTitle`) | `collabSave`, `collabCancel` |
| Lịch sử sửa | Mở từ `collabEdited` hoặc menu `collabHistory`: danh sách trong thread, mới nhất trước, dòng đầu `collabHistoryCurrent`, mỗi bản `collabHistoryEntry` + thân; chỉ đọc (cả người `view`) | `collabHistoryTitle`, `collabHistoryCurrent`, `collabHistoryEntry` |
| Lịch sử rỗng / lỗi / comment đã xóa | Rỗng → câu; lỗi → câu + `collabRetry`; tombstone (409 `comment_deleted`) → không mở lịch sử, hiện khung `collabDeleted` | `collabHistoryEmpty`, `collabHistoryError` |
| Xóa | Hỏi một bước (`collabDeleteTitle`, `collabDeleteBody`, nút danger `collabDeleteConfirm`, `collabCancel`); câu đúng cho cả hai kết quả (khung hoặc biến mất) | `collabDeleteTitle`, `collabDeleteBody`, `collabDeleteConfirm` |
| Chỉ xem (`commentsLevel = view`, hoặc 403 khi ghi) | Đọc được mọi thứ (thread, lịch sử, mục trong tệp, `collabGoToAnchor`); không composer, không trả lời/sửa/xóa/giải quyết/mở lại (ẩn, không `aria-disabled`: người xem không có hành động này); huy hiệu + dòng trạng thái | `collabViewOnlyBadge`, `collabViewOnly` |
| `commentsLevel` thiếu | Composer + thao tác trên bình luận của mình, không bao giờ của người khác; 403 → hàng Chỉ xem (hợp đồng mục 10) | — |
| `manage` | Như `edit`, thêm Sửa/Xóa trên bình luận của người khác | — |
| Mất mạng (`network`) khi đã có dữ liệu | Panel chỉ đọc với dữ liệu đã tải; composer giữ nháp; Gửi `aria-disabled`, `aria-describedby` → dòng trạng thái; desktop tự thử lại ở chu kỳ tải kế (focus / 30 s); có lại mạng → dòng biến mất, Gửi chạy lại | `collabOffline` |
| Server lỗi (`internal`, 5xx) khi đã có dữ liệu | Như hàng mất mạng, câu khác nguyên nhân | `collabServerError` |
| Phiên hết (`unauthorized`) | Chỉ đọc như trên; desktop: luồng đăng nhập sẵn có của shell; web: host đưa về đăng nhập; nháp giữ | `collabSignedOut` |
| Mất quyền đọc (403/404 khi tải) | Danh sách ẩn, thông điệp thay panel; không composer | `collabNoAccess`, `collabNoAccessBody` |
| Đang gửi | Gửi `aria-disabled` + lý do; nháp chưa xóa tới khi server nhận | `collabSending` |
| Gửi lỗi (khác `comment_deleted`) | Nháp giữ trong ô; câu dưới composer; người dùng bấm Gửi lại | `collabSendFailed` |
| Sửa/xóa/giải quyết lỗi | Thao tác không áp; câu dưới thread | `collabActionFailed` |
| Thread đích bị xóa khi đang soạn (`conflict` + `details.code = comment_deleted`) | Không tải lại tài liệu; nháp giữ, câu dưới composer + nút sao chép; thread đánh dấu đã xóa; tải lại danh sách | `collabCommentDeleted`, `collabCopyText` |
| Danh sách tải lại có thay đổi | Không đổi focus, không phá composer; câu polite một lần | `collabUpdatedAnnounce` |
| Bình luận trong tệp (F) | Mục thu gọn cuối panel, dòng `collabInFileHint`; thread của tệp hiện tác giả lưu trong tệp (hằng `"User"` hiện nhãn trung tính của G8-02), không trả lời/sửa/xóa/giải quyết; byte giữ nguyên khi Lưu | `collabInFileSection`, `collabInFileHint` |
| Bản nháp từ AI | Dòng `collabAiDraftLabel` trên ô soạn tới khi người dùng sửa hoặc gửi; không gửi tự động | `collabAiDraftLabel` |
| Hủy composer có nháp | Hỏi `collabDiscardTitle` / `collabDiscardBody`; `collabDiscard` (danger) / `collabKeepWriting` (focus mặc định) | `collabDiscard`, `collabKeepWriting` |

**Nhãn neo — một khóa có placeholder cho mỗi định dạng**, không ghép chuỗi theo thứ tự tiếng Việt. Không dùng một khóa ICU
`select` cho cả bốn định dạng vì `format()` của fork chỉ thay `{word}` (EXPERIENCE › Số đếm):

| Định dạng | Khóa | Giá trị placeholder |
| --- | --- | --- |
| docx | `collabAnchorDocx` | `{quote}` = trích dẫn của neo, cắt ở 60 ký tự kèm "…" (trích dẫn đầy đủ ≤ 500 ký tự đọc qua `title`/tooltip khi focus) |
| xlsx | `collabAnchorCell` | `{cell}` = `range` A1; khác sheet đang mở → `'Tên sheet'!B7` (cú pháp Excel, không dịch) |
| pptx | `collabAnchorSlide` | `{slide}` = `slide_index + 1` (số theo locale) |
| pdf | `collabAnchorPage` | `{page}` = `page` (số theo locale) |

### S13 — panel Discussion

Một Discussion mỗi tài liệu = mọi dòng `kind=discussion` của tài liệu (phụ lục §4.1), mọi định dạng (Markdown/HTML chỉ có S13).
Dùng chung component với S12 (G8-20), khác ở:

| Trạng thái | Hành vi | Khóa |
| --- | --- | --- |
| Mở | Nút `collabDiscussion` ở thanh tài liệu (shell desktop; frame web; D: tab thứ hai của panel D, tablist APG `collabComments` / `collabDiscussion` khi định dạng neo được; mọi định dạng khác chỉ một vùng Discussion nên không có tablist) | `collabDiscussion` |
| Đang tải / lỗi tải / mất quyền / chỉ xem / mất mạng / server lỗi / cập nhật | Như S12; chữ của các khóa này trung tính theo bề mặt (không nói "bình luận"), nên một khóa dùng chung cho S12 và S13 (bảng chuỗi bên dưới) | `collabLoading`, `collabLoadError`, `collabLoadErrorBody`, `collabRetry`, `collabNoAccess`, `collabNoAccessBody`, `collabViewOnly`, `collabOffline`, `collabServerError`, `collabUpdatedAnnounce` |
| Rỗng | Câu mời + composer ở cuối (người có `edit`) | `collabEmptyDiscussion` |
| Danh sách | Bài theo thời gian, cũ nhất trước; không nhãn neo, không `collabGoToAnchor`; trả lời thụt vào; bài đã giải quyết gom cuối như S12 | `collabLabelCount`, `collabResolved` |
| Composer | Luôn ở cuối panel (không đi từ vùng chọn); placeholder `collabComposerDiscussion`; trả lời dùng `collabComposerReply` | `collabComposerDiscussion`, `collabComposerReply`, `collabSend` |
| Tombstone, sửa, lịch sử, xóa, giải quyết, mở lại, phiên hết, đang gửi, gửi lỗi, AI nháp, hủy nháp | Như S12 cùng khóa; chữ của bảy khóa dùng chung ở hàng này cũng trung tính theo bề mặt (không nói "bình luận"): menu thao tác, hộp xóa (tiêu đề, thân, nút), lịch sử rỗng, thao tác lỗi, phiên hết. Riêng khung tombstone dùng khóa theo loại (`collabCommentDeleted` / `collabDiscussionDeleted`) | như S12; dùng chung trung tính: `collabActions`, `collabDeleteTitle`, `collabDeleteBody`, `collabDeleteConfirm`, `collabHistoryEmpty`, `collabActionFailed`, `collabSignedOut` |
| Bài đích bị xóa khi đang soạn | Như S12, câu theo loại luồng | `collabDiscussionDeleted`, `collabCopyText` |
| Tệp cục bộ / chưa đăng nhập (desktop) | Không có nút, không panel | — |

### S14 — picker mention

Combobox APG trong composer của S12/S13 (ARIA ở Accessibility Floor G8). Nguồn: `mentions.search` → `mention-candidates` (G8-06):
chỉ người có ít nhất `view` trên tài liệu, tối đa 20 dòng, `q` rỗng = theo tên.

| Trạng thái | Hành vi | Khóa |
| --- | --- | --- |
| Mở | Gõ `@` ở đầu từ mở listbox dưới con trỏ; chữ sau `@` là `q` (chờ 150 ms sau phím cuối); nhãn của listbox | `collabMentionLabel` |
| Đang tìm | Một dòng không chọn được trong listbox; kết quả cũ giữ tới khi có mới | `collabMentionSearching` |
| Có kết quả | Mỗi dòng: avatar, tên hiển thị, email (chỉ khi server trả); dòng đầu được đánh dấu; số kết quả đọc qua vùng polite | `collabMentionCount` |
| Không khớp `q` | Dòng thông điệp; Esc hoặc gõ tiếp | `collabMentionNoMatch` |
| Không có ứng viên (chỉ mình tôi đọc được tài liệu) | Dòng thông điệp ngay khi mở với `q` rỗng | `collabMentionNoCandidates` |
| Lỗi (`network`/`internal`) | Dòng thông điệp + nút Thử lại trong listbox; chữ đã gõ giữ nguyên | `collabMentionError`, `collabRetry` |
| Chọn | Chèn token `[@Tên](mention://member/<id>)`, hiện như chip tên hiện tại; đóng picker; con trỏ sau chip + một dấu cách | — |
| Esc / bấm ra ngoài | Đóng picker, giữ chữ đã gõ (thành văn bản thường, không phải mention) | — |
| Chỉ xem / mất mạng / server lỗi | Không có composer hoặc Gửi bị chặn; picker vẫn mở được khi composer còn (mất mạng → hàng Lỗi) | — |
| Người chưa có quyền (phác, **pending G8-18**) | v1 (giá trị tạm G8-D3): picker không bao giờ liệt kê họ; token dán vào được lưu `no_access`, không thông báo, **không chữ nào** trong UI. Phác cho G8-18: chip có dấu chữ cạnh tên + câu dưới composer kiểu "{name} chưa xem được tài liệu này nên sẽ không nhận thông báo"; khóa, câu và nơi hiện chốt ở G8-18 khi G8-D3 ký, chưa vào String catalogue | — |

### S15 — mở từ Inbox (ngoại lệ UNI-1389)

Link: `paths.workspace(org, ws).document(id)?comment=<id>` (G8-07; nguồn slug ở phụ lục §4.6); desktop: vé launch có
`comment_id`. Mở thông báo không đổi Open/Resolved. Cột "Mức": **trang** = thông điệp thay nội dung trang tài liệu (web D):
heading là câu thông điệp, nút `inboxBack` ngay sau; **panel** = tài liệu mở bình thường, panel mở đúng tab với dòng thông
điệp ở đầu panel (frame trả `revealed: false` — hợp đồng mục 10 — hoặc panel D không thấy comment trong danh sách).

| # | Trường hợp UNI-1389 | Nhận biết | Mức | Khóa |
| --- | --- | --- | --- | --- |
| 1 | Tài liệu không còn | Hàng Inbox có `resource_deleted`, hoặc mở trang nhận 404/410 | trang (chỉ web; desktop không nhận được vé cho tài liệu đã xóa) | `inboxDocGone`, `inboxBack` |
| 2 | Mất quyền | Hàng Inbox có `resource_access_lost` (snippet đã ẩn), hoặc mở trang nhận 403 | trang (chỉ web) | `inboxDocNoAccess`, `inboxBack` |
| 3 | Bình luận đã xóa (`params.kind = comment`) | Comment đích là tombstone → mở thread, focus khung `collabDeleted`, dòng thông điệp; không còn trong danh sách → chỉ dòng thông điệp | panel, tab Bình luận | `collabCommentDeleted` |
| 4 | Bài thảo luận đã xóa (`params.kind = discussion`; bài gốc hoặc trả lời trong Discussion) | Như hàng 3 với bài Discussion; câu nói về **bài** đã xóa, không nói cả Discussion mất (Discussion là mọi bài `kind=discussion` của tài liệu, các bài khác vẫn còn) | panel, tab Thảo luận | `collabDiscussionDeleted` |
| 5 | Phiên hết hạn | Web: chưa có phiên → màn hình đăng nhập sẵn có, câu thông điệp phía trên form, đăng nhập xong quay lại đúng link (giữ `?comment=`); desktop: luồng đăng nhập của shell, vé launch hết hạn dùng thông điệp sẵn có của shell | trang đăng nhập | `inboxSessionExpired` |
| — | Neo không còn (`lost`) — không phải ngoại lệ | Mở thread, nhãn `collabAnchorLost`, không định vị, không mở comment khác | panel | `collabAnchorLost` |
| — | Comment đã giải quyết | Mở nhóm "Đã giải quyết", mở thread, xem được lịch sử; không đổi trạng thái | panel | `collabResolved` |

### S16 — chọn tổ chức sau đăng nhập

| Trạng thái | Hành vi |
| --- | --- |
| Một tổ chức | Không có bước chọn; vào thư viện |
| >1 tổ chức, chưa chọn | Màn hình chọn ngay sau đăng nhập; danh sách tổ chức (tên, vai trò của tôi); không gọi API của tổ chức nào trước khi chọn; nút "Tiếp tục" `aria-disabled` tới khi chọn |
| Đã chọn trước đó | Không hỏi lại; dùng tổ chức đã nhớ (theo tài khoản + máy) |
| Tổ chức đã nhớ không còn (rời/bị xóa) | Hiện lại bước chọn với dòng `uwOrgPickRememberedGone` |
| Hàng tổ chức bị tạm ngưng / tôi bị vô hiệu | Hàng hiện nhưng không chọn được (`aria-disabled` + lý do); chọn được hàng khác |
| Mọi tổ chức đều khóa | Panel khóa: tiêu đề `uwLockOrgTitle` (sẵn có) + câu `uwOrgAllBlocked` + nút Đăng xuất |
| Đổi tổ chức | Cài đặt › Tài khoản › "Tổ chức làm việc" (nhãn `uwOrgSettingsLabel`; đường dẫn là hai khóa sẵn có `settings` + `setSecAccount` của shell, không thêm khóa; không có menu tài khoản, OQ-UX7); đổi xong thư viện tải lại; tab tài liệu của tổ chức cũ giữ nguyên tới khi đóng |
| Lỗi tải danh sách | Câu `uwOrgPickError` + "Thử lại" |

### S17 — thư viện UniWork: "Được chia sẻ với tôi" và thuộc tính

| Phần | Hành vi |
| --- | --- |
| Mục "Được chia sẻ với tôi" | Mục mới cạnh danh sách workspace; liệt kê tài liệu được chia sẻ trực tiếp (route `shared-with-me` sẵn có); rỗng → `uwLibSharedEmpty` |
| Danh sách workspace | Tên + vai trò của tôi (`uwLibWsRole`) |
| Bảng thuộc tính | Mở bằng nút "Thông tin" của hàng hoặc tab đang mở; trường: chủ sở hữu, người tạo + thời gian, người cập nhật + thời gian, quyền của tôi (`my_level` → nhãn), phiên bản hiện tại + người cập nhật; trường thiếu từ server hiện "—"; lỗi tải: câu của mã lỗi qua `UNIWORK_ERROR_KEYS[code]` (nhóm khóa `uwErr*` sẵn có; không đặt khóa lỗi riêng cho panel này) + nút `acctRetry` |
| Mất quyền khi đang xem | Hàng biến mất ở lần tải sau; tab đang mở theo S11 (EXPERIENCE) |

### S18 — tạo, đổi tên, lưu trữ

| Thao tác | Hành vi |
| --- | --- |
| Tài liệu mới | Hộp thoại `uwDocNew`: tên `uwDocName` (bắt buộc), loại `uwDocType`, nơi lưu `uwDocLocation` (hai ô chọn: workspace `uwPickWorkspace` rồi thư mục, mục đầu `uwDocLocationTop`); loại là nhóm radio chỉ mang tên định dạng DOCX / XLSX / PPTX (tên định dạng, không dịch, không khóa); nút `uwDocCreate` / `cancel`; tạo xong mở tab theo id; không tạo bản sao cục bộ thứ hai |
| Tải lên | `uwDocUpload`: nút `uwDocUploadPick` (mở hộp chọn tệp của hệ điều hành: `uploadPickTitle`, bộ lọc `uploadPickDocuments` / `uploadPickAll`, chuỗi main process) rồi tên tệp đã chọn → nơi lưu; tiến trình theo pattern Progress của EXPERIENCE, câu `uwDocUploading`; `cancel` |
| Đổi tên | `uwDocRename`: sửa tại chỗ trong hàng (ô có nhãn ẩn thị giác = `uwDocName` · tên hiện tại) hoặc hộp thoại; Enter lưu, Esc hủy; tên rỗng → lỗi tại trường (`uwDocNameEmpty`); tên quá 500 ký tự → lỗi tại trường (`uwDocNameTooLong`, client kiểm trước khi gửi); nếu server vẫn trả 400 → theo hàng "Lỗi server" bên dưới; tên trùng tài liệu khác **được phép** (FD-D10 a, UNI-1425: server không chặn trùng tài liệu, không có lỗi trùng cho tài liệu) |
| Lưu trữ / khôi phục | Menu "…" (nút `aria-label` = `uwDocActionsFor` với `{name}` = tên tài liệu); `uwDocArchive` có xác nhận một bước (`uwDocArchiveConfirm`) / `uwDocRestore`; hàng đã lưu trữ mang chữ `uwDocArchived`; không có "Xóa vĩnh viễn" trong app |
| Quyền `view` | Mục thao tác không hiện (không phải `aria-disabled`: người xem không có hành động này) |
| Đổi tên ở nơi khác | Tiêu đề tab đổi ở lần làm mới metadata (feed hoặc khi focus); câu polite `uwDocRenamedAnnounce` |
| Lỗi server | Toast lỗi + thao tác không áp; tên trong hàng trở về tên cũ |

## Accessibility Floor G8

Bổ sung Accessibility Floor của EXPERIENCE.md (luật chung, vùng live cố định, `aria-disabled`, vùng chạm áp nguyên).

- **S12/S13 panel:** `aside` có `aria-labelledby` = tiêu đề panel; danh sách thread là `role=list`, mỗi thread `role=listitem`
  với tên ghép bằng `aria-labelledby` (id của tác giả, nhãn neo, nhãn trạng thái — không khóa ghép chuỗi). Nhãn neo `stale`/`lost`
  và "đã giải quyết" có chữ, không chỉ màu/biểu tượng. Nhóm "Đã giải quyết" và "Bình luận trong tệp" là nút disclosure
  (`aria-expanded`, `aria-controls`). Tab Bình luận/Thảo luận của panel D là tablist APG (EXPERIENCE › Interaction Primitives › Tab S2).
- **Focus:** mở từ `comments.reveal` hoặc `?comment=` → focus vào thread đích (heading của thread, `tabindex=-1`), editor không
  mất vùng chọn neo; thông điệp S15 mức panel nhận focus thay thread khi không có thread. `comments.changed` và tải lại định kỳ
  **không** di chuyển focus và không cướp focus khỏi editor/composer. Danh sách tải lại có thay đổi → câu polite
  `collabUpdatedAnnounce` một lần (vùng live của cửa sổ). Đóng panel → focus về nút mở. Thread biến mất khi đang focus trong
  nó → focus về thread kế (hoặc tiêu đề panel). Mở/đóng lịch sử sửa → focus về nút đã mở.
- **Composer:** ô soạn có nhãn (placeholder đồng thời là nhãn ẩn thị giác); Gửi = Ctrl/⌘+Enter (`collabSendHint` với
  `{shortcut}` theo nền tảng), Esc đóng picker trước rồi mới hủy composer (hủy có nháp thì hỏi). Nút Gửi bận/không chạy dùng
  `aria-disabled` + lý do (`collabSending`, hoặc dòng trạng thái panel). Câu lỗi dưới composer gắn `aria-describedby`.
- **S14 picker:** combobox APG — ô soạn mang `role=combobox` chỉ khi picker mở, `aria-expanded` `aria-controls` → `role=listbox`
  (`aria-label` = `collabMentionLabel`), `aria-activedescendant`; ↑↓ di chuyển, Enter/Tab chọn, Esc đóng (giữ chữ đã gõ). Dòng
  thông điệp (đang tìm/không khớp/không ứng viên/lỗi) là `role=option` `aria-disabled=true`; nút Thử lại đạt được bằng ↑↓ + Enter.
  Số kết quả đọc qua vùng polite (`collabMentionCount`, một khóa trung tính).
- **Phím tắt (chốt G8-09):** **không** thêm phím tắt mở panel ở v1. Đề xuất Ctrl/⌘+Alt+M của r2 trùng phím mở hộp thoại Đoạn
  văn của Docs (`apps/docs/src/renderer/App.tsx`, `e.altKey && e.code === 'KeyM'`) và luật "phím tắt không ghi đè phím của editor".
  Bình luận mới dùng phím sẵn có của từng editor, ở chế độ server mở composer S12: Docs ⌥⌘A / Ctrl+Alt+A (`shortcuts.ts`, id
  `comment`), Sheets (`global-shortcuts.ts`, `comment-new`, hai phím cùng `{mod, shift}`) Ctrl+Shift+F2 hoặc Ctrl+Shift+M trên Windows/Linux, ⌘⇧F2 hoặc ⌘⇧M trên macOS; Slides và PDF chưa có phím → chỉ nút trên
  thanh công cụ. Nút mở panel bình luận và nút `collabDiscussion` nằm trong thứ tự Tab của thanh tài liệu.
- **S15:** heading ngoại lệ (mức trang) nhận focus khi trang tải; nút `inboxBack` là điểm Tab đầu tiên sau heading. Mức panel:
  dòng thông điệp `tabindex=-1` nhận focus, câu ghi vào nút polite của cửa sổ.
- **S16:** danh sách tổ chức là radio group (`role=radiogroup`, mũi tên đổi lựa chọn); hàng khóa `aria-disabled` + `aria-describedby`
  lý do; focus đầu vào hàng đầu tiên chọn được.
- **S17:** bảng thuộc tính là `dl` trong dialog không modal hoặc panel bên, `aria-labelledby` = tên tài liệu.
- **S18:** hộp thoại modal theo pattern dialog của fork (focus trap, Esc hủy, focus trả về nút mở); lỗi trường qua
  `aria-invalid` + `aria-describedby`. Nút "…" của hàng có `aria-label` = `uwDocActionsFor` (tên tài liệu nằm trong nhãn, không ghép
  chuỗi); ô đổi tên tại chỗ có nhãn ẩn thị giác `uwDocName` · tên hiện tại (bản đã ship ghép hai đoạn bằng " · "); "Đã lưu trữ" (`uwDocArchived`) là chữ, không chỉ màu hay
  làm mờ hàng; xong đổi tên thì câu polite `uwDocRenamedAnnounce` vào vùng live cố định.
- **Vùng chạm:** nút trong panel, hàng thread, mục picker ≥ 24px, ≥ 44px khi `pointer: coarse`.

## String catalogue G8 (vi / en)

### Định dạng khóa (nguồn duy nhất cho G8-07, G8-10, G8-11, G8-20)

- **Khóa logic** là camelCase có tiền tố theo bề mặt: `collab*` (S12–S14 và thông điệp S15 mức panel, dùng chung web D và fork),
  `inbox*` (S15 mức trang, chỉ web D), `uw*` (shell S16–S18, sẵn có). Một khóa = một nghĩa; hai bề mặt cùng nghĩa dùng chung khóa.
- **Fork (G8-20):** thuộc tính cùng tên khóa trong `packages/ui/src/strings-collab-panel.ts` (S12, S13, S15 mức panel) và
  `packages/ui/src/strings-collab-mention.ts` (S14), dạng `Record<Lang, …>` như `strings-ai-model-picker.ts`; placeholder `{name}`
  qua `format()`; đủ 21 locale (19 locale ngoài vi/en dịch máy có review, EXPERIENCE › Ngôn ngữ). Shell và frame không chép khóa
  `collab*` vào shard riêng: chúng đọc từ `packages/ui`.
- **Web D (G8-10, G8-07):** `documents.collab.<khóa>` trong `packages/core/i18n/locales/{en,vi}.json`, lá giữ nguyên tên camelCase
  của khóa logic (ví dụ `documents.collab.collabAnchorStale`, `documents.collab.inboxDocGone`); placeholder viết `{{name}}`
  (i18next). Chỉ khóa có cột Host chứa D.
- **Khóa D sẵn có:** khi cột "D sẵn có" ghi một khóa `documents.comments.*`, web D dùng khóa đó (sửa giá trị theo spine nếu cột vi/en
  khác giá trị hiện tại) và **không** thêm `documents.collab.*` trùng nghĩa. Khóa `documents.comments.*` mà panel tab hóa thay thế
  (`open`, `count_one/_other`, `file_title`, `file_open`, `file_close`, `file_empty`, `empty`, `comment_placeholder`, `comment_reply_count_one/_other`,
  `comment_resolved_fold_*`, `thread_resolved_one/_other`) được G8-10 xóa khi không còn chỗ dùng, để không có hai khóa cùng nghĩa. Mọi khóa `documents.comments.*` còn lại đều được quyết định ở đây
  (không có khóa nào bị bỏ sót):

  | Khóa D | Quyết định |
  | --- | --- |
  | `title`, `error_title`, `error_description`, `retry`, `revoked_title`, `revoked_description`, `action_failed`, `comment_send`, `comment_edited_time`, `comment_deleted`, `comment_resolved`, `comment_resolve`, `comment_unresolve`, `comment_actions`, `comment_copy`, `comment_edit`, `comment_delete_title`, `comment_delete_description`, `comment_delete_confirm` | giữ làm khóa D của khóa `collab*` ở cột "D sẵn có" bên dưới (đổi giá trị khi cột vi/en khác) |
  | `close` | giữ làm khóa D của `collabClosePanel` (chữ đổi thành `{{panel}}`) |
  | `former_member` | giữ làm khóa D của `collabFormerMember` (giá trị không đổi) |
  | `comment_edit_placeholder` | **bỏ**: ô sửa lấy nhãn ẩn từ `collabEdit` (S12 hàng Sửa) |
  | `comment_collapse`, `comment_expand`, `comment_preview_empty` | **giữ nguyên**, chỉ D: thu gọn thân bình luận dài và dòng xem trước của bình luận không có chữ, spine không định nghĩa bề mặt thay thế |
  | `favorite_add`, `favorite_remove`, `favorite_failed`, `favorite_unavailable` | **giữ nguyên**: yêu thích tài liệu, chỉ cùng không gian tên, ngoài phạm vi G8 |
- **Số đếm:** đúng ba khóa có `{count}`, mỗi khóa một nghĩa, câu trung tính với số (EXPERIENCE › Số đếm; không cặp `_one/_other`
  mới ở D): `collabLabelCount`, `collabReplyCount`, `collabMentionCount`. Kiểm ở 1, 2, 5 cho vi, en, ru, pl (fork).
- Không chuỗi nào chứa mã nội bộ, tên repo/GitHub hay tên nhà cung cấp; "UniWork" và "UniWork AI" giữ nguyên.
- Đổi tên so với khung r2: `collabTargetDeleted` + `inboxCommentDeleted` → `collabCommentDeleted` (một nghĩa); `inboxThreadDeleted`
  → `collabDiscussionDeleted` (hiện cả ở panel); `collabCopyDraft` → `collabCopyText` (cùng nghĩa "Sao chép nội dung" với menu
  thread); `collabMentionEmpty` → `collabMentionNoMatch` + `collabMentionNoCandidates` (hai trường hợp khác nghĩa);
  `collabEmptyComments` tách thêm `collabEmptyCommentsNoEditor` (D không tạo được bình luận gốc).

### Panel, trạng thái panel (S12, S13)

| Khóa | vi | en | Host | D sẵn có |
| --- | --- | --- | --- | --- |
| `collabComments` | Bình luận | Comments | F+D | `documents.comments.title` |
| `collabDiscussion` | Thảo luận | Discussion | F+D | — |
| `collabClosePanel` | Đóng {panel} | Close {panel} | F+D | `documents.comments.close` (thay: vi "Đóng bình luận") |
| `collabLabelCount` | {label} · {count} | {label} · {count} | F+D | — |
| `collabLoading` | Đang tải… | Loading… | F+D | — |
| `collabEmptyComments` | Chưa có bình luận. Chọn một chỗ trong tài liệu rồi chọn Bình luận. | No comments yet. Select something in the document, then choose Comment. | F | — |
| `collabEmptyCommentsNoEditor` | Chưa có bình luận. Bình luận tại một vị trí được thêm khi mở tài liệu trong trình soạn thảo. | No comments yet. Comments on a specific place are added while the document is open in the editor. | D | — |
| `collabEmptyDiscussion` | Chưa có thảo luận. Hãy viết điều bạn muốn trao đổi về tài liệu này. | No discussion yet. Write what you’d like to talk about in this document. | F+D | — |
| `collabLoadError` | Không tải được nội dung này | Could not load this | F+D | `documents.comments.error_title` |
| `collabLoadErrorBody` | Chưa mất gì cả. Thử lại sau giây lát. | Nothing was lost. Try again in a moment. | F+D | `documents.comments.error_description` |
| `collabRetry` | Thử lại | Try again | F+D | `documents.comments.retry` |
| `collabOffline` | Không kết nối được UniWork. Bạn vẫn đọc được nội dung đã tải nhưng chưa gửi được. | Can’t reach UniWork. You can still read what’s already loaded, but you can’t send yet. | F+D | — |
| `collabServerError` | UniWork đang gặp sự cố. Bạn vẫn đọc được nội dung đã tải nhưng chưa gửi được. | UniWork is having trouble. You can still read what’s already loaded, but you can’t send yet. | F+D | — |
| `collabSignedOut` | Phiên đăng nhập đã hết. Đăng nhập lại để gửi. | Your session has ended. Log in again to send. | F+D | — |
| `collabNoAccess` | Bạn không còn quyền xem nội dung này | You no longer have access to this | F+D | `documents.comments.revoked_title` |
| `collabNoAccessBody` | Nội dung bị ẩn theo quyền hiện tại của bạn trên tài liệu này. | This is hidden under your current access to this document. | F+D | `documents.comments.revoked_description` |
| `collabViewOnlyBadge` | Chỉ xem | View only | F+D | — |
| `collabViewOnly` | Bạn chỉ có quyền xem: đọc được nhưng không viết được. | You have view access: you can read but not write. | F+D | — |
| `collabUpdatedAnnounce` | Nội dung vừa được cập nhật. | The content was updated. | F+D | — |

### Neo (S12)

| Khóa | vi | en | Host | D sẵn có |
| --- | --- | --- | --- | --- |
| `collabAnchorDocx` | Đoạn: “{quote}” | Text: “{quote}” | F+D | — |
| `collabAnchorCell` | Ô {cell} | Cell {cell} | F+D | — |
| `collabAnchorSlide` | Trang chiếu {slide} | Slide {slide} | F+D | — |
| `collabAnchorPage` | Trang {page} | Page {page} | F+D | — |
| `collabAnchorStale` | Vị trí có thể đã thay đổi | The location may have changed | F+D | — |
| `collabAnchorLost` | Không còn tìm thấy vị trí được bình luận | The commented location can no longer be found | F+D | — |
| `collabGoToAnchor` | Đến vị trí | Go to location | F | — |

### Thread, thao tác, lịch sử (S12, S13)

| Khóa | vi | en | Host | D sẵn có |
| --- | --- | --- | --- | --- |
| `collabResolved` | Đã giải quyết | Resolved | F+D | `documents.comments.comment_resolved` (vi đổi "Đã xử lý" → "Đã giải quyết") |
| `collabResolve` | Đánh dấu đã giải quyết | Resolve | F+D | `documents.comments.comment_resolve` (vi đổi "Đánh dấu đã xử lý") |
| `collabReopen` | Mở lại | Reopen | F+D | `documents.comments.comment_unresolve` (en đổi "Unresolve") |
| `collabReply` | Trả lời | Reply | F+D | — |
| `collabReplyCount` | Trả lời: {count} | Replies: {count} | F+D | — (thay `comment_reply_count_one/_other`) |
| `collabActions` | Thao tác khác | More actions | F+D | `documents.comments.comment_actions` |
| `collabEdit` | Sửa | Edit | F+D | `documents.comments.comment_edit` |
| `collabSave` | Lưu | Save | F+D | — |
| `collabCancel` | Hủy | Cancel | F+D | — |
| `collabDelete` | Xóa | Delete | F+D | — |
| `collabCopyText` | Sao chép nội dung | Copy content | F+D | `documents.comments.comment_copy` |
| `collabDeleteTitle` | Xóa nội dung này? | Delete this? | F+D | `documents.comments.comment_delete_title` |
| `collabDeleteBody` | Nội dung và lịch sử sửa sẽ bị xóa hẳn. Nếu đã có trả lời, các trả lời vẫn còn. | The text and edit history will be permanently deleted. Any replies stay. | F+D | `documents.comments.comment_delete_description` (giá trị đổi) |
| `collabDeleteConfirm` | Xóa hẳn | Delete permanently | F+D | `documents.comments.comment_delete_confirm` |
| `collabDeleted` | Nội dung đã bị xóa | This content was deleted | F+D | `documents.comments.comment_deleted` |
| `collabEdited` | Đã sửa · {time} | Edited · {time} | F+D | `documents.comments.comment_edited_time` |
| `collabFormerMember` | Cựu thành viên | Former member | F+D | `documents.comments.former_member` (giữ giá trị) |
| `collabHistory` | Xem lịch sử sửa | View edit history | F+D | — |
| `collabHistoryTitle` | Lịch sử sửa | Edit history | F+D | — |
| `collabHistoryCurrent` | Bản hiện tại | Current version | F+D | — |
| `collabHistoryEntry` | {name}, {time} | {name}, {time} | F+D | — |
| `collabHistoryEmpty` | Nội dung này chưa được sửa. | This hasn’t been edited. | F+D | — |
| `collabHistoryError` | Không tải được lịch sử sửa. | Couldn’t load the edit history. | F+D | — |
| `collabActionFailed` | Thao tác chưa thành công | The action did not go through | F+D | `documents.comments.action_failed` |

**`{panel}` của `collabClosePanel`** = đúng giá trị khóa tiêu đề của panel đang đóng (`collabComments` hoặc `collabDiscussion`), giữ nguyên hoa/thường như tiêu đề
hiển thị: vi "Đóng Bình luận" / "Đóng Thảo luận", en "Close Comments" / "Close Discussion"; host truyền chuỗi đã dịch, khóa không tự tra.

**Động từ đăng nhập (en)**: D dùng "Log in" (khớp `auth.login`, nút của màn hình đăng nhập sẵn có); fork (`strings-collab-panel.ts`) viết "Sign in" ở
`collabSignedOut` để khớp shell ("Sign in again"). Catalogue ghi giá trị D; đây là khác biệt duy nhất theo host của một khóa, vì hai host có hai nút
đăng nhập đã ship với hai động từ khác nhau.

**`{time}` của `collabEdited`, `collabHistoryEntry`, `uwDocInfoByAt`** không phải chuỗi dịch: host truyền chuỗi đã định dạng bằng
`Intl.DateTimeFormat` của locale giao diện, múi giờ cục bộ, không giây. Cùng ngày: chỉ giờ-phút; cùng năm: ngày-tháng + giờ-phút; khác
năm: thêm năm. Ví dụ vi (`dd/MM`, 24 giờ) `12/10 15:30`; en `Oct 12, 3:30 PM`. Một khóa, một định dạng cho mọi bề mặt; không cặp khóa theo
mốc thời gian.

### Composer (S12, S13)

| Khóa | vi | en | Host | D sẵn có |
| --- | --- | --- | --- | --- |
| `collabComposerComment` | Viết bình luận… | Write a comment… | F | — |
| `collabComposerReply` | Viết trả lời… | Write a reply… | F+D | — |
| `collabComposerDiscussion` | Viết vào thảo luận… | Write in the discussion… | F+D | — |
| `collabSend` | Gửi | Send | F+D | `documents.comments.comment_send` |
| `collabSendHint` | {shortcut} để gửi | {shortcut} to send | F+D | — |
| `collabSending` | Đang gửi… | Sending… | F+D | — |
| `collabSendFailed` | Chưa gửi được. Nội dung vẫn còn trong ô soạn. | Couldn’t send. Your text is still in the box. | F+D | — |
| `collabCommentDeleted` | Bình luận này đã bị xóa. | This comment was deleted. | F+D | — |
| `collabDiscussionDeleted` | Bài thảo luận này đã bị xóa. | This discussion post was deleted. | F+D | — |
| `collabDiscardTitle` | Bỏ bản nháp? | Discard the draft? | F+D | — |
| `collabDiscardBody` | Nội dung bạn đang viết sẽ mất. | What you’ve written will be lost. | F+D | — |
| `collabDiscard` | Bỏ nháp | Discard | F+D | — |
| `collabKeepWriting` | Tiếp tục viết | Keep writing | F+D | — |
| `collabAiDraftLabel` | Bản nháp do UniWork AI gợi ý. Xem lại rồi bấm Gửi. | Draft suggested by UniWork AI. Review it, then send. | F | — |

### Bình luận trong tệp (S12, chỉ F)

| Khóa | vi | en | Host | D sẵn có |
| --- | --- | --- | --- | --- |
| `collabInFileSection` | Bình luận trong tệp | Comments in the file | F | — |
| `collabInFileHint` | Lưu sẵn trong tệp và chỉ để xem: không sửa hay trả lời được ở đây. | Saved in the file and read-only: you can’t edit or reply here. | F | — |

Tác giả của bình luận trong tệp dùng nhãn trung tính sẵn có của G8-02, không thêm khóa `collab*`; mỗi editor đọc khóa của chính nó
(bảng "Khóa sẵn có được dùng lại" bên dưới: `editorNeutralCommentAuthor`, `appThreadNeutralAuthor`, `paneCommentsNeutralAuthor`,
`noteNeutralAuthor`; cùng giá trị vi "Người dùng" / en "User").

### Picker mention (S14)

| Khóa | vi | en | Host | D sẵn có |
| --- | --- | --- | --- | --- |
| `collabMentionLabel` | Nhắc đến ai đó | Mention someone | F+D | — |
| `collabMentionSearching` | Đang tìm… | Searching… | F+D | — |
| `collabMentionCount` | Kết quả: {count} | Results: {count} | F+D | — |
| `collabMentionNoMatch` | Không có ai khớp “{query}” trong số người xem được tài liệu này. | No one with access to this document matches “{query}”. | F+D | — |
| `collabMentionNoCandidates` | Chưa có ai khác xem được tài liệu này. | No one else has access to this document yet. | F+D | — |
| `collabMentionError` | Không tải được danh sách người. | Couldn’t load people. | F+D | — |

### Mở từ Inbox, mức trang (S15, chỉ web D)

Câu vi/en của hàng 1, 2 là nguyên văn UNI-1389; hàng 3, 4 dùng `collabCommentDeleted` / `collabDiscussionDeleted` ở trên.
"Inbox" của D tiếng Việt là "Hộp việc" (`nav.inbox`).

| Khóa | vi | en | Host | D sẵn có |
| --- | --- | --- | --- | --- |
| `inboxDocGone` | Tài liệu không còn tồn tại hoặc đã bị xóa. | This document no longer exists or was deleted. | D | — |
| `inboxDocNoAccess` | Bạn không có quyền truy cập tài liệu này. | You don’t have access to this document. | D | — |
| `inboxSessionExpired` | Phiên đăng nhập đã hết. Hãy đăng nhập lại để mở bình luận này. | Your session has ended. Log in again to open this comment. | D | — |
| `inboxBack` | Về Hộp việc | Back to Inbox | D | — |

### Shell (S16–S18)

Shard `uniwork-documents` của shell, 19 locale còn lại dịch máy có review theo EXPERIENCE › Ngôn ngữ:

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
| `uwDocNameTooLong` | Tên tài liệu quá dài (tối đa 500 ký tự). | The name is too long (500 characters at most). — khóa đã có trong shard G8-17 (fork main `404d820c`), spine nhận lại; lỗi tại trường cho tên quá 500 |
| `uwDocNameTaken` | Đã có tài liệu cùng tên ở đây. | A document with this name already exists here. — **không dùng cho tài liệu** từ FD-D10 a (2026-10-13); giữ dòng để G8-17 gỡ khóa khỏi shard khi bỏ nhánh lỗi trùng |
| `uwDocRenamedAnnounce` | Tài liệu đã được đổi tên thành {name}. | The document was renamed to {name}. |
| `uwDocActionFailed` | Không thực hiện được. Hãy thử lại. | That didn’t work. Try again. |
| `uwDocActionsFor` | Thao tác khác cho “{name}” | More actions for “{name}” |
| `uwDocCreate` | Tạo | Create |
| `uwDocUploadPick` | Chọn tệp | Choose a file |
| `uwDocUploading` | Đang tải lên “{name}”… | Uploading “{name}”… |
| `uwDocLocationTop` | Cấp trên cùng | Top level |
| `uwDocArchived` | Đã lưu trữ | Archived |

Sáu khóa cuối bảng (`uwDocActionsFor` … `uwDocArchived`) do lane G8-17 đã ship (`d2cdfd78`, đủ 21 locale); spine lấy tên và chữ của bản ship, không đặt khóa song song.
Nút Hủy dùng khóa sẵn có `cancel` của shell, nhãn loại tài liệu là tên định dạng, nhãn ô đổi tên ghép từ `uwDocName` — nên mockup không còn ba khóa tự đặt cho Hủy, loại tài liệu và nhãn ô đổi tên.

Hộp chọn tệp gốc của hệ điều hành mà nút `uwDocUploadPick` mở (S18) là chuỗi **main process**, không thuộc shard renderer: file `apps/shell/src/main/uniwork-docs/strings.ts`, owner G8-17, đã ship ở `3468e971` (vi/en đã review, ngôn ngữ khác rơi về en); spine lấy tên và chữ của bản ship:

| Khóa (main) | vi | en |
| --- | --- | --- |
| `uploadPickTitle` | Chọn tệp để tải lên | Choose a file to upload |
| `uploadPickDocuments` | Tài liệu | Documents |
| `uploadPickAll` | Mọi tệp | All files |

`uploadPickTitle` là tiêu đề cửa sổ chọn tệp, `uploadPickDocuments` / `uploadPickAll` là hai bộ lọc loại tệp; `uwDocUploadPick` ("Chọn tệp") vẫn là nhãn nút trong hộp Tải lên, hai chuỗi không thay nhau.

Khóa do lane G8-16 thêm khi làm S16/S17 (nhánh `feature/UNI-1411-g8-16-post-login-links`, ghi nhận, không đổi hành vi):

| Khóa | vi | en |
| --- | --- | --- |
| `uwDocInfoFor` | Thông tin về “{name}” | Details for “{name}” |
| `uwDocInfoVersionBy` | {version} · {name} | {version} · {name} |
| `uwAccessView` / `uwAccessEdit` / `uwAccessManage` | Xem / Chỉnh sửa / Quản lý | View / Edit / Manage |
| `uwRoleOwner` / `uwRoleAdmin` / `uwRoleMember` | Chủ sở hữu / Quản trị viên / Thành viên | Owner / Admin / Member |

### Khóa sẵn có được dùng lại (không thêm khóa)

Mockup và hành vi S12–S18 dùng các khóa này nguyên trạng; cột cuối là bên sở hữu (sửa giá trị ở đó, không chép sang `collab*` / `uw*` mới).

| Khóa | vi | en | Bên sở hữu |
| --- | --- | --- | --- |
| `uwErrServerError` | UniWork đang gặp sự cố. Hãy thử lại sau ít phút. | UniWork ran into a problem. Try again in a moment. | shard `uniwork-documents`; mọi mã lỗi đi qua `UNIWORK_ERROR_KEYS[code]` (nhóm `uwErr*`), mockup S17 vẽ mã `server_error` |
| `acctRetry` | Thử lại | Retry | shard `account` của shell (nút Thử lại của panel thông tin S17) |
| `cancel` | Hủy | Cancel | `apps/shell/src/renderer/src/strings.ts` (nút Hủy của hộp thoại S18, mọi nơi trong shell) |
| `closeTab` | Đóng tab | Close tab | `apps/shell/src/renderer/src/strings.ts` (`aria-label` nút đóng tab) |
| `settings` | Cài đặt | Settings | `apps/shell/src/renderer/src/strings.ts` (đoạn đầu đường dẫn Cài đặt › Tài khoản) |
| `setSecAccount` | Tài khoản | Account | `apps/shell/src/renderer/src/strings.ts` (đoạn sau của đường dẫn) |
| `uwPickWorkspace` | Không gian làm việc | Workspace | shard `uniwork-documents` (nhãn ô chọn workspace của hộp thoại S18 và thư viện) |
| `uwLockOrgTitle` | Không mở được trong tổ chức này | Can’t open in this organization | EXPERIENCE.md, shard `sync` (tiêu đề panel khóa của S16) |
| `nav.inbox` | Hộp việc | Inbox | web D `packages/core/i18n/locales` (tên Inbox ở S15; trong D `inboxBack` là khóa i18next `"Về $t(nav.inbox)"`, giá trị hiển thị ở bảng dưới là kết quả sau khi nối, nên đổi tên Inbox sửa một chỗ) |
| `auth.login` | Đăng nhập | Log in | web D `packages/core/i18n/locales` (nút của màn hình đăng nhập sẵn có, S15 hàng 5) |
| `auth.email` | Email | Email | web D `packages/core/i18n/locales` (nhãn ô của màn hình đăng nhập sẵn có, S15 hàng 5) |
| `editorNeutralCommentAuthor` | Người dùng | User | Docs `apps/docs/src/renderer/i18n/strings-editor.ts` (G8-02; tác giả bình luận trong tệp) |
| `appThreadNeutralAuthor` | Người dùng | User | Sheets `apps/sheets/src/renderer/i18n/app/*` (G8-02) |
| `paneCommentsNeutralAuthor` | Người dùng | User | Slides `apps/slides/src/renderer/i18n/panes/*` (G8-02) |
| `noteNeutralAuthor` | Người dùng | User | PDF `apps/pdf/src/renderer/i18n/strings.ts` (G8-02) |

Ngoài bảng: các khóa `uwPick*` (tiêu đề, tìm kiếm, "Gần đây", "Cập nhật {time}"), `acctPlan`, `acctSignOut` mà khung S16/S17 vẽ đã có trong
shard của chúng và không đổi.

### Ràng buộc khi spine lệch bản G8-16 đã ship

Nhánh `feature/UNI-1411-g8-16-post-login-links` (`04bc9a66`) đã ship S16/S17 và nhánh `zone17th/UNI-1412-g8-17-fe` (859261ad) đã ship S18; G8-16/G8-17 không đổi hành vi của nó theo spine. Các chỗ mockup
vẽ khác (1–3: S16/S17 trên bản G8-16; 4–7: S18 trên bản G8-17 bên dưới), mỗi chỗ ghi bên nào ràng buộc:

1. **Hàng tổ chức khóa trong hộp chọn đổi tổ chức (S16).** Bản đã ship ràng buộc (đầu nhánh `04bc9a66`, `AccountPane.tsx` + `settings.css`): `Dropdown` của shell, tổ chức khóa là option `disabled`
   vẽ **hai dòng** (`acct-org-opt-name` tên màu mờ, `acct-org-opt-reason` lý do màu danger, cỡ nhỏ hơn), không biểu tượng; tên truy cập của option vẫn là "tên · lý do".
   Biểu tượng cảnh báo trong mockup chỉ là hình mục tiêu nếu G8-17 chuyển sang listbox tùy biến, không là điều kiện của G8-16. Spine vẫn ràng buộc: lý do là chữ (không chỉ màu).
2. **Nút "Thông tin" của hàng (S17).** Bản đã ship ràng buộc `tabindex` luân phiên (0 chỉ trên hàng đang chọn hoặc đang mở panel; hàng khác
   -1) vì danh sách là listbox; mockup vẽ nút trên mọi hàng chỉ để xem bố cục. Spine ràng buộc kích thước (≥ 24px; ≥ 44px khi `pointer: coarse`):
   bản ship 28px và 44px coarse, đạt sàn.
3. **Lỗi tải panel thông tin (S17).** Bản đã ship ràng buộc: câu theo `UNIWORK_ERROR_KEYS[code]` + `acctRetry`; spine đã bỏ `uwDocInfoError` và
   chấp nhận cách này.

Bản S18 của lane G8-17 (`859261ad`, đọc trước khi chốt khóa) lệch spine/mockup ở các chỗ sau; hành vi đã ship giữ nguyên và **ràng buộc**:

4. **Nơi lưu (S18).** Bản ship dùng hai ô chọn (workspace, thư mục với mục "Cấp trên cùng"), spine ghi một "nơi lưu" chung: giữ hai ô; khóa `uwDocLocationTop` thêm vào catalogue.
5. **Loại tài liệu (S18).** Bản ship hiện radio mang nhãn thô DOCX / XLSX / PPTX (tên định dạng, không dịch); spine bỏ ba khóa loại tài liệu mà mockup tự đặt.
6. **Nhãn ô đổi tên và nút "…" (S18).** Bản ship ghép `uwDocName` + " · " + tên hiện tại cho ô đổi tên và dùng `uwDocActionsFor` ("Thao tác khác cho") cho nút "…": ràng buộc, thay `uwDocRenameLabel` và `uwDocMore` của mockup. Phép ghép đoạn nằm ở `aria-label`, không là khóa mới.
7. **Hủy và chọn tệp (S18).** Bản ship dùng `cancel` của shell và nút `uwDocUploadPick` (không có nhãn "Tệp"): ràng buộc, thay `uwDocCancel` và `uwDocFile`.

## Open questions

Không còn câu nào mở. Các câu của bản r2 và của hợp đồng thuộc UX đã đóng như sau:

| Câu | Đóng bằng | Nguồn |
| --- | --- | --- |
| Phím tắt mở panel (Ctrl/⌘+Alt+M) | Không thêm phím mở panel ở v1 (trùng hộp thoại Đoạn văn của Docs); bình luận mới dùng phím sẵn có của editor | Accessibility Floor G8 › Phím tắt |
| Chữ nhãn neo `lost` (hợp đồng OQ-C11, phần UX) | Ký chữ riêng: "Không còn tìm thấy vị trí được bình luận" / "The commented location can no longer be found", khác khung `collabDeleted` | String catalogue G8 › Neo |
| Tên chip sau khi đổi tên hiển thị (hợp đồng OQ-C10, phần UX) | Chấp nhận: chip làm mới ở mỗi lần list đầy đủ (web mỗi lần invalidate; desktop khi token đổi); không chuỗi nào | hợp đồng mục 2.1, mục 6 |
| Bỏ cứng dây chuyền cha tombstone (hợp đồng OQ-C4, phần UX) | Chấp nhận: khung rỗng không còn con thì biến mất cùng lần tải; S12 hàng "Xóa comment không có trả lời" | S12 |
| Thông điệp mention người chưa có quyền | **pending G8-18** (khi G8-D3 ký): chỉ phác ở S14, chưa có khóa; v1 không chữ nào | S14 |
| "Người liên quan" khi giải quyết (hợp đồng OQ-C7) | Không thuộc UX (Product, UNI-1337); không đổi bề mặt S12–S15 | hợp đồng mục 13 |
