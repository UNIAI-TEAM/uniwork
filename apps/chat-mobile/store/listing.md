# UniChat mobile — hồ sơ store (bản nháp, UNI-1836)

Nguồn cho App Store Connect và Google Play Console khi có tài khoản (UNI-1838); `scripts/store-metadata.mjs` sinh từ
đây `store/apple/store.config.json` (EAS Metadata, `eas metadata:push`) và `store/play/<ngôn ngữ>/*.txt` (main store
listing của Play, bố cục fastlane supply), kiểm giới hạn ký tự của từng store; `store-listing.test.ts` đỏ khi chúng cũ. Tên trên cả hai store là "UniWork Chat":
App Store Connect giữ app dưới tên đó vì "UniChat" đã có người giữ (`docs/evidence/unichat/release-accounts.md`), và
`eas metadata:push` gửi tên khác là xin đổi sang một tên không được phép. Tên dưới biểu tượng trên máy vẫn là "UniChat",
định danh `com.uniworkos.chat` (bản `internal` dùng `com.uniworkos.chat.staging`, tên "UniChat (Staging)"). Lý do và luật: spec
`docs/superpowers/specs/2026-10-16-chat-native-apps-design.md` §3.1, §3.4, §11; quy trình nộp:
`docs/runbooks/unichat-mobile-release.md`. Chữ ở đây là bản nháp; chủ sở hữu duyệt trước lần nộp production (Q1).

## Mô tả

**Tên trên store (≤ 30 ký tự):** UniWork Chat

**vi — phụ đề (≤ 30 ký tự):** Nhắn tin và gọi cho cả đội

**vi — phụ đề iPhone (khi gọi còn tắt trên iPhone):** Nhắn tin cho cả đội

**vi — mô tả:**

> UniChat là ứng dụng nhắn tin của UniWork cho đội ngũ Việt Nam. Trò chuyện riêng, nhóm và kênh của workspace luôn
> đồng bộ với UniWork trên web và máy tính.
>
> - Tin nhắn tức thời, trả lời trích dẫn, luồng, cảm xúc, nhắc tên, đã đọc
> - Gửi ảnh và tệp vào cuộc trò chuyện
> - Gọi thoại và video cho hai người hoặc cả nhóm
> - Danh bạ đồng nghiệp với trạng thái hoạt động
> - Thông báo đẩy có xem trước nội dung, trả lời hoặc đánh dấu đã đọc ngay trên thông báo, tự gỡ khi bạn đã đọc; không
>   làm phiền khi bạn đang đọc chính workspace đó ở thiết bị khác
> - Bản nháp giữ nguyên khi rời cuộc trò chuyện, liên kết trong tin bấm được, mở lại phòng ở đúng tin chưa đọc đầu tiên (tới vài trăm tin chưa đọc)
> - Hỗ trợ VoiceOver và TalkBack, cỡ chữ lớn và chế độ tối
>
> Cần một tài khoản UniWork. Đăng nhập an toàn qua trình duyệt, ứng dụng không lưu mật khẩu.

**en — subtitle:** Team messaging and calls

**en — iPhone subtitle (while calls are off on iPhone):** Messaging for your team

**en — description:**

> UniChat is the messaging app of UniWork, built for Vietnamese teams. Direct messages, groups and workspace channels
> stay in sync with UniWork on the web and desktop.
>
> - Instant messages, quoted replies, threads, reactions, mentions and read receipts
> - Share photos and files in a conversation
> - Voice and video calls, one-to-one or with the whole group
> - A directory of your colleagues with their presence
> - Push notifications with message previews that you can reply to or mark as read in place, cleared once you have
>   read them, and held back while you are reading the same workspace elsewhere
> - Drafts that wait for you, tappable links, and rooms that reopen at your first unread message (up to a few hundred unread)
> - Works with VoiceOver and TalkBack, large text and dark mode
>
> Requires a UniWork account. You sign in securely in the browser; the app never stores your password.

**Từ khoá (≤ 100 ký tự):** `uniwork,chat,nhắn tin,gọi video,nhóm,công việc,team,messaging`
**Danh mục:** Business (chính), Productivity (phụ).

**Độ tuổi: 18+**, khớp chính sách quyền riêng tư ("dành cho người từ 18 tuổi", `apps/web/features/landing/privacy-content.ts`).
App Store: Age Rating 18+ (không nội dung phản cảm; có nhắn tin giữa người dùng). Google Play: Target audience chỉ nhóm
18+; bảng hỏi IARC — không bạo lực, tình dục, cờ bạc hay mua trong app; Interactive elements: **Users interact** (nhắn
tin, gọi giữa thành viên một tổ chức), không chia sẻ vị trí. Nội dung do người dùng tạo có báo cáo và chặn (mục
"Nội dung do người dùng tạo" dưới đây).

## Quyền riêng tư

