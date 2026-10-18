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

## Round 2 billing (2026-10-18, UNI-1910, worker `design` của lane ai-plan-uw-bill)

Thêm bốn board G–J (44 trạng thái × 4 khung = 176 ảnh trong `shots/`, cùng cách đặt tên với vòng 1). A–F **không đổi** (không dựng lại). Dựng bằng cùng bộ sinh trong `_build/` (`g.mjs`, `h.mjs`, `i.mjs`, `j.mjs` + `bill.mjs` chứa phần dùng chung); `lib.mjs` chỉ thêm bốn board vào thanh điều hướng và đường dẫn worktree, `real.mjs` thêm persona `org_admin` (quản trị viên tổ chức, không phải chủ sở hữu). `index.html` thêm G–J và câu hỏi B-1…B-9.

Quy tắc người dùng: khách hàng chỉ trả trong UniWork (tab Thanh toán hiện có + VNPay), không có màn nào ở máy chủ AI; giá VND là giá niêm yết, credit hiện US$ (Q-AIP-2 a), không quy đổi; BYOK vẫn miễn phí và không vào các board này.

### Ánh xạ

| Board | Dùng lại | Mới cần làm |
| --- | --- | --- |
| G Thanh toán | `BillingTab`, `SettingsSection/Card/Row`, `QuotaMeterRow`, `PlanCards`, `Notice`, `ConfirmDialog`, `SettingsBadge`, `SettingsDangerZone` | dòng "Credit AI" + nút "Nạp thêm"; dòng credit trên thẻ gói; nút "Nâng cấp", "Hạ xuống gói này", "Hủy hẹn", "Gia hạn"; hộp xác nhận nâng/hạ gói |
| H Nạp credit | `Dialog`, `RadioGroup`, `Button`, `Spinner`, `Notice`, `sonner`, `useCreateCheckout`, `useCheckoutReturn`, `CorrelationNote` | hộp chọn gói nạp; loại đơn "nạp credit"; trạng thái "đang cộng" và "cộng quá lâu" |
| I Hoàn tiền | `InvoicesPanel` (`SummaryStat`, `SettingsList`), `SettingsBadge`, `Sheet` | ba trạng thái hoàn tiền trên dòng hóa đơn; ngăn chi tiết hóa đơn (Tiền / Credit AI / Gói) |
| J Thông báo | `InboxView`, ma trận `NotificationsTab`, thư giao dịch (`mail.go`), `AskUniPanel`, `AdminLayout`, `BreadcrumbHeader`, `Tabs`, `ReasonDialog` | bốn kind thông báo (tên tạm), bốn email, nhóm "Thanh toán" của ma trận, nút "Cấp credit" và hai ô của `ReasonDialog` ở `/admin` |

Trạng thái hóa đơn theo `server/internal/service/admin_billing_refund.go` và `admin.sql`: `paid` (kèm `amount_refunded` > 0 là hoàn một phần), `refund_pending`, `partial_refund_pending`, `refunded`; hoàn đủ mới chuyển gói về mặc định (`billing_subscription_refund.go`). Trạng thái đơn checkout: `pending | completed | failed | expired`; `Checkout` tái dùng đơn `pending` còn hạn (h10). Chuỗi hiện có được giữ nguyên chữ (`settings.billing.*`, `admin.reason.*`); chuỗi mới nằm ở bảng h11 và ghi chú từng trạng thái.

### Điều đã chọn khi vẽ (tên tạm, chờ spec v0.5 và người dùng)

- Tên kind thông báo `billing_credit_added`, `billing_renewed`, `billing_payment_failed`, `billing_refunded`; chỉ chủ sở hữu tổ chức nhận (người duy nhất thanh toán). Lead đã xác nhận dùng tên tạm; đối chiếu cuối ở vòng delta.
- Gia hạn = chủ sở hữu thanh toán lại qua VNPay, không tự trừ tiền (lead xác nhận).
- Chờ người dùng quyết (đã ghi ở `index.html`): hạ gói hẹn từ kỳ sau (B-1; server hôm nay trả `downgrade_not_allowed`), gia hạn trước hạn (B-2), credit gói không cộng dồn và credit nạp hạn 12 tháng dùng sau credit gói (B-3), chỉ nạp khi đã có gói trả phí (B-4). Còn lại là câu hỏi design B-5…B-9 kèm đề xuất.
- Số trong bản vẽ là ví dụ: Team US$ 100 và Business US$ 500 mỗi kỳ; gói nạp US$ 50 / 100 / 250 giá 199.000 / 349.000 / 790.000 ₫; giá gói 499.000 và 1.499.000 ₫ lấy từ migration `9991790921000000_billing_tiers_b1`.
- Dòng "Token AI" của mục Hạn mức bị thay bởi dòng "Credit AI" khi bật định tuyến Hub (spec §5.9); cờ tắt (g9) giữ nguyên tab như app đang chạy.
- Thư thanh toán **có số tiền** (biên nhận của chính chủ sở hữu), khác thư `ai_quota_alert` của board E không có số tiền.
- Hoàn tiền do nhân viên hỗ trợ ở `/admin` (hóa đơn đã có nút "Hoàn tiền"); chủ sở hữu chỉ thấy kết quả, không có nút "Yêu cầu hoàn tiền". Không vẽ thêm dòng thu hồi credit trong hộp hoàn tiền của `/admin`.

