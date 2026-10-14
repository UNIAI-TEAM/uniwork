# Office G5/G6/G7 — Lịch sử review plan

> **Trạng thái:** in-progress — nhật ký finding review của plan [2026-10-12-office-g5-g6-g7](../../superpowers/plans/2026-10-12-office-g5-g6-g7.md); cập nhật mỗi vòng.

Finding gốc nằm ở báo cáo của reviewer (ngoài repo). File này chỉ trỏ tới chỗ plan/spine đã sửa; nội dung nằm ở đó.
Cách lập plan (BMad, cây ticket, script đồng bộ) ghi ở plan §1; quyết định UX từng vòng ghi ở memlog BMad
(`_bmad-output/ux-office-g5g6g7/.memlog.md`, ngoài repo).

## Vòng 1–2 (plan v2.0)

| Finding | Sửa ở |
| --- | --- |
| P1.1 | G7-08, G6-05/G6-05u, G7-02 |
| P1.2 | G6-07a, G6-07b |
| P1.3 | G6-03a/b/c, G5-01a/b, G5-06/06u, G5-05/05u, G6-05/05u, G5-08s/c |
| P1.4 | plan §5 (phụ thuộc = cây ticket), plan §6.4, G7-03a |
| P1.5 | G5-04, G5-03w/G5-03a |
| P1.6 | plan §4 |
| P1.7 | dòng owner của mọi task |
| P1.8 | G7-05, G7-07, X-03 |
| P1.9 | plan §2 |
| P1.10 | brief planner (coordinator commit) |
| P2.1 | G7-03a, G7-03b |
| P2.2 | X-02, plan §6.3 |
| P2.3 | G7-02 |
| P2.4 | X-03, G6-03c, G7-08 |
| Validator BMad (v2.0) | G6-06/G6-11, G7-02/G7-12, G7-10, G5-04, X-03, G7-03a/G7-04, G6-12, G5-01b, G5-02, G7-11, G6-07b, G6-04 |

## Vòng 3 (plan v2.1)

| Finding | Sửa ở |
| --- | --- |
| P3.1, P3.2 | plan G5-09w; EXPERIENCE › Conflict dialog (S5), Inspiration |
| P3.3 | plan G6-05, G6-03c; EXPERIENCE › Provider row, Flow 1 |
| P3.4 | plan X-03 (route capability), G5-04, G5-06, G5-05, G6-05 |
| P3.5 | plan G6-01 (từ vựng), G6-05 (test công cụ) |
| P3.6 | plan G5-09w; EXPERIENCE › Conflict dialog (S5), OQ-UX8 |
| P3.7 | plan G5-04, G5-06, G5-11 |
| P3.8 | plan X-02 (`aiRun`), G6-05, G5-03w/03a; plan §6.3 |
| P3.9 | plan G6-03a |
| P3.10 | plan G6-02, G6-03a, G6-03b, G6-05u |
| P3.11 | plan X-02 |
| P3.12 | dòng Test của task liên quan ở plan §5 |
| P3.13–P3.15, P3.17, P3.18, P3.20 | EXPERIENCE.md, DESIGN.md, mockups |
| P3.16 | plan §3, §5.6, §6.1, §6.2 |
| P3.19 | plan §1, §4, §6.1, §6.3, §7 |

## Vòng 4 (plan v2.2)

| Finding | Sửa ở |
| --- | --- |
| P4.1 | plan X-02, G7-06 (thay bằng `protocolSha256` ở vòng 5) |
| P4.2 | plan X-02, G5-09w, G6-05u; EXPERIENCE › Conflict dialog (S5), OQ-UX8; DESIGN › Conflict dialog |
| P4.3 | plan G6-05, X-03, G5-03w |
| P4.4 | plan G5-04, G5-06, G5-11; plan §8 |
| P4.5 | plan G6-02, G6-03a, G6-03b, X-02, G6-05; plan §3 |
| P4.6 | G6-07s; G6-08, G6-07b, G7-10; X-01; G7-01; plan §8 |
| P4.7 | plan U-01, U-02; EXPERIENCE › String catalogue (đổi tiếp ở vòng 5) |
| P4.8 | plan G5-05, G5-04, G5-06; EXPERIENCE, OQ-UX2 |
| P4.9 | EXPERIENCE › State Patterns; plan X-03, X-01, §2 |
| P4.10 | dòng Test của G5-01a/b, G5-07, G5-08s, G5-05, G5-03w, G6-09, G6-12, G7-04, G7-05, G7-06, G7-07, G7-08, G7-09; plan §5.6 |
| P4.11 | DESIGN.md, EXPERIENCE.md, mockups |
| P4.12 | plan §1, §6.1, §7; EXPERIENCE (OQ, Accessibility Floor) |
| Quyết định thêm | G5-05 (xóa bản offline khi bị xóa), G5-06u (Ctrl/⌘+S mở S5), G5-06 (`paused_admin` hủy được), G5-09w |