App gửi về server UniWork, qua Expo Push Service (bên thứ ba, rồi APNs/FCM), tới Sentry (bên thứ ba, báo cáo
crash; UNI-2053) và — khi người dùng, hay một thành viên khác của cuộc trò chuyện hoặc cuộc gọi chung, dùng tính năng
AI — qua server UniWork tới Anthropic (nhà cung cấp mô hình AI) những dữ liệu sau. Không có quảng cáo, không theo dõi giữa app (App Tracking Transparency: không),
không bán dữ liệu. Chính sách riêng tư (`apps/web/features/landing/privacy-content.ts`, vi và en) nói từng dòng của bảng dưới — Expo, Sentry, thống kê sử dụng ẩn danh và cách tắt; `privacy-content.test.ts` đọc bảng này và đỏ khi một dòng chưa có trong chính sách (thêm dòng thì thêm câu ở cả hai). Báo cáo crash không chứa nội dung tin, email,
tên, token hay query của URL (`lib/redact.ts` lọc trước khi gửi), không chụp màn hình, không ghi lại phiên.

| Dữ liệu | Khi nào | Apple App Privacy | Google Data safety |
| --- | --- | --- | --- |
| Tên, email | Hồ sơ tài khoản, danh bạ | Contact Info → Name, Email Address; App Functionality; Linked | Personal info → Name, Email; App functionality; Shared: không |
| Nội dung tin, ảnh, tệp, tin thoại | Người dùng gửi (ảnh JPEG/PNG lớn được thu nhỏ trên máy còn cạnh dài 2048 px, bỏ metadata như vị trí GPS, trước khi tải lên) | User Content → Emails or Text Messages, Photos or Videos, Audio Data, Other User Content; App Functionality; Linked | Messages → Other in-app messages; Photos and videos; Audio; Files and docs; Shared: không |
| Nội dung xem trước trong push | Mỗi thông báo tin mới, trừ khi người dùng tắt Cài đặt › Quyền riêng tư và bảo mật › Hiện nội dung trong thông báo hay tổ chức ẩn cho mọi người (khi đó push chỉ nói loại việc, như "Tin nhắn riêng mới", không tên người gửi, phòng, tiêu đề hay chữ trong tin; chuông cuộc gọi đến vẫn mang tên người gọi). Push được gửi kèm access token của Expo (enhanced push security) | (như dòng trên; đi qua Expo/APNs/FCM) | Messages → Other in-app messages (như dòng trên); Shared: không (nhà cung cấp dịch vụ: Expo, APNs, FCM) |
| Push token Expo, tên máy, nền tảng | Đăng ký push, đăng nhập (danh sách thiết bị) | Identifiers → Device ID; App Functionality; Linked | Device or other IDs; App functionality; Shared: không (nhà cung cấp dịch vụ: Expo) |
| Chẩn đoán: báo cáo crash và hiệu năng (Sentry, bên thứ ba) | Khi app crash, một thao tác lỗi phía server, hay một bản cập nhật của app không khởi động được (id bản cập nhật đó); mẫu 10 % phiên cho thời gian mở app, thời gian tải từng màn hình (tới khi dữ liệu đã vẽ) và khung hình chậm, một nửa số đó kèm profile hiệu năng (tên hàm và thời gian chạy, không nội dung); URL request trong đó bỏ query. Chỉ khi bản build có `SENTRY_DSN` | Diagnostics → Crash Data, Performance Data; App Functionality; Linked (id người dùng dạng mã, không email/tên); không Tracking | Collected → App info and performance → Crash logs, Diagnostics; App functionality; không tuỳ chọn; Shared: không (nhà cung cấp dịch vụ: Sentry) |
| Thống kê sử dụng ẩn danh (server UniWork) | Mở app, màn đầu vẽ xong (thời gian), gửi tin (gửi được hay hỏng hẳn, thời gian), mở từ push (tin hay cuộc gọi), nối cuộc gọi (âm thanh có nối được hay không, thời gian), push cuộc gọi tới máy (đổ chuông được bằng màn nào, hay không hiện được), lần chạy trước có crash không và bản cập nhật có khởi động được không: theo lô mỗi phút tới `POST /api/v1/mobile/events`, server chỉ cộng vào bộ đếm theo hệ điều hành và phiên bản app — không lưu người, tổ chức, cuộc trò chuyện hay nội dung nào (`data/analytics.ts`). Mặc định bật; tắt ở Cài đặt › Quyền riêng tư và bảo mật › Gửi thống kê sử dụng ẩn danh | Usage Data → Product Interaction; Analytics; **Not Linked**; không Tracking | Collected → App activity → App interactions; Analytics; **tuỳ chọn** (người dùng tắt được); Shared: không |
| Mã định danh trong báo cáo crash | Cùng báo cáo trên: id người dùng UniWork (mã ULID), phiên bản, bản dựng, kênh và id bản cập nhật | Identifiers → User ID; App Functionality; Linked | Personal info → User IDs; App functionality; Shared: không (nhà cung cấp dịch vụ: Sentry) |
| Xử lý AI (Anthropic, bên thứ ba) | Khi **bất kỳ thành viên nào** dùng AI trên nội dung chung: người dùng này bấm "Bắt kịp nhanh" trên điện thoại, hoặc một thành viên khác dùng Bắt kịp, Hỏi UNI hay tóm tắt cuộc gọi trên web/máy tính. Gửi tin nhắn của cuộc trò chuyện (và nội dung cuộc gọi đã ghi, khi có người ghi) kèm tên người gửi và thời gian — gồm cả tin của người dùng này; server UniWork gửi đi, app không gọi thẳng Anthropic. Màn thông báo xử lý AI trên điện thoại (nêu tên Anthropic, dữ liệu gửi đi, không dùng để huấn luyện, rút lại ở Cài đặt › Quyền riêng tư và pháp lý; câu trả lời lưu trên server, `PUT /me/ai-consent`) chặn yêu cầu AI của chính người dùng từ điện thoại tới khi họ đồng ý; người dùng **không cho phép** (hay rút lại, `DELETE /me/ai-consent`) thì server chỉ bỏ tin họ viết trong các cuộc trò chuyện khỏi Bắt kịp, Hỏi UNI và tóm tắt cuộc gọi, dù ai yêu cầu, cả trên web/máy tính (`users.ai_opt_out_at`, `server/internal/service/ai_opt_out.go`); tin trong phòng họp, bản ghi lời nói cuộc họp, bình luận công việc và tài liệu không thuộc phạm vi này; người chưa trả lời thì tin vẫn đi khi thành viên khác dùng AI, web và máy tính không hỏi | User Content → Emails or Text Messages (và Audio Data nếu khai cuộc gọi đã ghi); App Functionality; Linked; Apple 5.1.2(i): màn đồng ý trước yêu cầu AI đầu tiên từ điện thoại; người từ chối thì tin họ viết trong các cuộc trò chuyện bị bỏ khỏi Bắt kịp, Hỏi UNI và tóm tắt cuộc gọi, dù ai yêu cầu | Messages → Other in-app messages; App functionality; khi người dùng hoặc một thành viên khác dùng tính năng AI; Shared: không (nhà cung cấp dịch vụ: Anthropic, Hoa Kỳ) |
| Báo cáo vi phạm | Người dùng báo cáo một tin nhắn hay một người: lý do, lời mô tả (tuỳ chọn), id tin và người. Chủ sở hữu và quản trị viên tổ chức thấy lý do, người/tin bị báo cáo và **người báo cáo** trong Nhật ký hoạt động; lời mô tả chỉ nằm trong bản xuất dữ liệu của tổ chức | User Content → Other User Content; App Functionality; Linked | Messages → Other in-app messages; App functionality; Shared: không |

