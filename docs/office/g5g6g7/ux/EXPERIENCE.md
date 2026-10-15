---
name: UniWork Office — G5/G6/G7 surfaces
status: final
updated: 2026-10-12
sources:
  - ../../../superpowers/specs/2026-10-02-office-g5-g6-g7-design.md
  - ../../../superpowers/plans/2026-10-12-office-g5-g6-g7.md
design: DESIGN.md
---

# UniWork Office G5/G6/G7 — Experience Spine

Spine này là hợp đồng hành vi cho các bề mặt UI của G5 (đồng bộ, offline, Lưu, xung đột) và G6 (nhà cung cấp
UniWork AI trong panel AI genoffice). Mọi `§` trỏ vào spec G5/G6/G7 v1.2 (U-12 bỏ Dify; spine không có trạng thái Dify/retrieval nào); mã task, cổng (X-01, X-02, X-03, U-01, G5-…,
G6-…) và tên trường wire do plan đề xuất (`x_uniwork`, `ask_clarification`, `Retry-After`, `office_capability_off`) trỏ vào plan
và chốt ở task được nêu. Trạng thái `final`: U-01 đã áp các câu trả lời Product đã ký (U-15, 2026-10-12) và đóng Open questions; mọi con số và nhãn ở đây là giá trị đã ký.

## Foundation

- **Hai host, một renderer.** App desktop là repo fork `UNIAI-TEAM/uniwork-office` (Electron: shell renderer +
  main process + renderer của từng app); web nạp renderer genoffice trong iframe `office-frame` của dev-uniwork. Panel
  AI, `AiModelPicker`, composer, pill trạng thái Lưu (`uw-pill` trong `UniworkChrome.tsx`) và hộp thoại của frame
  (`web/modules/shared/frame-dialog.ts`) đều là của genoffice/fork; G5/G6 **mở rộng**, không dựng bản thứ hai. Thay đổi
  có tên trong fork (danh sách duy nhất): `frame-dialog.ts` + `frame-dialog.css` (State Patterns › Conflict dialog
  (S5)), `AiModelPicker.tsx` + `ai-model-picker.css` (Accessibility Floor › S7), `tabbar.css` và `UniworkChrome.tsx`
  (tone `info`, vùng chạm và vùng live của pill — Accessibility Floor › S1), đường xung đột của `webapi.ts`/
  `text-webapi.ts` khi Lưu do host gửi (Conflict dialog (S5)), preload của sáu app + `tab-manager.ts` (`aiRun` desktop,
  dưới đây).
- **G8 (plan v2.8).** Bề mặt S12–S18 và danh sách file fork G8 đổi nằm ở spine riêng [EXPERIENCE-G8.md](EXPERIENCE-G8.md)
  (draft); luật chung của spine này áp nguyên cho G8.
- **UI system.** Token và component của fork (`packages/ui/src/tokens.css`, `home.css`, `styles.css` từng app), i18n của
  shell (`apps/shell/src/renderer/src/i18n/*`) và của từng app/frame (`apps/*/src/renderer/i18n/app/*`,
  `web/modules/shared/i18n/web/*`); khóa nguồn kiểu `zh`, mọi locale phải có khóa. Tham chiếu thị giác: DESIGN.md.
- **Phân chia theo host:** cột Host của Information Architecture (nguồn duy nhất).
- **Capability theo server (desktop).** Desktop đọc capability từ route mới của D (tên chốt ở X-01, đề xuất
  `GET /orgs/{orgID}/office/capabilities` → `{sync_feed, sync_write, offline_library, ai_uniwork, ai_uniwork_formats[],
  ttl_seconds}`), lưu **theo từng tổ chức**; server vẫn từ chối bằng `office_capability_off` nếu client cũ gọi. Quy tắc
  TTL, lỗi và "chưa từng đọc được": State Patterns › Capability tắt (server) (nguồn duy nhất; plan X-03/G5-04 dẫn về đây).
- **Grant và flag (web).** Web nhận quyền qua grant của frame token. Renderer tính khóa `ai` = `granted.ai ||
  granted.uniworkAi` (mở panel AI); `aiCredentials` = `granted.ai` (mục BYOK trong Cài đặt); `uniworkAi` cho hiện
  Provider row; công cụ đám mây cần (`ai` hoặc `uniworkAi`) **và** grant riêng của nó. `sheetsHostGrants`
  (`web/modules/sheets/capabilities.ts`) theo đúng cách tách này (công thức này chỉ ghi ở đây). S6 trên web theo flag
  công khai `office_sync_feed` (đọc qua `GET /api/v1/config`): tắt thì host không gửi `doc.remoteVersion`; Lưu vẫn gặp
  409 → S5.
- **Tín hiệu giữa frame và host** (X-02; sự kiện của frame không có tiền tố).
  - `modal` (sẵn có): hộp thoại của frame mở/đóng.
  - `aiRun {state: running|idle, run_id?}` (mới): phát cho **mọi** lượt AI (UniWork AI, BYOK, CLI). `running` khi lượt
    bắt đầu; **đúng một** `idle` trên mọi đường kết thúc mà renderer còn sống: xong, lỗi, Dừng, mất kết nối, 401, đăng
    xuất, bỏ cuộc sau 429. Chờ `Retry-After` vẫn là `running` (cùng run id). **Đây là danh sách đường kết thúc duy nhất;
    plan dẫn về đây.** Frame unload/tab đóng không phát được gì: host (web) và main (desktop) coi lượt là `idle` khi frame
    unload, mất port/IPC hoặc tab đóng. Desktop: preload của sáu app (`apps/{docs,sheets,slides,pdf,markdown,html}/src/
    preload/index.ts`) mở `reportAiRun(payload)` → IPC `uniwork:ai-run` → registry ở main theo webContents id;
    `TabManager.editorDirtyStates` trả `{path, dirty, aiRunning}` cho từng tab.
  - `doc.remoteVersion {document_id, revision, version_id, …}` (mới, host → frame); thay đổi chỉ metadata không gây xung đột Lưu (server so base nội dung, OQ-UX15, U-15, 2026-10-12), nên có gửi `doc.remoteVersion` cho chúng hay không không ảnh hưởng Lưu và do X-02 chốt. Tải lại dùng `api.open` (khóa xin version và cách trả lời khi version không còn là head do X-02 chốt, OQ-UX15 (U-15, 2026-10-12);
    không bao giờ ghép byte cũ với revision của head); phản hồi mang `FileMeta.revision` của bản trả về
    (host cũ không có trường này: S6 dùng câu không số `uwRemoteUpdatedNoRev`).
  - `api.download {data}` (mới, frame → host): frame gửi bytes đang mở; host tự quyết tên, đuôi, MIME, giới hạn kích
    thước và quyền (hợp đồng: State Patterns › Conflict dialog (S5) › `api.download`). Capability hiệu lực `download` =
    host quảng bá trong `init` **và** frame khai `download: true` (`web/docs/bridge/module-bridge.ts`/`install.ts`); frame
    chỉ vẽ lựa chọn tải về khi có. Frame không có `allow-downloads`.
  - `save` (sẵn có, host → frame): hợp đồng cho lần Lưu do host gửi ở State Patterns › Conflict dialog (S5).
- **Ngôn ngữ.** vi và en là hai ngôn ngữ được thiết kế và duyệt; 19 locale còn lại dùng dịch máy có review, cổng tối thiểu là test parity + placeholder + quét brand (OQ-UX4, U-15, 2026-10-12).
- **Chế độ màu.** light / dark / theo hệ thống, theo `data-theme` của fork.

## Information Architecture

| # | Bề mặt | Host | Mở từ | Mục đích | Spec |
| --- | --- | --- | --- | --- | --- |
| S1 | Pill trạng thái Lưu (mở rộng) | Desktop | Luôn hiện trên tab tài liệu UniWork | Một nhãn đúng cho checkpoint / chờ / đã lưu / cần xử lý | §5.2, §5.3 |
| S2 | Trung tâm đồng bộ | Desktop | Pill S1 → "Xem hàng chờ"; Cài đặt › Tài khoản → liên kết `uwSyncOpenFromSettings` (không có menu tài khoản; OQ-UX7, U-15, 2026-10-12) | Kết nối, lần đồng bộ cuối, hàng chờ, cần xử lý, thư viện offline | §5.3 |
| S3 | Thư viện offline (tab của S2) + hành động ghim | Desktop | S2 tab "Dùng khi không có mạng"; menu tài liệu → "Dùng khi không có mạng" | Ghim/bỏ ghim, tiến trình tải, trạng thái sẵn sàng/lease | §5.1 |
| S4 | Popover hàng chờ của tài liệu | Desktop | Bấm pill S1 khi có intent; Ctrl/⌘+S khi đã có intent | Bản đang chờ (N), có thay đổi mới (N+1), vì sao Lưu bị chặn | §5.2 |
| S5 | Hộp thoại xung đột | Web frame + desktop | Mọi đường Lưu gặp 409 (kể cả nút Lưu của trang host web); pill "Xử lý…"; hàng `conflict` ở S2 | Tải lại bản mới nhất / Lưu thành bản sao / Ghi đè / Hủy | §5.3 |
| S6 | Thanh phiên bản mới | Web frame + desktop | Server có version mới cho tài liệu đang mở; mất quyền; bị xóa | Sạch: đã nạp. Dirty/AI: không nạp, mời xử lý | §4.2 |
| S7 | Mục "UniWork AI" trong picker | Web frame + desktop | Panel AI → chọn mô hình | Chọn UniWork AI khi đủ điều kiện | §6.1 |
| S8 | Lời công bố nội dung gửi đi | Web frame + desktop | Lượt UniWork AI đầu tiên mỗi tài liệu mỗi phiên; dòng phụ thường trực | Nội dung đang mở (kể cả chưa lưu) được gửi và dùng tín dụng tổ chức | §6.1, §8.3 |
| S9 | Kết quả và lỗi của lượt AI | Web frame + desktop | Luồng hội thoại của panel | 5 loại kết quả, lỗi có cấu trúc, Dừng | §6.1, §6.2, §10.2 |
| S10 | AI với tệp cục bộ | Desktop | Panel AI trên tệp chưa bind cloud | Tệp không ở UniWork; cái gì được gửi | §5.1, §6.1 |
| S11 | Trạng thái khóa | Desktop (lock panel); web: thanh S6 error + editor chỉ đọc khi mất quyền/xóa | Mở tài liệu offline bị khóa; nhận revoke/delete; store cần bản app mới hơn | Giải thích, giữ nháp được bảo vệ, cách mở lại | §5.1, §5.3 |

Cột Host là nguồn duy nhất của phân chia theo host. Hộp thoại không chồng lớp (State Patterns › Conflict dialog (S5)).

→ Mockup: [`mockups/sync-center.html`](mockups/sync-center.html) (S1, S2, S3, S4, S11),
[`mockups/conflict-dialog.html`](mockups/conflict-dialog.html) (S5, S6),
[`mockups/ai-provider-states.html`](mockups/ai-provider-states.html) (S7–S10). Spine thắng khi lệch.

## Voice and Tone

Giọng: bình tĩnh, cụ thể, nói dữ liệu đang ở đâu. Tiếng Việt dùng "bạn", câu ngắn, không chữ hoa toàn bộ,
không thán từ. Thời gian theo locale (`Intl`), số theo locale ("12,4 MB" vi / "12.4 MB" en). Câu có số đếm theo quy ước
ở đầu String catalogue.

| Do | Don't |
| --- | --- |
| "Đã xếp hàng lưu — chưa lưu lên UniWork" | "Đã lưu" khi mới chỉ ghi vào hàng đợi |
| "Thay đổi của bạn vẫn an toàn trên máy này." | "Đừng lo!" / "Có lỗi xảy ra" |
| "Đang kiểm tra lần lưu trước…" (reconciling) | "Lưu thất bại" khi chưa biết kết quả |
| "Ghi đè sẽ tạo phiên bản 13 từ bản của bạn. Phiên bản 12 vẫn còn trong lịch sử." | "Ghi đè sẽ xóa thay đổi của người khác" (sai: không xóa version) |
| "UniWork AI đọc nội dung đang mở, kể cả phần chưa lưu" | "AI đọc tài liệu của bạn" (mơ hồ: bản nào?) |
| "AI không tự lưu. Xem lại rồi bấm Lưu." | "AI đã cập nhật tài liệu" (gợi ý đã lưu) |
| Tên sản phẩm giữ nguyên: "UniWork", "UniWork AI", "UniWork Office" | Dịch tên sản phẩm; nhắc GenOffice/Genspark |

Nhãn kết quả AI ánh xạ tên trong spec §6.1 một lần: "trả lời" → `aiResultAnswer` "Trả lời"; "cần làm rõ" →
`aiResultClarify` "Cần làm rõ"; "đã sửa trong editor" → `aiResultEdited` "Đã sửa trong tài liệu"; "không hỗ trợ" →
`aiResultUnsupported` "Chưa hỗ trợ"; "lỗi" → `aiResultError` "Lỗi". Eval §9.2 dùng tên spec, UI dùng nhãn này.

Mọi chuỗi có khóa ở **String catalogue**; bảng trạng thái chỉ dẫn khóa.

## Component Patterns

Bảng này là hành vi. Hợp đồng ARIA (role, nhãn, focus, vùng live, vùng chạm) của mọi thành phần nằm **một chỗ**:
Accessibility Floor, theo mã S. Tên thành phần dùng chung với DESIGN.md › Components.