## Vòng 5 (plan v2.3)

| Finding | Sửa ở |
| --- | --- |
| F5.1 | EXPERIENCE › Capability tắt (server) (quy tắc TTL duy nhất); plan X-03, G5-04 (test đồng hồ giả), G5-06 (offline 2 giờ → `paused_offline`) trỏ về đó |
| F5.2 | EXPERIENCE › Conflict dialog (S5) › Lần Lưu do host web gửi (`timeoutMs: 0`, mã trả lời, `navigate`); plan G5-09w (file `office-module-frame.tsx`, test S5 > 30 giây) |
| F5.3 | plan X-02 (`FileMeta.revision` trong phản hồi `api.open`); EXPERIENCE › Thanh phiên bản mới (S6) (`uwRemoteUpdatedNoRev`) |
| F5.4 | plan X-02 (`protocolSha256` trong `manifest.json`, `parseManifest`/`buildPin`/`parsePin`, `frame-install` từ chối khi lệch), G7-06, plan §6.3 (pin lại bằng `--pin`) |
| F5.5 | EXPERIENCE › Conflict dialog (S5) › `api.download` (hợp đồng host, thành công = giao tệp, bước `uwConflictDownloadCheck`); plan X-02 (khóa capability `download`, test âm), G5-09w (handler D + test) |
| F5.6 | task mới G5-04g (guard store ở bản N′); G5-04 phụ thuộc G5-04g; hợp đồng đăng ký store + bộ kiểm tuân thủ (G5-04, chạy ở G5-06/G5-08c/G5-05); G7-05, G7-07; plan §6.1 (L9), §6.3, §6.5, §8; cây ticket `2.4g` |
| F5.7 | EXPERIENCE › Lý do bị chặn (`keyring_unavailable` = lỗi đăng nhập, bỏ khỏi pill/S2/S3/S11, mã mới `keystore_locked`); plan G5-04, G5-06 (không đường lưu trực tiếp), G5-11 |
| F5.8 | plan X-02 (preload sáu app → IPC `uniwork:ai-run` → `editorDirtyStates`), G5-03w (test unload), G6-05; EXPERIENCE › Foundation (danh sách đường kết thúc duy nhất); plan §6.3 |
| F5.9 | plan G6-02 (nơi lưu/TTL hội thoại), G6-03a (luật 7 theo hội thoại, kê khai §8.3, migration nếu Postgres), G6-05 (chỉ gửi lượt mới), G6-03b; EXPERIENCE › Vòng đời lượt chạy, Flow 1 |
| F5.10 | plan §3 (G6-D5 gộp vào G6-D2, thứ tự gate), X-03 (`Default: false`), X-01/G7-01 (bỏ vòng phụ thuộc: harness chạy ở G7-01, điều kiện ra P0 ở plan §6.5) |
| F5.11 | G7-07 (alert chỉ trên metric server D), G7-06 (script trích xuất G6-01), G6-07s (fake Dify trong `check.sh`, staging qua cloud runner), plan §5.6 (G6-A07/A08 thêm task chạy); plan §8 + OQ-UX13 (telemetry app) |
| F5.12 | plan G6-02 (trần đồng thời, LoadShed), G6-03a (test `/api/v1/tasks` không 503), G7-07; plan §6.3 (`router.go`), §8 |
| F5.13 | EXPERIENCE › Vòng đời lượt chạy › 429, Offline library rows (S3), Lý do bị chặn, Trạng thái khóa (S11), Queue rows; DESIGN › Colors; plan G5-05, G6-05, G6-05u, X-02 (test `onReject`), §2/§6.1 (dấu C2/C3 và gate chỉ ở bảng wave) |
| F5.14 | EXPERIENCE › Save pill (thứ tự ưu tiên đủ, `reconciling-stuck`, `paused_user`), Ctrl/⌘+S theo trạng thái, Queue rows, Conflict dialog (S5) › Biến thể, Offline library rows (S3), Thanh phiên bản mới (S6), Component Patterns (Second-window bar, Lock-while-open bar, Sign-out prompt, Composer note, Result chip); plan G5-06, G5-08c, G5-11, G6-02, G6-05 |
| F5.15 | plan G5-04, G5-06, G5-11 (test thêm), U-01/U-02 (chỉ câu trung tính với số, kiểm ở 1, 2, 5 cho vi/en/ru/pl), G6-11 → G6-08 (nhập lại bản phát hành thứ hai), X-02 Test (2); EXPERIENCE › String catalogue › Số đếm |
| F5.16 | plan đầu trang (quy ước `plan §n`), §5 (khuôn task một chỗ, dòng Gate trên mọi thẻ), §6.5 (điều kiện ra mốc tách khỏi 6.1), §7 (bỏ cột Host, tên mục spine đúng), §8 (gộp hai hàng migration store); EXPERIENCE (Foundation, Responsive và Inspiration chỉ trỏ; Conflict dialog (S5) thành mục riêng; bỏ OQ-UX5); DESIGN (bỏ danh sách trạng thái → tone, CSS chuyển về Floor); log này rút gọn |
| F5.17 | EXPERIENCE › Accessibility Floor › Focus ring (ngoại lệ `.ai-model-item:focus-visible`), › S7 (focus về chip sau khi chọn); plan G6-05u, G7-09; mockup `ai-provider-states.html` |
| F5.18 | EXPERIENCE › Accessibility Floor (S1, S2/S3, S5, S7–S9, S11, Sign-out prompt); mockups (`.err` thu gọn, nút 44px khi coarse, tiêu đề focus được, Usage header trong tabpanel, nhãn pill không live, nút live riêng của luồng) |
| F5.19 | DESIGN › Components (Sync center, Second-window bar, Lock-while-open bar, Sign-out prompt, Discard confirm, link mockup, token `{spacing.0.5}`/`{spacing.1}`); EXPERIENCE › String catalogue (vị trí khóa web, khóa dùng lại `uwReasonForbidden`/`uwReasonQuota`/`uwReasonTooLarge`/`uwReasonOther`/`uwChipUnreachable`), Flow 2 |