Mọi dữ liệu mã hoá khi truyền (HTTPS/WSS).

**Một luật cho câu "Shared" của Google Data safety** (`store-listing.test.ts` giữ): theo định nghĩa của Google,
chuyển dữ liệu cho **nhà cung cấp dịch vụ** xử lý thay UniWork theo hợp đồng (Expo và APNs/FCM chuyển push, Sentry nhận
báo cáo crash, Anthropic chạy mô hình AI và không dùng dữ liệu để huấn luyện) không phải "sharing". Mỗi dòng của cột
Google ghi "Shared: không", kèm tên nhà cung cấp dịch vụ khi dữ liệu đi qua một bên như vậy; chính sách quyền riêng tư
vẫn nêu tên từng bên, và cột Apple vẫn khai loại dữ liệu đó (Apple tính cả dữ liệu nhà cung cấp dịch vụ nhận).

**Lưu trên máy (UNI-2053 S3, để app dùng được khi mất mạng).** Phiên đăng nhập và hồ sơ người dùng cuối (tên, email,
id) nằm trong Keychain/Keystore. Tin chưa gửi được; lượt đọc, biểu cảm, bình chọn, lần sửa và xoá tin chờ gửi; bản
nháp đang soạn; mã các tin người dùng đã báo cáo (để ẩn chúng với họ); cùng bản sao danh sách cuộc trò chuyện, số chưa đọc, danh bạ của workspace, trang tin mới nhất của 24
cuộc trò chuyện có hoạt động gần nhất và trang đầu (tin gốc cùng các trả lời mới nhất) của 12 chủ đề đọc gần nhất
trong các cuộc đó nằm trong một kho MMKV **mã hoá AES-256** bằng khoá ngẫu nhiên giữ trong Keychain/Keystore, chỉ trên máy này (khoá không vào bản
sao lưu và không chuyển máy, nên bản sao lưu hay máy khác không đọc được kho). Ảnh, tệp và tin thoại chưa gửi được chép vào thư mục riêng của app (được hệ
điều hành bảo vệ, không mã hoá thêm) và xoá ngay khi server nhận. Tất cả bị xoá khi đăng xuất hay xoá tài khoản; mọi
lần đăng xuất, kể cả khi thiết bị bị thu hồi từ máy khác, còn xoá ảnh đã lưu trong bộ nhớ đệm, thông báo trong khay và số
trên biểu tượng. Android không sao lưu dữ liệu của app lên đám mây và không chép nó sang máy mới
(`allowBackup: false` và luật data extraction loại mọi vùng lưu trữ). Gỡ app rồi cài lại là đăng xuất: iOS giữ
Keychain qua lần gỡ, nên lần mở đầu của bản cài mới bỏ phiên cũ và thu hồi thiết bị đó.
Dữ liệu này không rời máy nên không là dữ liệu "thu thập" trong Apple App Privacy hay Google Data safety; câu hỏi
"Data is encrypted in transit" của Play: có.