### Kiểm

- Mọi khung: 0 tràn ngang ở 1280 và 390 (`shots.mjs`), 0 tràn trang ở 390 và 1440 (`pageover.mjs`).
- Tương phản (`_build/contrast.mjs`, đã thêm G–J): không còn chữ dưới 4,5:1 trên cả 44 trạng thái; lỗi duy nhất tìm thấy (nút "Ngừng gói" chữ đỏ trên nền đỏ ở chế độ tối) đã sửa theo `Button variant="destructive"` thật (nền `--destructive-soft`). Chữ dưới lớp phủ mờ của hộp thoại/ngăn được đo cùng; chưa chạy `e2e/onboarding-contrast.spec.ts` (không có app dựng).
- Đã mở xem trực tiếp: g1 máy tính sáng, g2 di động tối, h1 máy tính sáng, h6 di động sáng, i1 di động sáng, i4 máy tính sáng, j1 máy tính tối, j9 máy tính sáng, j10 máy tính sáng, j11 di động tối.

### Chưa vẽ (cố ý)

- Màn VNPay (không thuộc UniWork); trang đổi gói của `/admin` (đã có); nút yêu cầu hoàn tiền của khách; biểu đồ credit theo ngày; Enterprise "báo giá riêng" (dùng lại thẻ hiện có, không đổi).
- Nút "Nạp thêm" ở gói Starter: không có, theo B-4 (g3) (thay bằng fix 1: g3 vẽ nút mờ kèm lý do).

## Round 2 billing — fix 1 (2026-10-18, UNI-1910, sau FE review `review-bill-fe-r1.md`)

Sửa FE-B1…B22 và căn lại theo **spec v0.5 đã commit `db4f0df54`** (bản FE-B18 tham chiếu là bản nháp sớm hơn): bốn kind `billing_*` chỉ gửi owner tổ chức (Hộp việc + thư giao dịch), credit nạp hạn 12 tháng (Q-AIP-17), credit kỳ tiêu trước (Q-AIP-18), chỉ nạp khi gói trả phí `active` (Q-AIP-19), hạ gói lên lịch (Q-AIP-20 a), nâng gói giữ credit cũ đến hạn (Q-AIP-14), Starter có credit nhỏ (Q-AIP-11 a), ngăn nạp là `Sheet`, nút "Nạp thêm credit", nút nạp vẫn dùng khi máy chủ AI sập. Từ 44 lên **49 trạng thái** (g 14, h 14, i 6, j 15), 4 khung mỗi trạng thái. Đã dựng lại và chụp lại g, h, i, j (trừ j7–j9, không đổi) vào `shots/`; `_build/contrast.mjs` chạy lại trên mọi board: 0 chữ dưới 4,5:1; 0 tràn ngang khung (1280, 390) và 0 tràn trang (390, 1440).

### Bảng ánh xạ: trạng thái trong spec §11 → khung đã vẽ