Kiểm sau vòng 5: cây ticket 55 entry, `tickets.py status` không `unpinned_after`/`undeclared_after`/`order_conflict`,
chuỗi dài nhất 10 bước; script đồng bộ thẻ plan → cây và so phụ thuộc: 0 lệch (G5-13 không còn được bỏ qua); UX ở
`docs/office/g5g6g7/ux/` và `_bmad-output/ux-office-g5g6g7/` giống từng byte; mọi tài liệu ở đây dùng LF.

## Vòng 6 (plan v2.4)

| Finding | Sửa ở |
| --- | --- |
| F6.1 | EXPERIENCE › Conflict dialog (S5) › Lần Lưu do host web gửi (chỉ `SaveResult` + mã sẵn có `cancelled`/`unauthorized`/`forbidden`/`not_found`/`internal`, watchdog 30 giây qua `signal`, `navigate` gặp 401/403/410/5xx); plan X-02, G5-09w (D: `cancelled` không gọi `onError`, test watchdog) |
| F6.2 | plan X-03 (`office_sync_feed`/`office_sync_write` `Default: true`, còn lại `false`; test deployment mới vẫn commit), G5-07 (test cùng ý) |
| F6.3 | plan G5-04 (`uniwork-auth/manager.ts`, `session-core.ts`: trạng thái `keystore-locked`, test restore/Thử lại/không ghi đè credential), G5-10, G5-11 (đăng xuất vẫn khóa ngay); EXPERIENCE › Sign-out prompt, Lý do bị chặn, `uwSignOutKeystore` |
| F6.4 | plan G6-03a luật 7 (buộc theo claim của frame token, route phiên cho tệp cục bộ, `conversation_expired`, test xoay token và hai điều kiện dọn), G6-05 (hội thoại mới khi hết hạn/đổi nhà cung cấp); EXPERIENCE › Vòng đời lượt chạy, Lỗi của một lượt (S9), Tệp cục bộ (S10), khóa `aiConversationRestarted`/`aiConversationBoundary` |
| F6.5 | EXPERIENCE › Conflict dialog (S5) › `api.download` (Blob + `<a download>`, `can_edit`, trần export, bản sao không có access log), Bước 2 web ("Quay lại" ở bước kiểm tệp), Biến thể 413; OQ-UX14; plan X-02 (frame khai `download: true`, test dương theo module), G5-09w |
| F6.6 | plan G6-03a (semaphore theo pod + lease Redis, `middleware/loadshed.go` miễn theo tiền tố, test `HTTPMaxInFlight` ≤ trần có đối chứng 503, chạy không Redis) |
| F6.7 | plan X-01 (semver tăng ngặt mỗi bản dev), G5-04g (đóng khi lỗi, test so phiên bản; test `fcfcd29d` chuyển sang G7-05; N′ trên mọi kênh), G5-04 (`min_app_version` = bản build của chính nó), G7-05, G7-07 (support matrix theo kênh), plan §8 |
| F6.8 | plan X-02 (`detached-windows.ts` và tab trình chiếu cùng registry; `api.open {version_id}`; revision tăng không version mới → không sự kiện), G5-03w, G5-03a, plan §6.3; EXPERIENCE › Foundation, Thanh phiên bản mới (S6) |
| F6.9 | EXPERIENCE › Save pill (view-only dưới các trạng thái có intent), Pause/resume gửi (theo tài khoản), Queue rows (thoát về `paused_user`, nháp tối đa/`store_full`, tải về desktop, "Lưu lại" superseded trước, `uwRemoteWaitStuck`, `uwSyncStoreError`), Lý do bị chặn (`keystore_locked` là lớp phủ), Cancel intent, Thanh phiên bản mới (S6) (host cũ, revision nhỏ hơn), Conflict dialog (S5) › Biến thể, Trạng thái khóa (S11) (`signed_out`); plan G5-06 (test thêm) |
| F6.10 | plan G5-04 (route capability 401 → `session_expired`), G6-03a (hai điều kiện dọn), G5-09w (`save-conflict-dialog.tsx` không có test riêng), G5-07, G6-03b, G6-04 (tên metric tiền tố `uniwork_`) |
| F6.11 | EXPERIENCE › Mở rộng `frame-dialog.ts` (ARIA chỉ trỏ Floor › S5); plan §8 (gộp hai hàng store), dòng Unknown trên 13 thẻ, §3 (quy tắc dấu wave) + dòng Gate của G5-05, G6-03a, G7-07, G7-08, G7-11 và wave W8, cây ticket (`references` của 2.9w/2.3w), §7 (Pin offline, Unpin offline; Provider row "UniWork AI"), G5-04 (trỏ đoạn "Feed"), "ma trận §6.5" ở mọi chỗ trỏ spec, phụ thuộc không còn ghi chú trong ngoặc (G5-04, G5-06, G5-03w, G5-03a) |
| F6.12 | EXPERIENCE › Accessibility Floor (vùng live ngoài `inert`, bản trong thanh không live, mô tả pill chỉ trên nút, nút pill `aria-disabled`, picker theo listbox APG, `th scope=row`, focus về tiêu đề khi đổi tại chỗ, `uwLockRegion`, focus S4 về chỗ đã mở); DESIGN › Colors (forced colors); mockups (vùng chạm pill không đối xứng, `.opt` 44px khi coarse, luồng không `aria-live`, thanh/ghi chú không live); plan G5-06u, G6-05u |
| F6.13 | DESIGN (ánh xạ `danger-dark` → `--danger-strong`, `{spacing.half}`, Toast không có mock); EXPERIENCE › String catalogue (vị trí chuỗi panel AI, khóa `uwRowBlocked`, `uwActDiscard`, `uwActDiscardSave`, `uwOfflineUnpinShort`), `sources` theo bản trong repo; mockup `sync-center.html` (câu đã đăng xuất theo catalogue, hàng `paused_admin` một dòng phụ) |