**Xoá tài khoản.** Trong app: Cài đặt › Xóa tài khoản — ở tab Cài đặt của workspace, và khi người dùng không ở
workspace nào (bị gỡ khỏi mọi workspace, hay mới đăng ký) thì ở nút Cài đặt của màn chọn workspace —, nêu hệ quả, xác nhận lại bằng mật khẩu (hoặc mã hai lớp, hoặc
gõ lại email với tài khoản chỉ Google), gọi `POST /api/v1/me/delete`, rồi đăng xuất mọi thiết bị và xoá dữ liệu của tài
khoản trên máy (bản sao cuộc trò chuyện, tin và tệp chưa gửi, ảnh đã lưu, thông báo, ghim). Chủ sở hữu tổ chức còn thành viên khác chọn người nhận quyền sở hữu ngay trong sheet, rồi app chuyển quyền bằng mật khẩu vừa nhập và xoá tài khoản (tài khoản chưa có mật khẩu, như đăng nhập Google, được đưa sang web vì server đòi mật khẩu để chuyển quyền); chủ sở hữu là thành viên duy nhất gõ lại địa chỉ tổ chức và đóng nó cùng lúc với việc xoá tài khoản, ngay trong app (`close_organization` của `POST /me/delete`, một giao dịch) — không có ngõ cụt nào ra web. URL
chính sách riêng tư: `https://app.uniworkos.com/privacy`; URL xoá tài khoản cho Play:
`https://app.uniworkos.com/privacy#delete-account`. Điều khoản sử dụng: `https://app.uniworkos.com/terms` (App Store
Connect › License Agreement: dùng điều khoản này làm EULA riêng — có mục tối thiểu Apple yêu cầu — hoặc giữ EULA chuẩn của
Apple; điều khoản này vẫn áp dụng vì người dùng đồng ý khi đăng ký và đăng nhập). Cài đặt › Quyền riêng tư và pháp lý mở
chính sách, điều khoản, liên hệ hỗ trợ (`contact@unicomhub.com`) và danh sách giấy phép mã nguồn mở; màn đăng nhập của
app và trang đăng ký/đăng nhập web nói đăng nhập (đăng ký) là đồng ý điều khoản, kèm link.

## Nội dung do người dùng tạo (Apple 1.2, Play UGC)

Điều khoản sử dụng (`/terms`, neo `#acceptable-use`) cấm nội dung phản cảm và người dùng lạm dụng, không ngoại lệ, và
cam kết nhà vận hành xem mọi báo cáo trong 24 giờ: nhà vận hành gỡ tin vi phạm, tổ chức vô hiệu hoá tài khoản đã đăng
theo yêu cầu, hoặc nhà vận hành tạm ngưng tổ chức (khi đó không ai trong tổ chức xem được nội dung); người dùng đồng ý điều khoản khi đăng ký và mỗi lần đăng nhập (dòng dưới nút). Tin nhắn chỉ đi giữa thành viên một tổ chức. Báo cáo: nhấn giữ một tin › Báo cáo; chi tiết cuộc trò chuyện riêng ›
Báo cáo; chạm một thành viên trong chi tiết nhóm › Báo cáo — chọn lý do (spam, quấy rối, thù ghét, khiêu dâm, bạo lực,
tự gây hại, khác), mô tả tuỳ chọn, và có thể chặn luôn. Tin vừa báo cáo **ẩn ngay với người báo cáo** (thay bằng dòng
"Bạn đã báo cáo tin nhắn này" có nút Xem; giữ qua lần mở lại app, `data/stores/reported-messages-store.ts`). Báo cáo lưu ở server (`chat_reports`) và ghi nhật ký
`chat.report.created`: chủ sở hữu và quản trị viên tổ chức thấy nó ở web › Cài đặt › Nhật ký hoạt động — lý do, người
và tin bị báo cáo, **ai đã báo cáo** (sheet báo cáo nói điều này; người bị báo cáo không nhận thông báo, nhưng nếu là
chủ sở hữu/quản trị viên thì cũng thấy). Lời mô tả của người báo cáo không vào nhật ký (nhật ký không xoá được, không
chứa chữ tự do); chủ sở hữu đọc nó trong bản xuất dữ liệu của tổ chức. **Nhà vận hành** thấy mọi báo cáo trong hàng
đợi của console (`/admin/chat-reports`: tổ chức, lý do, người và tin bị báo cáo, người báo cáo, thời điểm — không nội
dung, không lời mô tả) và nhận alert `UniChatReportFiled` khi có báo cáo đang chờ, `UniChatReportOverdue` khi một báo cáo chờ quá 20 giờ (runbook cùng tên); đóng báo cáo kèm lý
do ghi `chat.report.resolved` vào nhật ký của tổ chức. **Gỡ tin bị báo cáo**: tài khoản platform `admin` bấm "Gỡ tin
nhắn" trên hàng của báo cáo, ghi lý do (≥ 10 ký tự) — tin biến mất với mọi người như khi người gửi tự xoá (máy đang mở
nhận `chat.message.deleted`), báo cáo được đóng, nhật ký của tổ chức ghi `chat.message.removed` (ai gỡ, lý do) và
`admin_actions` giữ thao tác; console vẫn không bao giờ đọc nội dung tin
(`POST /api/v1/admin/chat-reports/{id}/remove-message`, `AdminService.RemoveReportedMessage`). Người dùng và reviewer cũng
báo cáo thẳng qua `contact@unicomhub.com` (chính sách riêng tư nói vậy). Trong tổ chức, chỉ người gửi xoá được tin của
mình: vô hiệu hoá người đăng chặn họ lại nhưng tin họ đã gửi vẫn hiện; gỡ một tin là việc của nhà vận hành, tạm ngưng tổ
chức ẩn mọi nội dung (không ai trong tổ chức xem được nữa). Cho chủ sở hữu/quản trị viên tổ chức tự gỡ tin chờ owner quyết. Chặn: chi tiết cuộc trò chuyện riêng hoặc thành
viên nhóm › Chặn nhắn tin (hai bên không nhắn riêng được; cuộc trò chuyện biến khỏi danh sách người chặn); cuộc trò
chuyện hiện người nào đã chặn. Ghi chú cho reviewer: **Review notes (en)** ở mục "Tài khoản demo cho review".