| Spec | Nội dung | Khung |
| --- | --- | --- |
| g1 | Starter, credit mỗi tháng; thẻ nâng cấp "Gồm US$ y credit AI" | g3 (hàng Credit AI), g1 (thẻ gói) |
| g2 | Gói trả phí: hàng Credit AI "Còn US$ z" + nút "Nạp thêm credit" | g1, g10b, g10; **bảng lịch sử nạp chưa vẽ** (xem dưới) |
| g3 | Nâng cấp Team → Business | g2 |
| g4 | Hạ gói (Q-AIP-20 a: lên lịch, "Hủy lịch hạ gói") | g4, g4b (vượt hạn mức), g5 |
| g5 | Đang cộng credit | h5 (dòng Credit AI + dải), h6 (quá 10 phút) |
| g6 | Admin tổ chức, chỉ đọc | g8 |
| g7 | Cờ tắt | g9 |
| g8 | Máy chủ AI không phản hồi, nút nạp vẫn dùng | g12 |
| h1 | Chọn gói nạp (Sheet, hạn 12 tháng, thứ tự tiêu) | h1 |
| h2 | Đang chuyển sang VNPay | h2, h2b |
| h3 | Về thành công | h3 (đang xác nhận), h4 (đã nạp) |
| h4 | Về chờ: đã trừ tiền, chưa có credit | h5, h6 |
| h5 | Thất bại hoặc hủy | h7 (hủy), h8 (cổng từ chối), h8b (hết hạn phiên) |
| h6 | Quá thời gian xác nhận | h3b (chưa xác nhận được), h6 |
| h7 | Còn đơn nạp đang chờ | h10 |
| h8 | Không phải owner / cờ tắt / gói miễn phí / `past_due` | g8, g9, g3 và g7 (nút mờ kèm lý do) |
| i1 | Hoàn toàn bộ gói nạp | i2 (+ danh sách i1) |
| i2 | Hoàn một phần | i3 |
| i3 | `refund_pending` | i5 |
| i4 | Thu hồi đang xử lý / cần hỗ trợ | i6 (đang thu hồi), i6b (cần hỗ trợ) |
| i5 | Hoàn hóa đơn gói → Starter | i4 |
| j1 | Bốn dòng Hộp việc + thư tương ứng | j1; thư j3 (`billing_credit_added`), j4 (`billing_renewed`), j5 (`billing_payment_failed`), j6 (`billing_refunded`) |
| j2 | Toast khi trở về | h4, h7 |
| j3 | Hộp cấp credit tay `/admin` | j11, j12, j13, j14 |
| j4 | Khối "Credit AI" ở chi tiết tổ chức | j10 (khối mới: ví, đơn, đơn lỗi nổi bật) |
| j5 | Hộp hoàn tiền hóa đơn, dòng "Credit liên quan" | j15 (mới) |
| j6 | Nhóm "Thanh toán" trong ma trận Thông báo | j2 (bốn hàng, Hộp việc + Email) |

Ngoài spec nhưng giữ: g6 (gia hạn, B-1), g7 (quá hạn), g10, g10b, g11, h9, h11, j7–j9 (người dùng cuối).

### Phát hiện → đã đổi → khung

| Phát hiện | Đã đổi | Khung |
| --- | --- | --- |
| FE-B1 | g2: "Credit còn lại của kỳ Team vẫn dùng được đến khi hết hạn." (Q-AIP-14 a); "không cộng dồn" chỉ còn ở gia hạn g6 (Q-AIP-13) | g2, g6 |
| FE-B2 | Phương án A: vượt hạn mức → dải đỏ CircleAlert, nút `aria-disabled`; g4 là ca trong hạn mức (28 thành viên) | g4, g4b (mới) |
| FE-B3 | `failed` chỉ nói "chưa bị trừ tiền" khi cổng từ chối rõ; `expired` dùng câu trung tính, "đừng thanh toán lại" trước "Thử lại"; h11 sửa | h8, h8b (mới), h11 |
| FE-B4 | Đơn đang chờ: gói của đơn là hàng chọn duy nhất, các gói khác `aria-disabled` | h10 |
| FE-B5 | Thư hoàn tiền: dòng tiền ngay, credit chỉ "sẽ được điều chỉnh" (spec §16.9: không nêu US$ vì thu hồi chạy sau, không có thông báo riêng cho kết quả thu hồi); kết quả xem ở Hóa đơn (i6). Ghi sự kiện gửi thư: hóa đơn thành "Đã hoàn tiền" | j6, j1, i6 |
| FE-B6 | "Đã hết" chỉ khi tổng = 0; phần trăm tối đa 99 khi còn credit; g7 dùng mẫu 362,70 / 500,00 | g7, mọi dòng Credit AI |
| FE-B7 | "Còn US$ z" = credit kỳ + credit nạp, dòng phụ "Gồm US$ x credit nạp."; khung kỳ hết còn credit nạp | g1, h4, g10b (mới) |
| FE-B8 | Chỉ một nút "Nạp thêm credit" (ở dải đỏ) | g10 |
| FE-B9 | Nút nạp dùng được khi máy chủ AI sập (spec §11 g8) | g12 |
| FE-B10 | Khung "về từ VNPay nhưng chưa xác nhận": chuỗi `checkout_confirming_timeout` hiện có nguyên văn + "Đừng thanh toán lại." + "Thử lại"; thêm hàng h11 | h3b (mới), h11 |
| FE-B11 | Mục "Tất cả hóa đơn", mới nhất trước (14/10, 12/10, 01/10, 01/09, 01/08) | i1 |
| FE-B12 | i3 dùng hóa đơn kỳ hiện tại (01/10–01/11); "Còn dùng được" = số dư hiện tại (17,42) | i3, i1 |
| FE-B13 | i4: câu cuối "Credit đã dùng không thu hồi được."; nhãn "Đã dùng (không thu hồi)"; bỏ dòng "còn lại 0,00" ở i2 | i2, i4, i6 |
| FE-B14 | Một mã: số hóa đơn `UW-2026-…` ở h6, thư j3, hộp hoàn tiền (thay `TU-…`) | h6, j3, j11–j14 |
| FE-B15 | Hạn credit nạp thống nhất 12 tháng (18/10/2027); thông báo hoàn tiền 13/10 khớp i2; j13 hiện 234,20 sau khi cấp 50; j14 vẽ hộp giữ lý do dưới toast | h4, j1, j13, j14 |
| FE-B16 | Dòng ghi chú dưới nhóm "Thanh toán": Email = biên nhận gửi ngay, không gom mỗi sáng (spec: bốn kind loại khỏi digest) | j2 |
| FE-B17 | "Nếu bạn vừa thanh toán, hệ thống cần vài phút để xác nhận, không cần trả lại." ở g6, g7; thư j5 là thất bại rõ ràng nên dùng "Nếu bạn đã thanh toán lại thành công, bỏ qua thư này." | g6, g7, j5 |
| FE-B18 | Căn theo spec `db4f0df54` như trên; ngăn `Sheet`; "Gồm US$ y credit AI"; hộp cấp tay hạn dùng tùy chọn; khối "Credit liên quan" ở hộp hoàn tiền; index: Q-AIP-11…20 + B-1…B-3 (các câu design cũ mà spec đã trả lời bỏ, dẫn về số Q-AIP) | g, h, j2, j10, j11, j15, index |
| FE-B19 | Thanh điều hướng `/admin` trên di động mờ dần ở mép phải | j10–j15 (390) |
| FE-B20 | Gói nạp mẫu 269.000 / 549.000 / 1.390.000 ₫ (mỗi US$ cao hơn gói Team 499.000 ₫ / US$ 100; bậc giá đổi ở fix 2, FE-B28) | h1, i, j |
| FE-B21 | Ngăn nạp trên di động: nút chính rộng hết chiều ngang, tổng một dòng, "Hủy" dưới | h1 (390) |
| FE-B22 | Chip "Thanh toán" trong Hộp việc (AIP-BILL-10 thêm nhóm vào `notification-category.ts`) | j1 |