Kiểm sau vòng 6: cây ticket 55 entry, `tickets.py status` không `unpinned_after`/`undeclared_after`/`order_conflict`,
chuỗi dài nhất 10 bước; đồng bộ thẻ plan → cây và so phụ thuộc: 0 lệch; UX ở hai nơi giống từng byte; LF.

## Vòng 7 (plan v2.5)

Bốn major là hệ quả của luật vòng 6. Chỗ cần luật thiết kế mới không được viết vào plan: plan §3 thêm bảng "Câu hỏi
thiết kế mở chặn task" (OQ-P1..P4, có bằng chứng của review r7, task quyết, owner, test bắt buộc), bỏ câu khẳng định sai,
và task sở hữu ghi OQ ở dòng Unknown + điều kiện xong.

| Finding | Sửa ở |
| --- | --- |
| F7.1 | plan §3 OQ-P1 (X-01 quyết, G1/FileService ký); bỏ luật "revision tăng không version mới → không gửi `doc.remoteVersion`" ở X-02, G5-03w và EXPERIENCE › Foundation; Unknown ở X-01, X-02, G5-03w, G5-06, G5-07; EXPERIENCE › Queue rows (`moved`), Lý do bị chặn (`document_archived`), OQ-UX15 |
| F7.2 | plan §3 OQ-P2 (G6-02 quyết); G6-02, G6-03a (luật 7 không còn coi route phiên chỉ là tệp cục bộ; test theo OQ-P2), G6-05 Unknown |
| F7.3 | plan §3 OQ-P3 (X-02 quyết; bất biến không ghép byte cũ với revision head là AC); X-02 (bỏ khóa `version_id` cố định, test (7), điều kiện xong), G5-03w, plan §6.3; EXPERIENCE › Foundation, Thanh phiên bản mới (S6), OQ-UX15 |
| F7.4 | sửa thẳng: G5-04g — N′ không có bộ đọc schema 2 nên mọi binding `schema ≥ 2` → S11 (bỏ nhánh "≤ → không khóa" và test so semver); phép so chuyển vào G5-04 (+ test). Phần luật: plan §3 OQ-P4 (X-01 quyết phép so độc lập kênh), X-01 bỏ "semver tăng ngặt" |
| F7.5 | G5-09w + EXPERIENCE › Conflict dialog (S5) (watchdog → `timeout`, tạm dừng khi `api.save` đang chạy, đặt lại khi `modal {open:false}`; test). Còn lại: lối thoát khi frame treo sau `modal {open:true}` |
| F7.6 | phần dư (xem dưới) |
| F7.7 | G5-04 thêm file renderer cho `keystore-locked` + test. Còn lại: lỗi giải mã vĩnh viễn, đăng nhập khi đang khóa, ưu tiên giữa `uwSyncStoreError` và badge kho khóa, working copy plaintext khi đăng xuất |
| F7.8 | phần dư |
| F7.9 | "trần export" (không tồn tại ở D) → "trần tải về" do G5-09w chốt (plan G5-09w, EXPERIENCE); test dương theo module chuyển từ X-02 sang G5-09w, X-02 giữ assertion protocol. Còn lại: 413 đang tắt đường tải về cứu dữ liệu; version đã dọn/khác tài liệu (đưa vào test OQ-P3) |
| F7.10 | G6-03a: bỏ "miễn theo tiền tố", miễn theo mẫu route và giữ body deadline; file `loadshed.go` "nếu miễn". Còn lại: chọn có miễn hay không và biến thể test không miễn |
| F7.11 | §6.1 bỏ dấu G5-D3 ở G5-06, G5-05 chỉ còn "khi G5-D1", U-02 bỏ dấu và Gate "không (chờ U-01)" (§2, §3); G6-D2 "Chặn" thêm G6-03a phần dữ liệu thật; ghi chú sub-issue của G6-12 chuyển lên Sản phẩm |
| F7.12 | mockup: mô tả pill chỉ trên nút, hàng progress `th scope=row`. Còn lại: ghi phần dư |
| F7.13 | EXPERIENCE › String catalogue › Vị trí (chuỗi AI ở `packages/ui/src/strings-ai-*.ts`, shard `i18n/ai` theo app, `ai-web`; `ai-notice.ts` là bảng en/vi duy nhất), U-02 thêm các file đó; mockup S3 hàng lease hết hạn dùng `uwRowBlocked`. Còn lại: ghi phần dư |