## Quyền và chuỗi xin quyền

Lát thêm module native là lát đặt chuỗi trong `app.config.ts` (qua tuỳ chọn plugin); bảng này là lý do để trả lời
review. Cột chuỗi là đúng chuỗi app gửi (`app.config.ts › USAGE_VI` / USAGE_EN; `store-listing.test.ts` đỏ khi lệch),
và mọi quyền Android của bản release đều có tên ở mục này — trong bảng, hay trong đoạn quyền thường dưới bảng
(`android-manifest.test.ts` đỏ khi manifest có quyền mà mục này không nhắc, hay mục này nhắc quyền manifest không có). Chuỗi iOS có tiếng Việt (ngôn ngữ gốc, `CFBundleDevelopmentRegion: vi`) và tiếng Anh (`locales.en`); app khai
hai ngôn ngữ với hệ điều hành (`expo-localization` `supportedLocales`), nên trang ngôn ngữ theo app của iOS và
Android 13+ chỉ có hai lựa chọn đó.

Trước micro (tin thoại, cuộc gọi), camera (gọi video, bật camera giữa cuộc gọi thoại) và thông báo, app hiện màn giải thích của mình (UNI-2053 S6,
`data/permissions.ts`): nói cần gì, để làm gì, khi nào dùng; chỉ khi người dùng bấm "Tiếp tục" hộp thoại hệ thống mới
hiện, "Để sau" giữ hộp thoại cho lần sau. Quyền đã bị tắt hẳn thì màn nói quyền đang tắt và mở Cài đặt của máy. Lời
mời bật thông báo lúc mở app chỉ hiện một lần mỗi máy (Apple 5.1.1(iv): không ép, nút hệ thống không bị thay thế).
Thư viện ảnh dùng trình chọn ảnh của hệ thống, không có màn giải thích riêng. Rung khi gửi tin, nhấn giữ, thả biểu cảm
và nghe/gác máy dùng phản hồi chạm của hệ thống (Android `performHapticFeedback`, theo cài đặt "Phản hồi khi chạm";
`VIBRATE` là quyền thường đã có từ `expo-notifications`), không xin quyền mới.