### Chưa làm / để lead quyết

- **Bảng "lịch sử nạp" của spec §11 g2** chưa vẽ: trùng danh sách Hóa đơn (board I) và vi phạm quy tắc rút gọn. Nếu lead muốn vẽ thì thêm một mục "Lịch sử nạp" dưới thẻ Gói hiện tại ở g1 (3 dòng: loại, US$, ngày, trạng thái, liên kết hóa đơn).
- Thời gian: ngày "hôm nay" trong mẫu là 18/10/2026; các board g6/g7 (sắp hết kỳ, quá hạn) là kịch bản khác nhau, không cùng một dòng thời gian.

## Round 2 billing — fix 2 (2026-10-18, UNI-1910, sau FE review delta `review-bill-fe-r2.md`)

Sửa FE-B23, B25…B30; FE-B24 giữ nguyên bảng vẽ (nhãn "Đã hoàn một phần" ở i1/i3; spec được viết lại cho khớp). Từ 49 lên **50 trạng thái** (g 14, h 14, i 7, j 15). Chỉ dựng lại và chụp lại các khung đổi (1280 + 390, sáng + tối); `_build/contrast.mjs` chạy lại trên mọi board (thêm i6b): 0 chữ dưới 4,5:1; 0 tràn ngang khung và 0 tràn trang (390, 1440). A–F không đổi.