| Component | S | Quy tắc hành vi |
| --- | --- | --- |
| Save pill (`uw-pill`) | S1 | Một trạng thái tại một thời điểm, theo thứ tự ưu tiên ở State Patterns › Save pill (S1, desktop). Một hành động tối đa. Câu giải thích đầy đủ là cột "Mô tả" của bảng đó, hiện thành tooltip khi hover **hoặc** focus. |
| Queue popover | S4 | Mở từ pill hoặc Ctrl/⌘+S khi có intent. Dòng 1 `uwQueuePopWaiting`; dòng 2 nếu có N+1 `uwQueuePopNewer`; dòng 3 nếu Lưu đang bị chặn: lý do. Hành động: "Mở trung tâm đồng bộ", "Hủy lần lưu…" (chỉ khi biết chưa commit). Đóng bằng Esc hoặc bấm ngoài. |
| Lưu khi đang có intent | S1, S4 | Không tạo intent thứ hai (§5.2 bước 2). Mở S4 với `uwQueueBlockedSave`. Không âm thanh lỗi, không đổi snapshot N. Theo từng trạng thái: State Patterns › Ctrl/⌘+S theo trạng thái. |
| Sync center | S2 | Gồm bốn phần (tên dùng chung với DESIGN): **Sync header** (kết nối + lần đồng bộ cuối + tài khoản/tổ chức + bộ nhớ đồng bộ `uwSyncStoreBudget` + "Đồng bộ ngay" + "Tạm dừng gửi"/"Tiếp tục gửi"), **Sync header status line** (một dòng, thứ tự ở State Patterns › Đầu trang S2), **Sync tab** (tablist: "Cần xử lý", "Đang chờ lưu", "Dùng khi không có mạng" (khi capability offline bật hoặc còn bản đã tải được giữ, OQ-UX11, U-15, 2026-10-12), "Đã lưu gần đây"; mở mặc định ở "Cần xử lý" nếu > 0, ngược lại "Đang chờ lưu"; tab "Đã lưu gần đây" giữ hàng 24 giờ, OQ-UX2, U-15, 2026-10-12), và mỗi tabpanel là một bảng **Sync row**. Tabpanel S3 có **Usage header** (`uwOfflineUsage` + "Thêm tài liệu…") nằm trong tabpanel, trên bảng. "Đồng bộ ngay" khi offline: vẫn hiện, không chạy, kèm lý do `uwSyncNowOffline`. |
| Status badge | S2, S3 | Tone và khóa nhãn lấy từ bảng trạng thái; badge luôn có chữ; không tương tác. |
| Pause/resume gửi | S2 | "Tạm dừng gửi" chỉ dừng dispatch intent mới; intent đang `committing` chạy tới receipt hoặc `reconciling`. Không xóa gì. Intent chờ vì người dùng tạm dừng ở trạng thái `paused_user` (State Patterns › Queue rows); trạng thái tạm dừng là **theo tài khoản** (áp cho mọi tổ chức, dù S2 lọc theo tổ chức), được lưu và giữ qua lần khởi động lại cho tới khi người dùng bấm "Tiếp tục gửi". |
| Cancel intent | S2, S4 | Chỉ khi `queued`, `paused_offline`, `paused_user`, `paused_admin`, `failed`, `conflict` (biết chắc chưa commit). Xác nhận trong popover `uwQueueCancelConfirm` → `cancelled`, Toast `uwQueueCancelled`. Kết quả: tài liệu về "Có thay đổi chưa lưu"; hủy từ `conflict` (server đã mới hơn) → `remote-newer`. Tài liệu đang đóng: snapshot của intent thành **Nháp đã giữ** ở S2 (không bị xóa); tài liệu đã có 3 nháp (tối đa mỗi tài liệu, OQ-UX2, U-15, 2026-10-12) hoặc store đầy (1 GiB mỗi tài khoản, không gồm thư viện offline) → từ chối hủy với `uwConflictDraftCapReached` / `uwQueueFull`, intent giữ nguyên. Không có ở `validating/uploading/committing/reconciling/reconciling-stuck`. |
| Pin offline | S3 | Hành động trong menu tài liệu và nút "Thêm tài liệu…" ở Usage header. Online: tải ngay; offline: `uwOfflineBadgeWaiting`. Đạt giới hạn (2 GiB mỗi tài khoản trên một máy hoặc 200 tài liệu ghim, cái nào chạm trước; OQ-UX2, U-15, 2026-10-12): nút và mục menu vẫn bật, chọn thì hiện `uwOfflineCapReached` và không ghim. Không có "ghim cả thư mục/không gian" ở v1. |
| Unpin offline | S3 | Không cần xác nhận khi không có nháp/intent. Có nháp/intent: xác nhận `uwOfflineUnpinConfirm`. Không bao giờ xóa nháp/intent (§5.1). Tài liệu đang mở ở một tab: bản tải về chỉ được dọn sau khi tab đóng (không còn reader). |
| Download progress | S3 | Thanh + chữ `uwOfflineRowProgress` + "Hủy tải" (`uwOfflineCancelDownload`). Hủy hoặc mất mạng → `interrupted`, giữ bản cũ nếu có. "Sẵn sàng offline" chỉ sau kiểm checksum. Bản cập nhật vượt giới hạn, hỏng hoặc thiếu dung lượng: giữ bản `ready` cũ, dòng phụ `uwOfflineRowUpdateKept`. "Tải ngay" khi tài liệu đang mở và dirty: tải bản mới vào cache nhưng **không** thay nội dung đang mở; tài liệu nhận S6 dirty. |
| Conflict dialog | S5 | Toàn bộ hợp đồng (thứ tự, focus, bước xác nhận, biến thể, lần Lưu do host web gửi, `api.download`, mở rộng `frame-dialog.ts`): State Patterns › Conflict dialog (S5). |
| Mở S5 từ hàng S2 | S2 → S5 | "Mở để xử lý" khi tài liệu đang đóng: mở tài liệu (nội dung của intent, chỉ đọc phía sau hộp thoại) rồi hiện S5 khi đã nạp xong head; offline: biến thể "Desktop offline" của S5. Hủy S5 để lại tài liệu ở trạng thái dirty với intent `conflict` giữ nguyên. |
| New-version bar | S6 | Một thanh, không chồng. Sạch: nạp xong rồi hiện thanh info; tự ẩn sau 8 giây (OQ-UX2, U-15, 2026-10-12) **chỉ khi** không có focus và không có hover trong thanh; câu vẫn tra lại được (desktop: S2 "Đã lưu gần đây"; web: lịch sử phiên bản). Dirty / AI chạy / có intent: thanh warn, không nạp, hai hành động "Tải lại bản mới nhất…" (mở S5 bước Reload confirm) và "Để sau"; pill `remote-newer`. Chi tiết theo trạng thái: State Patterns › Thanh phiên bản mới (S6). |
| Second-window bar | S1 | Skin của New-version bar (tone info). Mở một Document đã có cửa sổ khác giữ lock: cửa sổ mới chỉ đọc, thanh `uwLockOtherWindow` + "Chuyển tới cửa sổ đó". Lock có heartbeat và **generation**: cửa sổ giữ lock treo hoặc crash không gửi heartbeat quá 15 giây (nhịp 5 giây, mất sau 3 nhịp lỡ; OQ-UX2, U-15, 2026-10-12) → thanh đổi thành `uwLockOtherWindowGone` + "Sửa ở cửa sổ này"; khi chọn, generation tăng; cửa sổ cũ sống lại thấy generation mới và tự thành chỉ đọc với cùng thanh (không bao giờ hai cửa sổ cùng sửa). |
| Lock-while-open bar | S11 | Skin của New-version bar (tone error). Tài liệu **đang mở và dirty** khi khóa xảy ra: giữ bộ đệm chỉnh sửa trên màn hình ở chế độ chỉ đọc, chặn Lưu và chép/xuất theo policy; nháp N+1 ghi vào store mã hóa, thanh `uwLockWhileOpen`. Store không ghi được (kho khóa đang khóa, `store_full`): bộ đệm chỉ còn trong RAM, chỉ đọc, thanh `uwLockWhileOpenRam`; đóng cửa sổ thì mất (hộp thoại đóng của fork hỏi như với tệp chưa lưu). |
| Provider row "UniWork AI" | S7 | Hiện khi đủ điều kiện ở State Patterns › UniWork AI (S7–S10). Desktop: tên "UniWork AI" + tên mô hình Gateway khi server gửi (`uniwork_model`, G6-05m) + mô tả tín dụng (`cloudCreditsLeft`/`cloudCreditsUnlimited`). Web: tên "UniWork AI" + tên mô hình khi server gửi (`uniwork_model`; server cũ không gửi, `""` hoặc UniWork AI tắt thì chỉ nhãn), không dòng tín dụng ở v1 (grant frame chỉ có boolean); hết tín dụng hiện bằng lỗi 402 (S9). Không bao giờ hiện bản disabled. |
| Picker footer | S7 | Desktop: dòng chú thích dưới danh sách, ngoài listbox, sau nút "Quản lý". Là chú thích, không phải lỗi (OQ-UX3, U-15, 2026-10-12). Dùng nhãn `cloudState*` + nút "Chi tiết" (mở Cài đặt › Tài khoản) hoặc "Đăng nhập" khi `signed-out`. Không có footer khi chưa đọc được server lần đầu; có khi server trả `cloud_unavailable`. Web: không có footer. |
| Composer note | S7–S9 | Một ghi chú tại một thời điểm, phía trên composer. Khi nhiều điều kiện cùng đúng, ưu tiên: signed-out > capability/format tắt > not-entitled > subscription-inactive > credits-exhausted > unavailable. Dòng phụ chỉ xem (`aiUniworkViewOnly`) là dòng riêng dưới composer, có thể cùng hiện với ghi chú. Nội dung và hành động theo bảng trạng thái UniWork AI và bảng lỗi. Không tự ẩn; mất khi người dùng chọn hành động hoặc đổi nhà cung cấp. |
| AI disclosure | S8 | Chọn UniWork AI: khối mở rộng xuất hiện trên composer, không cướp focus. "Gửi" chưa chạy khi chưa xác nhận; bấm "Gửi" lúc đó đưa người dùng tới khối. Sau "Đã hiểu": dòng phụ thường trực dưới composer. Đổi tài liệu hoặc tổ chức → hiện lại khối mở rộng (OQ-UX10, U-15, 2026-10-12; G6-05u lưu "đã hiểu" theo khóa tài khoản, tổ chức, tài liệu). |
| Result chip | S9 | Mỗi câu trả lời UniWork AI có đúng một chip, là chữ đầu của đoạn trả lời (cùng một nút với chữ). Quyết định xác định (thứ tự ưu tiên): (1) **Đã sửa trong tài liệu** nếu có ít nhất một công cụ ghi chạy thành công trong lượt (thắng mọi loại khác; nếu lượt sau đó kết thúc bằng lỗi, câu trả lời **vẫn** có chip này **và** một dòng lỗi theo bảng S9 kèm hành động của nó); (2) **Chưa hỗ trợ** nếu server báo tool call bị bỏ (chỉ qua `x_uniwork.dropped_tool_calls`), và không công cụ ghi nào chạy — lý do bỏ `view_only` → dòng `aiErrViewOnlyEdit`, `not_allowlisted` → `aiErrUnsupported {module}`; (3) **Cần làm rõ** chỉ khi model gọi công cụ làm rõ `ask_clarification` trong allowlist; (4) **Lỗi** khi lượt kết thúc bằng lỗi trong bảng S9; (5) còn lại **Trả lời**. G6-D1 (lô #2, 2026-10-13) đã chốt: tín hiệu bỏ là `x_uniwork.dropped_tool_calls` (mở rộng wire, A13); `finish_reason` giữ chuẩn. Lượt bị Dừng mà chưa ghi: có chữ trả lời thì chip "Trả lời" + dòng `aiRunStopped`; chưa có chữ thì không có câu trả lời, chỉ dòng `aiRunStopped`. "Đã sửa…" kèm "Xem thay đổi", dòng meta (XLSX: sheet/range, số ô ghi, số ô có sẵn bị ghi đè, số dòng, cảnh báo — §6.5) và `aiResultEditedHint`. Engine không tính được (§6.5): chip "Trả lời" với cảnh báo trong dòng meta. |
| Stop | S9 | Khi lượt chạy, nút "Gửi" đổi thành "Dừng". Dừng cũng bằng Esc khi focus trong composer và không có popup nào mở. Sau dừng: dòng `aiRunStopped`. |
| Toast | S1, S2 | Toast một lần của shell (ví dụ `uwQueueCancelled`). Không tự tắt khi đang hover hoặc focus; nội dung cũng có trong S2. |
| Lock panel | S11 | Desktop, khi mở tài liệu bị khóa: vùng editor thay bằng panel khóa (biểu tượng + tiêu đề + câu + hành động). Lý do và hành động: State Patterns › Trạng thái khóa (S11). Web không có panel khóa: mất quyền/xóa trên web là thanh S6 error + editor chỉ đọc. |
| Discard confirm | S2, S3 | Xác nhận ngay trong hàng (không hộp thoại): hàng thay hành động bằng câu `uwDiscardDraftConfirm` (hoặc `uwStuckDiscardConfirm` cho hàng `reconciling-stuck`) + "Bỏ" (`uwActDiscard`, danger) + "Quay lại" (focus mặc định); "Quay lại" trả hàng về như cũ và focus về nút đã mở. |
| Sign-out prompt | S1, S2 | Đăng xuất khi còn tài liệu dirty hoặc intent: hỏi `uwSignOutTitle` / `uwSignOutBody`; nút "Đăng xuất" + "Quay lại" (focus mặc định). "Quay lại": không đổi gì. Sau "Đăng xuất": intent đang `committing`/`reconciling` được chờ tới receipt hoặc `reconciling` trong giới hạn của G5-11 (hiện `uwSignOutWaiting`), quá giới hạn thì giữ mã hóa ở `reconciling`; tải offline đang chạy → `interrupted`; mọi thứ khóa với lý do `signed_out`. Kho khóa đang khóa (không giữ mã hóa được phần chỉ có trong cửa sổ): câu `uwSignOutKeystore` nêu rõ phần sẽ mất; nút "Đăng xuất" (danger) + "Quay lại" (focus mặc định). Đăng xuất **vẫn khóa ngay** (§5.1): những gì đã giữ mã hóa bị khóa, bộ đệm chỉ có trong RAM bị bỏ, không ghi plaintext; kho khóa hỏng hẳn cũng không chặn đăng xuất. |

## State Patterns

### Lý do bị chặn (dùng chung cho pill, hàng S2, S3, S11)

| Lý do | Nhãn pill (`uwChipBlocked {reason}`) | Badge (khóa) | Hành động | Thoát |
| --- | --- | --- | --- | --- |
| `session_expired` | `uwReasonSession` | error `uwBadgeBlocked` | Đăng nhập lại | Đăng nhập cùng tài khoản → queued |
| `signed_out` | `uwReasonSignedOut` | error `uwBadgeLocked` | Đăng nhập | Đăng nhập cùng tài khoản/deployment → mở khóa |
| `foreign_account` | `uwReasonForeign` | error `uwBadgeLocked` | Chuyển tài khoản | Chỉ tài khoản chủ mở được; không hiện tên tài liệu |
| `permission_revoked` | `uwReasonForbidden` (sẵn có) | error `uwBadgeRevoked` | Kiểm tra lại · Bỏ nháp… | Cấp lại quyền (biết qua feed hoặc "Kiểm tra lại") → queued; nếu không, giữ khóa tới khi người dùng bỏ nháp |
| `document_deleted` | `uwReasonDeleted` (sẵn có) | error `uwBadgeDeleted` | Kiểm tra lại · Bỏ nháp… | Khôi phục tài liệu → queued; nếu không, kết thúc khi người dùng bỏ nháp |
| `document_archived` | `uwReasonArchived` | info `uwBadgeArchived` | Kiểm tra lại · Bỏ nháp… | Bỏ lưu trữ → queued (không gây xung đột: server so base nội dung, OQ-UX15, U-15, 2026-10-12) |
| `organization_suspended` | `uwReasonSuspended` | error `uwBadgeBlocked` | Kiểm tra lại | Tổ chức được mở lại → queued |
| `member_deactivated` | `uwReasonDeactivated` | error `uwBadgeBlocked` | Kiểm tra lại · Bỏ nháp… | Tài khoản được kích hoạt lại → queued |
| `lease_expired` | `uwReasonLease` | error `uwBadgeReconnect` | Kết nối lại | Gia hạn lease khi online |
| `lease_expired` khi `offline_library` tắt | `uwReasonLease` | error `uwBadgeReconnect` | Mở trung tâm đồng bộ | Không gia hạn được tới khi capability bật lại; nháp giữ khóa ở S2 |
| `keystore_locked` | `uwReasonKeystore` | error `uwBadgeKeystore` | Thử lại | Lớp phủ: kho khóa mở → về đúng trạng thái trước đó (`reconciling` vẫn `reconciling`, không bao giờ thành `queued` chỉ vì mở khóa). Phiên ở trạng thái `keystore-locked` (G5-04), tách khỏi `keyring_unavailable` |
| `clock_rollback` | `uwReasonClock` | error `uwBadgeReconnect` | Kết nối lại | Kiểm thời gian với server khi online |
| `store_full` | `uwReasonStoreFull` | error `uwBadgeBlocked` | Mở trung tâm đồng bộ | Ngân sách store của tài khoản (1 GiB mỗi tài khoản, queue + nháp, không gồm thư viện offline; OQ-UX2, U-15, 2026-10-12) còn chỗ → người dùng Lưu lại |
| `store_newer` (store cần bản app mới hơn) | `uwReasonStoreNewer` | error `uwBadgeLocked` | Đóng | Cập nhật app (bản đọc được schema mới); không tạo intent mới (G5-04g) |

Máy không có kho khóa an toàn (`keyring_unavailable`: Linux `basic_text` hoặc `safeStorage` không dùng được) **không
phải lý do bị chặn**: fork từ chối đăng nhập trên máy đó (lỗi đăng nhập sẵn có `acctErrKeyringUnavailable`, thông báo
`acctKeyringTitle`/`acctKeyringBody`/`acctKeyringShort`), nên không có phiên UniWork, không pill/S2/S3 của tài liệu
UniWork; app chỉ mở tệp cục bộ. Không có đường Lưu UniWork nào ghi plaintext.

Dòng phụ của hàng bị chặn ở S2/S3 (gồm `lease_expired`): `uwRowBlocked {reason}`, `{reason}` = nhãn pill của lý do.
Mã 403 `organization_suspended` / `member_deactivated` và từ chối ghi vì lưu trữ đến từ server; bản dịch của mọi lý do
có khóa ở catalogue. `blocked` không bao giờ tự xóa nháp; "Bỏ nháp…" là hành động có xác nhận của người dùng (Discard
confirm).

### Save pill (S1, desktop) — ánh xạ trạng thái queue §5.2

**Thứ tự ưu tiên (duy nhất):** store_newer/blocked > signed-out > failed > error > conflict > reconciling-stuck >
reconciling > remote-newer > paused_admin > đang chờ AI > saving > paused_user > queued (gồm `paused_offline`) >
view-only > offline > unreachable > dirty > saved. Intent tạo trước khi quyền giảm vẫn hiện trạng thái của nó (dispatch
gặp 403 → blocked `permission_revoked`); view-only chỉ thắng các trạng thái không có intent.

| Trạng thái | Nhãn (khóa) | Tone | Hành động | Mô tả (`aria-describedby`, khóa) |
| --- | --- | --- | --- | --- |
| clean | `uwChipSaved` (sẵn có) | ok | — | `uwTipSavedAt` (sẵn có) |
| dirty | `uwChipDirty` (sẵn có) | — | — | `uwTipDirty` (sẵn có) |
| validating / uploading / committing | `uwChipSaving` (sẵn có) | — + spinner | — | `uwTipSaving` (sẵn có) |
| queued / paused_offline | `uwChipQueued` | info | Xem hàng chờ | `uwTipQueued` |
| queued + N+1 | `uwChipQueuedNewer` | info | Xem hàng chờ | `uwTipQueuedNewer` |
| paused_user (người dùng tạm dừng gửi, online) | `uwChipQueued` | info | Xem hàng chờ | `uwTipPausedUser` |
| paused_admin (sync write tắt) | `uwChipPausedAdmin` | — | Xem hàng chờ | `uwTipPausedAdmin` |
| reconciling | `uwChipReconciling` | warn | Xem hàng chờ | `uwTipReconciling` |
| reconciling-stuck | `uwChipReconcileStuck` | warn | Xem hàng chờ | `uwTipReconciling` |
| committed (+ N+1) | `uwChipSaved` → nếu còn N+1: `uwChipDirty` | ok / — | — | sẵn có |
| remote-newer (dirty, server mới hơn) | `uwChipRemoteNewer` | warn | Xử lý… | `uwTipRemoteNewer` |
| conflict | `uwChipConflict` (sẵn có) | warn | `uwActResolve` (sẵn có) | `uwTipConflict` (sẵn có) |
| blocked | `uwChipBlocked` (sẵn có) + lý do ở bảng trên | error | theo lý do | `uwTipBlocked` (sẵn có); `store_full`: `uwQueueFull` |
| failed (không tự thử lại) | `uwChipError` (sẵn có) | error | Chi tiết | `uwTipFailed` |
| error (sẵn có: lỗi tạm thời khi gửi, ví dụ 5xx trước khi intent được tạo) | `uwChipError` (sẵn có) | error | `uwActRetry` (sẵn có) | `uwTipError` (sẵn có) |
| cancelled | theo Component Patterns › Cancel intent; Toast `uwQueueCancelled` | — | — | — |
| offline (sẵn có, dirty khi không có mạng, chưa bấm Lưu) | `uwChipOffline` (sẵn có) | — | — | `uwTipOffline` (sẵn có); bấm Lưu → queued |
| unreachable (sẵn có, chưa có intent) | `uwChipUnreachable` (sẵn có); có intent thì thành `paused_offline` | — | — | `uwTipUnreachable` (sẵn có) |
| signed-out (sẵn có) | `uwChipSignedOut` (sẵn có); nếu có intent/nháp: blocked `signed_out` | error | Đăng nhập | `uwTipSignedOut` (sẵn có) |
| view-only (sẵn có) | `uwChipViewOnly` (sẵn có) | — | — | `uwTipViewOnly` (sẵn có) |
| đang chờ AI xong bước | `uwChipSaving` (sẵn có; không có chữ riêng) | — + spinner | Dừng AI (`uwActStopAi`; chỉ khi quá ngưỡng) | `uwTipWaitAi`; quá 30 giây (OQ-UX2, U-15, 2026-10-12): `uwTipWaitAiLong` |

Web frame giữ trạng thái Lưu của frame (không có queue); chỉ thêm S6.

### Ctrl/⌘+S theo trạng thái

Hàng đầu tiên khớp thắng (đọc từ trên xuống).

| Trạng thái | Kết quả |
| --- | --- |
| view-only / lock panel / `store_newer` | Không làm gì ngoài thông báo trạng thái sẵn có |
| Đã có intent ở bất kỳ trạng thái nào (gồm khi AI đang ghi) | Không tạo intent; `conflict` → mở S5; `blocked` → S4 với lý do và hành động của lý do; `failed` → S4 với `uwTipFailed`, người dùng chọn "Lưu lại" (intent cũ superseded trước, rồi tạo intent mới) hoặc "Hủy lần lưu…"; còn lại → S4 với `uwQueueBlockedSave` |
| `keystore_locked` hoặc `store_full` (chưa có intent) | Không tạo intent, không gửi request; pill blocked với lý do đó; S4 với câu của lý do (`store_full`: `uwQueueFull`) + "Mở trung tâm đồng bộ". Nội dung chỉ còn trong cửa sổ đang mở |
| remote-newer (chưa có intent) | Online: mở S5 ngay, không tạo intent, không gửi request (409 đã biết). Offline: như hàng dưới; dispatch sau này gặp 409 → `conflict` |
| AI đang ghi (một lượt có công cụ ghi đang chạy, chưa có intent) | Lưu chờ tới ranh giới bước công cụ hiện tại hoặc `aiRun idle` rồi chụp snapshot; pill `uwChipSaving` + `uwTipWaitAi` (như hàng "đang chờ AI xong bước" ở Save pill). Quá 30 giây (OQ-UX2, U-15, 2026-10-12) chưa tới ranh giới: `uwTipWaitAiLong` + hành động "Dừng AI" (`uwActStopAi`) |
| dirty / offline / unreachable (chưa có intent) | Desktop: tạo intent. Không có mạng → `paused_offline` (thắng `sync_write` tắt: không cần biết capability khi chưa gửi được); online và bản capability đang biết có `sync_write` tắt → `paused_admin`; người dùng đang tạm dừng gửi → `paused_user`; capability **chưa từng đọc được** → vẫn tạo intent (ghi coi như bật, State Patterns › Capability tắt). Web online: Lưu của frame; web offline: lỗi Lưu của frame, giữ C18 |

### Queue rows (S2 tab "Đang chờ lưu" / "Cần xử lý")

| Trạng thái | Badge (khóa) | Dòng phụ (khóa) | Hành động | Thoát |
| --- | --- | --- | --- | --- |
| queued | info `uwBadgeQueued` | `uwRowQueued` | Gửi ngay (online) · Hủy lần lưu… | dispatch; dispatch bị từ chối `office_capability_off` → paused_admin (không phải failed) |
| paused_offline | info `uwBadgeWaitNetwork` | `uwRowWaitNetwork` | Hủy lần lưu… | có mạng → queued (`paused_user` nếu người dùng đang tạm dừng gửi) |
| paused_user | neutral `uwBadgePausedUser` | `uwRowPausedUser` | Hủy lần lưu… | "Tiếp tục gửi" → queued |
| paused_admin | neutral `uwBadgePausedAdmin` | `uwRowPausedAdmin` | Hủy lần lưu… | capability bật → queued (`paused_user` nếu người dùng đang tạm dừng gửi) |
| validating / uploading | info `uwBadgeSending` + progress | `uwRowUploading` | — | receipt / reconciling / conflict / failed; `sync_write` tắt lúc này → dừng trước commit, cùng intent về paused_admin (phần đã tải lên có thể bị bỏ; lần dispatch sau tải lại) |
| committing | info `uwBadgeSending` | `uwRowCommitting` | — | receipt / reconciling / conflict / failed; `sync_write` tắt không dừng bước này |
| reconciling | warn `uwBadgeReconciling` | `uwRowReconciling` | Kiểm tra lại · Hướng dẫn | tra cứu (G5-07) trả đã commit → committed; chứng minh chưa commit → queued (attempt mới), hoặc paused_admin nếu `sync_write` tắt, paused_offline nếu mất mạng; trả **không biết/đã bị dọn** → reconciling-stuck (không bao giờ queued); 401 → blocked `session_expired`; 403 theo mã: `organization_suspended`/`member_deactivated`/`document_archived` → blocked lý do đó, 403 khác → `permission_revoked`; 410 → blocked `document_deleted`; quá giới hạn thử (G5-D2) hoặc đã 1 giờ đối soát chưa có kết quả xác định (OQ-UX2, U-15, 2026-10-12) → reconciling-stuck |
| reconciling-stuck | warn `uwBadgeReconcileStuck` | `uwRowReconcileStuck` | Kiểm tra lại · Sao chép mã hỗ trợ · Tải bản của tôi về máy (hộp thoại Lưu của hệ điều hành, tên `{tên} (bản của tôi).{ext}` theo OQ-UX12 (U-15, 2026-10-12); chỉ khi `can_edit` biết gần nhất còn đúng, offline vẫn chạy được vì tệp ở máy) · Bỏ lần lưu… (`uwActDiscardSave`; Discard confirm `uwStuckDiscardConfirm`) | không tạo attempt mới; app tự kiểm lại mỗi 15 phút (OQ-UX2, U-15, 2026-10-12) và khi người dùng bấm "Kiểm tra lại"; đối soát thành công → như hàng reconciling; 403/410 → blocked như hàng reconciling; "Bỏ lần lưu…" → snapshot thành Nháp đã giữ, phần store của intent được giải phóng; tài liệu đã có 3 nháp (OQ-UX2) hoặc store đầy → từ chối với `uwConflictDraftCapReached` / `uwQueueFull`, intent giữ nguyên |
| conflict | warn `uwBadgeConflict` | `uwRowConflict` | Mở để xử lý | Ghi đè/Tải lại → intent cũ superseded; Ghi đè gặp 409 lần nữa → vẫn conflict với head mới |
| blocked | theo bảng lý do | `uwRowBlocked {reason}` | theo lý do | theo lý do |
| failed | error `uwBadgeFailed` | `uwRowFailed {reason}`; `{reason}` dùng lại `uwReasonQuota` / `uwReasonTooLarge` / `uwReasonOther` (sẵn có) | Chi tiết · Lưu lại · Hủy lần lưu… | người dùng chọn; "Lưu lại" = intent cũ superseded rồi intent mới |
| committed | ok `uwBadgeSaved` (tab "Đã lưu gần đây") | `uwRowCommitted` | Mở | hết 24 giờ giữ (OQ-UX2, U-15, 2026-10-12) |
| kept draft | warn `uwBadgeKeptDraft` | `uwRowKeptDraft` | Mở nháp (chỉ đọc, chép được) · Bỏ nháp… | người dùng bỏ nháp. Mất quyền với tài liệu: badge `uwBadgeRevoked`, nháp giữ khóa, chỉ còn "Bỏ nháp…" (không mở, không chép) |
| moved | info `uwBadgeMoved` | `uwRowMoved` | Mở | queue tiếp tục theo quyền ở vị trí mới; di chuyển không gây xung đột: server so base nội dung, lần gửi không gặp 409 chỉ vì di chuyển (OQ-UX15, U-15, 2026-10-12) |
| archived | info `uwBadgeArchived` | `uwRowArchived` | Mở | server từ chối ghi → blocked `document_archived` |

**Superseded** (định nghĩa duy nhất): khi người dùng Ghi đè hoặc Tải lại, intent cũ chuyển `cancelled` với lý do
`superseded`; không bị sửa, không gửi lại ("Lưu lại" trên `failed` cũng superseded intent cũ trước khi tạo intent mới).
Không superseded được intent đang `committing`/`reconciling` (Reload/Ghi đè chờ, `uwRemoteWaitCommit`) hoặc
`reconciling-stuck` (không tự xong: `uwRemoteWaitStuck` + "Mở trung tâm đồng bộ").

Trống: `uwSyncEmptyQueue` / `uwSyncEmptyAttention` / `uwSyncEmptyRecent`. Lần đầu: 3 hàng skeleton. Không đọc được
store: chỉ thông báo `uwSyncStoreError` + "Thử lại" thay cho bảng (không vẽ hàng blocked nào).
Đổi tổ chức: intent giữ gắn với tổ chức của nó và được dispatch theo phiên và bản capability của **tổ chức đó**; S2 lọc
theo tổ chức đang chọn, đầu trang hiện `uwSyncOtherOrg` khi tổ chức khác còn intent.
Feed: cursor hết hạn (410 `change_cursor_expired`) hoặc không hợp lệ → đồng bộ lại toàn bộ, đầu trang `uwSyncResynced`;
không bao giờ hiện thành "Đã xóa". Mỗi tổ chức chạy tối đa một lần đồng bộ lại tại một thời điểm. Đồng bộ lại lại gặp
410: thử lại với backoff tăng dần, tối đa 5 lần liên tiếp (OQ-UX2, U-15, 2026-10-12); quá số đó → đầu trang `uwSyncResyncFailed` + "Đồng bộ
ngay", feed dừng tới khi người dùng bấm hoặc app khởi động lại.

### Đầu trang S2

Sync header status line: một dòng, lấy điều kiện đứng cao nhất:

| Ưu tiên | Điều kiện | Chuỗi |
| --- | --- | --- |
| 1 | Store cần bản app mới hơn | Thay toàn bộ S2 bằng panel S11 `uwLockNewerStore` |
| 2 | Đã đăng xuất | `uwSyncSignedOut` (còn mục khóa) hoặc `uwSyncSignedOutEmpty` (không còn) + "Đăng nhập"; bảng chỉ hiện số hàng bị khóa, không tên tài liệu |
| 3 | Phiên hết hạn | `uwSyncSessionExpired` + "Đăng nhập lại" |
| 4 | Sync write tắt (quản trị) | `uwSyncAdminPaused` |
| 5 | Offline | `uwSyncOffline` |
| 6 | Tạm dừng gửi (người dùng) | `uwSyncPaused` |
| 7 | Đồng bộ lại thất bại quá số lần | `uwSyncResyncFailed` + "Đồng bộ ngay" |
| 8 | Feed tắt (quản trị) | `uwSyncFeedOff` |
| 9 | Vừa đồng bộ lại toàn bộ | `uwSyncResynced` |
| 10 | Online | `uwSyncOnline` |

Dòng tài khoản luôn kèm `uwSyncStoreBudget` (trừ khi đã đăng xuất).

### Offline library rows (S3)

Một hàng hiện một trạng thái, ưu tiên: revoked/deleted > lease-expired/locked > disk-full/corrupt > interrupted >
downloading/verifying > lease-expiring > update-available/update kept > waiting-network > archived/moved > ready/view-only.

| Trạng thái | Badge (khóa) | Dòng phụ | Hành động |
| --- | --- | --- | --- |
| waiting-network | info `uwOfflineBadgeWaiting` | `uwOfflineRowWaiting` | Bỏ ghim |
| downloading | info `uwOfflineBadgeDownloading` + progress | `uwOfflineRowProgress` | Hủy tải |
| verifying | info `uwOfflineBadgeVerifying` | `uwOfflineRowVerifying` | — |
| ready | ok `uwOfflineReady` | `uwOfflineRowReady` | Mở · Bỏ ghim |
| update-available | info `uwOfflineBadgeUpdate` | `uwOfflineRowUpdate` | Mở · Tải ngay · Bỏ ghim |
| update không áp được (vượt giới hạn / hỏng / thiếu dung lượng) | ok `uwOfflineReady` | `uwOfflineRowUpdateKept` | Mở · Thử lại |
| interrupted | warn `uwOfflineBadgeInterrupted` | `uwOfflineRowInterrupted` | Thử lại · Bỏ ghim |
| disk-full (lần tải đầu) | error `uwOfflineBadgeDiskFull` | `uwOfflineRowDiskFull` | Thử lại · Mở thư mục lưu trữ |
| corrupt (lần tải đầu) | error `uwOfflineBadgeCorrupt` | `uwOfflineRowCorrupt` | Tải ngay (`uwOfflineDownloadNow`) |
| lease-expiring | warn `uwOfflineBadgeLeaseSoon` | `uwOfflineRowLeaseSoon` | Mở · Bỏ ghim |
| lease-expired / locked | theo bảng lý do | theo lý do | theo lý do |
| revoked | error `uwBadgeRevoked` | `uwOfflineRowRevoked` | Bỏ ghim |
| deleted trên server | error `uwBadgeDeleted` | `uwOfflineRowDeleted` | Bỏ ghim |
| restored (đã xóa rồi được khôi phục) | → waiting-network / downloading | — | như hàng đích |
| archived trên server | info `uwBadgeArchived` | `uwOfflineRowArchived` | Mở · Bỏ ghim |
| moved | info `uwBadgeMoved` | `uwOfflineRowMoved` | Mở · Bỏ ghim |
| view-only lease | ok `uwOfflineBadgeViewOnly` | `uwOfflineRowViewOnly` | Mở · Bỏ ghim |

Nhãn trong hàng: "Bỏ ghim" = `uwOfflineUnpinShort` (menu tài liệu dùng `uwOfflinePin`/`uwOfflineUnpin`).
Revoked và deleted: khi nhận `permission_revoked` / xóa trên server, hoặc khi gia hạn lease thất bại vì mất quyền,
G5-05 **xóa bản đã commit và asset** khỏi máy; nháp giữ khóa. Hàng không có "Mở". Archived ở lại thư viện tới hết lease.
Trống: `uwOfflineEmpty`. Đạt giới hạn: `uwOfflineCapReached`. Đã đăng xuất: tab hiện số mục bị khóa, không tên.
`offline_library` tắt: bản đã tải được giữ tới khi bật lại hoặc đăng xuất và mở được khi lease còn hạn (OQ-UX11, U-15, 2026-10-12); tab hiện danh sách chỉ đọc (Mở khi lease còn hạn · Bỏ
ghim), không có "Thêm tài liệu…", không tải mới, không gia hạn.

### Capability tắt (server)

| Capability | Khi tắt |
| --- | --- |
| `sync_write` | Không dispatch intent mới; intent mới tạo thành `paused_admin`; `validating`/`uploading` dừng trước commit về `paused_admin`; `committing` chạy tới receipt/reconciling; dispatch bị từ chối `office_capability_off` → `paused_admin`; queue và nháp giữ nguyên |
| `sync_feed` | Không đọc feed: không S6 và không `remote-newer` mới — desktop bỏ qua cả sự kiện realtime cho S6 khi feed tắt; đầu trang S2 `uwSyncFeedOff`; hàng blocked cần "Kiểm tra lại" để biết quyền được cấp lại; Lưu vẫn kiểm `base_revision` nên conflict vẫn được phát hiện. Web: flag `office_sync_feed` tắt → không S6 |
| `offline_library` | Ẩn hành động ghim và "Thêm tài liệu…"; bản đã tải được giữ (OQ-UX11, U-15, 2026-10-12; Offline library rows). Lease hết hạn khi capability tắt: không gia hạn được → S11 `uwLockLibraryOff`; nháp giữ khóa ở S2 |
| `ai_uniwork` hoặc format trong `ai_uniwork_formats` | Mục S7 ẩn; nếu UniWork AI đang được chọn: Composer note `aiUniworkOff`; lượt đang chạy hoàn tất bước công cụ hiện tại, bước tiếp theo bị từ chối với `aiErrCapabilityOff`. Web: flag tắt trước khi grant làm mới → request đầu bị từ chối `office_capability_off` không kèm run id → ẩn S7 + `aiUniworkOff`, không chip lỗi |

**Bản capability (desktop) — quy tắc TTL duy nhất** (plan X-03, G5-04, G5-06, G6-05 dẫn về đây):
- Lưu theo tổ chức; giá trị của tổ chức A không bao giờ áp cho tổ chức B.
- TTL = `ttl_seconds`; thiếu hoặc ≤ 0 → 300 giây.
- Route trả 401 → đường `session_expired`.
- Route lỗi khác (hoặc không có mạng) **trong** TTL → dùng bản biết gần nhất.
- Lỗi hoặc không có mạng **sau** TTL → các capability G5 (`sync_write`, `sync_feed`, `offline_library`) giữ trạng thái
  cuối (server vẫn từ chối lúc dispatch bằng `office_capability_off` → `paused_admin`); `ai_uniwork` coi như tắt.
- Chưa từng đọc được → `sync_write` coi như bật (intent được tạo; server từ chối lúc dispatch nếu thực sự tắt →
  `paused_admin`); `sync_feed`, `offline_library`, `ai_uniwork` coi như tắt.

### Thanh phiên bản mới (S6) — §4.2

Revision so sánh bằng BigInt (chuỗi chữ số), không so chuỗi.

| Trạng thái local | Thanh | Hành vi |
| --- | --- | --- |
| Clean, không có lượt AI chạy | info `uwRemoteUpdated` [Đóng] | Đã nạp qua `api.open`; giữ vị trí đọc khi có thể. Host cũ không trả `FileMeta.revision` → `uwRemoteUpdatedNoRev` (không số) |
| Dirty / có intent / commit chưa rõ | warn `uwRemoteNewerDirty` [Tải lại bản mới nhất…] [Để sau] | Không thay base/nội dung; pill `remote-newer` |
| Clean nhưng một lượt AI bất kỳ đang chạy (`aiRun running`) | warn `uwRemoteNewerAi` [Tải lại bản mới nhất… `uwRemoteReload`] [Để sau `uwRemoteLater`] | Không nạp. "Tải lại bản mới nhất…" khi lượt đang chạy: xác nhận `uwRemoteStopAiConfirm`, dừng lượt rồi mới mở Reload confirm |
| Thanh AI đang hiện, nhận `aiRun idle` | — | Tài liệu vẫn sạch → nạp như hàng Clean; đã dirty → thanh Dirty |
| Đang nạp sạch thì `aiRun running` | warn `uwRemoteNewerAi` | Bỏ kết quả nạp, không thay nội dung |
| Intent đang `committing`/`reconciling` (desktop) | warn `uwRemoteNewerDirty` | "Tải lại bản mới nhất…" (`uwRemoteReload`) `aria-disabled`, lý do `uwRemoteWaitCommit`; chạy được sau receipt hoặc khi đối soát xong |
| Intent `reconciling-stuck` (desktop) | warn `uwRemoteNewerDirty` | "Tải lại bản mới nhất…" (`uwRemoteReload`) `aria-disabled`, lý do `uwRemoteWaitStuck` + "Mở trung tâm đồng bộ" (`uwQueueOpenCenter`) |
| "Để sau" rồi có bản mới hơn nữa | thanh hiện lại với `{n}` mới | Không chồng thanh |
| Dirty trở về sạch (hoàn tác hết) khi server mới hơn | info `uwRemoteNowClean` [Tải lại `uwConflictReloadGo`] | Không tự nạp; người dùng sửa tiếp → về thanh Dirty |
| Đang nạp thì tài liệu thành dirty | warn `uwRemoteNewerDirty` | Bỏ kết quả nạp, không thay nội dung |
| `api.open` trả 403 / 410 | như Revoke / Delete | — |
| Host cũ (reply `api.open` không có `FileMeta.revision`; nó trả bản mới nhất) | sau khi nạp luôn `uwRemoteUpdatedNoRev` | Không bao giờ ghi số được yêu cầu |
| `FileMeta.revision` trả về nhỏ hơn revision đang mở | không thanh | Bỏ kết quả nạp, giữ nội dung, ghi log |
| Revoke | error `uwRemoteRevoked` (web: `uwRemoteRevokedWeb`) | Ngừng read/write; desktop: S11 nếu mất quyền đọc; editor chỉ đọc nếu chỉ mất quyền sửa. Web: thanh này + editor chỉ đọc là S11 của web |
| Delete | error `uwRemoteDeleted` | Dừng replay, không tạo tài liệu mới |
| Lần nạp sạch thất bại | error `uwRemoteReloadFailed` [Thử lại] | Giữ nội dung đang mở |
| Self-echo, `revision` ≤ revision đang mở, `document_id` khác tài liệu đang mở, hoặc `revision` không phải chuỗi chữ số | không thanh | Bỏ qua (chuỗi sai dạng được ghi log) |
| Full resync xong | không thanh; đầu S2 `uwSyncResynced` | Đối chiếu theo id |

`{author}` chỉ hiện khi người xem có quyền xem tên thành viên (host tra qua API thành viên theo quyền); ngược lại
`uwAuthorFallback`.

Web, phản hồi Lưu: 401 → frame báo cần đăng nhập lại, nháp giữ ở C18; 403 theo mã: `organization_suspended`/
`member_deactivated`/`document_archived` → thanh error `uwRemoteOrgBlockedWeb {reason}`, 403 khác → thanh revoke web;
410 → thanh delete; 409 → S5.

### Conflict dialog (S5)

**Thứ tự và focus (câu chuẩn duy nhất; nơi khác dẫn về đây):** thứ tự DOM = thị giác = Tab ở mọi chiều rộng: bảng so
sánh → "Xem khác biệt" (chỉ Docs/DOCX ở v1, module khác ẩn nút; OQ-UX9, U-15, 2026-10-12) → **Tải lại bản mới nhất** (primary) → **Lưu thành bản sao…** (`uwConflictSaveCopy`, OQ-UX6, U-15, 2026-10-12; chỉ khi còn quyền sửa) → **Ghi đè…** (danger) → **Hủy** →
nút đóng X. Focus mặc định **Hủy**: khuôn fork tự chọn cancel khi không có `primary` (hiện trạng tại pin); nếu
implementation đánh dấu "Tải lại" là `primary` thì **phải** truyền `focusId: 'cancel'`. Enter ở Hủy chỉ đóng. Esc = Hủy.
"Ghi đè…", "Lưu thành bản sao…" và "Tải lại bản mới nhất" mở bước xác nhận **trong cùng hộp thoại** (bước thay nội dung, không chồng lớp);
"Quay lại" trả về bước 1 và focus về nút đã mở bước 2. Lượt AI đang chạy khi chọn Tải lại, Ghi đè hoặc Lưu thành bản sao: xác nhận
`uwRemoteStopAiConfirm`, dừng lượt, rồi mới vào bước 2. Giống nhau trên web frame và desktop (desktop vẽ cùng khuôn);
nhãn web dùng khóa sẵn có `appWebConflict*`.

**Một hộp thoại, ở frame (quy tắc duy nhất):** trên web chỉ một hộp thoại xung đột tồn tại tại một thời điểm và nó luôn
ở frame; host xóa `save-conflict-dialog.tsx` và khóa `office.conflict.*` (PR #219).

**Lần Lưu do host web gửi.** Nút Lưu (và hộp thoại rời trang) của host gửi `save {reason}` tới frame với
`{timeoutMs: 0}` (không hết giờ 30 giây khi S5 mở lâu), hủy request khi frame unload, và giữ watchdog riêng qua `signal`:
30 giây không có trả lời **và** chưa có `modal {open:true}` → host hủy request với lý do cục bộ ánh xạ thành `timeout`
(đầu trang lỗi, không phải "dirty" im lặng), điều hướng không bị giữ; watchdog tạm dừng khi frame đang chạy `api.save` của
lần Lưu này và đặt lại khi `modal {open:false}` mà chưa có trả lời. Gặp 409, frame hiện S5 như với Lưu từ trong frame (thay đường hiện tại ở `webapi.ts`/`text-webapi.ts`
trả xung đột về host), và trả lời `save` sau khi người dùng chọn, chỉ bằng `SaveResult` và mã có sẵn của
`PROTOCOL_ERROR_CODES` (không thêm mã):

| Kết quả trong S5 | Trả lời `save` | Trạng thái host |
| --- | --- | --- |
| Ghi đè thành công | `ok: true`, `file`, `versionId` | saved |
| Tải lại xong | `ok: true`, `file` = bản đã nạp, không `versionId` (như "không có gì để lưu") | ready |
| Hủy / Esc / X | `ok: false`, `error.code: 'cancelled'` | dirty; không phải lỗi, host không báo lỗi |
| Ghi đè trả 401 / 403 / 410 / 5xx, người dùng đóng biến thể tương ứng | `ok: false`, `error.code`: `unauthorized` / `forbidden` / `not_found` / `internal` | lỗi theo mã; 403/410 → thanh S6 tương ứng |
| Revoke/delete khi S5 đang mở (biến thể khóa tại chỗ), người dùng đóng | `forbidden` / `not_found` | như Revoke / Delete |
| `reason: 'navigate'` + 409 | S5 hiện, điều hướng bị giữ; Ghi đè/Tải lại xong → điều hướng tiếp; Hủy (`cancelled`) → ở lại trang | như trên |
| `reason: 'navigate'` + 401 / 403 / 410 / 5xx | mã như hàng Ghi đè lỗi | host hiện lỗi; điều hướng giữ qua hộp thoại rời trang sẵn có |

**Bước 2 — Reload confirm (desktop).** Câu `uwConflictReloadDesktopBody`. Nhóm radio: "Giữ bản của tôi làm nháp" (mặc
định) / "Bỏ thay đổi của tôi". Nháp giữ = bytes cục bộ mới nhất (gồm N đang chờ và N+1 nếu có), lưu trong store mã
hóa, hiện ở S2 "Cần xử lý" dạng "Nháp đã giữ"; mở ở chế độ chỉ đọc/chép được, **không bao giờ tự áp lại** lên base mới
(§4.2). Không giữ được nháp — tài liệu đã có 3 nháp, tối đa mỗi tài liệu (OQ-UX2, U-15, 2026-10-12: `uwConflictDraftCapReached` + "Mở trung tâm đồng
bộ") hoặc store không ghi được (`store_full`/`keystore_locked`: `uwConflictKeepUnavailable`) — lựa chọn "Giữ bản của tôi làm nháp" (`uwConflictKeepDraft`)
`aria-disabled` kèm câu lý do; "Bỏ thay đổi của tôi" (`uwConflictDiscard`) không được chọn sẵn và "Tải lại" chỉ chạy khi đã chọn. Intent cũ thành superseded.
Nút: "Tải lại" (primary) + "Quay lại" (focus mặc định).

**Bước 2 — Reload confirm (web).** Web không có kho nháp xung đột và không đưa nháp này vào C18 Restore. Câu
`uwConflictReloadWebBody`. Nút: "Tải bản của tôi về máy rồi tải lại" (chỉ khi capability hiệu lực có `download` **và**
frame token hiện tại có `can_edit`; bản của tôi vượt trần tải về (G5-09w chốt) → `aria-disabled` + `uwConflictTooLarge`), "Bỏ thay đổi
và tải lại", "Quay lại" (focus mặc định). Tải về: frame xuất
bytes đang mở ở định dạng gốc và gửi `api.download {data}` (hợp đồng dưới). Host trả thành công → hộp thoại đổi sang câu
`uwConflictDownloadCheck` + "Tải lại" + "Quay lại": trình duyệt không cho biết người dùng có hủy hộp thoại Lưu tệp hay
không, nên tài liệu **không** tự tải lại; người dùng xác nhận đã có tệp rồi bấm "Tải lại"; "Quay lại" ở bước này về
bước 2, focus nút tải về, tải về lần nữa được. Thất bại → ở lại bước 2,
dòng `uwConflictDownloadFailed`. Lựa chọn tải về trên web được giữ (OQ-UX8, U-15, 2026-10-12); nháp xung đột không vào C18 Restore.

**Bước 2 — Save copy confirm (OQ-UX6, U-15, 2026-10-12; G5-12).** Tiêu đề `uwConflictSaveCopyTitle`, câu `uwConflictSaveCopyConfirm`. Nút: "Tạo bản sao" (`uwConflictSaveCopyGo`, primary) + "Quay lại" (focus mặc định). Bản sao giữ owner, visibility và ACL của tài liệu nguồn, ghi provenance (nguồn, version, revision, checksum) và không mở ACL rộng hơn; tên mặc định do server đặt (`<tên> (bản sao)`). Chỉ khi còn quyền sửa nguồn; thiếu `consent: "copy"` hoặc tài liệu do Work Product sở hữu bị server từ chối (`copy_consent_required`, `owner_requires_copy`) → `uwConflictSaveCopyFailed`. Cách ghi nội dung "bản của bạn" vào bản sao do G5-12 chốt. Ghi chú G5-12: Lưu thành bản sao tạo bản sao rồi ghi byte cục bộ của bạn lên đó làm phiên bản mới đầu tiên qua đường commit thông thường; bản sao không bao giờ hiện nội dung head của server như thể là bản của người dùng; nếu G5-12 không làm được như vậy thì đổi chuỗi `uwConflictSaveCopyConfirm` qua chủ i18n. Không tạo intent, không thay đổi tài liệu hiện tại; desktop dùng cùng khuôn.

**Bước 2 — Overwrite confirm.** Câu `uwConflictOverwriteConfirm`. Nút: "Ghi đè" (danger) + "Quay lại" (focus mặc định).
Desktop: tạo intent mới trên base mới; intent cũ thành superseded (§5.3).

**`api.download` (hợp đồng host, D; G5-09w).** Frame chỉ gửi `data`. Host đặt tên = tiêu đề tài liệu + `uwConflictMineFileSuffix` + đuôi định dạng gốc của module: `{tên} (bản của tôi).{ext}` / en `{name} (my version).{ext}`; host thay ký tự cấm của hệ điều hành (`\ / : * ? " < > |`) bằng `_` (OQ-UX12, U-15, 2026-10-12); MIME lấy từ allowlist định dạng gốc của module
(không theo frame); kích thước ≤ trần tải về do G5-09w chốt (D chưa có trần export); chỉ chạy khi frame token hiện tại có `can_edit` (SDO frame
token không có quyền tải riêng); một lần tải mỗi request: host tạo Blob, bấm một `<a download>` mang tên host dựng, thu
hồi object URL ngay sau đó; không có route server, không có bản sao nội dung nào khác. Bản tải về là bản sao cục bộ
**không có access log** (khác download/export phía server, vốn ghi `document_access`); ghi trong danh mục bản sao §8.3,
chấp nhận như vậy, đã ký (OQ-UX14, U-15, 2026-10-12): không có route ghi `export` trước khi giao Blob. "Thành công" = host đã giao tệp cho trình duyệt (không phải người dùng đã lưu). Request sai dạng, vượt kích thước, không quyền → từ chối, frame hiện `uwConflictDownloadFailed`.

**Biến thể (bảng duy nhất):**

| Biến thể | Khác biệt |
| --- | --- |
| Có quyền sửa | Bốn hành động đầy đủ: Tải lại, Lưu thành bản sao, Ghi đè, Hủy (theo thứ tự này) |
| Mất quyền sửa (đã thành chỉ xem) | Không có "Ghi đè…" và không có "Lưu thành bản sao…"; dòng `uwConflictNoEdit`. Chỉ "Tải lại bản mới nhất" + "Hủy". Không có sao chép/xuất để né quyền (§5.3) |
| Tài liệu bị xóa | Không mở S5; thanh S6 Delete |
| Desktop từ hàng queue `conflict` | Như có quyền sửa; "Ghi đè" tạo intent mới trên base mới, intent cũ superseded |
| Module có so sánh | "Xem khác biệt": chỉ Docs/DOCX ở v1; G6-01 xác nhận host (desktop/web) của panel so sánh; module khác ẩn nút (OQ-UX9, U-15, 2026-10-12) |
| Web offline | "Tải lại bản mới nhất"/"Ghi đè…" `aria-disabled`, lý do `uwConflictOfflineWeb` (web không có hàng đợi); "Lưu thành bản sao…" `aria-disabled`, lý do `uwConflictSaveCopyOffline`; "Hủy" dùng được |
| Desktop offline | "Ghi đè…" tạo intent mới trên head đã biết (`paused_offline`, dispatch sau gặp 409 thì về conflict); "Tải lại bản mới nhất" chỉ chạy khi head có trong thư viện offline, ngược lại `aria-disabled` với `uwConflictOfflineDesktop`; "Lưu thành bản sao…" `aria-disabled`, lý do `uwConflictSaveCopyOffline` |
| Lượt AI đang chạy | Tải lại, Ghi đè hoặc Lưu thành bản sao hỏi `uwRemoteStopAiConfirm` trước |
| Intent đang `committing`/`reconciling` | "Tải lại bản mới nhất"/"Ghi đè…"/"Lưu thành bản sao…" `aria-disabled`, lý do `uwRemoteWaitCommit` |
| Intent `reconciling-stuck` | "Tải lại bản mới nhất"/"Ghi đè…"/"Lưu thành bản sao…" `aria-disabled`, lý do `uwRemoteWaitStuck` + "Mở trung tâm đồng bộ" (`uwQueueOpenCenter`) |
| Ghi đè gặp 409 lần nữa | Cột "Bản trên UniWork" cập nhật theo head mới, dòng `uwConflictHeadMoved`, về bước 1, focus Hủy |
| Đọc head / tải bản mới thất bại (mất mạng) | Ở lại hộp thoại, dòng `uwConflictReloadFailed` / `uwConflictOverwriteFailed`, tài liệu không đổi, các nút vẫn dùng được |
| Lưu thành bản sao xong | Ở lại hộp thoại, về bước 1, dòng `uwConflictSaveCopyDone` (ghi vào vùng thông báo của hộp thoại, một live region `role=alert`, không phải một nút), focus Hủy; tài liệu hiện tại và intent không đổi, không trả lời `save` |
| Lưu thành bản sao thất bại | Ở lại bước xác nhận, dòng `uwConflictSaveCopyFailed`; thay đổi của bạn không đổi |
| Web, tải bản của tôi thất bại | Ở lại bước 2, dòng `uwConflictDownloadFailed`, không tải lại |
| Web, Ghi đè trả 401 | Dòng `uwConflictSessionWeb`; nháp giữ ở C18 |
| Web, Ghi đè trả 403 | Theo mã: suspended/deactivated/archived → hộp thoại đổi sang câu `uwRemoteOrgBlockedWeb {reason}` + "Đóng", focus về tiêu đề mới; 403 khác → như Revoke |
| Web, Ghi đè trả 410 | Như Revoke/Delete khi đang mở |
| Web, Ghi đè trả 413 | Dòng `uwConflictTooLarge`, ở lại bước 1; cùng trần đó chặn tải về (bước 2 web: lựa chọn tải về `aria-disabled`) |
| Web, Ghi đè trả 5xx | Dòng `uwConflictOverwriteFailed` |
| Revoke/delete khi S5 đang mở | Chuyển sang biến thể khóa tại chỗ: mất quyền sửa → bỏ "Ghi đè…"; mất quyền đọc hoặc bị xóa → nội dung thành câu `uwRemoteRevoked`/`uwRemoteDeleted` + nút "Đóng"; focus về tiêu đề mới |

**Mở rộng `frame-dialog.ts` / `frame-dialog.css` (G5-09w; danh sách duy nhất, ARIA chi tiết ở Accessibility Floor ›
S5):** (1) slot `content` (phần tử DOM) giữa câu mô tả và hàng nút, cho bảng so sánh, "Xem khác biệt", nhóm radio;
(2) đổi bước tính lại bẫy Tab (mọi phần tử focus được trong thẻ theo thứ tự DOM, kể cả `aria-disabled`), `describedBy`
và đích focus (`focusId`); (3) phần ARIA của Accessibility Floor › S5 (nút alert cố định của thẻ, lựa chọn
`aria-disabled`, `inert`, tiêu đề focus được); (4) CSS:
`@media (pointer: coarse)` nút ≥ 44px và nút X lùi vào trong không che tiêu đề; `@media (max-height: 480px)` cả hộp thoại
cuộn (không chỉ phần đầu). Nút X vẫn cuối DOM.

### Trạng thái khóa (S11)

Hành động theo bảng Lý do bị chặn; bảng này chỉ cho tiêu đề và câu của panel (desktop). Web: thanh S6 error + editor
chỉ đọc.

| Lý do | Tiêu đề | Câu |
| --- | --- | --- |
| `signed_out` | `uwLockSignedOutTitle` | `uwLockSignedOut` |
| `lease_expired` | `uwLockLeaseTitle` | `uwLockExpired` |
| `lease_expired` khi `offline_library` tắt | `uwLockLeaseTitle` | `uwLockLibraryOff` |
| `keystore_locked` | `uwLockKeystoreTitle` | `uwLockKeystore` |
| `clock_rollback` | `uwLockClockTitle` | `uwLockClock` |
| `permission_revoked` | `uwLockRevokedTitle` | `uwRemoteRevoked` |
| `document_deleted` | `uwLockDeletedTitle` | `uwRemoteDeleted` |
| `foreign_account` | `uwLockForeignTitle` | `uwLockForeign` |
| `organization_suspended` / `member_deactivated` | `uwLockOrgTitle` | `uwLockSuspended` / `uwLockDeactivated` |
| `store_newer` | `uwLockNewerStoreTitle` | `uwLockNewerStore` |

### UniWork AI (S7–S10)

Điều kiện hiện mục S7:
- Desktop: `GET /orgs/{orgID}/ai/cloud` trả `ready` **và** `tools.chat = true` **và** capability `ai_uniwork` +
  format đang mở thuộc `ai_uniwork_formats`.
- Web: grant `uniworkAi` (từ `uniwork_ai`) + format bật. Panel mở khi có `ai` hoặc `uniworkAi` (Foundation › Grant và
  flag); không có `ai` thì mục BYOK ẩn.
- Định dạng ngoài sáu định dạng (csv, odt, txt…) không có mục.

| Trạng thái cloud | Mục S7 | Picker footer (desktop) | Composer note khi UniWork AI đã chọn trước đó |
| --- | --- | --- | --- |
| signed-out | ẩn | `aiUniworkFooterSignIn` [Đăng nhập] | `aiUniworkSignedOut` |
| not-entitled | ẩn | `cloudStateNotEntitled` · Chi tiết | `not_entitled` sẵn có (ai-notice.ts) |
| subscription-inactive | ẩn | `cloudStateInactive` · Chi tiết | `cloudInactiveBody` (sẵn có) |
| credits-exhausted | ẩn | `cloudStateExhausted` · Chi tiết | `credits_exhausted` sẵn có |
| unavailable | ẩn | `cloudStateUnavailable` (chỉ khi server trả `cloud_unavailable`) | `aiErrUnavailable` |
| ready + `tools.chat` + capability | hiện (desktop: kèm tín dụng) | — | Bình thường + S8 |
| ready, `tools.chat` = false, hoặc capability/format tắt | ẩn | — | `aiUniworkOff` nếu đã chọn |

Không có fallback âm thầm sang nhà cung cấp khác (§8.3): composer giữ lựa chọn và chỉ mời chọn lại.
Với UniWork AI, panel chỉ gửi công cụ editor của module đang mở (thêm công cụ đám mây khi tổ chức có `office.ai_cloud`);
MCP server và agent skills của app là tích hợp cho agent bên ngoài, không bao giờ đi qua nhà cung cấp UniWork AI.

**Vòng đời lượt chạy** (tín hiệu `aiRun`: Foundation):

| Sự kiện giữa lượt | Hành vi |
| --- | --- |
| Đăng xuất / phiên hết hạn / frame token 401 | Lượt dừng; `aiErrSession`; thay đổi đã áp dụng vẫn hoàn tác được |
| Quyền giảm từ sửa xuống xem | Server bỏ công cụ ghi ở bước tiếp; client ngừng thực thi công cụ ghi ngay khi biết; `aiErrDowngraded` |
| Mất quyền đọc / bị xóa | Lượt dừng; `aiErrRevoked`; S6 tương ứng |
| Đổi tổ chức | Lượt dừng (`aiRunStopped`); tín dụng tính cho tổ chức được chọn lúc bắt đầu lượt |
| 429 giữa lượt (quy tắc duy nhất; plan G6-05 dẫn về đây) | Giữ run id; tự chờ theo `Retry-After` rồi tiếp bước; trong lúc tự chờ **không** có nút "Thử lại" (tránh request trùng), chỉ "Dừng". `Retry-After` là số giây (≥ 0) hoặc HTTP-date (đổi ra số giây; ≤ 0 → thử ngay một lần). Thiếu, không đọc được, lớn hơn mức kẹp 300 giây, hoặc số lần chờ trong một lượt vượt trần 3 lần (G6-02 xác nhận khi spike xong; OQ-UX2, U-15, 2026-10-12) → bỏ cuộc: `aiErrRateLimitedNoWait` + "Thử lại", `aiRun idle` |
| `run_limit_reached` | Lượt kết thúc, kết quả giữ; "Hỏi tiếp" bắt đầu lượt mới (run id mới) **trong cùng hội thoại**: server giữ các lượt trước của hội thoại (theo người dùng + tổ chức + tài liệu + module), client chỉ gửi lượt mới |
| Frame token xoay vòng (web) | Không ảnh hưởng: hội thoại buộc theo claim của token (người dùng, tổ chức, tài liệu), không theo giá trị token |
| Hội thoại hết hạn hoặc đã bị dọn (`conversation_expired`) | Lượt không chạy; client bỏ conversation id, luồng hiện dòng `aiConversationRestarted`, câu hỏi còn trong ô nhập để người dùng gửi lại (không tự gửi lại) |
| Đổi nhà cung cấp giữa luồng | Lượt sau là hội thoại mới phía server; luồng hiện mốc `aiConversationBoundary {provider}`; lượt phía trên không được gửi kèm |
| Capability tắt giữa lượt | Bước hiện tại xong, bước kế bị từ chối, `aiErrCapabilityOff` |
| Ctrl/⌘+S trong khi công cụ ghi | Xem bảng Ctrl/⌘+S |
| Frame unload / mất kết nối host | Host coi lượt là `idle`; nếu đang `inert` vì `modal`, host gỡ `inert` (Accessibility Floor) |

**Lỗi của một lượt (S9)** — ánh xạ §10.2 và ADR 0029:

| Điều kiện | Khóa | Hành động |
| --- | --- | --- |
| `run_limit_reached` | `aiErrRunLimit` | Hỏi tiếp |
| `conversation_expired` | `aiConversationRestarted` | — (gửi lại câu hỏi) |
| `credits_exhausted` 402 | `aiErrCredits` | Chọn nhà cung cấp khác |
| `entitlement_required` 403 | `aiErrEntitlement` | Chọn nhà cung cấp khác |
| 429 có `Retry-After` hợp lệ (đang tự chờ) | `aiErrRateLimited {seconds}` (làm tròn lên) | — (tự tiếp bước; chỉ "Dừng") |
| 429 bỏ cuộc (vòng đời lượt chạy) | `aiErrRateLimitedNoWait` | Thử lại |
| `provider_unreachable` 502 / `cloud_unavailable` 503 / timeout | `aiErrUnavailable` | Thử lại |
| Mất kết nối giữa lượt | `aiErrDisconnected` | Thử lại |
| Offline trước khi gửi | `aiErrOffline` | — |
| Phiên hết hạn / 401 | `aiErrSession` | Đăng nhập lại |
| Mất quyền giữa lượt | `aiErrRevoked` | — |
| Quyền giảm giữa lượt | `aiErrDowngraded` | — |
| Capability/format tắt | `aiErrCapabilityOff` | Chọn nhà cung cấp khác |
| Tool call bị bỏ: `not_allowlisted` | chip "Chưa hỗ trợ" + `aiErrUnsupported {module}` | — |
| Tool call bị bỏ: `view_only` | chip "Chưa hỗ trợ" + `aiErrViewOnlyEdit` | — |
| Workbook vượt giới hạn web | `aiErrWorkbookTooLarge` | Mở bằng ứng dụng |

### Chỉ xem (G6, §6.1)

Người chỉ xem vẫn chọn UniWork AI và hỏi được. Dòng phụ composer `aiUniworkViewOnly`. Yêu cầu sửa → chip "Chưa hỗ trợ"
với `aiErrViewOnlyEdit`.

### Tệp cục bộ (S10)

| Điều kiện | Hành vi |
| --- | --- |
| Chưa đăng nhập UniWork | Mục UniWork AI ẩn; BYOK/CLI chạy như genoffice (ADR 0028); không footer gây hiểu nhầm là lỗi |
| Đã đăng nhập, đủ điều kiện | Mục hiện; khối S8 biến thể `aiUniworkLocalFile`. Hội thoại: server cấp conversation id buộc người dùng + tổ chức (+ thiết bị), không có tài liệu; xóa khi đăng xuất và theo TTL (danh mục §8.3) |
| Nhiều tổ chức | Dòng phụ ghi rõ tổ chức trả tín dụng; đổi tổ chức ở Cài đặt › Tài khoản (app không có menu tài khoản; OQ-UX7, U-15, 2026-10-12), không trong panel |
| Đăng xuất giữa lượt | Như vòng đời lượt chạy; mục ẩn sau đó |

## Interaction Primitives

- **Ctrl/⌘+S** — theo bảng State Patterns › Ctrl/⌘+S.
- **Esc** — thứ tự ưu tiên: đóng popup/listbox/popover trên cùng, trả focus về phần tử đã mở; nếu không có gì mở và
  focus trong composer khi lượt đang chạy: Dừng; trong hộp thoại: Hủy/Quay lại.
- **Enter / Space** — kích hoạt nút đang focus. Không có phím tắt toàn cục cho "Ghi đè".
- **Tab / Shift+Tab** — theo thứ tự DOM = thứ tự thị giác ở mọi chiều rộng.
- **Tab S2** — tablist theo APG: một điểm Tab cho cả thanh, ←/→ chuyển và kích hoạt tab, Home/End tới đầu/cuối.
- **Bảng S2/S3** — bảng thường (không grid, không roving tabindex): tên tài liệu là nút "Mở" (điểm focus đầu của hàng),
  Tab đi qua các nút hành động; ↑/↓ để screen reader tự xử lý theo chế độ bảng.
- **Chuột** — hover chỉ bổ sung; mọi thông tin hover cũng có khi focus. Không hành động nào chỉ có khi hover.
- **Bị cấm** (danh sách duy nhất, gồm các mẫu loại bỏ) — tự Lưu, tự Ghi đè, tự tải lại khi dirty hoặc khi AI đang chạy,
  tự áp lại nháp lên base mới, tự gửi lại yêu cầu AI sau khi có mạng, hộp thoại chồng hai lớp, xác nhận bằng hộp thoại
  hệ điều hành; một dấu tích "đã lưu" chung cho mọi trạng thái; tự đồng bộ cả tổ chức; ẩn lỗi sau toast tự tắt; nút
  UniWork AI disabled kèm lỗi; fallback âm thầm sang nhà cung cấp khác; đưa nháp xung đột vào Restore của C18.

## Accessibility Floor

Đây là nguồn duy nhất của hợp đồng ARIA, và là danh sách kiểm của G7-09. Component Patterns chỉ nói hành vi.

- **Chung:** WCAG 2.2 AA trên cả hai host, hai chế độ màu; trạng thái không chỉ bằng màu (badge luôn có chữ). Mục tiêu
  tương phản ở DESIGN.md › Colors. Mọi điều khiển hiện mà không chạy được (S2/S3, S5, S6, S8…) dùng `aria-disabled` +
  `aria-describedby` lý do và giữ trong thứ tự Tab; nút danger khi `aria-disabled` giữ chữ `danger-text`.
- **Vùng live:** mỗi cửa sổ (shell, mỗi frame) có hai nút live **cố định** từ lúc tải, ẩn thị giác: một `role=status`
  (polite) và một `role=alert` (assertive, ban đầu rỗng). Không bao giờ đổi `aria-live`/`role` lúc chạy (ngoại lệ: pill
  thông báo khởi chạy sẵn có của fork, `UniworkChrome.tsx`, không thuộc phạm vi này và giữ nguyên).
  - Polite: chuyển trạng thái thường (pill — `uwSyncRowAnnounce`; hàng S2/S3 người dùng không tự gây ra —
    `uwSyncRowAnnounce`, `uwOfflineReadyAnnounce`), Toast, mở S4.
  - Alert: chuyển sang blocked/failed/conflict, disk-full/corrupt, revoke/delete, khóa (S11) — ghi một lần rồi xóa sau
    ~1 giây. Hai sự kiện assertive trong vòng 1 giây: xếp hàng, ghi sự kiện sau khi nút đã được xóa; không ghi đè.
  - Mọi thanh/dòng xuất hiện **cùng nội dung** (S6, Second-window bar, Lock-while-open bar, Composer note, Sync header
    status line, Toast) ghi câu của nó vào nút live cố định của cửa sổ lúc hiện. Bản trong thanh **không** mang
    `role=status|alert`/`aria-live` (chỉ là bản nhìn thấy, tra lại được), nên mỗi câu được đọc đúng một lần.
  - Nút live của cửa sổ nằm **ngoài** cây bị `inert`: khi hộp thoại đặt `inert` cho phần còn lại, nút live là anh em của
    phần bị inert. Trong lúc S5 mở, dòng lỗi của S5 chỉ ghi vào nút `role=alert` của chính hộp thoại (không ghi thêm vào
    cửa sổ).
  - Progress không đọc từng bước, chỉ đọc khi xong.
- **S1 Save pill:** `div[role=group][aria-label=uwChipAria]` > nhãn `span` (**không** live: bỏ `role=status` hiện có ở
  `UniworkChrome.tsx`; một lần chuyển trạng thái chỉ được đọc một lần, qua nút polite của cửa sổ) + nút hành động. Câu mô
  tả qua `aria-describedby` chỉ trên nút hành động (nhóm không mang mô tả, để không đọc hai lần); tooltip mở bằng hover
hoặc focus; không dùng `title`. Nút hành động bận dùng `aria-disabled` (fork hiện dùng `disabled={busy}`, làm focus rơi
về `<body>` sau khi bấm bằng bàn phím).
  Vùng chạm của nút pill (`.uw-pill-action`, `.uw-pill-close`, cao 22px trong pill 28px, thanh tab 40px): con trỏ mịn ≥
  24×24px bằng `::before` trong suốt (`.uw-pill-close` rộng 22px nên `inset: -1px` cả bốn phía); con trỏ thô
  (`pointer: coarse`): `.uw-chrome` cao đủ 40px của thanh và `-webkit-app-region: no-drag`, `::before` kéo dọc -9px (tới
  mép thanh, không vào vùng kéo cửa sổ), ngang không đối xứng — nút hành động kéo sang trái, nút đóng kéo sang phải,
  không chồng nhau. Tức là "40px trong thanh tiêu đề" (không phải 44px); pill không cao thêm.
- **S2/S3:** tab là tablist APG (`role=tablist` > `button[role=tab]`, roving `tabindex`, `aria-selected`,
  `aria-controls` → `tabpanel`); số đếm nằm trong tên tab (`uwSyncTabCount`), số hiển thị `aria-hidden`. Usage header và
  "Thêm tài liệu…" nằm trong tabpanel. Mỗi bảng có `caption` (tên tab) và tiêu đề cột ẩn "Hành động"; ô tên tài liệu là
  `th scope=row` (nút hành động lặp lại được đọc kèm tên hàng); điểm focus đầu của hàng là nút tên tài liệu (≥ 24px, 44px
  khi `pointer: coarse`). Nút "…" khi hẹp: `aria-haspopup=menu` + `aria-label` =
  `uwSyncMoreActions`. Discard confirm trong hàng: focus vào "Quay lại" khi hiện, câu xác nhận là `aria-describedby`
  của hai nút.
- **Progress (S2/S3):** `role=progressbar` + `aria-labelledby` (tên tài liệu) + `aria-valuetext` (`uwOfflineRowProgressAria`);
  thanh dung lượng S3 `aria-hidden` vì chữ bên cạnh đã mang giá trị.
- **S4 Queue popover:** `role=dialog` không modal, `tabindex=-1`, `aria-labelledby` = dòng 1. Khi mở (từ pill hoặc
  Ctrl/⌘+S): focus chuyển vào popover và dòng 1 (hoặc `uwQueueBlockedSave` khi mở bằng Ctrl/⌘+S) ghi vào nút polite;
  Esc/đóng trả focus về phần tử đã mở popover (pill khi mở từ pill; editor khi mở bằng Ctrl/⌘+S).
- **S5 và mọi bước xác nhận:** `role=alertdialog`, `aria-modal=true`, `aria-labelledby`/`aria-describedby` cập nhật theo
  bước; phần còn lại của cửa sổ `inert` (shell và frame — không chỉ bẫy phím, để chế độ duyệt của NVDA/VoiceOver không
  rời thẻ); bẫy focus qua mọi phần tử focus được, kể cả `aria-disabled`; focus mặc định theo câu chuẩn ở State Patterns ›
  Conflict dialog (S5); đóng trả focus về phần tử đã mở. Tiêu đề là `h2[tabindex=-1]`, nhận focus khi biến thể đổi tại
  chỗ (gồm câu kiểm tệp sau khi tải về và câu tổ chức bị chặn). Dòng lỗi trong thẻ là nút `role=alert` cố định của hộp thoại, thu gọn thị giác khi rỗng, không bao giờ
  `display:none`. Radio là `fieldset` + `<input type=radio>` gốc; "Giữ…" có `aria-describedby` = `uwConflictKeepDraftHint`.
  Nút ≥ 44px khi `pointer: coarse`; ở 320×256 CSS px (zoom 400 %) cả hộp thoại cuộn được và tiêu đề không bị cắt.
- **Web host khi frame mở hộp thoại:** frame gửi sự kiện `modal` sẵn có khi hộp thoại mở/đóng; host đặt `inert` cho mọi
  phần trang ngoài iframe `office-frame`, tạm ngưng phím tắt của host (Ctrl/⌘+S, Esc) và trả focus vào frame khi đóng.
  Frame unload, điều hướng, hoặc mất port khi `modal` đang bật: host gỡ `inert` và bật lại phím tắt.
- **Sign-out prompt:** `role=alertdialog` (khuôn hộp thoại shell), focus mặc định "Quay lại"; `uwSignOutWaiting` ghi vào
  nút polite khi hiện; trong lúc chờ, "Đăng xuất" `aria-disabled`.
- **S6:** thanh là `region` có nhãn `uwRemoteRegion` (phiên bản mới: sạch, dirty, AI) hoặc `uwLockRegion` (revoke,
  delete, nạp thất bại, Second-window bar, Lock-while-open bar); câu trong thanh là bản nhìn thấy không live, được đọc qua
  nút live của cửa sổ (polite cho phiên bản mới, alert cho phần còn lại). Không tự ẩn khi có focus hoặc hover.
- **S7:** thay đổi `AiModelPicker.tsx` / `ai-model-picker.css`: `role=listbox` + `aria-label` chuyển từ `.ai-model-pop`
  xuống `.ai-model-pop-list`; `.ai-model-pop` thành `role=group` có `aria-label`; mỗi `.ai-model-group` là `role=group`
  `aria-labelledby` = đầu nhóm; tùy chọn giữ là `<button role=option>` như fork, theo listbox APG: một điểm Tab cho cả
  danh sách (roving `tabindex`, vào ở tùy chọn đang chọn), ↑/↓ chuyển giữa các tùy chọn, Home/End tới đầu/cuối, không
  `aria-activedescendant`; "Quản lý" rồi Picker footer là anh em **sau** danh sách. Tab: nút chip → danh sách → Quản lý
  → hành động của footer. Esc ở đâu trong popup cũng đóng và trả focus về chip. Chọn một tùy chọn, "Quản lý" hoặc hành
  động footer: popup đóng và focus về chip, trừ khi hành động mở bề mặt khác nhận focus; bấm ra ngoài: focus ở nơi bấm.
  Nút chip `aria-haspopup=listbox` + `aria-expanded` (+ `aria-controls` khi mở). Tín dụng (desktop) chỉ qua
  `aria-describedby` của tùy chọn; dòng phụ hiển thị trong tùy chọn `aria-hidden`. Chip và tùy chọn ≥ 44px khi
  `pointer: coarse`.
- **S8:** khối công bố là `region` có nhãn ngắn `aiUniworkDisclosureLabel`, `tabindex=-1`, không cướp focus khi xuất
  hiện, được đọc polite. Nút Gửi dùng `aria-disabled` + `aria-describedby` = `aiUniworkSendNeedsAck` và câu công bố. Bấm
  Gửi khi chưa xác nhận: ghi `aiUniworkSendNeedsAck` vào nút polite và chuyển focus vào khối. "Đã hiểu" có
  `aria-describedby` câu công bố.
- **S9:** luồng hội thoại **không** `aria-live` toàn bộ (tin nhắn của chính người dùng không bị đọc lại); một nút live
  polite riêng của panel đọc câu trả lời hoàn chỉnh (chip + chữ, cùng một nút) một lần khi xong; trong khi stream luồng
  có `aria-busy=true`. Chip là chữ đầu câu trả lời ("Đã sửa trong tài liệu: …"). Đổi Gửi ↔ Dừng đổi `aria-label` và báo
  polite (`aiRunRunning`, `aiRunStopped`). Nút gửi/dừng ≥ 44px khi `pointer: coarse`.
- **S11:** panel là `region` `aria-labelledby` = tiêu đề. Khi hiện: ghi "{tiêu đề}. {câu}" một lần vào nút alert của
  cửa sổ và chuyển focus tới tiêu đề (`tabindex=-1`); khóa khi đang gõ thì chuyển sau phím hiện tại. Hành động chính là
  điểm Tab kế tiếp.
- **Vùng chạm:** mọi điều khiển ≥ 24×24px (kể cả nút kiểu liên kết: Xem hàng chờ, Xem khác biệt, Xem thay đổi, Đóng, Để
  sau), 44px khi `(pointer: coarse)`; ngoại lệ duy nhất: nút pill theo mục S1.
- **Focus ring:** bề mặt G5/G6 kế thừa ring sẵn có của từng thành phần fork (pill: `--color-border-brand`; hộp thoại:
  `--color-dialog-primary`). Ngoại lệ (thuộc thay đổi `ai-model-picker.css` ở S7): `.ai-model-item:focus-visible`,
  kể cả `.ai-model-item.selected:focus-visible`, có `outline: 2px solid var(--accent); outline-offset: -2px` (fork hiện chỉ
  đổi nền, 1,09:1); G7-09 kiểm ring của tùy chọn đang chọn ≥ 3:1 so với `accent-soft` ở hai chế độ. Ring theo accent của
  app luôn là `var(--accent)`, không ghi cứng màu.
- **Phóng to 200% / text spacing:** không cắt nhãn trạng thái bằng `nowrap` không lối thoát: pill được ellipsis nhưng câu
  đủ có ở mô tả; badge và dòng phụ xuống dòng.
- **Chuyển động:** `prefers-reduced-motion: reduce` → spinner thành biểu tượng tĩnh + chữ "Đang lưu…", không hiệu ứng
  trượt/mờ của thanh.
- **Forced colors:** theo DESIGN.md › Colors (gồm tùy chọn đang chọn của picker, tab S2 đang chọn, nút `aria-disabled`).
- **Không chỉ `title`:** mọi giải thích an toàn dữ liệu nằm trong DOM (mô tả, tooltip mở bằng focus), không chỉ thuộc tính `title`.
- Kiểm bằng NVDA + Windows, VoiceOver + macOS (desktop, máy Mac thật), và Chrome/Edge/Safari trên web (G7-A04).

## Responsive & Platform

Bề mặt theo host: Information Architecture (cột Host).

| Host | Hành vi |
| --- | --- |
| Desktop hẹp | Sync center rộng tối đa 880px; < 640px co một cột: dòng phụ xuống dòng, hành động đầu của hàng luôn hiện, các hành động còn lại vào nút menu "…". |
| Web hẹp (< 768px) | Frame giữ hành vi của genoffice; S5 chiếm toàn chiều rộng trừ lề 16px, bảng so sánh một cột; nút vẫn xếp dọc theo câu chuẩn ở Conflict dialog (S5). |
| Sheets web vượt giới hạn | AI web không xử lý; mời mở bằng app (GO-C4). |

## Inspiration & Anti-patterns

- **Giữ từ genoffice/fork:** pill `uw-pill` và mô hình tone, chuỗi `uwChip*`/`uwTip*`, `UniworkCloudPane` và trạng thái
  cloud, `AiModelPicker`, khuôn `frame-dialog.ts` (alertdialog, bẫy focus, Esc = cancel, nút danger không bao giờ là focus
  đầu, focus mặc định Hủy khi không có primary — fork 549c273b) và skin của nó, chuỗi `appWebConflict*`.
- **Thay đổi so với hiện trạng:** danh sách ở Foundation › Hai host, một renderer.
- **Bị cấm / loại bỏ:** Interaction Primitives › Bị cấm.

## Key Flows

### Flow 1 — Lan tính doanh thu bằng UniWork AI (kế toán, 15:20 thứ Ba, web)

1. Lan mở `bao-cao-quy3.xlsx` từ UniWork trên Chrome; frame Sheets mở.
2. Cô mở panel AI, bấm picker: thấy "UniWork AI" bên cạnh các nhà cung cấp riêng (web không hiện số tín dụng). Cô chọn nó.
3. Khối công bố hiện: "UniWork AI đọc nội dung đang mở trong tài liệu này, kể cả phần chưa lưu…". Lan bấm "Đã hiểu".
4. Cô gõ "Tính doanh thu từ các cột X, Y, Z". Model gọi `ask_clarification`: chip "Cần làm rõ": "Cột Z có cả 10 và 10% — Z là phần trăm giảm giá hay số tiền giảm?"
5. Lan trả lời "phần trăm". Chip "Trả lời": "Doanh thu = 1.284.500.000 ₫ · Sheet ‘Q3’ A2:Z412 · 410 dòng, bỏ 1 dòng tổng, 2 dòng ẩn được tính, 1 ô lỗi Y57 bị loại (nêu rõ)".
6. Cô gõ "Ghi công thức vào cột AA" (lượt mới trong cùng hội thoại: UniWork AI vẫn biết cột Z là phần trăm). Chip "Đã sửa trong tài liệu": "Đã ghi 410 ô (AA2:AA411) · 0 ô có sẵn bị ghi đè · Chưa lưu".
7. **Climax:** Lan bấm "Xem thay đổi", thấy cột AA được đánh dấu, kiểm vài ô, rồi bấm Lưu. Không có phiên bản nào được tạo cho tới khi cô bấm Lưu.

Thất bại: tổ chức hết tín dụng giữa lượt → 402 → `aiErrCredits` + "Chọn nhà cung cấp khác"; tài liệu và Lưu không bị ảnh hưởng.

### Flow 2 — Minh làm việc trên chuyến bay (trưởng nhóm kinh doanh, desktop Windows)

1. Tối trước chuyến đi, Minh mở menu của `hop-dong-khung.docx` → "Dùng khi không có mạng". S3 hiện "Đang tải 12,4 / 30,0 MB", rồi "Sẵn sàng offline · quyền offline tới 09:00 ngày mai".
2. Trên máy bay, anh mở tài liệu từ S3, sửa điều khoản 4, bấm Ctrl+S. Pill: "Đã xếp hàng lưu — chưa lưu lên UniWork".
3. Anh sửa tiếp điều khoản 5 và bấm Ctrl+S lần nữa: popover "Lần lưu trước vẫn đang chờ. Bạn lưu tiếp được khi lần đó xong."; pill "Đã xếp hàng lưu · có thay đổi mới".
4. Laptop hết pin. Khi mở lại, S2 tab "Đang chờ lưu" vẫn có hàng `hop-dong-khung.docx` với badge "Chờ mạng" và dòng phụ "Sẽ gửi khi có mạng".
5. Hạ cánh, có Wi-Fi: hàng chuyển "Đang gửi" rồi "Xung đột — phiên bản 12 đã được lưu bởi Trần An lúc 08:10"; vùng live đọc "hop-dong-khung.docx: Xung đột".
6. Minh bấm "Mở để xử lý". S5 hiện hai cột, focus ở "Hủy". Anh chọn "Ghi đè…"; bước xác nhận: "UniWork sẽ tạo phiên bản 13 từ bản của bạn. Phiên bản 12 của Trần An vẫn còn trong lịch sử."
7. **Climax:** Anh bấm "Ghi đè". Intent cũ thành superseded, intent mới lưu xong: hàng "Đã lưu · phiên bản 13"; pill về "Có thay đổi chưa lưu" vì điều khoản 5 (N+1) chưa được lưu — anh bấm Lưu một lần nữa, có chủ ý.

Thất bại: mất mạng ngay khi đang ghi phiên bản → hàng "Đang đối soát"; không có "Hủy" hay "Gửi lại"; khi có mạng, ứng dụng tra kết quả và không tạo bản trùng. Đối soát quá giới hạn → "Cần hỗ trợ" với mã hỗ trợ.

### Flow 3 — Hùng xem và hỏi AI với quyền chỉ xem (kiểm toán viên, web)

1. Hùng mở `quy-che-chi-tieu.docx` với quyền chỉ xem; pill frame "Chỉ xem".
2. Anh chọn UniWork AI; dòng phụ: "Chế độ chỉ xem: AI trả lời được nhưng không sửa hoặc lưu tài liệu."
3. Anh hỏi "Tóm tắt điều 7 và so với điều 9". Chip "Trả lời" với trích dẫn có anchor tới hai điều.
4. Anh thử "Viết lại điều 7 cho gọn". Chip "Chưa hỗ trợ": "Bạn chỉ có quyền xem tài liệu này nên AI không sửa được."
5. **Climax:** Trong khi đọc, chủ tài liệu lưu phiên bản 8. Tài liệu của Hùng sạch và không có lượt AI chạy, nên thanh S6 báo "Đã cập nhật lên phiên bản 8…"; câu trả lời AI cũ vẫn ghi rõ là theo nội dung đã mở trước đó.

Thất bại: chủ tài liệu thu hồi quyền của Hùng giữa một lượt AI → lượt dừng với `aiErrRevoked`; thanh S6 error `uwRemoteRevokedWeb`; nội dung không còn đọc được trong frame.

### Flow 4 — Thảo dùng AI với tệp trên máy (nhân viên hành chính, desktop macOS)

1. Thảo mở `ke-hoach.xlsx` từ ổ đĩa, chưa đăng nhập UniWork. Panel AI chỉ có nhà cung cấp riêng của cô; không có lỗi về UniWork.
2. Cô đăng nhập UniWork. Mục "UniWork AI" xuất hiện kèm tín dụng còn lại.
3. Cô chọn nó; khối công bố biến thể tệp cục bộ: "Tệp này nằm trên máy bạn, chưa ở UniWork… dùng tín dụng AI của Công ty ABC. Tệp không được tải lên thành tài liệu UniWork."
4. **Climax:** Cô bấm "Đã hiểu", hỏi tổng chi phí tháng 10; câu trả lời có range và số dòng. Tệp vẫn chỉ ở trên máy, không xuất hiện trong UniWork.

Thất bại: phiên UniWork hết hạn giữa lượt → `aiErrSession` + "Đăng nhập lại"; mục UniWork AI ẩn cho tới khi đăng nhập lại; BYOK vẫn dùng được.

### Flow 5 — An nhận phiên bản mới khi đang sửa (biên tập viên, web)

1. An mở tài liệu trên web và đang sửa, chưa lưu. Minh lưu phiên bản 12 từ desktop.
2. Thanh S6 warn: "Có phiên bản mới hơn trên UniWork (phiên bản 12). Thay đổi của bạn chưa lưu nên tài liệu không tự tải lại."
3. An bấm "Tải lại bản mới nhất…"; S5 bước Reload confirm web, focus ở "Quay lại".
4. **Climax:** An chọn "Tải bản của tôi về máy rồi tải lại": trình duyệt nhận tệp `…(bản của tôi).docx`; hộp thoại nhắc An kiểm tra tệp đã được lưu rồi bấm "Tải lại", và tài liệu hiện phiên bản 12; An mở tệp đã tải để chép phần cần giữ. Không có gì tự áp lên phiên bản 12.

Thất bại: mạng rớt khi tải bản 12 → ở lại hộp thoại với `uwConflictReloadFailed`; tài liệu và tệp đã tải không đổi. Nhánh desktop: cùng tình huống trên app → "Giữ bản của tôi làm nháp"; nháp hiện ở S2 "Nháp đã giữ".

### Flow 6 — Minh mở tài liệu offline khi quyền offline đã hết (desktop Windows)

1. Ba ngày sau chuyến bay, Minh ở công trường không có mạng, mở `bao-gia-q4.xlsx` đã ghim.
2. Lease đã hết hạn lúc 09:00 hôm qua. Vùng editor hiện panel khóa: "Quyền offline đã hết hạn. Nội dung được giữ mã hóa; kết nối để mở lại." + "Kết nối lại"; focus ở tiêu đề panel.
3. Pill của tab: "Không lưu được: quyền offline đã hết hạn". Nháp từ hôm trước vẫn được giữ, hàng S2 "Cần kết nối lại".
4. **Climax:** Có 4G, Minh bấm "Kết nối lại": lease được gia hạn, panel khóa biến mất, tài liệu mở với nháp còn nguyên; hàng S2 trở lại "Đang chờ".

Thất bại: trong lúc Minh offline, quyền của anh bị thu hồi → khi kết nối, lease không được gia hạn; bản tải về bị xóa khỏi máy; panel đổi sang "Bạn không còn quyền truy cập tài liệu này…"; nháp giữ khóa tới khi anh chọn "Bỏ nháp…".

## String catalogue (vi / en)

U-01 đã đóng danh mục này (U-15, 2026-10-12): mọi chuỗi trong bảng trạng thái có khóa (nhãn viết thẳng trong bảng ánh xạ ở "Nhãn trong bảng trạng thái → khóa"). Lane UI chỉ thêm khóa trong shard của mình khi có
review của owner i18n (Lead F). "(sẵn có)" = khóa đã có ở fork, giữ nguyên. Khóa của fork dùng lại nguyên, U-02 không thêm trùng: `cloudState*`, `cloudCreditsLeft`, `cloudCreditsUnlimited`, `cloudInactiveBody`, `acctKeyring*`, `acctErrKeyringUnavailable`.

**Số đếm.** `format()` của fork (`packages/i18n`) chỉ thay `{word}` và fork có 21 locale (gồm ar, cs, he, pl, ru), nên
không dùng cặp khóa số ít/số nhiều. Mọi chuỗi có số đếm là **một khóa với câu trung tính với số**: `{count}` đứng ở
vị trí nhãn/giá trị ("Số mục: {count}", "{label}, {count} mục") để câu đúng ngữ pháp với mọi số ở mọi locale. U-02 kiểm ở
1, 2, 5 cho vi, en, ru, pl.

**Vị trí:** shell `apps/shell/src/renderer/src/i18n/{uniwork-documents,cloud}/*`; chuỗi AI: khóa của picker và panel
dùng chung → `packages/ui/src/strings-ai-*.ts` (đủ 21 locale, như `strings-ai-model-picker.ts`,
`strings-ai-panel-side.ts`); khóa AI theo app → shard `apps/{docs,sheets,slides,html}/src/renderer/i18n/ai/*` (pdf và
markdown chưa có, U-02 thêm); lỗi AI của frame web → `web/modules/shared/i18n/ai-web/*` + `strings-ai-web.ts`, dùng lại
khóa đã có khi trùng nghĩa; `packages/ai-provider/src/ai-notice.ts` là bảng en/vi duy nhất, chỉ giữ chuỗi sẵn có. Shard
`cloud` của shell chỉ renderer shell đọc được, nên Picker footer dùng khóa cùng nội dung trong `strings-ai-*` chứ không
import shard shell; frame web: khóa xung đột theo từng app `apps/*/src/renderer/i18n/app/*`
(`appWebConflictTitle`, `appWebConflictBody`, `appWebConflictReload`, `appWebConflictOverwrite`, `appWebConflictNotSaved`,
`appCancel` — giữ, không đổi tên) và `web/modules/shared/i18n/web/*` (`webConflictTitle`, `webConflictBody`,
`webConflictReload`, `webConflictOverwrite`, `webConflictNotSaved`, `webCancel` — giữ) cho chuỗi web dùng chung. Desktop
dùng khóa `uwConflict*` mới với **cùng nội dung** cho các phần trùng. `appWebConflictOverwrite`/`webConflictOverwrite` đổi
nội dung thành "Ghi đè…" / "Overwrite…" (vì mở bước xác nhận); `appWebConflictBody`/`webConflictBody` hiện nói "tải lại …
và bỏ các thay đổi" — đổi nội dung thành câu của `webConflictBodySafe`, vì Tải lại giờ có bước giữ/bỏ. Khóa
`office.conflict.*` của host (PR #219) bị xóa cùng `save-conflict-dialog.tsx`. Khóa `uw*` mới mà frame web vẽ (S5 web:
`uwConflictReloadWebBody`, `uwConflictDownloadThenReload`, `uwConflictDiscardThenReload`, `uwConflictMineFileSuffix`,
`uwConflictDownloadFailed`, `uwConflictDownloadCheck`, `uwConflictOfflineWeb`, `uwConflictSessionWeb`,
`uwConflictTooLarge`, các khóa bảng hai cột; S6 web: bộ `uwRemote*`, `uwRemoteRevokedWeb`, `uwRemoteOrgBlockedWeb`) nằm
ở `web/modules/shared/i18n/web/*`, giữ nguyên tiền tố `uw`; desktop dùng lại cùng nội dung trong shard shell.

### Pill, hàng chờ, popover

| Khóa | vi | en |
| --- | --- | --- |
| `uwChipQueued` | Đã xếp hàng lưu — chưa lưu lên UniWork | Save queued — not on UniWork yet |
| `uwChipQueuedNewer` | Đã xếp hàng lưu · có thay đổi mới | Save queued · newer edits |
| `uwChipPausedAdmin` | Đã xếp hàng lưu · tạm dừng gửi | Save queued · sending paused |
| `uwChipReconciling` | Đang kiểm tra lần lưu trước… | Checking the last save… |
| `uwChipReconcileStuck` | Cần hỗ trợ để xác nhận lần lưu | Support needed to confirm the save |
| `uwChipUnreachable` (sẵn có) | (sẵn có) | (sẵn có) |
| `uwChipRemoteNewer` | Có phiên bản mới hơn trên UniWork | Newer version on UniWork |
| `uwChipError` (sẵn có, dùng cho cả `failed`) | Không lưu được | Couldn’t save |
| `uwTipQueued` | Bản lưu lúc {time} được giữ an toàn trên máy này và sẽ gửi khi có mạng. | Your save from {time} is kept safely on this computer and will be sent when you’re online. |
| `uwTipQueuedNewer` | Bản lúc {time} đang chờ gửi. Thay đổi sau đó chưa nằm trong lần lưu này. | The save from {time} is waiting to be sent. Later edits aren’t part of it. |
| `uwTipPausedAdmin` | Quản trị viên đang tạm dừng việc gửi. Bản lưu được giữ trên máy này. | Your admin has paused sending. The save is kept on this computer. |
| `uwTipPausedUser` | Bạn đang tạm dừng gửi. Bản lưu lúc {time} được giữ trên máy này; bấm "Tiếp tục gửi" trong trung tâm đồng bộ. | You paused sending. The save from {time} is kept on this computer; choose Resume sending in the sync center. |
| `uwTipReconciling` | Chưa rõ lần lưu trước đã tới UniWork chưa. Ứng dụng đang hỏi lại và sẽ không tạo bản trùng. | It’s not yet clear whether the last save reached UniWork. The app is checking and won’t create a duplicate. |
| `uwTipRemoteNewer` | Thay đổi của bạn chưa lưu nên tài liệu không tự tải lại. | You have unsaved changes, so the document didn’t reload. |
| `uwTipFailed` | Lần lưu này sẽ không tự thử lại: {reason}. Thay đổi vẫn trên máy này. | This save won’t retry on its own: {reason}. Your changes stay on this computer. |
| `uwTipWaitAi` | Đang chờ AI xong bước hiện tại rồi lưu. | Waiting for AI to finish its current step, then saving. |
| `uwTipWaitAiLong` | AI chưa xong bước hiện tại. Dừng lượt AI để lưu ngay. | AI hasn’t finished its current step. Stop the AI run to save now. |
| `uwTipDirty` / `uwTipSaving` / `uwTipConflict` / `uwTipBlocked` / `uwTipError` / `uwTipOffline` / `uwTipUnreachable` / `uwTipSignedOut` / `uwTipViewOnly` / `uwTipSavedAt` | (sẵn có) | (sẵn có) |
| `uwChipSaved` / `uwChipDirty` / `uwChipSaving` / `uwChipConflict` / `uwChipBlocked` / `uwChipOffline` / `uwChipSignedOut` / `uwChipViewOnly` / `uwChipAria` / `uwActResolve` | (sẵn có) | (sẵn có) |
| `uwActViewQueue` | Xem hàng chờ | View queue |
| `uwActSaveAgain` | Lưu lại | Save again |
| `uwActStopAi` | Dừng AI | Stop AI |
| `uwActBack` | Quay lại | Back |
| `uwQueuePopWaiting` | Bản đang chờ lưu: lúc {time} (dựa trên phiên bản {base}) | Waiting to save: from {time} (based on version {base}) |
| `uwQueuePopNewer` | Có thay đổi mới sau đó — chưa gửi | Newer edits since then — not sent |
| `uwQueueBlockedSave` | Lần lưu trước vẫn đang chờ. Bạn lưu tiếp được khi lần đó xong. | Your last save is still waiting. You can save again once it finishes. |
| `uwQueueFull` | Bộ nhớ đồng bộ trên máy này đã đầy nên lần lưu chưa được xếp hàng. Thay đổi vẫn trong cửa sổ đang mở; hãy giải phóng chỗ trong trung tâm đồng bộ. | Sync storage on this computer is full, so the save wasn’t queued. Your changes are still in the open window; free up space in the sync center. |
| `uwQueueOpenCenter` | Mở trung tâm đồng bộ | Open sync center |
| `uwQueueCancel` | Hủy lần lưu… | Cancel save… |
| `uwQueueCancelConfirm` | Hủy lần lưu đang chờ? Thay đổi vẫn ở trên máy này; tài liệu trên UniWork không đổi. | Cancel the queued save? Your changes stay on this computer; the document on UniWork doesn’t change. |
| `uwQueueCancelled` | Đã hủy lần lưu đang chờ. Thay đổi vẫn ở trên máy này. | Queued save cancelled. Your changes stay on this computer. |
| `uwReasonDeleted` (sẵn có) | tài liệu đã bị xóa | document deleted |
| `uwReasonForbidden` / `uwReasonQuota` / `uwReasonTooLarge` / `uwReasonOther` (sẵn có; `uwReasonForbidden` dùng cho `permission_revoked`, ba khóa sau cho `{reason}` của `uwRowFailed`/`uwTipFailed`) | (sẵn có) | (sẵn có) |
| `uwReasonSession` / `uwReasonSignedOut` / `uwReasonForeign` / `uwReasonArchived` / `uwReasonSuspended` / `uwReasonDeactivated` / `uwReasonLease` / `uwReasonKeystore` / `uwReasonClock` / `uwReasonStoreFull` / `uwReasonStoreNewer` | cần đăng nhập lại / đã đăng xuất / thuộc tài khoản khác / tài liệu đã được lưu trữ / tổ chức đang bị tạm ngưng / tài khoản của bạn đã bị vô hiệu hóa trong tổ chức / quyền offline đã hết hạn / kho khóa của máy đang khóa / đồng hồ máy bị lùi / bộ nhớ đồng bộ trên máy đã đầy / cần phiên bản ứng dụng mới hơn | sign in again / signed out / belongs to another account / document archived / organization suspended / your account is deactivated in this organization / offline access expired / this computer’s keychain is locked / the clock was set back / sync storage on this computer is full / a newer app version is needed |
| `uwBadgeQueued` / `uwBadgeWaitNetwork` / `uwBadgePausedUser` / `uwBadgePausedAdmin` / `uwBadgeSending` / `uwBadgeReconciling` / `uwBadgeReconcileStuck` / `uwBadgeConflict` / `uwBadgeBlocked` / `uwBadgeLocked` / `uwBadgeRevoked` / `uwBadgeDeleted` / `uwBadgeReconnect` / `uwBadgeKeystore` / `uwBadgeFailed` / `uwBadgeSaved` / `uwBadgeKeptDraft` / `uwBadgeMoved` / `uwBadgeArchived` | Đang chờ / Chờ mạng / Bạn đã tạm dừng / Tạm dừng bởi quản trị / Đang gửi / Đang đối soát / Cần hỗ trợ / Xung đột / Bị chặn / Đã khóa / Không còn quyền / Đã xóa / Cần kết nối lại / Kho khóa đang khóa / Không gửi được / Đã lưu / Nháp đã giữ / Đã chuyển / Đã lưu trữ | Waiting / Waiting for network / Paused by you / Paused by admin / Sending / Checking / Needs support / Conflict / Blocked / Locked / No access / Deleted / Reconnect needed / Keychain locked / Couldn’t send / Saved / Kept draft / Moved / Archived |
| `uwRowQueued` | Lưu lúc {time} · dựa trên phiên bản {base} · {size} | Saved {time} · based on version {base} · {size} |
| `uwRowWaitNetwork` | Sẽ gửi khi có mạng | Will send when online |
| `uwRowPausedUser` | Sẽ gửi khi bạn bấm "Tiếp tục gửi" | Will send when you choose Resume sending |
| `uwRowPausedAdmin` | Sẽ gửi khi quản trị viên bật lại | Will send when your admin turns sending back on |
| `uwRowUploading` | Đang tải lên {done} / {total} | Uploading {done} / {total} |
| `uwRowCommitting` | Đang ghi phiên bản | Creating the version |
| `uwRowReconciling` | Chưa rõ kết quả lần gửi lúc {time}. Đang hỏi lại UniWork. | The result of the send at {time} isn’t clear yet. Checking with UniWork. |
| `uwRowReconcileStuck` | Số lần đã thử đối soát: {count}, chưa có kết quả. Ứng dụng sẽ không gửi lại; hãy gửi mã hỗ trợ cho quản trị viên. | Reconcile attempts: {count}, no result yet. The app won’t resend; send the support code to your admin. |
| `uwStuckDiscardConfirm` | Bỏ lần lưu này? Nếu nó đã tới UniWork thì phiên bản đó vẫn còn; bản của bạn được giữ thành nháp trong trung tâm đồng bộ. | Discard this save? If it already reached UniWork, that version stays; your copy is kept as a draft in the sync center. |
| `uwRowConflict` | Phiên bản {n} đã được lưu bởi {author} lúc {time} | Version {n} was saved by {author} at {time} |
| `uwRowFailed` | Không gửi được: {reason} | Couldn’t send: {reason} |
| `uwRowBlocked` | Không lưu được: {reason} | Can’t save: {reason} |
| `uwRowCommitted` | Phiên bản {n} · {time} | Version {n} · {time} |
| `uwRowKeptDraft` | Giữ từ lần tải lại lúc {time} | Kept when you reloaded at {time} |
| `uwRowMoved` / `uwRowArchived` | Tài liệu đã được chuyển tới {workspace} / Tài liệu đã được lưu trữ trên UniWork | The document moved to {workspace} / The document was archived on UniWork |
| `uwActRetry` (sẵn có) | Thử lại | Retry |
| `uwActDiscard` / `uwActDiscardSave` | Bỏ / Bỏ lần lưu… | Discard / Discard save… |
| `uwActSendNow` / `uwActRecheck` / `uwActGuide` / `uwActOpenToResolve` / `uwActCopySupport` / `uwActDownloadMine` / `uwActOpenDraft` / `uwActDiscardDraft` / `uwActSignInAgain` / `uwActSignIn` / `uwActSwitchAccount` / `uwActReconnect` / `uwActDetails` / `uwActOpen` | Gửi ngay / Kiểm tra lại / Hướng dẫn / Mở để xử lý / Sao chép mã hỗ trợ / Tải bản của tôi về máy / Mở nháp / Bỏ nháp… / Đăng nhập lại / Đăng nhập / Chuyển tài khoản / Kết nối lại / Chi tiết / Mở | Send now / Check again / Guide / Open to resolve / Copy support code / Download my version / Open draft / Discard draft… / Sign in again / Sign in / Switch account / Reconnect / Details / Open |
| `uwDiscardDraftConfirm` | Bỏ nháp này? Thay đổi trong nháp sẽ bị xóa khỏi máy này và không khôi phục được. | Discard this draft? Its changes will be removed from this computer and can’t be recovered. |
| `uwSignOutTitle` | Đăng xuất khỏi UniWork? | Sign out of UniWork? |
| `uwSignOutBody` | Tài liệu còn thay đổi chưa lưu hoặc lần lưu đang chờ: {count}. Chúng được giữ khóa trên máy này và chỉ tài khoản của bạn mở lại được. | Documents with unsaved changes or queued saves: {count}. They stay locked on this computer and only your account can open them again. |
| `uwSignOutKeystore` | Kho khóa của máy đang khóa nên thay đổi chưa lưu chỉ còn trong cửa sổ đang mở. Đăng xuất bây giờ sẽ bỏ các thay đổi đó; những gì đã được giữ mã hóa vẫn còn. Muốn giữ chúng, hãy mở khóa máy trước. | The computer’s keychain is locked, so unsaved changes exist only in open windows. Signing out now discards them; anything already kept encrypted stays. To keep them, unlock the computer first. |
| `uwSignOutGo` | Đăng xuất | Sign out |
| `uwSignOutWaiting` | Đang hoàn tất lần lưu đang gửi trước khi đăng xuất… | Finishing the save in progress before signing out… |

### Trung tâm đồng bộ

| Khóa | vi | en |
| --- | --- | --- |
| `uwSyncTitle` | Trung tâm đồng bộ | Sync center |
| `uwSyncOpenFromSettings` (liên kết trong Cài đặt › Tài khoản; OQ-UX7, U-15, 2026-10-12) | Trung tâm đồng bộ | Sync center |
| `uwSyncOnline` | Đã kết nối UniWork · đồng bộ lúc {time} | Connected to UniWork · synced {time} |
| `uwSyncOffline` | Không có mạng · lần đồng bộ cuối {time} | Offline · last synced {time} |
| `uwSyncPaused` | Đã tạm dừng gửi — lần lưu mới sẽ chờ | Sending paused — new saves will wait |
| `uwSyncAdminPaused` | Quản trị viên đang tạm dừng việc gửi. Các lần lưu được giữ trên máy này. | Your admin has paused sending. Saves are kept on this computer. |
| `uwSyncFeedOff` | Tạm thời không nhận thông báo phiên bản mới. Khi bạn lưu, UniWork vẫn kiểm tra xung đột. | New-version notices are paused. UniWork still checks for conflicts when you save. |
| `uwSyncResynced` | Đã đồng bộ lại toàn bộ lúc {time} | Fully resynced at {time} |
| `uwSyncResyncFailed` | Chưa đồng bộ lại được sau nhiều lần thử. Thông báo phiên bản mới tạm dừng; khi bạn lưu, UniWork vẫn kiểm tra xung đột. | Couldn’t resync after several tries. New-version notices are paused; UniWork still checks for conflicts when you save. |
| `uwSyncSignedOut` | Bạn đã đăng xuất. Số mục đang được giữ khóa trên máy này: {count}. | You’re signed out. Items kept locked on this computer: {count}. |
| `uwSyncSignedOutEmpty` | Bạn đã đăng xuất. | You’re signed out. |
| `uwSyncSessionExpired` | Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục gửi. | Your session expired. Sign in again to keep sending. |
| `uwSyncOtherOrg` | Lần lưu đang chờ ở tổ chức khác: {count} | Saves waiting in another organization: {count} |
| `uwSyncStoreBudget` | Bộ nhớ đồng bộ trên máy: {used} / {cap} | Sync storage on this computer: {used} of {cap} |
| `uwSyncStoreError` | Không đọc được hàng chờ trên máy này. Dữ liệu chưa bị xóa. | Couldn’t read the queue on this computer. Nothing was deleted. |
| `uwSyncNow` / `uwSyncPause` / `uwSyncResume` | Đồng bộ ngay / Tạm dừng gửi / Tiếp tục gửi | Sync now / Pause sending / Resume sending |
| `uwSyncNowOffline` | Cần có mạng để đồng bộ. | Syncing needs a connection. |
| `uwSyncTabAttention` / `uwSyncTabQueue` / `uwSyncTabOffline` / `uwSyncTabRecent` | Cần xử lý / Đang chờ lưu / Dùng khi không có mạng / Đã lưu gần đây | Needs attention / Waiting to save / Available offline / Recently saved |
| `uwSyncTabCount` | {label}, {count} mục | {label}: {count} |
| `uwSyncColDoc` / `uwSyncColState` / `uwSyncColDetail` / `uwSyncColActions` | Tài liệu / Trạng thái / Chi tiết / Hành động | Document / Status / Details / Actions |
| `uwSyncMoreActions` | Thêm hành động cho {doc} | More actions for {doc} |
| `uwSyncEmptyQueue` | Không có lần lưu nào đang chờ. | Nothing is waiting to save. |
| `uwSyncEmptyAttention` | Không có gì cần xử lý. | Nothing needs attention. |
| `uwSyncEmptyRecent` | Chưa có lần lưu nào gần đây. | No recent saves. |
| `uwSyncRowAnnounce` | {doc}: {state} | {doc}: {state} |

### Thư viện offline và khóa

| Khóa | vi | en |
| --- | --- | --- |
| `uwOfflinePin` / `uwOfflineUnpin` | Dùng khi không có mạng / Bỏ dùng khi không có mạng | Make available offline / Remove offline copy |
| `uwOfflineUnpinShort` | Bỏ ghim | Unpin |
| `uwOfflineAdd` | Thêm tài liệu… | Add documents… |
| `uwOfflineUsage` | Đang dùng {used} / {cap} trên máy này | Using {used} of {cap} on this computer |
| `uwOfflineEmpty` | Chưa có tài liệu nào dùng khi không có mạng. | No documents are available offline yet. |
| `uwOfflineCapReached` | Thư viện offline trên máy này đã đạt giới hạn: dung lượng {cap}; số tài liệu tối đa: {maxDocs}. Bỏ ghim một tài liệu để thêm tài liệu khác. | The offline library on this computer is at its limit: storage {cap}; maximum documents: {maxDocs}. Remove an offline copy to add another. |
| `uwOfflineReady` | Sẵn sàng offline | Available offline |
| `uwOfflineBadgeWaiting` / `uwOfflineBadgeDownloading` / `uwOfflineBadgeVerifying` / `uwOfflineBadgeUpdate` / `uwOfflineBadgeInterrupted` / `uwOfflineBadgeDiskFull` / `uwOfflineBadgeCorrupt` / `uwOfflineBadgeLeaseSoon` / `uwOfflineBadgeViewOnly` | Chờ mạng / Đang tải / Đang kiểm tra / Có bản mới / Chưa sẵn sàng / Không đủ dung lượng / Bản tải về bị lỗi / Sắp hết quyền offline / Sẵn sàng offline · chỉ xem | Waiting for network / Downloading / Verifying / Update available / Not ready / Not enough space / Download damaged / Offline access ending soon / Available offline · view only |
| `uwOfflineRowWaiting` | Sẽ tải khi có mạng | Will download when online |
| `uwOfflineRowProgress` | {done} / {total} | {done} of {total} |
| `uwOfflineRowProgressAria` | {done} trên {total} | {done} of {total} |
| `uwOfflineRowVerifying` | Đang kiểm tra tính toàn vẹn | Checking integrity |
| `uwOfflineRowReady` | Phiên bản {n} · {size} · quyền offline tới {datetime} | Version {n} · {size} · offline access until {datetime} |
| `uwOfflineRowUpdate` | Phiên bản {n} sẽ tải khi có mạng; bản {old} vẫn dùng được | Version {n} will download when online; version {old} still works |
| `uwOfflineRowUpdateKept` | Chưa cập nhật được lên phiên bản {n}: {reason}. Bản {old} vẫn dùng được. | Couldn’t update to version {n}: {reason}. Version {old} still works. |
| `uwOfflineRowInterrupted` | Tải bị gián đoạn. Bản cũ (nếu có) vẫn dùng được. | The download was interrupted. The older copy (if any) still works. |
| `uwOfflineRowDiskFull` | Cần thêm {size}. Bản cũ vẫn được giữ. | {size} more needed. The older copy is kept. |
| `uwOfflineRowCorrupt` | Đã bỏ bản lỗi. Hãy tải lại. | The damaged copy was removed. Download it again. |
| `uwOfflineRowLeaseSoon` | Kết nối trước {datetime} để gia hạn | Connect before {datetime} to renew |
| `uwOfflineRowRevoked` | Bạn không còn quyền với tài liệu này. Bản tải về đã được xóa khỏi máy; nháp được giữ khóa. | You no longer have access to this document. The downloaded copy was removed; drafts stay locked. |
| `uwOfflineRowDeleted` | Tài liệu đã bị xóa trên UniWork. Bản tải về đã được xóa khỏi máy; nháp được giữ khóa. | The document was deleted on UniWork. The downloaded copy was removed; drafts stay locked. |
| `uwOfflineRowArchived` | Tài liệu đã được lưu trữ; bản trên máy vẫn mở được tới hết quyền offline. | The document was archived; the copy here opens until offline access ends. |
| `uwOfflineRowMoved` | Đã chuyển tới {workspace}; bản trên máy vẫn dùng được. | Moved to {workspace}; the copy here still works. |
| `uwOfflineRowViewOnly` | Phiên bản {n} · chỉ xem · quyền offline tới {datetime} | Version {n} · view only · offline access until {datetime} |
| `uwOfflineReadyAnnounce` | Sẵn sàng offline: {doc} | Available offline: {doc} |
| `uwOfflineUnpinConfirm` | Bản tải về sẽ được xóa khỏi máy này. Nháp và lần lưu đang chờ được giữ lại. | The downloaded copy will be removed from this computer. Drafts and queued saves are kept. |
| `uwOfflineCancelDownload` / `uwOfflineDownloadNow` / `uwOfflineOpenFolder` | Hủy tải / Tải ngay / Mở thư mục lưu trữ | Cancel download / Download now / Open storage folder |
| `uwLockLeaseTitle` / `uwLockKeystoreTitle` / `uwLockClockTitle` / `uwLockRevokedTitle` / `uwLockDeletedTitle` / `uwLockForeignTitle` / `uwLockOrgTitle` | Cần kết nối lại / Kho khóa của máy đang khóa / Cần kiểm tra thời gian / Không còn quyền truy cập / Tài liệu đã bị xóa / Tài liệu của tài khoản khác / Không mở được trong tổ chức này | Reconnect needed / This computer’s keychain is locked / Time check needed / No access / Document deleted / Belongs to another account / Can’t open in this organization |
| `uwLockExpired` | Quyền offline đã hết hạn. Nội dung được giữ mã hóa; kết nối để mở lại. | Offline access expired. The content stays encrypted; connect to open it again. |
| `uwLockLibraryOff` | Quản trị viên đã tắt tài liệu dùng khi không có mạng nên quyền offline không được gia hạn. Nháp được giữ khóa trong trung tâm đồng bộ. | Your admin turned off offline documents, so offline access can’t be renewed. Drafts stay locked in the sync center. |
| `uwLockKeystore` | Kho khóa của máy đang khóa nên không mở được nội dung đã mã hóa. Mở khóa máy rồi thử lại; dữ liệu không bị xóa. | The computer’s keychain is locked, so the encrypted content can’t be opened. Unlock it and try again; nothing was deleted. |
| `uwLockClock` | Đồng hồ máy đã bị lùi nên quyền offline tạm khóa. Kết nối để UniWork kiểm tra thời gian. | The computer’s clock was set back, so offline access is locked. Connect so UniWork can check the time. |
| `uwLockForeign` | Tài liệu này thuộc một tài khoản khác trên máy này. Chuyển sang tài khoản đó để mở. | This document belongs to another account on this computer. Switch to that account to open it. |
| `uwLockSuspended` | Tổ chức đang bị tạm ngưng. Nội dung được giữ mã hóa; hãy liên hệ quản trị viên. | The organization is suspended. The content stays encrypted; contact your admin. |
| `uwLockDeactivated` | Tài khoản của bạn đã bị vô hiệu hóa trong tổ chức này. Nội dung được giữ mã hóa; hãy liên hệ quản trị viên. | Your account is deactivated in this organization. The content stays encrypted; contact your admin. |
| `uwLockSignedOutTitle` | Bạn đã đăng xuất | You’re signed out |
| `uwLockSignedOut` | Nội dung được giữ khóa trên máy này. Đăng nhập cùng tài khoản để mở lại. | The content stays locked on this computer. Sign in with the same account to open it again. |
| `uwLockRegion` | Trạng thái tài liệu | Document status |
| `uwLockNewerStoreTitle` | Cần phiên bản ứng dụng mới hơn | A newer app version is needed |
| `uwLockNewerStore` | Dữ liệu này cần phiên bản ứng dụng mới hơn. Hãy cập nhật UniWork Office; dữ liệu không bị xóa và không có lần lưu mới nào được tạo. | This data needs a newer app version. Update UniWork Office; nothing was deleted and no new save was created. |
| `uwLockWhileOpen` | Tài liệu đã bị khóa trong khi đang mở. Thay đổi chưa lưu được giữ mã hóa; bạn chưa lưu hoặc chép được cho tới khi mở khóa. | The document was locked while open. Unsaved changes are kept encrypted; you can’t save or copy until it’s unlocked. |
| `uwLockWhileOpenRam` | Tài liệu đã bị khóa trong khi đang mở và máy chưa giữ được thay đổi một cách an toàn. Thay đổi chỉ còn trong cửa sổ này (chỉ xem); đóng cửa sổ sẽ mất chúng. | The document was locked while open and this computer can’t keep your changes safely yet. They exist only in this window (view only); closing it loses them. |
| `uwLockOtherWindow` | Tài liệu này đang mở để sửa trong cửa sổ khác. Cửa sổ này chỉ xem. | This document is open for editing in another window. This window is view only. |
| `uwLockOtherWindowGone` | Cửa sổ đang sửa tài liệu này không còn phản hồi. Bạn có thể sửa ở cửa sổ này. | The window editing this document stopped responding. You can edit in this window. |
| `uwLockGoToWindow` / `uwLockTakeEdit` | Chuyển tới cửa sổ đó / Sửa ở cửa sổ này | Go to that window / Edit in this window |

### Xung đột và phiên bản mới

| Khóa | vi | en |
| --- | --- | --- |
| `uwConflictTitle` (= `appWebConflictTitle`, danh từ theo app: Sheets "Sổ làm việc này…" / "This workbook…") | Tài liệu này đã được thay đổi ở nơi khác | This document was changed elsewhere |
| `uwConflictBody` | Thay đổi của bạn chưa lưu lên UniWork và vẫn an toàn trên máy này. | Your changes aren’t on UniWork yet and are safe on this computer. |
| `webConflictBodySafe` (mới, web) | Thay đổi của bạn chưa lưu lên UniWork và vẫn được giữ trong trình duyệt này cho tới khi bạn đăng xuất. | Your changes aren’t on UniWork yet and are kept in this browser until you sign out. |
| `uwConflictColMine` / `uwConflictColServer` | Bản của bạn / Bản trên UniWork | Your version / Version on UniWork |
| `uwConflictRowVersion` / `uwConflictRowTime` / `uwConflictRowBy` | Phiên bản / Thời điểm / Người lưu | Version / Time / Saved by |
| `uwConflictMineUnsaved` | Bạn (chưa lưu) | You (not saved) |
| `uwConflictBasedOn` | dựa trên phiên bản {n} | based on version {n} |
| `uwConflictViewDiff` | Xem khác biệt | View differences |
| `uwConflictReload` (= `appWebConflictReload`) | Tải lại bản mới nhất | Reload latest |
| `uwConflictOverwrite` (= `appWebConflictOverwrite`, nội dung mới) | Ghi đè… | Overwrite… |
| `uwConflictCancel` (= `appCancel`) | Hủy | Cancel |
| `uwConflictKeepUnavailable` | Máy chưa giữ được nháp (bộ nhớ đồng bộ đầy hoặc kho khóa đang khóa). | This computer can’t keep a draft right now (sync storage full or keychain locked). |
| `uwConflictOfflineDesktop` | Không có mạng và bản mới nhất chưa có trên máy này nên chưa tải lại được. | You’re offline and the latest version isn’t on this computer, so it can’t reload yet. |
| `uwConflictNoEdit` | Bạn không còn quyền sửa tài liệu này. | You no longer have edit access to this document. |
| `uwConflictOverwriteTitle` | Ghi đè bằng bản của bạn? | Overwrite with your version? |
| `uwConflictOverwriteConfirm` | UniWork sẽ tạo phiên bản {next} từ bản của bạn. Phiên bản {server} của {author} vẫn còn trong lịch sử. | UniWork will create version {next} from your copy. Version {server} by {author} stays in the history. |
| `uwConflictOverwriteGo` / `uwConflictBack` | Ghi đè / Quay lại | Overwrite / Back |
| `uwConflictHeadMoved` | Trong lúc đó UniWork đã có phiên bản {n}. Bảng đã cập nhật; hãy chọn lại. | Meanwhile UniWork got version {n}. The table is updated; choose again. |
| `uwConflictReloadTitle` | Tải lại bản mới nhất | Reload latest |
| `uwConflictReloadDesktopBody` | Chọn điều xảy ra với thay đổi của bạn trước khi tải phiên bản {n}. | Choose what happens to your changes before version {n} loads. |
| `uwConflictKeepDraft` / `uwConflictDiscard` | Giữ bản của tôi làm nháp / Bỏ thay đổi của tôi | Keep my version as a draft / Discard my changes |
| `uwConflictKeepDraftHint` | Nháp nằm trong trung tâm đồng bộ, mở để xem hoặc chép; không tự áp lên bản mới. | The draft stays in the sync center to view or copy; it’s never applied to the new version automatically. |
| `uwConflictDraftCapReached` | Số nháp được giữ của tài liệu này đã đạt mức tối đa: {cap}. Bỏ một nháp cũ trong trung tâm đồng bộ để giữ thêm. | This document has reached the maximum number of kept drafts: {cap}. Discard an old draft in the sync center to keep another. |
| `uwConflictReloadGo` | Tải lại | Reload |
| `uwConflictSaveCopy` (OQ-UX6, U-15, 2026-10-12) | Lưu thành bản sao… | Save as a copy… |
| `uwConflictSaveCopyTitle` | Lưu thành bản sao? | Save as a copy? |
| `uwConflictSaveCopyConfirm` | UniWork sẽ tạo một tài liệu mới từ bản của bạn, cùng chủ sở hữu và quyền truy cập với tài liệu này. Tài liệu hiện tại và phiên bản {server} của {author} không đổi. | UniWork will create a new document from your version, with the same owner and access as this document. The current document and version {server} by {author} stay as they are. |
| `uwConflictSaveCopyGo` | Tạo bản sao | Create copy |
| `uwConflictSaveCopyDone` | Đã lưu bản của bạn thành tài liệu mới: {title}. Tài liệu này chưa đổi; bạn vẫn chọn được Tải lại hoặc Ghi đè. | Your version was saved as a new document: {title}. This document hasn’t changed; you can still reload or overwrite. |
| `uwConflictSaveCopyFailed` | Chưa tạo được bản sao. Thay đổi của bạn vẫn an toàn; hãy thử lại. | Couldn’t create the copy. Your changes are still safe; try again. |
| `uwConflictSaveCopyOffline` | Không có mạng. Tạo bản sao cần kết nối; thay đổi của bạn vẫn được giữ. | You’re offline. Creating a copy needs a connection; your changes are kept. |
| `uwConflictReloadWebBody` | Trình duyệt không giữ nháp xung đột. Tải bản của bạn về máy để chép lại sau, hoặc bỏ thay đổi. | The browser doesn’t keep conflict drafts. Download your version to copy from later, or discard your changes. |
| `uwConflictDownloadThenReload` / `uwConflictDiscardThenReload` | Tải bản của tôi về máy rồi tải lại / Bỏ thay đổi và tải lại | Download my version, then reload / Discard changes and reload |
| `uwConflictMineFileSuffix` | (bản của tôi) | (my version) |
| `uwConflictDownloadCheck` | Trình duyệt đã nhận tệp bản của bạn. Hãy kiểm tra tệp đã được lưu, rồi bấm Tải lại. | Your browser received your file. Check that it was saved, then choose Reload. |
| `uwConflictSessionWeb` | Phiên đăng nhập đã hết hạn nên chưa ghi đè được. Thay đổi vẫn được giữ trong trình duyệt này; đăng nhập lại rồi thử lại. | Your session expired, so the overwrite didn’t happen. Your changes stay in this browser; sign in again and retry. |
| `uwConflictTooLarge` | Bản của bạn vượt giới hạn kích thước của UniWork nên chưa ghi đè được. | Your version is over UniWork’s size limit, so it couldn’t overwrite. |
| `uwConflictDownloadFailed` | Chưa tải được bản của bạn về máy nên tài liệu chưa được tải lại. Hãy thử lại. | Couldn’t download your version, so the document didn’t reload. Try again. |
| `uwConflictReloadFailed` | Không tải được bản mới nhất. Tài liệu của bạn chưa thay đổi; hãy thử lại. | Couldn’t load the latest version. Your document hasn’t changed; try again. |
| `uwConflictOverwriteFailed` | Chưa ghi đè được. Tài liệu của bạn chưa thay đổi; hãy thử lại. | Couldn’t overwrite yet. Your document hasn’t changed; try again. |
| `uwConflictOfflineWeb` | Không có mạng. Trên web, lựa chọn này cần kết nối; thay đổi vẫn được giữ trong trình duyệt. | You’re offline. On the web this needs a connection; your changes stay in this browser. |
| `uwConflictClose` | Đóng | Close |
| `uwRemoteRegion` | Phiên bản mới | New version |
| `uwRemoteUpdated` | Đã cập nhật lên phiên bản {n} do {author} lưu lúc {time}. | Updated to version {n}, saved by {author} at {time}. |
| `uwRemoteUpdatedNoRev` | Đã cập nhật lên phiên bản mới nhất trên UniWork. | Updated to the latest version on UniWork. |
| `uwRemoteNewerDirty` | Có phiên bản mới hơn trên UniWork (phiên bản {n}). Thay đổi của bạn chưa lưu nên tài liệu không tự tải lại. | A newer version is on UniWork (version {n}). You have unsaved changes, so the document didn’t reload. |
| `uwRemoteNewerAi` | Có phiên bản mới hơn trên UniWork (phiên bản {n}). UniWork AI đang chạy nên tài liệu không tự tải lại; kết quả AI chỉ áp dụng cho bản đang mở. | A newer version is on UniWork (version {n}). UniWork AI is running, so the document didn’t reload; AI results apply only to the open copy. |
| `uwRemoteNowClean` | Bạn đã hoàn tác hết thay đổi. Phiên bản {n} trên UniWork mới hơn bản đang mở. | You’ve undone all changes. Version {n} on UniWork is newer than the open copy. |
| `uwRemoteStopAiConfirm` | Dừng lượt UniWork AI đang chạy để tải lại? Thay đổi AI đã áp dụng sẽ theo bản đang mở. | Stop the running UniWork AI run to reload? Changes AI already made belong to the open copy. |
| `uwRemoteWaitCommit` | Đang chờ lần lưu đang gửi hoàn tất; tải lại được sau đó. | Waiting for the save in progress to finish; you can reload after that. |
| `uwRemoteWaitStuck` | Lần lưu trước đang cần hỗ trợ nên chưa tải lại hay ghi đè được. Mở trung tâm đồng bộ để xử lý. | The earlier save needs support, so you can’t reload or overwrite yet. Open the sync center to resolve it. |
| `uwRemoteReload` / `uwRemoteLater` / `uwRemoteClose` | Tải lại bản mới nhất… / Để sau / Đóng | Reload latest… / Later / Close |
| `uwRemoteReloadFailed` | Không tải được phiên bản {n}. Bạn vẫn đang xem bản trước. | Couldn’t load version {n}. You’re still viewing the previous version. |
| `uwRemoteRevoked` | Bạn không còn quyền truy cập tài liệu này. Đã dừng lưu; thay đổi chưa lưu được giữ khóa trên máy này. | You no longer have access to this document. Saving stopped; unsaved changes are kept locked on this computer. |
| `uwRemoteRevokedWeb` | Bạn không còn quyền truy cập tài liệu này. Đã dừng lưu; thay đổi chưa lưu được giữ trong trình duyệt này cho tới khi bạn đăng xuất. | You no longer have access to this document. Saving stopped; unsaved changes are kept in this browser until you sign out. |
| `uwRemoteDeleted` | Tài liệu này đã bị xóa trên UniWork. Các lần lưu đang chờ đã dừng. | This document was deleted on UniWork. Queued saves stopped. |
| `uwRemoteOrgBlockedWeb` | Không lưu được: {reason}. Thay đổi chưa lưu được giữ trong trình duyệt này cho tới khi bạn đăng xuất. | Couldn’t save: {reason}. Unsaved changes are kept in this browser until you sign out. |
| `uwAuthorFallback` | một thành viên | a member |

### UniWork AI

| Khóa | vi | en |
| --- | --- | --- |
| `aiUniworkProvider` | UniWork AI | UniWork AI |
| `aiUniworkCreditsAria` | Còn {remaining} trên {limit} tín dụng | {remaining} of {limit} credits left |
| `aiUniworkFooterSignIn` | Đăng nhập UniWork để dùng UniWork AI | Sign in to UniWork to use UniWork AI |
| `aiUniworkSignedOut` | Phiên UniWork đã đăng xuất. Chọn nhà cung cấp khác hoặc đăng nhập lại. | You’re signed out of UniWork. Choose another provider or sign in again. |
| `aiUniworkOff` | UniWork AI đang tắt cho tài liệu này. Chọn nhà cung cấp khác. | UniWork AI is off for this document. Choose another provider. |
| `aiUniworkDisclosure` | UniWork AI đọc nội dung đang mở trong tài liệu này, kể cả phần chưa lưu, và gửi tới UniWork cùng nhà cung cấp mô hình để trả lời. Mỗi lượt dùng tín dụng AI của {org}. AI không tự lưu: bạn xem lại rồi bấm Lưu. | UniWork AI reads what’s open in this document, including unsaved changes, and sends it to UniWork and the model provider to answer. Each run uses {org}’s AI credits. AI never saves for you: review, then press Save. |
| `aiUniworkDisclosureLabel` | Nội dung gửi tới UniWork AI | What UniWork AI receives |
| `aiUniworkDisclosureShort` | Gửi nội dung đang mở (kể cả chưa lưu) tới UniWork · tín dụng của {org} | Sends open content (including unsaved) to UniWork · {org} credits |
| `aiUniworkLocalFile` | Tệp này nằm trên máy bạn, chưa ở UniWork. Khi dùng UniWork AI, nội dung tệp đang mở được gửi tới UniWork và dùng tín dụng AI của {org}. Tệp không được tải lên thành tài liệu UniWork. | This file is on your computer, not in UniWork. With UniWork AI, the open file’s content is sent to UniWork and uses {org}’s AI credits. The file isn’t uploaded as a UniWork document. |
| `aiUniworkViewOnly` | Chế độ chỉ xem: AI trả lời được nhưng không sửa hoặc lưu tài liệu. | View only: AI can answer but can’t edit or save the document. |
| `aiUniworkAck` / `aiUniworkLearnMore` / `aiUniworkDetails` | Đã hiểu / Tìm hiểu thêm / Chi tiết | Got it / Learn more / Details |
| `aiUniworkSendNeedsAck` | Hãy đọc và xác nhận lời công bố trước khi gửi. | Read and confirm the notice before sending. |
| `aiResultAnswer` / `aiResultClarify` / `aiResultEdited` / `aiResultUnsupported` / `aiResultError` | Trả lời / Cần làm rõ / Đã sửa trong tài liệu / Chưa hỗ trợ / Lỗi | Answer / Needs clarification / Edited in document / Not supported / Error |
| `aiResultEditedHint` | Chưa lưu — hoàn tác bằng Ctrl/⌘+Z hoặc bấm Lưu khi đã ổn. | Not saved — undo with Ctrl/⌘+Z, or press Save when it looks right. |
| `aiResultViewChanges` | Xem thay đổi | View changes |
| `aiResultCellsMeta` | Đã ghi {written} ô ({range}) · {overwritten} ô có sẵn bị ghi đè | Cells written: {written} ({range}) · Existing cells overwritten: {overwritten} |
| `aiRunStop` / `aiRunSend` | Dừng / Gửi | Stop / Send |
| `aiRunRunning` | Đang chạy… Bấm Dừng hoặc Esc để dừng. | Running… Press Stop or Esc to stop. |
| `aiConversationRestarted` | Cuộc trò chuyện trước đã hết hạn nên UniWork AI bắt đầu cuộc mới và không còn nhớ các lượt trước. Gửi lại câu hỏi để tiếp tục. | The previous conversation expired, so UniWork AI started a new one and no longer remembers earlier turns. Send your question again to continue. |
| `aiConversationBoundary` | Cuộc trò chuyện mới với {provider}: các lượt phía trên không được gửi kèm. | New conversation with {provider}: the turns above aren’t sent along. |
| `aiRunStopped` | Đã dừng. Thay đổi đã áp dụng (nếu có) vẫn trong tài liệu và hoàn tác được. | Stopped. Any changes already applied stay in the document and can be undone. |
| `aiRunAskAgain` | Hỏi tiếp | Ask again |
| `aiRunChooseOther` (không phải dạng số nhiều: hậu tố `Other` là nghĩa "khác", test no-plural miễn trừ khóa này) | Chọn nhà cung cấp khác | Choose another provider |
| `aiRunOpenInApp` | Mở bằng ứng dụng | Open in the app |
| `aiErrRunLimit` | Lượt này đã chạm giới hạn số bước của UniWork AI. Kết quả tới đây vẫn được giữ; hãy chia nhỏ yêu cầu rồi hỏi tiếp. | This run reached UniWork AI’s step limit. Results so far are kept; split the request and ask again. |
| `aiErrCredits` | Tổ chức đã dùng hết tín dụng AI kỳ này. Lượt này đã dừng. | Your organization is out of AI credits for this period. This run stopped. |
| `aiErrEntitlement` | Gói của tổ chức không còn bao gồm UniWork AI. | Your organization’s plan no longer includes UniWork AI. |
| `aiErrRateLimited` | Bạn đang gửi quá nhanh. Thử lại sau {seconds} giây. | You’re sending too fast. Try again in {seconds} s. |
| `aiErrRateLimitedNoWait` | Bạn đang gửi quá nhanh. Hãy thử lại sau ít phút. | You’re sending too fast. Try again in a few minutes. |
| `aiErrUnavailable` | UniWork AI tạm thời không phản hồi. Tài liệu và nút Lưu vẫn dùng bình thường. | UniWork AI isn’t responding right now. Your document and Save still work. |
| `aiErrDisconnected` | Mất kết nối giữa chừng nên lượt này đã dừng. Thay đổi đã áp dụng (nếu có) vẫn trong tài liệu và hoàn tác được. | The connection dropped, so this run stopped. Any changes already applied stay in the document and can be undone. |
| `aiErrOffline` | Không có mạng. UniWork AI không chạy khi offline và yêu cầu không được xếp hàng. | You’re offline. UniWork AI doesn’t run offline and requests aren’t queued. |
| `aiErrSession` | Phiên đăng nhập UniWork đã hết hạn nên lượt này đã dừng. Đăng nhập lại để tiếp tục. | Your UniWork session expired, so this run stopped. Sign in again to continue. |
| `aiErrRevoked` | Bạn không còn quyền với tài liệu này nên lượt AI đã dừng. | You no longer have access to this document, so the AI run stopped. |
| `aiErrDowngraded` | Quyền của bạn vừa đổi thành chỉ xem nên AI ngừng sửa tài liệu. Câu trả lời vẫn tiếp tục. | Your access just changed to view only, so AI stopped editing. Answers continue. |
| `aiErrCapabilityOff` | UniWork AI vừa được tắt cho tài liệu này nên lượt đã dừng sau bước hiện tại. | UniWork AI was just turned off for this document, so the run stopped after its current step. |
| `aiErrUnsupported` | UniWork AI chưa làm được thao tác này trong {module}. | UniWork AI can’t do this in {module} yet. |
| `aiErrViewOnlyEdit` | Bạn chỉ có quyền xem tài liệu này nên AI không sửa được. | You only have view access to this document, so AI can’t edit it. |
| `aiErrWorkbookTooLarge` | Bảng tính này quá lớn để AI xử lý trên web. Mở bằng ứng dụng UniWork Office. | This workbook is too large for AI on the web. Open it in the UniWork Office app. |

### Nhãn trong bảng trạng thái → khóa

Nhãn viết thẳng trong bảng trạng thái và Component Patterns; một nhãn một khóa, nơi nào khác khóa thì ghi rõ. Không còn chuỗi nào trong bảng trạng thái thiếu khóa.

| Nhãn (vi) | Khóa | Dùng ở |
| --- | --- | --- |
| Xem hàng chờ | `uwActViewQueue` | pill S1 |
| Lưu lại | `uwActSaveAgain` | pill, hàng `failed` |
| Dừng AI | `uwActStopAi` | pill, Ctrl/⌘+S |
| Quay lại | `uwActBack` (hàng, popover, Discard confirm, Sign-out); `uwConflictBack` (S5) | |
| Xử lý… | `uwActResolve` (sẵn có) | pill `remote-newer`, `conflict` |
| Chi tiết | `uwActDetails` (hàng `failed`); `aiUniworkDetails` (Picker footer) | |
| Thử lại | `uwActRetry` (sẵn có) | `keystore_locked`, `uwSyncStoreError`, S6, offline, bảng lỗi S9 |
| Kiểm tra lại | `uwActRecheck` | lý do bị chặn, hàng `reconciling` |
| Hướng dẫn | `uwActGuide` | hàng `reconciling` |
| Bỏ nháp… / Bỏ / Bỏ lần lưu… | `uwActDiscardDraft` / `uwActDiscard` / `uwActDiscardSave` | |
| Gửi ngay | `uwActSendNow` | hàng `queued` |
| Hủy lần lưu… | `uwQueueCancel` | S2, S4 |
| Mở để xử lý / Mở / Mở nháp | `uwActOpenToResolve` / `uwActOpen` / `uwActOpenDraft` | hàng S2 |
| Sao chép mã hỗ trợ / Tải bản của tôi về máy | `uwActCopySupport` / `uwActDownloadMine` | hàng `reconciling-stuck` |
| Đăng nhập / Đăng nhập lại / Chuyển tài khoản / Kết nối lại | `uwActSignIn` / `uwActSignInAgain` / `uwActSwitchAccount` / `uwActReconnect` | lý do bị chặn, đầu trang S2, Picker footer |
| Mở trung tâm đồng bộ | `uwQueueOpenCenter` | S4, lý do bị chặn, S5, S6 |
| Đóng | `uwRemoteClose` (thanh, panel khóa); `uwConflictClose` (S5) | |
| Chuyển tới cửa sổ đó / Sửa ở cửa sổ này | `uwLockGoToWindow` / `uwLockTakeEdit` | Second-window bar |
| Đồng bộ ngay / Tạm dừng gửi / Tiếp tục gửi | `uwSyncNow` / `uwSyncPause` / `uwSyncResume` | Sync header |
| Cần xử lý / Đang chờ lưu / Dùng khi không có mạng / Đã lưu gần đây | `uwSyncTabAttention` / `uwSyncTabQueue` / `uwSyncTabOffline` / `uwSyncTabRecent` | Sync tab |
| Thêm tài liệu… | `uwOfflineAdd` | Usage header |
| Dùng khi không có mạng / Bỏ ghim (menu: Bỏ dùng khi không có mạng) | `uwOfflinePin` / `uwOfflineUnpinShort` (menu `uwOfflineUnpin`) | menu tài liệu, S3 |
| Hủy tải / Tải ngay / Mở thư mục lưu trữ | `uwOfflineCancelDownload` / `uwOfflineDownloadNow` / `uwOfflineOpenFolder` | S3 |
| Chờ mạng (ghim khi offline) | `uwOfflineBadgeWaiting` | S3 |
| Tải lại bản mới nhất… / Để sau | `uwRemoteReload` / `uwRemoteLater` | S6 |
| Tải lại bản mới nhất / Ghi đè… / Lưu thành bản sao… / Hủy | `uwConflictReload` / `uwConflictOverwrite` / `uwConflictSaveCopy` / `uwConflictCancel` | S5 bước 1 |
| Tải lại / Ghi đè / Tạo bản sao | `uwConflictReloadGo` / `uwConflictOverwriteGo` / `uwConflictSaveCopyGo` | S5 bước 2, `uwRemoteNowClean` |
| Xem khác biệt | `uwConflictViewDiff` | S5 |
| Giữ bản của tôi làm nháp / Bỏ thay đổi của tôi | `uwConflictKeepDraft` / `uwConflictDiscard` | S5 Reload confirm desktop |
| Tải bản của tôi về máy rồi tải lại / Bỏ thay đổi và tải lại | `uwConflictDownloadThenReload` / `uwConflictDiscardThenReload` | S5 Reload confirm web |
| Đăng xuất | `uwSignOutGo` | Sign-out prompt |
| Gửi / Dừng / Hỏi tiếp / Chọn nhà cung cấp khác / Mở bằng ứng dụng | `aiRunSend` / `aiRunStop` / `aiRunAskAgain` / `aiRunChooseOther` / `aiRunOpenInApp` | S9 |
| Đã hiểu / Tìm hiểu thêm | `aiUniworkAck` / `aiUniworkLearnMore` | S8 |
| Xem thay đổi | `aiResultViewChanges` | chip "Đã sửa trong tài liệu" |
| Trả lời / Cần làm rõ / Đã sửa trong tài liệu / Chưa hỗ trợ / Lỗi | `aiResultAnswer` / `aiResultClarify` / `aiResultEdited` / `aiResultUnsupported` / `aiResultError` | Result chip |

## Open questions

Đã đóng bởi U-01 (U-15, 2026-10-12: người dùng ký mọi khuyến nghị của `u01-decision-packet.md`); không còn câu hỏi mở. Mỗi mục ghi câu trả lời đã ký; các bảng ở trên đã cập nhật theo.

- **OQ-UX1 (Product) — đã trả lời (U-15, 2026-10-12):** giữ "UniWork AI" là tên nhà cung cấp trong picker và "AI đám mây UniWork" là tên gói công cụ đám mây trong Cài đặt (`aiUniworkProvider`). G6-05 xử lý mục `uniAI` hiện có (id `genspark`): ẩn hoặc đổi nhãn khi mục `uniwork` có mặt, để picker không hiện hai tên gần giống nhau.
- **OQ-UX2 (Product, G5-D3) — đã trả lời (U-15, 2026-10-12):** các số ở bảng dưới là giá trị đã ký; task thực thi đo lại và chỉ đổi qua Advisor.
- **OQ-UX3 (Product + owner F) — đã trả lời (U-15, 2026-10-12):** footer picker cho trạng thái ẩn là chú thích, không phải lỗi (picker bỏ qua nhà cung cấp không dùng được, không hiện mục xám).
- **OQ-UX4 (owner F) — đã trả lời (U-15, 2026-10-12):** 19 locale ngoài vi/en dùng dịch máy có review; cổng tối thiểu là test parity + placeholder + quét brand (U-02).
- **OQ-UX6 (Product + G1) — đã trả lời (U-15, 2026-10-12):** "Lưu thành bản sao…" có trong S5 v1, giao ở G5-12 (P2); chỉ hiện khi còn quyền sửa; khóa `uwConflictSaveCopy*` (State Patterns › Conflict dialog (S5)).
- **OQ-UX7 (Lead F) — đã trả lời (U-15, 2026-10-12):** chỉ Cài đặt › Tài khoản cộng pill; không dựng menu tài khoản mới (app không có), đặt liên kết `uwSyncOpenFromSettings` trong `AccountPane`.
- **OQ-UX8 (Product) — đã trả lời (U-15, 2026-10-12):** giữ lựa chọn "Tải bản của tôi về máy rồi tải lại" trên web (đường `api.download`, X-02 + G5-09w). Không dùng C18 Restore cho nháp xung đột.
- **OQ-UX9 (Product + owner F) — đã trả lời (U-15, 2026-10-12):** "Xem khác biệt" chỉ có ở Docs (DOCX) trong v1; module khác ẩn nút; G6-01 xác nhận host (desktop/web) của panel so sánh.
- **OQ-UX10 (Product) — đã trả lời (U-15, 2026-10-12):** có; khối công bố S8 hiện lại khi đổi tài liệu hoặc tổ chức (G6-05u lưu "đã hiểu" theo khóa tài khoản, tổ chức, tài liệu).
- **OQ-UX11 (Product + G5-D1) — đã trả lời (U-15, 2026-10-12):** `offline_library` tắt thì bản đã tải được giữ tới khi bật lại hoặc đăng xuất, mở được khi lease còn hạn (lease vẫn là giới hạn quyền); không xóa ngay.
- **OQ-UX12 (Product + owner F) — đã trả lời (U-15, 2026-10-12):** tên tệp tải về `{tên} (bản của tôi).{ext}` / en `{name} (my version).{ext}` qua `uwConflictMineFileSuffix`, đuôi theo định dạng gốc của module; host thay ký tự cấm của hệ điều hành (`\ / : * ? " < > |`) bằng `_`.
- **OQ-UX13 (OPS + Lead F) — đã trả lời (U-15, 2026-10-12):** không có telemetry app → server trong phase này; ghi vào backlog, owner OPS + Lead F. Metric chỉ có ở app không có alert (plan §8, G7-07); "Sao chép mã hỗ trợ" là đường chẩn đoán v1. Xây đường này cần đổi `PRIVACY.md` của fork và một quyết định riêng.
- **OQ-UX14 (Product + Auth) — đã trả lời (U-15, 2026-10-12):** "Tải bản của tôi về máy" trên web là bản sao cục bộ không có hàng `document_access`, ghi trong danh mục bản sao §8.3; host không gọi server ghi sự kiện `export`.
- **OQ-UX15 (G1/FileService + Lead D + Lead F; plan §3 OQ-P1, OQ-P3) — đã trả lời (U-15, 2026-10-12):** OQ-P1 chọn (a1) ở `contract-p0.md` mục 7.1: server so base nội dung bằng cột `content_revision`, nên di chuyển, khôi phục, bỏ lưu trữ và đổi tên không gây 409 khi nội dung không đổi (owner thực thi G5-07). Phần `api.open` xin version không còn là head (OQ-P3) là dữ kiện cho X-02 ở `contract-p0.md` mục 7.3; X-02 chốt, bất biến của spine giữ nguyên: không bao giờ ghép byte cũ với revision của head.

Các số của OQ-UX2 (đã ký, U-15, 2026-10-12):

| Số | Giá trị |
| --- | --- |
| Dung lượng thư viện offline | 2 GiB mỗi tài khoản trên một máy (hiển thị: nơi gọi định dạng số bằng `Intl.NumberFormat(locale)` cộng nhãn đơn vị; giá trị GiB hiện là "GB", ví dụ 2 GiB → "2 GB", vi dùng dấu phẩy thập phân; U-02 F10) |
| Số tài liệu ghim | 200 |
| Số nháp giữ tối đa mỗi tài liệu | 3 |
| Ngân sách store đồng bộ mỗi tài khoản (queue + nháp, không gồm thư viện offline) | 1 GiB |
| Giữ tab "Đã lưu gần đây" | 24 giờ |
| Tự ẩn thanh S6 khi sạch | 8 giây (hover/focus giữ thanh) |
| Ngưỡng "Cần hỗ trợ" (reconciling → reconciling-stuck) | 1 giờ đối soát chưa có kết quả xác định |
| Chu kỳ tự kiểm lại hàng `reconciling-stuck` | 15 phút |
| Số lần resync liên tiếp khi gặp 410 trước `uwSyncResyncFailed` | 5, backoff tăng dần |
| Ngưỡng chờ AI trước `uwTipWaitAiLong` | 30 giây |
| Heartbeat lock cửa sổ | 5 giây; coi là mất sau 15 giây (3 nhịp lỡ) |
| Mức kẹp `Retry-After` | 300 giây |
| Số lần chờ 429 tối đa mỗi lượt | 3 (G6-02 xác nhận khi spike xong) |
| Độ dài queue | Một intent chưa giải quyết mỗi Document (G5-D3); tổng bị chặn bởi ngân sách store 1 GiB (U-15, derived) |