| Quyền | Nền tảng | Lát | Lý do (dùng cho review) | Chuỗi đề xuất (vi / en) |
| --- | --- | --- | --- | --- |
| Thông báo | iOS (hộp thoại hệ thống), Android 13+ `POST_NOTIFICATIONS` | M1 | Báo tin nhắn mới, nhắc tên, cuộc gọi đến khi app ở nền | — (iOS không dùng chuỗi riêng) |
| Thư viện ảnh | iOS `NSPhotoLibraryUsageDescription`; Android dùng photo picker, không xin quyền | M2a | Chọn ảnh để gửi vào cuộc trò chuyện | UniChat mở thư viện ảnh để bạn gửi ảnh vào cuộc trò chuyện. / UniChat opens your photo library so you can send photos to a conversation. |
| Micro | iOS `NSMicrophoneUsageDescription`, Android `RECORD_AUDIO` | M3 | Gọi thoại/video và ghi tin thoại; chỉ bật khi người dùng vào cuộc gọi hay bấm ghi | UniChat dùng micro khi bạn gọi điện và ghi tin thoại. / UniChat uses the microphone for calls and voice messages. |
| Camera | iOS `NSCameraUsageDescription`, Android `CAMERA` | M3 | Gọi video; chỉ bật khi người dùng bật camera trong cuộc gọi | UniChat dùng camera khi bạn gọi video. / UniChat uses the camera for video calls. |
| Màn cuộc gọi đến toàn màn hình | Android `USE_FULL_SCREEN_INTENT` (Android 14+: Play chỉ cấp sẵn cho app gọi điện, người dùng thu hồi được) | S4 | Hiện màn đổ chuông (Nghe / Từ chối) trên máy đang khoá khi có người gọi; không dùng cho gì khác. Bị thu hồi thì cuộc gọi chỉ là thông báo heads-up, Cài đặt › Thông báo có dòng mở lại | — (không có hộp thoại; trang cài đặt hệ thống) |
| Quản lý cuộc gọi của app | Android `MANAGE_OWN_CALLS` | S4 | Android 14 chỉ cho chạy dịch vụ nền kiểu `phoneCall` với app tự quản lý cuộc gọi; UniChat không đọc hay đặt cuộc gọi điện thoại | — (quyền thường, cấp lúc cài) |
| Thiết bị ở gần (Bluetooth) | Android 12+ `BLUETOOTH_CONNECT` | S4 | Đưa âm thanh cuộc gọi qua tai nghe Bluetooth; chỉ hỏi khi bắt đầu cuộc gọi, từ chối thì cuộc gọi vẫn dùng loa máy | — (hộp thoại hệ thống "thiết bị ở gần") |
| Face ID | iOS `NSFaceIDUsageDescription`; Android `USE_BIOMETRIC`/`USE_FINGERPRINT` (quyền thường) | bảo mật | Chỉ khi người dùng bật Cài đặt › Khoá UniChat hay tổ chức của họ bắt buộc khoá: mở app bằng Face ID, vân tay hay mã khoá của máy. App không đọc hay lưu dữ liệu sinh trắc; hệ điều hành chỉ trả lời có/không | UniChat dùng Face ID để mở khoá ứng dụng khi bạn bật Khoá UniChat. / UniChat uses Face ID to unlock the app when you turn on Lock UniChat. |
| ~~Bộ nhớ dùng chung, ảnh~~ | Android `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES` **bị gỡ** (`blockedPermissions`) | bảo mật | `expo-file-system`, `expo-image`, `expo-image-picker` khai hai quyền đầu tới API 32, `expo-screen-capture` khai quyền sau cho listener chụp màn hình trước Android 14 mà app không dùng; UniChat chỉ đọc tệp của chính nó và tệp trình chọn hệ thống trao, nên không xin | — |