| Phát hiện | Đã đổi | Khung |
| --- | --- | --- |
| FE-B23 | Dòng phụ của hàng Credit AI có hạn credit nạp: "Gồm US$ 100,00 credit nạp, dùng đến 18/10/2027."; khung kỳ hết: "Credit của kỳ đã hết, đang dùng credit nạp (dùng đến 18/10/2027)." (`creditRow`, `bill.mjs`; không thêm hàng) | g4, g4b, g10b, h4 (nền) |
| FE-B24 | Giữ nhãn "Đã hoàn một phần" ở i1/i3; không đổi bảng vẽ (spec sửa lời: nhãn UI từ `amount_refunded > 0`, trạng thái vẫn `paid`) | — |
| FE-B25 | Thêm i6b: cùng ngăn i6, nhãn "Cần hỗ trợ", câu "Đội hỗ trợ đang xử lý." thay cho "tự thử lại", không nêu Hub, không nút; ghi chú i6 trỏ sang i6b | i6b (mới), i6 (ghi chú) |
| FE-B26 | Bỏ ", ;" thừa trong ghi chú i6 | i6 |
| FE-B27 | Ghi chú g4b gọi nút là "Lên lịch hạ gói" đúng như khung; dòng cũ "Nút Nạp thêm ở gói Starter: không có" ghi thêm "(thay bằng fix 1)" | g4b, NOTES |
| FE-B28 | Gói nạp 269.000 / **529.000** / **1.290.000** ₫ (5.380 / 5.290 / 5.160 ₫ mỗi US$, đều cao hơn Team 4.990 ₫; gói lớn rẻ hơn mỗi US$). Cập nhật hóa đơn mẫu, thư hoàn tiền/nạp, hộp hoàn tiền và index | h1, h2, h9, h10, i1–i6b, j1, j3, j6, j11–j15, index |
| FE-B29 | Đơn lỗi ở khối Credit AI của `/admin` đổi thành Gói nạp US$ 250,00 ngày 16/10/2026 (không còn trùng đơn US$ 50 ngày 14/10 đang chờ hoàn ở i1/i5) | j10 |
| FE-B30 | j13 thêm dòng "Cấp tay US$ 50,00 · 18/10/2026 · Đã cộng" ở đầu danh sách đơn; ghi chú j13 cập nhật | j13 |

Ánh xạ spec → khung: chỉ đổi i4 (thêm i6b, xem bảng ánh xạ ở trên). Khung đã chụp lại: g4, g4b, g10b; h1, h2, h4, h9, h10; i1–i6, i6b; j1, j3, j6, j10–j15.

## Round 3 (2026-10-19, UNI-1910, W2 design r3)

Quyết định của người dùng (01:15, 01:30, 01:35 ngày 19/10) được gấp vào bản vẽ; mọi khung khác giữ nguyên. Mỗi khung đổi hoặc mới có đủ 1280 + 390, sáng + tối (`shots/<id>-<desktop|mobile>-<light|dark>.png`). Chạy lại: `DESIGN_OUT=<thư mục> node _build/<board>.mjs`, rồi `node _build/shots-r3.mjs` (một trình duyệt) và `node _build/contrast-r3.mjs` (272 khung, 0 lỗi). Kiểm tràn ngang theo khung và theo trang: không có.

### Khung đổi hoặc thêm
- **G** (17 trạng thái, 68 ảnh): g1 (gói đọc từ danh mục; thẻ có giá VND / kỳ và "US$ y credit AI / kỳ"), g1b mới (admin thêm "Business năm", bốn thẻ), g3 (Starter nạp được), g4, g4b, g5 (hạ gói "Áp dụng từ dd/mm", "Hủy lịch hạ gói"), g6 (gia hạn sớm: kỳ mới bắt đầu từ ngày hết kỳ, credit cộng khi kỳ bắt đầu), g6b mới (hộp xác nhận gia hạn), g6c mới (đã gia hạn, dòng "Kỳ tiếp theo"), g8 (quản trị viên tổ chức có nút nạp). Dòng thẻ gói đổi ở mọi khung có thẻ (g2, g7, g10, g10b, g12); dòng Credit AI đổi "không hết hạn" ở g10b và h4.
- **H** (16, 64): h1 (một ô số US$ nguyên, thành tiền = ceil(số × tỷ giá), tỷ giá hiện một lần, không dòng hạn dùng, ghi credit gói tiêu trước), h1b mới (dưới tối thiểu), h1c mới (trên tối đa), h2, h4, h9, h10 (đơn chờ giữ giá lúc tạo), h11 (bảng câu chữ).
- **I** viết lại (11, 44): i1 danh sách (bỏ "Đã hoàn một phần"), i2 đơn chưa dùng "Liên hệ hỗ trợ để hoàn tiền", i3 đơn đã dùng "Không hoàn tiền: đã dùng", i4, i5, i6, i6b; mới ở /admin: i7 danh sách (cột Credit, nút Hoàn tiền chỉ sáng cho đơn chưa dùng), i8 hộp hoàn tiền (lý do thiếu), i8b (đủ ≥ 10 ký tự), i9 (đơn đã dùng, nút mờ kèm chú thích). Bỏ các khung hoàn một phần và thu hồi credit đã tiêu của vòng 2.
- **J** (15, 60): j7, j8, j9 (thành viên liên hệ quản trị viên, quản trị viên và chủ sở hữu có nút nạp), j15 (hộp hoàn tiền của /admin, dùng chung với i8). Sửa theo hệ quả, không nằm trong danh sách hợp đồng: j1, j3 (bỏ "hạn dùng 12 tháng", thêm người nạp; thông báo nạp đến người nạp và chủ sở hữu), j6 (hoàn đơn chưa dùng: "sẽ được thu hồi"), j10…j14 (nhãn "Nạp credit" thay "Gói nạp").
- **D**: d2d (thành viên, chú thích khớp D-10), d2e mới (quản trị viên có nút "Nạp thêm credit").
- **K** mới (8, 32; đã đổi ở fix 1, xem dưới): k1 /admin › Gói dịch vụ (gói do admin tạo, sửa ngay trên dòng bảng, thẻ "Giá nạp credit"), k1b lưu một dòng (hộp lý do), k2 tạo gói (mặc định ẩn), k3 xóa gói chưa ai mua, k3b xóa gói đã có người mua bị chặn, k4 sửa giá nạp ("đơn đang chờ giữ giá cũ"), k4b lỗi tối thiểu > tối đa, k5 đã lưu (còn 2 đơn giữ giá cũ).
- `index.html`: thêm board K, mục "Vòng 3 đổi gì", cập nhật các hàng Q-AIP-12, 15, 16, 17, 19, 20, B-3 và thêm D-8, D-10 cùng dòng "Gói và giá nạp do admin đặt".