**Phần dư đã biết (minor, chưa sửa; đội nhận bàn giao xử lý ở task nêu):**
- F7.5 (G5-09w): frame treo sau `modal {open:true}` để trang host bị inert và điều hướng bị giữ — cần lối thoát
  ("Tải lại trang", gỡ inert) sau N giây không có heartbeat.
- F7.6 (X-03, G5-07, G5-03w): `office_capability_off` trên route commit dùng chung chưa có HTTP status cố định; web hiện
  ánh xạ "403 khác" thành thanh revoke. Cần status/`error_class` riêng, chỉ áp cho dispatch intent G5 hoặc thêm hàng web
  `uwSyncWriteOffWeb`; nêu cách bản desktop trước G5 xử lý.
- F7.7 (G5-04, G5-10, G5-11): lỗi giải mã vĩnh viễn (đổi mật khẩu Windows, keyring mới) báo là `locked` → cần "Đăng xuất"
  / "Đăng nhập lại, bỏ dữ liệu không đọc được" và "Đặt lại bộ nhớ đồng bộ…"; kết quả đăng nhập khi đang khóa
  (`acctErrKeystoreLocked` hay phiên chỉ RAM); hàng đầu trang S2 cho `keystore-locked`; badge kho khóa và
  `uwSyncStoreError` cái nào thắng; working copy plaintext và `PendingIntent` schema 1 khi đăng xuất lúc kho khóa khóa.
