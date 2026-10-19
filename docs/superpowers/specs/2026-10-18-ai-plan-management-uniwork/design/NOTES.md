# Ghi chú bản vẽ Gói AI (UNI-1910, D2)

Trạng thái: bản nháp để duyệt, 2026-10-18. Chỉ là HTML tĩnh, chưa có mã sản phẩm. Số liệu, tên model, tên người là ví dụ.

## Cách dựng và kiểm

- Mỗi board là một tệp tự chứa (CSS nằm trong tệp). Khối token ở đầu mỗi tệp được sao nguyên văn từ `packages/ui/styles/tokens.css` (`:root` và `.dark`, bỏ các slot landing, preview, meeting, chat-sender, chart không board nào dùng). Không có màu hex nào ngoài khối đó. Ngoại lệ có chủ ý: lớp phủ `rgb(0 0 0/.1)` + blur 2px giống đúng `bg-black/10` của `Dialog` và `Sheet`.
- Cỡ chữ dùng tên vai trò (`--text-caption`, `--text-body`, `--text-title-lg`...) với lớp `.t-*` tương ứng `text-*` của Tailwind. Phông: Inter, Plus Jakarta Sans, JetBrains Mono từ Google Fonts, đúng ba họ trong tokens.css (các board Documents dùng Be Vietnam Pro; bản vẽ này theo app, không theo canvas đó).
- Mỗi trạng thái có bốn khung: máy tính 1280 và di động 390, sáng và tối. Chế độ sáng/tối cố định theo nhãn khung; nút "Đổi sáng/tối" chỉ đổi nền trang bao quanh (đã kiểm: khung sáng giữ nền trắng, khung tối giữ #111 khi bật nút).
- Ảnh chụp: `shots/<trạng thái>-<desktop|mobile>-<light|dark>.png`, 196 ảnh (49 trạng thái × 4, sau Fix round 3), chụp bằng Playwright Chromium. Không khung nào bị tràn ngang. `shots/live/` là ảnh app thật dùng làm chuẩn kiểu; `shots/STYLE-SAMPLE-a1-desktop-light.png` là mẫu kiểu đã duyệt. Đã xem trực tiếp một mẫu từng board; chưa chạy kiểm tương phản đo trên trang render (thuộc `e2e/onboarding-contrast.spec.ts` khi làm thật).
- Khung ngoài dựng lại từ component thật (xem Fix round 1 › Kiểu); bên trong là HTML tĩnh, trạng thái di động và máy tính do tay chọn bố cục, không dựa trên breakpoint.

## Ánh xạ primitive và view

| Board | Dùng lại | Mới cần làm |
| --- | --- | --- |
| A Gói AI tổ chức | Tab mới `ai-plan` trong nhóm Tổ chức của `settings-page.tsx` (gate `org_admin`, icon `Gauge`, đặt trước Truy cập AI). `SettingsTab`, `SettingsSection`, `SettingsCard`, `SettingsRow`, `SettingsList`, thanh mức dùng của `QuotaMeterRow` (80% vàng, 100% đỏ), `Card`, `Table`, `Badge`, `Alert`/`Notice`, `Switch`, `Button`, `Tabs` (gạt), `CollectionPageState`, `Skeleton` | Hàng "Chia hạn mức" có nút sửa; ô số liệu `StatTile` nếu chưa có |
| B Sửa hạn mức | `Sheet` (như Hỏi UNI), `Dialog` (so sánh), `Field`, `Input` có hậu tố, `Select`, `RadioGroup`, `Switch`, `Checkbox`, `Alert` warning, `Button`, `Spinner`, `sonner` | Chip ngưỡng có nút xóa (chip bật/tắt của `Toggle`); danh sách model có khóa |
| C Hạn mức workspace | Tab `ai` hiện có (`ai-tab.tsx`, gate `workspace_admin`), `QuotaMeterRow`, `SettingsRow` chỉ đọc, `Badge`, `Alert`, `Table`/`SettingsList`, `Dialog`, `CollectionPageState` | Hộp thoại yêu cầu tăng hạn mức (đề xuất) |
| D Người dùng cuối | `AskUniPanel` (`Sheet`, bong bóng tin nhắn hiện có), `Alert`, `Button`, `Spinner`, `Popover`, `Drawer` | Dải cảnh báo trên ô nhập; thẻ "hết hạn mức"; ô chọn model (đề xuất mới) |
| E Thông báo | `InboxView`, `KindIcon` (bốn loại mới `ai_quota_threshold`, `ai_quota_exhausted`, `ai_credit_low`, `ai_credit_depleted`), ma trận của `NotificationsTab`, `sonner`, `Checkbox` | Mẫu email HTML (tiêu đề, thân) |
| F Khóa riêng và gói | `Dialog`, `RadioGroup` thẻ, `Table`/`Card`, `Badge`, `Alert`, `Button` | Hộp thoại "Nguồn AI cho Office"; nhãn nguồn trên câu trả lời |

Icon theo `docs/conventions.md`: AI là `Sparkles`; cảnh báo `TriangleAlert`; lỗi `CircleAlert`; thử lại `RefreshCw`; hết hạn mức `Ban`; hạn mức/gói `Gauge`; khóa riêng `KeyRound`. Tab "Gói AI" dùng `Gauge` để không trùng `Sparkles` của tab AI workspace.

## Điều đã chốt theo spec Hub (không tự nghĩ ra)

- Money và credit nằm ở Hub; UniWork chỉ hiện "đã dùng / hạn mức", không lưu số dư. Khi máy chủ AI không phản hồi, số liệu cuối cùng hiện mờ kèm "cập nhật lúc …" (A3), không trình bày như số hiện tại.
- Hạn mức: `hard` chặn, `soft` chỉ cảnh báo; kỳ `day|month|none`, đặt lại 00:00 UTC+7; ngưỡng mặc định 80% và 100%; mọi hạn mức áp dụng song song (B2). Model được phép là giao của gói, tổ chức và từng đối tượng (B1, D5).
- Ghi hạn mức dùng `version`; 409 `conflict` là trạng thái B5/B6. Lưu rồi mới đồng bộ qua outbox nên có "Đang áp dụng…" và "Chưa áp dụng được" (B7, B8).
- 429 `policy_exceeded` là "hết hạn mức", không thử lại; 429 `concurrency_limit` là tạm thời, tự thử lại (D2, D4). 402 `insufficient_credit` và 403 `model_not_allowed` có câu riêng (bảng D6).
- Cảnh báo từ webhook `policy.threshold`, `credit.low`, `credit.depleted`; mỗi cắt ngưỡng một lần mỗi kỳ; payload chỉ có id và số, chữ hiển thị do client ghép (E).
- BYOK theo ADR 0029 và 0034: khóa lưu mã hóa phía server, proxy ghi `credits=0` nên không tính vào hạn mức; Hỏi UNI không dùng khóa riêng (F).

## Giả định cần người đọc để ý

1. Đơn vị hiển thị là US$ 2 chữ số (Q-AIP-2 a; 1 credit = US$ 1 ở Hub). Không quy VND.
2. Hạn mức theo người không gắn workspace, vì Hub chưa hỗ trợ cặp nhãn (SPEC §7, §23).
3. Trang Office (khung genoffice) dùng nền `--on-solid` (trắng) vì chưa có token cho "mặt giấy"; quy tắc F8 giữ trang trắng ở cả hai chế độ. FE cần chốt token genoffice đang dùng.
4. Tên model (Haiku 5.5, Sonnet 5.5, GPT-6 Astra, Gemini 4 Argon, Opus 5.5) chỉ minh họa; danh sách thật từ `/v1/models` đã lọc.
5. Email dựng theo token để so sáng/tối; email thật là HTML bảng với giá trị hex lấy từ cùng token, nhiều ứng dụng thư tự ép nền sáng.

## Câu hỏi mở

Q-AIP-1…10 của spec §17 và D-1…D-6 của bản vẽ nằm ở `index.html`, mỗi câu kèm khuyến nghị và board đang vẽ theo phương án nào.

## Chưa vẽ (cố ý)

- Mua gói, nạp credit, hóa đơn (P3/P4, thanh toán nằm ở Thanh toán hiện có).
- Quản lý webhook (không có UI, chỉ đăng ký qua Admin API).
- Trang trạng thái model (Hub §12) ngoài việc ẩn model đang sập trong bộ chọn.
- Biểu đồ mức dùng theo ngày và theo model (cần chốt dashboard riêng).
- Màn console nền tảng (`/admin`), vì không đụng nội dung và không thuộc quản trị tổ chức.
- Hạn mức nợ cho phép (FE-12): bỏ khỏi a1 khi rút gọn (chỉ hiện khi khác 0, người quản trị không hành động trên đó). Chưa vẽ ở bất kỳ board nào.
- Số lượt chạy cùng lúc tối đa của tổ chức: bỏ khỏi a1, vì không phải thứ người quản trị đổi hay cần để quyết.
- "Cảnh báo gần đây" ở a1: bỏ (không có việc để làm trên đó); lịch sử nằm trong Hộp việc (e1).

## Fix round 1 (2026-10-18, W2 fix1 + yêu cầu kiểu của user 17:35 và 17:50)

### Kiểu và rút gọn (chặn của user)

- **Kiểu:** mọi khung dựng lại từ component thật: `Sidebar variant="inset"` 256px trên `--app-shell` + thẻ nổi `--page-canvas`, `WorkspaceSwitcher`, nav có ô màu đặc, `WorkspaceTopBar`, `CollectionPageHeader`, trang Cài đặt (`SettingsTab/Section/Card/Row/Badge`, `QuotaMeterRow`), ngăn Hỏi UNI 384px. Phông Inter + token. So với ảnh app thật trong `shots/live/`; đã sửa chữ nhóm, độ cao tab, icon theme.
- **Sidebar:** khớp app thật sau nhận xét của lead: lề trái 24px, nhịp hàng 38px, đáy chứa tên người dùng.
- **Board C mở rộng tab AI có sẵn:** giữ "Hạn mức của tổ chức", "30 ngày qua" (4 số + biểu đồ nhỏ) và "Theo tính năng" như app đang chạy; thêm dòng "Hạn mức của workspace", dòng liên hệ và bảng "Dùng trong workspace". Đơn vị chuyển từ token sang US$ theo Q-AIP-2 (a).
- **Rút gọn:** một dòng chỉ ở lại nếu người dùng làm gì đó trên nó hoặc cần nó để quyết. a1 "Kỳ này" = một dòng dùng so với hạn mức + số dư; "Cảnh báo" = một dòng gọn (ngưỡng, người nhận, email chỉ ở hai trường hợp), không dòng cho thứ quản trị viên không đổi được. b: chỉ các trường v1 lưu (khi hết, hạn mức, kỳ, ngưỡng, model), bỏ hint dài và số bản. c: một dòng hạn mức, bảng một cột số, một dòng "Cần đổi hạn mức?". d: gỡ nút Nhắn, bảng câu chữ 3 cột. e/f: bỏ cột và dòng không ai thao tác.

### Theo mục FE

- **FE-1:** d5 (board D#d5): popover bộ chọn model nằm trong ô nhập và neo trên chip, xếp trên thân ngăn (không còn bị che). Đã xem d5 desktop sáng và di động sáng.
- **FE-2:** nhãn chỉ đọc "Mô hình đang dùng" dưới câu trả lời ở d1–d4b (D#d1…d4b), d5a có thêm "Bị giới hạn bởi gói". d5 ghi rõ "Phương án (b), chưa chọn" ở nhãn khung và ghi chú.
- **FE-3:** email chỉ cho hai trường hợp (tổ chức đạt 100%, tổ chức hết credit), không có số tiền: E#e3 (cột "Email ngay"), e4, e5, e6 (cột Email "—" cho các loại khác); người nhận theo §6.4 ở e6. A#a1 dòng Cảnh báo ghi cùng quy tắc; danh sách "cảnh báo gần đây" bỏ.
- **FE-4:** thành viên chỉ thấy trạng thái và ngày đặt lại cho hạn mức workspace/tổ chức (D#d1 dải vàng, d6 hàng 1, F#f1 "Còn dùng được · đặt lại 01/11"). Con số chỉ ở hạn mức cá nhân của chính họ (d1b, d6 hàng 2).
- **FE-5:** bỏ CSV khỏi mọi khung C. Nút xin tăng chỉ ở c4, ghi là "Phương án (b), chưa chọn"; c1–c3 và d2 theo Q-AIP-6 (a): hiện tên quản trị viên, không có nút. f4 cũng bỏ "Nhắn quản trị viên". Index sửa câu hỏi tương ứng.
- **FE-6:** d4/d4b theo §8.1/§5.4: Gateway thử lại 2 lần, 1–2 giây, rồi `ai_busy` "AI đang bận, thử lại sau ít giây." + nút Thử lại; không có bộ đếm phía trình duyệt (d6 hàng ai_busy).
- **FE-7:** mọi số tiền là US$ 2 chữ số, không còn "credit" làm đơn vị. Index liệt kê Q-AIP-1…10 và "Câu hỏi design D-1…D-6".
- **FE-8:** quy tắc người nhận theo §6.4 ở e6; a1 chỉ nêu "quản trị viên tổ chức" cho dòng cảnh báo tổ chức (người nhận workspace/người ở e6).
- **FE-9:** A#a3 hiện số liệu cuối cùng mờ kèm "Cập nhật lúc 14:32"; mọi nơi gọi là "máy chủ AI" (không còn "dịch vụ gói AI/Hub" ở nội dung người dùng).
- **FE-10:** D#d6 dùng đúng câu của §8.1, có hàng `ai_hub_account_missing` và `ai_hub_misconfigured`, khung riêng cho hết hạn mức cấp tổ chức (d2c) theo mẫu `policy_exceeded`.
- **FE-11:** C#c1–c4 bảng thành viên là "Dùng trong workspace" (một phạm vi), bỏ cột hạn mức cá nhân và %.
- **FE-12:** vẽ A#a1b (tab Người dùng) và B#b2b (thêm hạn mức cho người). **Chưa vẽ:** dòng hạn mức nợ (đã bỏ khi rút gọn, xem mục Chưa vẽ).
- **FE-13:** (F#f6 đã bỏ ở Fix round 2) không còn số lượt và token của khóa riêng; ghi rõ UniWork không đo.
- **FE-16:** mọi khung di động có chú thích "Trên thiết bị cảm ứng, điều khiển lớn hơn (≥ 44px)" (`.fcap` trong `lib.mjs`).
- **FE-17 (phần board):** nút ≤ 4 từ ("Lưu hạn mức", "Giữ bản mới", "Lưu bản của tôi", "Tải bản mới", "Xin tăng hạn mức"); bỏ chữ "ghi đè". B#b5 nói rõ đây là 409 `quota_conflict` của UniWork, không phải 409 của máy chủ AI. Bảng thuật ngữ FE-17 không thuộc phần này.
- **Không làm:** FE-14, FE-15 và các dòng glossary của FE-17 (không thuộc W2).

### Cần để ý

- Khung Office (D#d3, F#f1…f5): đã vẽ lại từ ảnh thật ở Fix round 2 (FE-23); mục này là ghi chú cũ.
- B#b8 vẫn hiện hạn mức mới trên thanh nhưng cảnh báo nói hạn mức cũ US$ 160,00 đang có hiệu lực; chưa tách hai số trên cùng một dòng.
- Chưa chạy kiểm tương phản đo trên trang render (thuộc `e2e/onboarding-contrast.spec.ts` khi làm thật).

## Fix round 2 (2026-10-18, W2 fix2, theo review-fe-r2.md FE-18…FE-30)

Hiện có 47 trạng thái × 4 khung = 188 ảnh trong `shots/` (thêm a6 và b1b, bỏ f6; ảnh f6 đã xóa). Mọi board dựng lại, không khung nào tràn ngang, trang `a-org-plan.html` không còn tràn 31px ở viewport 390 (đã đo cả 7 tệp ở 390 và 1440). Đã mở xem trực tiếp các khung đã đổi (a1, a3, a6, b1b, b2b, b7, b8, c1, c5, d2, d3, d6, e1, e3, f1, cả di động và tối ở nhiều khung). Đo tương phản chữ trên a3, d2–d4, e1, e3, c1 (4 khung mỗi trạng thái): không còn chữ dưới 4,5:1 (chữ dưới lớp phủ mờ của hộp thoại/ngăn không đo).

- **FE-18 (E#e1):** dựng lại từ `inbox-view.tsx` thật và ảnh `shots/live/inbox-*`: nút cài đặt + "Đánh dấu tất cả đã đọc" ở đầu trang, hàng chip loại (Mọi loại, Nhắc & bình luận, Giao cho bạn, Cuộc họp, Cập nhật việc, Workspace, có số chưa đọc) cùng Tất cả/Chưa đọc, danh sách nằm thẳng trên trang, nhóm "CHƯA ĐỌC / HÔM QUA", dòng có thanh chưa đọc 3px. Ba loại AI nằm dưới chip Workspace (loại chưa biết rơi vào đó theo `notification-category.ts`). Bỏ nút "Mở Gói AI" trong dòng (không có trong hàng thật).
- **FE-19 (E#e3):** ma trận thật hai cột Hộp việc | Email, dòng "Mọi loại", tiêu đề nhóm dạng overline, công tắc từng ô, mô tả trang và mô tả "Theo loại" lấy nguyên văn app. Nhóm "Gói AI" ba loại; công tắc Email chỉ ở "Hạn mức AI sắp hết hoặc đã hết" và "Tổ chức hết credit" (spec §6.4), "Credit của tổ chức thấp" không có ô. Bỏ cột luôn bật, cột tóm tắt ngày, cột quy tắc và câu về thông báo đẩy.
- **FE-20 (C#c1–c5, A#a6):** thanh bên Cài đặt theo đúng cổng của `settings-page.tsx` (`persona` trong `real.mjs`): quản trị viên workspace thấy Thành viên tổ chức, Phòng ban, rồi Chung/Thành viên/Tích hợp/AI; thành viên thấy cùng nhóm không có AI; tab đang mở chỉ được liệt kê khi mở bằng URL (c5, a6). Thanh toán/Hóa đơn chỉ khi persona có quyền thanh toán (owner).
- **FE-21 (A#a1, a1b, a3, a4):** một con số còn lại ở thẻ "Kỳ này" (thanh "Còn US$ 184,20"; bỏ "Số dư" ở dòng mô tả), bỏ câu phụ đề "Số dư và giá nằm ở máy chủ AI", câu của Cảnh báo (dòng chỉ còn "Cảnh báo khi dùng đến" + chip + Sửa), dòng mô tả của "Cấp tổ chức", câu "Workspace chưa đặt dùng chung…" (kể cả ở tab Người dùng), vai trò ở a1b.
- **FE-22 (A#a1, B#b1b):** dòng workspace chưa có hạn mức (Vận hành) có nút "Đặt hạn mức"; mở b1b = ngăn b1 ở chế độ tạo (chỉ hiện số đã dùng, "Chỉ cảnh báo" chọn sẵn theo D-2, Lưu chờ nhập hạn mức). Vẽ thêm trong b1b nền là tab Gói AI có dòng Vận hành với nút đó.
- **FE-23 (D#d3, F#f1–f5):** khung ngoài vẽ lại từ `s11-office-*`: đầu trang tài liệu thật (mũi tên, "Tài liệu › tên tệp", sao, "Bình luận", ba chấm; di động chỉ icon), nền khung `--muted` thay vùng stub. Bỏ thanh Tệp/Trang chủ/Chèn/Bố cục tự nghĩ ra (ảnh thật chỉ có stub). Bảng "AI trong tài liệu" và hộp thoại "Nguồn AI cho Office" là UI mới: nhãn khung ghi "Bảng AI là phần mới" ở cả 4 khung d3, f1–f5. Trang giấy trong khung vẫn là hình minh họa.
- **FE-24:** f6 bỏ cả trạng thái (chỉ còn một thẻ lặp lại tổng và quy tắc quản trị viên không đổi được; ý "UniWork không đo khóa riêng" nằm ở ghi chú f1). b1–b3 không còn mã model và dòng "sửa lần cuối bởi…" (b2 chỉ còn "Người dùng"). c1–c4 bỏ dòng vai trò của từng người. e6 bỏ cột Email (nhãn "Gửi email" chỉ ở hai loại có thư), d6 bỏ cột Nút (nhãn nút chỉ ở dòng có nút). **Giữ nguyên** "30 ngày qua" và "Theo tính năng" của tab AI workspace theo quyết định của lead; thêm câu hỏi **D-7** ở `index.html` ("Giữ hay bỏ…", khuyến nghị "giữ").
- **FE-25:** chân thanh bên theo persona: c1–c4 Nguyễn Văn An (quản trị viên workspace), c5 và a6 Trần Minh Anh (thành viên), mọi khung d của thành viên (d1–d4c, d5, d5a) Trần Minh Anh; d2b (quản trị viên tổ chức) giữ Đỗ Thanh Tùng. Không khung nào còn người xem trùng với người được bảo liên hệ.
- **FE-26 (B#b7, b8):** thanh hiện số đang có hiệu lực (US$ 148,00 / 160,00, còn US$ 12,00); hạn mức mới ghi ở dòng mô tả ("mới US$ 200,00, chờ đồng bộ" / "chưa áp dụng được"). Dòng không có bút chì giữ chỗ 32px nên thanh không lệch.
- **FE-27 (A#a3, D#d2…d4):** a3 bỏ làm mờ bằng opacity, thêm nhãn "Số liệu cũ · 14:32" ở hai nhóm; ô nhập của Hỏi UNI khi bị khóa chỉ làm mờ nút Gửi, dòng lý do giữ màu `muted-foreground` đủ độ tương phản (đã đo).
- **FE-28 (C#c1–c3, D#d5, d5a):** bảng "Dùng trong workspace" của từng workspace cộng đúng số đã dùng (Sản phẩm 148,00 gồm 5 tên + "17 người khác" 55,60; Thiết kế 50,00; Vận hành 14,20); một bộ model: Haiku 5.5, Sonnet 5.5, Gemini 4 Argon dùng được, GPT-6 Astra và Opus 5.5 không (d5, d5a, b2 khớp nhau).
- **FE-29:** e3 bỏ câu ghi người nhận (e6 theo §6.4: quản trị viên workspace + tổ chức cho workspace; chính người đó cho cá nhân, quản trị viên tổ chức ở mức 100%); b2b và b1b chọn sẵn "Chỉ cảnh báo" theo D-2 (b1 sửa giữ giá trị đang lưu; index D-2 nói rõ); bỏ "Dùng chung hạn mức tổ chức" khỏi hạn mức cá nhân (còn ở sửa hạn mức workspace đang có, nơi nó có nghĩa); một tên "hạn mức cá nhân" ở d1b, e6, b2, b2b, a1b, D-1.
- **FE-30:** ô nhập Hỏi UNI dùng "Hỏi UNI về công việc…"; ghi chú d1 nói rõ nhãn "Mô hình đang dùng" đặt chỗ dòng "vào/ra" token của ngăn; một phụ đề Gói AI ("Hạn mức AI của tổ chức và cách chia cho workspace, người dùng."); d6 và e6 vẽ ngoài khung ứng dụng, nhãn "Bảng tham chiếu, không phải màn hình"; thêm a6 (thành viên mở thẳng `?tab=ai-plan`); hết tràn 31px ở a-org-plan.html (`overflow-wrap` cho chú thích ánh xạ). Chuỗi `ai_provider_error` ở d6 là chuỗi hiện có trong `vi.json`, giữ nguyên và ghi rõ trong ghi chú d6; chưa đổi vì chưa có câu thay được duyệt.
- **Không làm:** FE-14, FE-15, glossary FE-17, và phần spec của FE-30 (vòng spec).
- **Câu hỏi ở `index.html`:** D-1…D-7 khớp bảng §13.4 của spec v0.2 (256fd7ad3), cùng id và lời văn (chỉ D-1 dùng "hạn mức cá nhân" theo FE-29; D-7 là câu "30 ngày qua / Theo tính năng", khuyến nghị giữ). D-2: b1b và b2b nay chọn sẵn "Chỉ cảnh báo", nên ghi chú §13.4 "bản vẽ b1/b2b đang chọn sẵn Chặn" của spec đã cũ. Nhóm "Gói AI" riêng trong ma trận thông báo (e3) trong khi Hộp việc xếp ba loại vào chip Workspace (e1): lead đã quyết không thêm D-8 (Fix round 3). Chú thích Q-AIP trong board đã theo §13 hiện hành: email là Q-AIP-7 (e5 đã sửa từ Q-AIP-8), Hub sập Q-AIP-8, hết hạn mức Q-AIP-6, BYOK Q-AIP-5.
- **Cần để ý:** trang giấy và khung công cụ bên trong khung Office vẫn là hình minh họa (ảnh thật chỉ có stub). Mọi đo tương phản ở đây là đo trên trang render, chưa chạy `e2e/onboarding-contrast.spec.ts`.

## Fix round 3 (2026-10-18, W2 fix3, theo review-fe-r3.md FE-31…FE-38)

Hiện có 49 trạng thái × 4 khung = 196 ảnh trong `shots/` (thêm b1c và e3b). Đã dựng lại cả 6 board và index; 0 khung tràn ngang ở 1280 và 390, 0 tràn trang ở 390 và 1440. Đo tương phản lại (a1b, a3, b1, b1c, b2, b3, c1, d2–d4, e1, e3, e3b, f1–f4): không còn chữ dưới 4,5:1. Đã mở xem trực tiếp b1 sáng máy tính, b1c tối di động, b2 sáng di động, a1b sáng, c1 sáng di động, e1 sáng, e3b sáng di động, f2 sáng.

- **FE-31:** f2/f3 chỉ làm mờ tiêu đề và nút chọn của thẻ không dùng được; dòng lý do ("Chưa có khóa nào", "Tổ chức chưa mở Gói AI") và nút "Thêm khóa riêng" giữ nguyên độ tương phản. b2/b3: nhãn "Ngoài gói" nằm ngoài phần bị làm mờ (chỉ ô chọn và tên model mờ).
- **FE-32:** (a) Trần Minh Anh = US$ 34,00 / 40,00 (85%) ở a1b, b2, c1, d1b, d6; dòng "17 người khác" của Sản phẩm sửa còn 50,00 để tổng vẫn là 148,00. (b) b1 (kể cả b1c, b3b, b4, b5) bật "Giới hạn model" cho Sản phẩm với ba model (Haiku 5.5, Sonnet 5.5, Gemini 4 Argon), khớp d5/d5a; "Giới hạn model" vẫn tắt khi tạo mới. (c) Thiết kế ở 100% luôn là chip "Đã hết" (b1…b8 hết "Còn US$ 0,00").
- **FE-33:** nút chữ "Gỡ hạn mức" (màu destructive) bên trái chân ngăn b1 và b2, chỉ khi đã có hạn mức. Trạng thái mới **b1c**: chân ngăn đổi thành một dòng xác nhận "Gỡ hạn mức của Sản phẩm? Workspace sẽ dùng chung hạn mức của tổ chức." + Hủy / Gỡ hạn mức. Câu cho hạn mức cá nhân nằm trong ghi chú b1c. **Ngoài phạm vi:** dòng người đã rời tổ chức mà còn hạn mức (policy mồ côi, spec §8.2) không có hàng riêng trong a1b; spec §8.2 quyết cách hiện.
- **FE-34:** d6 thêm dòng "Hết hạn mức, không có ngày đặt lại" ("Hạn mức AI của workspace Thiết kế đã hết.", `ai.errors.ai_policy_exceeded_no_reset`, kỳ `none` hoặc không suy ra được kỳ). **Thanh kẹp 100% ("đã vượt nhẹ", spec §8.2):** khi `spent > limit` vài phần trăm do nhiều lệnh đồng thời, thanh `QuotaMeterRow` dừng ở 100% (màu đỏ) và chip đổi từ "Đã hết" thành "Đã vượt nhẹ"; không vẽ khung riêng, a1 (Thiết kế, 100%) là mẫu cho thanh đầy.
- **FE-35:** nhãn khung d3 và f1…f5 (cả 4 khung mỗi trạng thái, `.fcap`): "Trang tài liệu: minh họa (ảnh thật chỉ có khung stub); bảng AI: UI mới". Index "Cách xem" thêm một câu về khung Office.
- **FE-36:** e1 chỉ còn dòng của workspace đang mở (Sản phẩm) và dòng cấp tổ chức (credit thấp); dòng "Workspace Thiết kế đã hết hạn mức AI" bỏ khỏi e1 (chỉ hiện khi mở Thiết kế). Quy tắc (lead đã quyết, spec sẽ ghi): dòng cấp tổ chức không có workspace id và hiện ở Hộp việc của quản trị viên tổ chức trong mọi workspace của tổ chức. Ghi ở e1 và e6.
- **FE-37:** (a) bỏ câu "chưa có trong danh sách D-n" ở e3 và câu D-8 cũ trong NOTES (lead quyết không có D-8). (b) "Theo tính năng" ở c1–c4 có cột "Người gọi" (giá trị "Người", như app thật); bỏ dòng phụ "Sản phẩm · chỉ số liệu, không có nội dung". Ở di động bảng dùng lề hẹp để vừa 390. c1 mobile trước đây dựng ở bố cục máy tính vì build bỏ qua `m`, nay đã sửa. (c) e2 toast 80% = "Đặt lại 01/11." như e1. (d) 7 công tắc và 2 ô chọn "Mọi loại" ở e3 có `aria-label` ("<loại> · Hộp việc/Email"). (e) không làm.
- **FE-38:** e3 là góc nhìn chủ sở hữu/quản trị viên tổ chức (ba dòng, Email ở hai dòng). Trạng thái mới **e3b**: thành viên hoặc quản trị viên workspace chỉ thấy dòng "Hạn mức AI sắp hết hoặc đã hết", chỉ có công tắc Hộp việc, không có Email và không có hai dòng credit.
- **Phần spec cho vòng sau (không sửa ở đây):** §13.4 D-2 ("bản vẽ b1/b2b đang chọn sẵn Chặn" đã cũ), dòng D-7 ("Chưa có trong index"), §11 hàng `f-byok-vs-plan` (còn liệt kê f1–f6), thêm b1c, e3b, quy tắc hộp thư cho dòng cấp tổ chức (FE-36) và Email chỉ cho quản trị viên tổ chức (FE-38).
- **Không làm:** FE-14, FE-15, glossary FE-17; chưa chạy `e2e/onboarding-contrast.spec.ts` (không có app dựng).