### Số liệu ví dụ (chỉ minh họa; admin đặt thật)
Tỷ giá 5.300 ₫ cho US$ 1; mỗi đơn US$ 10 – 1.000 (US$ 100 = 530.000 ₫; US$ 50 = 265.000 ₫; US$ 20 = 106.000 ₫); Starter US$ 5 credit / tháng, Team 499.000 ₫ + US$ 100, Business 1.499.000 ₫ + US$ 500, "Business năm" 14.990.000 ₫ / năm + US$ 6.000 / năm. Tỷ giá cao hơn giá mỗi US$ của gói Team (4.990 ₫) để nạp không đọc thành rẻ hơn gói. `fmt` nhóm hàng nghìn bằng dấu chấm (US$ 6.000,00).

### Giả định cần lead/spec xác nhận
1. Quản trị viên tổ chức nạp được trên mọi gói nhưng không mua, nâng, hạ gói (D-10 chỉ nói nạp); g8, j8 vẽ như vậy.
2. Nạp ở gói `past_due` vẫn khóa (g7, giữ như vòng 2); Starter nạp được (Q-AIP-19 b).
3. "Đơn chưa dùng" áp cho cả đơn gói chưa dùng đồng credit nào (không chỉ đơn nạp); i3 vẽ đơn gói đã dùng.
4. Hộp /admin "Tạo gói" bỏ mô tả và thứ tự sắp xếp của hộp hiện có, đổi "Đang bán" thành công tắc "Ẩn khỏi khách hàng"; "Xóa gói" là hành vi mới (chỉ gói chưa ai dùng, không phải Starter).
5. Đổi giá hoặc credit của gói chỉ áp dụng từ kỳ kế tiếp của tổ chức đang dùng (k3b nói ngay dưới tiêu đề).
6. ~~Ma trận thông báo của quản trị viên~~ — đã quyết ở fix 1 (FE3-4): j2b.

### Fix 1 (2026-10-19, W2 fix1, theo `review-r3-fe-r1.md` FE3-1…FE3-14 và quyết định của lead)
Chạy lại: `node _build/{g,h,i,j,k,d,index}.mjs`, `node _build/shots-r3.mjs`, `node _build/contrast-r3.mjs` (296 khung, 0 lỗi; không tràn ngang). Số khung: G 17, H 18, I 13, J 16, K 8, D d2d + d2e = 74 trạng thái ở các board đổi (296 ảnh).

**Khung mới:** h9b (409 `topup_quote_changed`), h9c (409 `billing_past_due` trong ngăn), i4b (kết quả hoàn hóa đơn gói cho chủ sở hữu), i8c (hộp /admin hoàn hóa đơn gói), j2b (cài đặt thông báo của quản trị viên tổ chức), k1b (lưu một dòng + hộp lý do). **Đổi nội dung:** g1b, g5 (và ghi chú g4, g4b); h2 (ghi chú), h11 (hai hàng câu chữ mới), h1 (bỏ chữ "gói nạp"); i4, i5 (ghi chú), i7, i8, i1-i9 (hóa đơn mẫu); j2, j7, j10, j15; d2d, d2e; k1, k2, k3 (nay là xóa gói chưa ai mua), k3b (nay là xóa gói đã có người mua bị chặn), k5 (ghi chú), k4 (ghi chú); ngăn Hỏi UNI của j7, j8, j9.