- F7.8 (G6-03a, G6-05): dọn hội thoại khi "bắt đầu mới" chỉ nên dọn id client chủ động kết thúc (hai panel cùng tài
  liệu); đăng xuất offline không tới server (dọn khi revoke/hết TTL); `conversation_expired` giữa lượt (kết thúc lượt,
  `aiRun idle`, chip); thứ tự với capability tắt giữa lượt; đổi org/tài liệu/module trên cùng luồng; phạm vi mốc
  `aiConversationBoundary` với BYOK.
- F7.9 (G5-09w): khi Ghi đè trả 413, tải về nên là đường cứu chính thay vì bị tắt.
- F7.10 (G6-03a): quyết có miễn LoadShed không; nếu không, test biến thể trần + khoảng dư < `HTTPMaxInFlight`.
- F7.12 (G6-05u, G7-09, mockups): `role=status` trong luồng đang chạy, vòng focus picker theo accent của app, chưa vẽ
  `inert` sau S5; forced colors của tùy chọn đang chọn (viền và vòng focus cùng màu → dùng `outline-offset`/vòng kép);
  hai nút live của trang host web ngoài cây inert; nút Gửi AI dùng `disabled` gốc (`AiComposer.tsx:155`); mô hình chọn
  bằng phím mũi tên; nút live của panel nằm trong vùng S5 làm inert; `ai-input-need`; S11/S4 đọc tiêu đề hai lần; thay đổi
  fork của pill (`:disabled`, `title`) chưa liệt kê.
- F7.13 (U-01, G6-05u, G5-09w): bảng tone cho Sync header status line và Composer note; lỗi S9 nào là chip "Lỗi" và lỗi
  nào là Composer note; trạng thái đang chạy của S5 khi Ghi đè/Tải lại (`aria-busy`, nút `aria-disabled`); nhãn "Thử
  lại", "Đăng nhập lại", "Đăng nhập" của panel AI chưa có khóa trong shard panel đọc được; tên khóa cho chuỗi tín dụng/
  trạng thái chép vào picker.

Kiểm sau vòng 7: cây ticket 55 entry (thêm `unknown` OQ-P cho 8 entry), `tickets.py status` không
`unpinned_after`/`undeclared_after`/`order_conflict`, chuỗi dài nhất 10 bước; đồng bộ thẻ plan → cây và so phụ thuộc: 0
lệch; UX ở hai nơi giống từng byte; LF.

## U-12 bỏ Dify (spec v1.2, plan v2.6, 2026-10-12)

Quyết định người dùng 2026-10-12 (nguyên văn): "k cần giao task cho bên đó đâu bro. bỏ luôn đi cũng được. về url dify
config thì có thể test tạm bằng config của custom provider trong codex". Không phải finding review; ghi ở đây để các
vòng trên (nhắc G6-04, G6-06, G6-07a/s/b, G6-11, corpus, Dify) đọc như lịch sử.