Quyền thường của Android (cấp lúc cài, không hộp thoại, không khai báo riêng trên Play): `DETECT_SCREEN_CAPTURE`
(Android 14+: `expo-screen-capture` đăng ký callback chụp màn hình ngay khi module được tạo; chặn quyền này thì app
chết khi mở), `INTERNET`,
`ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE` (biết có mạng để gửi lại tin chờ), `MODIFY_AUDIO_SETTINGS` (loa ngoài, tai nghe
trong cuộc gọi), `VIBRATE`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED` (thông báo hẹn giờ của `expo-notifications` sống qua
lần khởi động lại), `FOREGROUND_SERVICE` cùng `FOREGROUND_SERVICE_PHONE_CALL`, `FOREGROUND_SERVICE_MICROPHONE`,
`FOREGROUND_SERVICE_CAMERA` (dịch vụ cuộc gọi, mục dưới), `BLUETOOTH` và `BLUETOOTH_ADMIN` (LiveKit khai, không có
`maxSdkVersion`; chỉ có nghĩa tới Android 11 — từ Android 12 tai nghe Bluetooth đi qua `BLUETOOTH_CONNECT` ở bảng trên).
`android-manifest.test.ts` giữ cả `maxSdkVersion` của từng quyền: hiện không quyền nào có.

Thư viện Maven mà các module kéo theo cũng thêm quyền khi Gradle gộp manifest, đều là quyền thường hoặc quyền riêng
của hãng, cấp lúc cài, không hộp thoại, không khai báo riêng trên Play: số chưa đọc trên biểu tượng app
(`ShortcutBadger` của `expo-notifications`) xin `READ_APP_BADGE` và quyền badge của từng launcher (Samsung, HTC, Sony,
Huawei, OPPO, Apex, Solid, EverythingMe); `firebase-messaging` xin quyền nhận tin FCM của Google Play services
(`com.google.android.c2dm.permission.RECEIVE`), đường mọi push đi qua; `androidx.core` khai và xin quyền mức chữ ký
`<package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` để chỉ chính app gửi được tới receiver nó đăng ký lúc chạy. Quyền
ràng buộc dịch vụ install referrer của Play (`installreferrer` qua `expo-application`) **bị gỡ** (`blockedPermissions`):
app không đọc nguồn cài đặt. Danh sách đầy đủ của bản release, mỗi quyền một lý do, là
`apps/chat-mobile/android-permissions.json`; `scripts/mobile-apk-scan.mjs` đọc manifest đã gộp của chính APK/AAB và đỏ
khi bản build xin một quyền ngoài danh sách đó.

**iOS privacy manifest** (`app.config.ts › IOS_PRIVACY_MANIFEST`, đặt vào `ios.privacyManifests`): không tracking; dữ liệu
thu thập đúng từng dòng Apple App Privacy của bảng "Quyền riêng tư" ở trên (`store-listing.test.ts` so hai bên); lý do
dùng API cần khai báo: UserDefaults `CA92.1`, file timestamp `C617.1` và `3B52.1`, system boot time `35F9.1`, disk space
`E174.1`. Module Expo và Sentry mang manifest riêng; Xcode gộp lại khi archive (runbook › iOS privacy manifest).

Không CallKit/VoIP push trên iOS (chưa có tài khoản Apple; kế hoạch PushKit + CallKit ở
`docs/adr/drafts/0038-cuoc-goi-native-android-va-ke-hoach-callkit-ios.md`), nên không có background mode `voip`, và
**gọi điện tắt trên iPhone** bằng công tắc server `unichat_mobile_calls_ios` (mặc định tắt: iPhone không hiện nút gọi,
không nhận push đổ chuông). Vì vậy mô tả App Store của bản iOS đầu tiên **bỏ dòng "Gọi thoại và video" / "Voice and
video calls"** (Apple 2.3.1: metadata phải đúng với app) cho tới khi bật CallKit; mô tả Play giữ nguyên. Thông báo nhắc
tên và cuộc gọi nhỡ trên iPhone là "time-sensitive" (đi qua Chế độ tập trung; entitlement
`com.apple.developer.usernotifications.time-sensitive`, EAS bật capability cho App ID khi ký) và mỗi push tin mang số
chưa đọc cho biểu tượng app. Màn tắt khi áp tai trong cuộc gọi thoại (Android, cảm biến tiệm cận) dùng `WAKE_LOCK`, quyền
thường đã khai, không xin quyền mới. Gọi trên iPhone là **năng lực của bản build**, không chỉ của công tắc server
(Apple 2.5.4, 2.3.1): bản iOS hiện tại **không khai background mode nào** — `UIBackgroundModes` chỉ có `audio` (để cuộc
gọi giữ tiếng khi rời app hay khoá máy; lý do cho review: "keeps an ongoing voice/video call audible") trong bản build
với `UNICHAT_IOS_CALLS=1`, và `app.config.ts` từ chối biến đó khi `modules/unichat-calls` chưa có phần iOS (CallKit,
PushKit). Bản build không có nó thì app luôn tắt gọi trên iPhone, `unichat_mobile_calls_ios` bật cũng vậy
(`lib/runtime-extra.ts › lackingFlags`): server không bật được tính năng mà reviewer chưa thấy. `expo-task-manager`
tự thêm `fetch`, `expo-audio` có thể thêm `audio`; plugin `with-unichat-calls` gỡ cả hai (trừ `audio` ở bản có gọi) và
`app.config.test.ts` đọc Info.plist cuối của bản release.

**Android, dịch vụ chạy nền (foreground service): đúng một, dịch vụ cuộc gọi** (`expo.modules.unichatcalls.CallService`,
`phoneCall|microphone|camera`). Chạy từ lúc cuộc gọi đang nối tới lúc kết thúc, với thông báo cuộc gọi đang diễn ra (tên,
đồng hồ, Gác máy); `microphone` và `camera` chỉ được thêm khi quyền đó đã cấp. Khai báo trên Play (runbook › Play Console
App content): kiểu `phoneCall` — "VoIP voice and video calls between members of an organization", `microphone` và
`camera` — "the user's own microphone/camera during a call they started or answered", kèm video quay màn hình: nhận
cuộc gọi trên máy khoá → Nghe → khoá máy giữa cuộc gọi → thông báo cuộc gọi đang diễn ra → Gác máy. `expo-audio` tắt
phát/ghi nền (`enableBackgroundPlayback: false`; tin thoại dừng khi rời app), `MediaProjectionService` của WebRTC (chia
sẻ màn hình, app không dùng) bị gỡ khỏi manifest. Ba dịch vụ không chạy nền khác: `UniChatMessagingService` (dịch vụ
FCM của app: push đổ chuông thành màn đổ chuông ngay, không cần khởi động JavaScript; mọi push khác chuyển cho dịch vụ
của `expo-notifications`), `TaskJobService` của `expo-task-manager` (đường dự phòng của push cuộc gọi khi app đang mở)
và `CallActionTaskService` (Từ chối/Gác máy trên thông báo báo cho server). App không xin quyền
bỏ qua tối ưu pin (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS; Play chỉ cho app không dùng được FCM): Cài đặt › Thông báo chỉ mở trang pin của
hệ thống và trang tự khởi động của hãng (Xiaomi, Oppo, vivo, Huawei, OnePlus, Asus) để người dùng tự bật; manifest khai
`<queries>` đúng tên gói các app cài đặt đó (không xin quyền thấy mọi app). Danh sách quyền, dịch vụ và gói được hỏi của
bản release do `android-manifest.test.ts` giữ.

## Tài khoản demo cho review

1. Trên production, tạo org riêng "UniChat Review" (không chung với khách hàng), một workspace, hai tài khoản
   (`review@…` cho Apple/Google và một tài khoản thứ hai để có người trò chuyện), vài phòng có sẵn tin, một cuộc gọi
   mẫu trong lịch sử.
2. Tài khoản review đăng nhập bằng email + mật khẩu (reviewer không dùng được Google SSO), không MFA.
3. App Store Connect → App Review Information → Sign-in required: email, mật khẩu, và **Review notes (en)** dưới đây
   (`store/apple/store.config.json › review.notes` mang đúng chữ này, trừ đoạn gọi điện khi iPhone còn tắt gọi; mật
   khẩu chỉ nằm ở App Store Connect và Play Console, không trong repo).
4. Play Console → App content → App access: cùng thông tin.
5. Đổi mật khẩu sau mỗi đợt review; không để tài khoản này là thành viên org nào khác.

**Review notes (en):**

> Tap "Sign in". The app opens a secure browser sheet on uniworkos.com; enter the email and password above, then tap
> "Allow" and "Open UniChat" to return to the app.
>
> To test a call, open the room "Review" and tap the call button; the second account can be reached the same way from
> another device or from https://app.uniworkos.com.
>
> Our terms of use (https://app.uniworkos.com/terms#acceptable-use), which every user agrees to when they sign up and
> sign in, forbid objectionable content and abusive users with no tolerance. Long-press any message from another
> person and choose "Report": the message is hidden from you at once. In a direct conversation, open its details (tap the name at the top) for "Block" and
> "Report". The organization's owners and admins see each report (reason, the person or message reported, and who
> reported it) in the web app's Settings › Activity log, and can deactivate the member who posted it. Every report also
> reaches the operator's moderation queue, and anyone can report content or a user directly to the operator at
> contact@unicomhub.com. The operator reviews every report within 24 hours: we take the reported message down for
> everyone from our moderation console, the organization deactivates the offending account at our request, or we
> suspend the organization, after which none of its content can be seen.

## Ảnh chụp và đồ hoạ

**Feature graphic của Play** (1024 × 500, không chữ, không kênh alpha): `store/play/feature-graphic.png`, sinh bởi
`pnpm brand:build` từ `packages/ui/brand/svg/unichat-feature-graphic.svg` (khoá trong `assets.lock.json`); không sửa tay.

**Icon hi-res của Play** (512 × 512, PNG 32-bit): `store/play/icon-512.png`, sinh bởi `pnpm brand:build` từ
`packages/ui/brand/svg/unichat-icon.svg` (khoá trong `assets.lock.json`); không sửa tay.

**Ảnh chụp màn hình** (chưa chụp; owner action một cú bấm: chạy workflow `chat-mobile-store-screenshots.yml` (Actions ›
"UniChat mobile store screenshots"), xem từng ảnh trong artifact `unichat-store-screenshots-play` /
`unichat-store-screenshots-app-store` rồi commit vào `store/`; workflow đọc các biến `MAESTRO_*` của
`chat-mobile-verify.yml`, nên chúng phải trỏ tới workspace có dữ liệu review, không dữ liệu khách hàng). Trên máy:
`node apps/chat-mobile/scripts/store-screenshots.mjs capture --platform android|ios --locale vi|en` đặt ngôn ngữ của app,
thanh trạng thái sạch (9:41, pin đầy), chạy `maestro/flows/store-screenshots.yaml` (danh sách hội thoại, một cuộc trò
chuyện, danh bạ, và tab cuộc gọi cho Play khi iPhone còn tắt gọi) và lưu vào `store/play/<vi-VN|en-US>/images/phoneScreenshots/`
(bố cục fastlane supply) và `store/apple/screenshots/<vi|en-US>/`. Máy: emulator 1080 × 1920 (Play từ chối cạnh dài hơn
hai lần cạnh ngắn) và iPhone 16 Pro Max (1320 × 2868; 6,5" 1242 × 2688 cũng được). `store-screenshots.mjs check` đỏ khi
một ngôn ngữ thiếu ảnh (tối thiểu 3), ảnh sai cỡ, hay thiếu icon 512; `chat-mobile-promote.yml` chạy nó trước khi một bản
lên production (`scripts/mobile-store-screenshots.test.mjs` giữ luật). Dữ liệu trong ảnh lấy từ org "UniChat Review",
không dữ liệu khách hàng.