| Finding | Cách xử lý |
|---|---|
| FE3-1 | Gói mới **ẩn mặc định** khi tạo (k2 công tắc BẬT). k1/k5 giữ nhãn "Ẩn"; g1b thành "sau khi admin bỏ ẩn", ghi gói ẩn không bao giờ hiện thẻ/nút Nâng cấp. |
| FE3-2 | h9b: máy khách gửi giá đã hiện; máy chủ tính lại khi tạo đơn, đổi tỷ giá/min/max thì 409 `topup_quote_changed` + báo giá mới; ngăn so sánh giá cũ (gạch) và giá mới, nút "Thanh toán với giá mới"; chưa chuyển VNPay. |
| FE3-3 | i8c (hộp /admin cho hóa đơn gói, dải vàng: kỳ kết thúc, về Starter ngay, credit kỳ thu hồi) và i4b (kết quả cho chủ sở hữu). Hàng mẫu /admin đổi thành hóa đơn gói của kỳ đang chạy (số `UW-2026-6C2N8W5J`, Công ty An Phát); i4b dựng với chrome của An Phát. |
| FE3-4 | j2b: quản trị viên thấy nhóm "Thanh toán" một hàng ("Đã nạp credit AI"), chỉ cho lần nạp họ mua; j2 ghi chủ sở hữu có đủ bốn hàng. |
| FE3-5 | Một nơi sửa: dòng bảng với "Lưu" riêng + hộp lý do (≥ 10 ký tự), như `FeatureRow` thật. Bảng có thêm dòng "Giá và kỳ" và công tắc "Ẩn khỏi khách hàng"; `PlanEditDialog` bỏ. Hộp chỉ để tạo (k2) và bỏ hạn mức thành viên/workspace khỏi hộp (sửa ở bảng sau khi tạo). Câu "áp dụng từ kỳ kế tiếp" ở chú thích đầu bảng và trong hộp lưu (k1b), áp cho mọi dòng kể cả Starter. k3 sửa Starter bỏ (khóa nằm ở k1). |
| FE3-6 | k3 xóa được gói chưa ai mua (hộp lý do, "không hoàn tác"); k3b chặn gói đã có người mua: "Đã có tổ chức mua gói này. Ẩn gói để ngừng bán." (luật "đã từng mua"). |
| FE3-7 | Starter: giá và kỳ đọc-only (khóa), công tắc Ẩn khóa; chỉ credit và hạn mức sửa được. |
| FE3-8 | g4 (28 / 30), g4b (38 vượt), g5 (28 / 30) khớp nhau; g5 có câu "Việc chuyển được kiểm lại vào 01/11/2026 …" (chi tiết thuộc AIP-BILL-15). |
| FE3-9 | i5 (ghi chú): nhân viên kiểm lại "chưa dùng" lúc thực hiện, nếu đã dùng thì từ chối "Đã dùng, không hoàn tiền" (i8 ghi chú cũng nói). i4: chỉ credit của đơn này bị thu hồi, không gì khác. |
| FE3-10 | Một khung ngăn Hỏi UNI (kiểu d: có nút cuộc trò chuyện mới và xóa) ở d2d, d2e, j7, j8, j9; một cách gọi "chủ sở hữu hoặc quản trị viên tổ chức" ở d2d (kể cả nhãn danh sách liên hệ) và j7. Các khung d khác (d2…) giữ nhãn cũ "Quản trị viên tổ chức" vì ngoài phạm vi. |
| FE3-11 | Mô tả hộp hoàn tiền: "Thanh toán qua VNPay thì hệ thống gửi lệnh hoàn tới VNPay; ghi nhận thủ công thì hóa đơn đổi trạng thái ngay. Lý do tối thiểu 10 ký tự." (**`vi.json` phải đổi cùng, owner thẻ AIP-BILL**); ô mã cổng "Mã hoàn tiền hoặc giao dịch VNPay"; gợi ý lý do "Khách hàng yêu cầu hoàn, chưa dùng credit"; bỏ dấu gạch thừa ở di động i7/j15. |
| FE3-12 | "gói nạp" → "Nạp credit" ở j10 (và h1: "ba mức nạp cố định"). Còn lại trong `index.html` là tên câu hỏi Q-AIP-12 (tên gốc của spec). |
| FE3-13 | k2: danh sách phía sau có ba gói. |
| FE3-14 | h9c. |

**Câu hỏi mở cho lead/spec:** (1) ~~hoàn hóa đơn gói của kỳ đã kết thúc~~ — đã chốt ở fix 2 (kỳ đã kết thúc = đã dùng); (2) k2 bỏ thành viên/workspace khỏi hộp tạo: xác nhận; (3) các khung d2… khác còn nhãn "Quản trị viên tổ chức" cho danh sách liên hệ.