| Mục | Đã đổi |
| --- | --- |
| Spec | v1.2: thêm U-12; U-02 gạch, U-03 và U-09 viết lại; §1.1, §1.3 (baseline Gateway/provider + upstream dev), §2 (phạm vi G6, ngoài phạm vi thêm Dify/RAG), §3 (sơ đồ, bảng ba đường AI); §6.1 (điều kiện `uniwork_ai` = Gateway bật + capability có model), §6.2 (bỏ hai cách nối và quy tắc dựng query; thêm "Khoảng trống của provider có sẵn": id tool call và message kết quả công cụ chưa có ở `provider.go`/`openai.go`); §7 viết lại thành instruction pack (prompt có version trong registry Gateway); §8 viết lại thành upstream model sau Gateway (§8.1 capability `office_uniwork_ai` + override `AI_MODEL_OFFICE_UNIWORK_AI`, §8.4 upstream dev = custom provider `customlocal` của Codex, CI = `fake`); §9.1 G6-A07/A08/A09/A10, G7-A05 viết lại (G6-A10 thành version instruction pack + không bịa công cụ); §9.2 bỏ recall@5, retrieval latency; §10–§12 bỏ Knowledge release, retrieval no-match, runbook index/import; §13.1 G6-D1/G6-D2 viết lại (giữ mã, bỏ phần Dify); §14 thay nguồn Dify bằng file code đã đọc |
| Plan — task đã bỏ | G6-04, G6-06, G6-07a, G6-07s, G6-07b, G6-11 (danh sách duy nhất ở plan §1); lane L8 bỏ, L13 thành "Instruction pack" |
| Plan — task đổi nội dung | G6-02 thành spike upstream + hợp đồng façade (W1, chỉ chờ X-01); G6-08 thành dev set + tinh chỉnh instruction pack (chờ G6-14, G6-05; không chờ G7-01 để epic G6 không phụ thuộc epic G7) |
| Plan — task mới | G6-13 (capability `office_uniwork_ai`, mở rộng vòng tool-result của provider có sẵn, `.env.example`, ghi chú `docs/office/g5g6g7/dev-upstream.md`, mục RUNBOOK_AI); G6-14 (instruction pack `office_uniwork_ai@1` + golden + script tên công cụ trong `scripts/check.sh`) |
| Plan — phụ thuộc | G6-03a, G6-03c chờ thêm G6-13; G6-10 sweep đổi danh sách; G7-10 chờ G6-14 thay G6-04/G6-07s; G7-12 chờ G6-14 thay G6-04/G6-07b (lên W7); G7-07 bỏ G6-04 |
| Plan — bảng | Plan §2 (C2: thêm G6-13, G6-14 vì PR #219 cũng sửa `provider.go`/`openai.go`/`policy.go`/`prompts.go`; danh sách chạy trước C2/C3), §3 (G6-D1, G6-D2, G7-D1), §4 (luật upstream bằng cấu hình, không ghi host/khóa), §5.6 (G6-A01/A02/A07/A08/A09/A10, G7-A05), §6.1 (lane, wave), §6.2 (đường găng tính lại: 10 bước, ba chuỗi qua G6-02 → G6-13 → G6-03a → G6-03b → G6-05), §6.3 (seam `check.sh`; seam mới provider/policy/prompt), §6.4 (sơ đồ), §6.5 (P0/P1/P2), §8 (rủi ro upstream, một Gateway cho mọi tính năng, lộ host/khóa), §9 |
| UX | Spine và mockup không có trạng thái Dify/retrieval nào; chỉ đổi dòng "spec v1.1" → "v1.2" trong EXPERIENCE.md (hai bản giống từng byte) |
| Cây ticket | Xóa entry 3.4, 3.6, 3.7a, 3.7s, 3.7b, 3.11; thêm 3.13, 3.14; 3.2, 3.8 đổi; tiêu đề epic G6 và initiative bỏ Dify; ghi chú quyết định U-12 ở initiative và epic G6 |
| Roadmap | Ghi chú sau hàng C-17 bỏ Dify |

Kiểm sau U-12: cây ticket 51 entry, đồng bộ thẻ plan → cây (title/description/verify) và so phụ thuộc: 0 lệch;
`tickets.py status` không `unpinned_after`/`undeclared_after`/`order_conflict`, `longest_remaining_chain` 10 bước
(X-01 → G6-02 → G6-13 → G6-03a → G6-03b → G6-05 → G6-05u → G7-04 → G7-05 → G7-11); mọi phụ thuộc của thẻ nằm ở wave
trước; `node --test scripts/governance.test.mjs` xanh.