### Fix 2 (2026-10-19, W2 fix2, theo `review-r3-fe-r2.md` NEW-1…NEW-8 và quyết định của lead)
Chạy lại: `node _build/{g,h,i,k,index}.mjs`, `node _build/shots-r3.mjs`, `node _build/contrast-r3.mjs` (324 khung, 0 lỗi; không tràn ngang). Số khung: G 18, H 19, I 18, J 16, K 8, D d2d + d2e = **81 trạng thái** ở các board đổi (324 ảnh).

**Khung mới:** g7b, h9d, i3b, i8d, i8e, i8f, i9b. **Đổi nội dung:** h9b (ghi chú), h9c (ghi chú, h11 thêm hàng), i1 (lede), i4b, i7 (ba hàng mới), i8, i8c, j15 (tiêu đề hộp), k1, k1b, k5.

| Finding | Cách xử lý |
|---|---|
| NEW-1 | Kỳ đã kết thúc = đã dùng. i7 thêm hàng hóa đơn 01/09 của Minh Long: nút "Hoàn tiền" mờ, nhãn Credit "Kỳ đã kết thúc"; i9b là chú thích nút mờ; i3b là ngăn chi tiết của chủ sở hữu "Không hoàn tiền: kỳ đã kết thúc". Hóa đơn của kỳ chưa bắt đầu (g6c) hoàn được: hàng "Chưa bắt đầu" sáng nút (i7, i8f). **Câu hỏi mở 1 của fix 1 đóng: đã chốt.** |
| NEW-2 a | Hoàn kỳ đang chạy bị từ chối khi còn kỳ tiếp theo đã trả: i8e (Công ty Thái Bình, dải đỏ "Hoàn kỳ tiếp theo trước", Xác nhận mờ). Nhân viên hoàn kỳ tiếp theo trước (i8f: kỳ đó bị bỏ, kỳ đang chạy giữ nguyên), rồi hoàn kỳ đang chạy. Ghi chú: i8c nay là nhánh "đi tiếp", từ chối nằm ở i8e. |
| NEW-2 b | Tổ chức vượt giới hạn Starter vẫn được hoàn: i8c thêm một dòng vàng "Tổ chức sẽ về Starter; đang vượt giới hạn: 12 thành viên / 4 workspace — không thêm mới được cho tới khi giảm", i4b thêm dòng "Vượt giới hạn Starter". |
| NEW-3 | k5: toast một dòng, 296 px, chuyển lên góc trên phải trong thanh trên; không còn che nút "Lưu" hay "Tạo gói". |
| NEW-4 | Ẩn/hiện áp dụng ngay (chú "Ẩn/hiện áp dụng ngay." cạnh công tắc và ở dòng chú thích đầu bảng); giá và credit sửa ở bảng áp dụng từ kỳ kế tiếp của từng tổ chức (k1, k1b, k5). |
| NEW-5 | h9b: ghi chú nói min/max đổi có thể đẩy số đã nhập ra ngoài khoảng; ô nhập hiện lỗi h1b/h1c với mức mới, nút thanh toán mờ. |
| NEW-6 | i8d: lỗi nội tuyến "Đã dùng, không hoàn tiền" trong hộp, Xác nhận mờ, hóa đơn không đổi. |
| NEW-7 | Mua gói chỉ chủ sở hữu (D-10): h9d (ngăn nạp của quản trị viên, dải vàng "Liên hệ chủ sở hữu tổ chức để thanh toán gói.", không nút Thanh toán gói) và g7b (trang past_due của quản trị viên, không nút "Thanh toán ngay"). h11 thêm hàng câu chữ. |
| NEW-8 | `docs/conventions.md` không có mục "HĐ" nên đổi thành "hóa đơn": tiêu đề hộp hoàn tiền "Hoàn tiền hóa đơn UW-…" (i8, i8b, i8c, i8d, i8e, i8f, j15). **`vi.json` đổi cùng, owner thẻ AIP-BILL.** |

**Dữ liệu mẫu mới:** Công ty Thái Bình (gia hạn sớm như g6c): hóa đơn kỳ 01/10 `UW-2026-1M7D4X8K` và kỳ tiếp theo 01/11 `UW-2026-8F3L6T1R`, cả hai chưa dùng. An Phát đang có 12 thành viên / 4 workspace (Starter: 5 / 2).

**Còn mở cho lead/spec:** (1) k2 bỏ thành viên/workspace khỏi hộp tạo: xác nhận; (2) các khung d2… khác còn nhãn "Quản trị viên tổ chức" cho danh sách liên hệ; (3) i4b/i8f chỉ vẽ kết quả phía chủ sở hữu cho kỳ đang chạy; kết quả của kỳ tiếp theo bị bỏ chưa có khung riêng (cùng ngăn i4b, chỉ khác dòng "Kỳ Business 01/11 – 01/12: Đã bỏ").
