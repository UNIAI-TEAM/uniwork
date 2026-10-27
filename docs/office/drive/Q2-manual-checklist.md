# Checklist thủ công — Google Drive trên Google thật (web và desktop)

> **Trạng thái:** in-progress

Checklist này do **người** chạy trên môi trường staging với Google thật (không phải bản giả lập), trước khi bật Google Drive cho tổ chức nội bộ. Web và app desktop đều phải qua checklist này mới được ra mắt. Mỗi bước có kết quả mong đợi; người chạy so với màn hình thật rồi ghi vào cột Web và cột Desktop.

## Cách chạy và cách ghi

- **Môi trường:** staging `https://<staging-uniwork>`; máy chủ có đủ khóa Google Drive (client, secret, khóa Picker, mã dự án, khóa mã hóa). Cờ `drive_connector` mặc định **bật**, không cần bật riêng cho tổ chức thử; công tắc tắt khẩn cấp là biến `FF_DRIVE_CONNECTOR=false` (hoặc ghi đè tắt trong Quản trị › Flags). Staging không được đặt `FF_DRIVE_CONNECTOR=false` khi chạy checklist. Biến giả lập Drive **không** được đặt, nếu không thì mọi bước đọc nội dung đang đọc dữ liệu giả, không phải Google.
- **Google:** OAuth client của Drive ở chế độ Testing, cả hai tài khoản thử đã nằm trong danh sách test user. Ở chế độ Testing, màn consent hiện cảnh báo "ứng dụng chưa xác minh" — bấm Tiếp tục. Theo tài liệu của Google, refresh token của app Testing hết hạn sau 7 ngày: nếu một kết nối tự chuyển "Mất kết nối" sau 7 ngày thì ghi lại, không coi là lỗi của UniWork.
- **Kiểm nhanh trước khi bắt đầu:** vào Cài đặt › Tích hợp, thấy hàng **Google Drive**. Không thấy hàng này nghĩa là máy chủ thiếu khóa/client Google Drive, hoặc công tắc tắt đang bật (`FF_DRIVE_CONNECTOR=false` hay ghi đè tắt trong Quản trị): dừng, báo người vận hành.
- **AI:** workspace thử đã bật AI (có nhà cung cấp, còn hạn mức token) và dịch vụ trích văn bản Office đang chạy; thiếu một trong hai thì mục 5 không chạy được.
- **Desktop:** cài bản desktop có màn Google Drive trong Tài liệu; đăng nhập đúng tổ chức và workspace thử. Giữ app desktop và trình duyệt cùng mở khi chạy mục 8.
- **Bằng chứng:** mỗi bước chụp ảnh màn hình (hoặc quay video ngắn khi có chuyển động như popup, Picker) và đặt tên `Buoc-<mã bước>-web` hoặc `Buoc-<mã bước>-desktop`; gom vào báo cáo kiểm thử. Bước không đạt: kèm giờ chạy và địa chỉ trang.
- **Cách đánh dấu:** ở cột Web và Desktop ghi một trong ba giá trị `Đạt`, `Không đạt`, `Bỏ qua`; mọi `Không đạt` và `Bỏ qua` phải có lý do ở cột Ghi chú. Ô có dấu "—" là bước không áp dụng cho nền đó. Ô `☐` là chưa chạy.
- **Bước ghi "chưa có trên bản hiện tại":** tính năng chưa có trong mã đang kiểm; ghi `Bỏ qua` kèm câu đó, không tính là không đạt.

## Chuẩn bị

**Tài khoản Google (2):**

- Tài khoản A: Gmail cá nhân, ví dụ `<gmail-test>@gmail.com`.
- Tài khoản B: tài khoản Google Workspace, ví dụ `<user>@<ten-mien-workspace>`, có quyền vào một Bộ nhớ dùng chung (Shared Drive).
- Có quyền vào Google Admin Console của tên miền Workspace (hoặc nhờ quản trị viên) để chặn ứng dụng ở bước 1.10.

**Người dùng UniWork (2), cùng một workspace, đều là thành viên (không phải khách):**

- U1 và U2. U2 giao được việc cho nhau với U1. Không ai đã kết nối Google Drive trước khi chạy.

**Tệp mẫu trên Google Drive:**

| Tài khoản | Tệp | Yêu cầu nội dung |
| --- | --- | --- |
| A | DOCX `Ke-hoach-Q4.docx` | Có một câu đánh dấu riêng chỉ có trong tệp này (ví dụ "MA-DOCX-7H3"); 5–8 đầu việc có tên người và hạn; có một đầu việc không nêu ngày bắt đầu |
| A | XLSX `Ngan-sach.xlsx` | Trang tính đầu có câu đánh dấu "MA-XLSX-4K9"; trang tính thứ hai có câu "MA-XLSX-TRANG2" |
| A | PPTX `Lo-trinh.pptx` | Có chữ trên từng slide và câu đánh dấu "MA-PPTX-2Q8"; có ghi chú người nói ở một slide |
| A | Google Doc `Bien-ban-hop` | Có câu đánh dấu "MA-GDOC-5M1" |
| A | Google Sheet `Theo-doi` | Có câu đánh dấu "MA-GSHEET-9P6" |
| A | PDF `Dac-ta.pdf` (dưới 10 MiB) | Có câu đánh dấu "MA-PDF-3T5" |
| A | Thư mục `Du-an-Q4` | Chứa hai tệp: một DOCX và một Google Doc |
| A | Tệp `Rieng.docx` | Chỉ A có quyền, không chia sẻ cho ai |
| A | Tệp `Chia-se.docx` | Đã chia sẻ cho tài khoản B (quyền xem) |
| A | Ảnh `Anh.png` (hoặc ODT) | Định dạng UNI chưa đọc |
| B | Tệp trong Bộ nhớ dùng chung `Dung-chung.docx` | Có câu đánh dấu "MA-SHARED-8D2" |
| B | Một tệp ở mục "Được chia sẻ với tôi" (do người khác chia sẻ cho B) | Có câu đánh dấu "MA-SWM-6R4" |

**Trình duyệt:** Chrome hoặc Edge, cho phép cửa sổ bật lên (pop-up) với `https://<staging-uniwork>`. Chuẩn bị thêm một cửa sổ ẩn danh khi cần đăng nhập tài khoản Google khác.

## 1. Kết nối tài khoản Google

Cài đặt › Tích hợp, hàng **Google Drive**. Chạy bằng U1.

| # | Bước | Kết quả mong đợi | Web | Desktop | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Mở Cài đặt › Tích hợp, nhìn hàng Google Drive khi chưa kết nối | Hàng hiện nhãn **Chưa kết nối**, nhãn **Mới** và nút **Kết nối Google Drive** | ☐ | — | Thử công tắc tắt trên một môi trường riêng nếu được: khi tắt thì hàng này biến mất |
| 1.2 | Bấm **Kết nối Google Drive**, đăng nhập tài khoản A trong cửa sổ Google vừa mở | Hiện cửa sổ bật lên. Màn consent của Google chỉ xin quyền với đúng những tệp bạn dùng với ứng dụng này (cộng email và danh tính cơ bản). Không có quyền "xem và tải mọi tệp trên Drive" | ☐ | — | Ghi nguyên văn các dòng quyền Google hiện ra vào ảnh chụp. Có dòng quyền nào rộng hơn thì `Không đạt` |
| 1.3 | Bấm Tiếp tục / Cho phép ở Google | Cửa sổ tự đóng. Thông báo **Đã kết nối Google Drive. Bạn có thể liên kết tài liệu vào việc.** Hàng hiện **Đã kết nối 1 tài khoản** và nút **Quản lý** | ☐ | — | |
| 1.4 | Bấm **Quản lý** | Mục **Tài khoản đã kết nối** có một thẻ cho tài khoản A: email, giờ kết nối, **Đang hoạt động**, phạm vi quyền **Chỉ tệp bạn chọn**, **UniWork lưu**: **Chỉ liên kết, không lưu nội dung**, số tài liệu đã liên kết, khối **UNI được làm gì với tài liệu đã liên kết**, nút **Ngắt kết nối** | ☐ | — | |
| 1.5 | Bấm **Kết nối thêm tài khoản**, ở Google chọn "Dùng tài khoản khác", đăng nhập tài khoản B (Workspace) | Google cho chọn tài khoản. Sau khi xong có thông báo thành công, hàng ghi **Đã kết nối 2 tài khoản**, danh sách có hai thẻ (A và B), cả hai **Đang hoạt động** | ☐ | — | Xác nhận cả Gmail cá nhân lẫn tài khoản Workspace đều kết nối được |
| 1.6 | Bấm lại **Kết nối thêm tài khoản** và chọn lại tài khoản A (đã kết nối) | Thông báo **Đã kết nối lại Google Drive.** Vẫn chỉ có hai thẻ, không có thẻ thứ ba cho A | ☐ | — | |
| 1.7 | Dùng một tài khoản Google thứ ba chưa kết nối, bấm kết nối tài khoản đó, lần này **bỏ tick** quyền truy cập tệp trên màn consent của Google rồi Tiếp tục | Cửa sổ đóng. Thông báo **Bạn chưa cấp quyền chọn tệp Google Drive cho UniWork. Kết nối lại và đánh dấu quyền truy cập tệp khi Google hỏi.** Không có thẻ tài khoản nào được thêm | ☐ | — | Google không hiện ô tick thì `Bỏ qua` và ghi lại |
| 1.8 | Bắt đầu kết nối rồi bấm Hủy / Không cho phép trên màn Google | Thông báo **Bạn đã hủy đăng nhập hoặc từ chối cấp quyền cho UniWork.** Không có thẻ mới | ☐ | — | |
| 1.9 | Bắt đầu kết nối rồi tự đóng cửa sổ Google khi chưa xong | **Cửa sổ đăng nhập đã đóng trước khi kết nối xong. Thử lại.** Có nút thử lại | ☐ | — | |
| 1.10 | Quản trị viên Workspace chặn ứng dụng UniWork trong Admin Console (Bảo mật › Kiểm soát API › Quản lý quyền truy cập ứng dụng bên thứ ba), rồi đăng nhập tài khoản B và kết nối | Thông báo **Quản trị viên Google Workspace của tổ chức bạn chưa cho phép UniWork truy cập Google Drive. Hãy nhờ quản trị viên Google Workspace cho phép ứng dụng UniWork.** Không có thẻ mới, không có nút "dùng Gmail cá nhân" | ☐ | — | Chạy xong gỡ chặn rồi kết nối lại B để các mục sau có B. Google trả mã lỗi khác với dạng mong đợi thì ghi nguyên văn lỗi Google hiện |
| 1.11 | Tắt cho phép cửa sổ bật lên với trang staging rồi bấm **Kết nối Google Drive** | Thông báo **Trình duyệt đã chặn cửa sổ đăng nhập. Cho phép cửa sổ bật lên (pop-up) với UniWork rồi thử lại.** | ☐ | — | Bật lại pop-up sau bước này |
| 1.12 | Kết nối khi đang mở nhiều tab: bắt đầu kết nối ở tab 1, hoàn tất đăng nhập Google nhưng giữ tab 2 mở cùng trang | Tab bắt đầu nhận thông báo thành công; tab kia không báo lỗi. Làm mới tab kia thấy cùng số tài khoản | ☐ | — | |

## 2. Chọn tệp bằng Google Picker

Chạy bằng U1 với hai tài khoản A và B đã kết nối. Picker là cửa sổ của Google, chữ trong Picker thuộc Google.

| # | Bước | Kết quả mong đợi | Web | Desktop | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| 2.1 | Tài liệu › **Google Drive** › **Thêm từ Google Drive** (có hai tài khoản) | Hộp **Chọn tài khoản Google Drive** liệt kê A và B, mỗi tài khoản có **Đang hoạt động**; có dòng "UniWork chỉ được quyền với tệp bạn chọn. UniWork chỉ lưu liên kết, nội dung vẫn nằm trên Google Drive."; có nút **Mở Google Picker** | ☐ | — | Chỉ có một tài khoản thì Picker mở thẳng, không hỏi tài khoản |
| 2.2 | Trình duyệt đang đăng nhập Google bằng tài khoản B làm mặc định. Chọn tài khoản A rồi **Mở Google Picker** | Picker liệt kê tệp của tài khoản A (thấy `Ke-hoach-Q4.docx`), không phải tệp của B, dù B là tài khoản mặc định của trình duyệt | ☐ | — | Đây là bước kiểm Picker chọn đúng tài khoản không phụ thuộc phiên Google của trình duyệt |
| 2.3 | Trong Picker, kiểm các nơi tìm tệp | Có Drive của tôi, Được chia sẻ với tôi và Bộ nhớ dùng chung. Chữ Picker theo tiếng Việt khi UniWork đang để tiếng Việt | ☐ | — | |
| 2.4 | Chọn nhiều tệp một lần của A: DOCX, XLSX, PPTX, Google Doc, Google Sheet, PDF, rồi xác nhận trong Picker | Thông báo **Đã liên kết 6 tệp từ Google Drive.** Không hiện hộp xác nhận tên tệp (chọn từ danh sách, không gắn việc). Danh sách có đủ 6 dòng | ☐ | — | |
| 2.5 | Mở lại Picker (tài khoản A), vào thư mục `Du-an-Q4`, thử chọn chính thư mục | Vào được thư mục và xem được tệp bên trong; **không** chọn được thư mục. Chọn một tệp bên trong thì liên kết được | ☐ | — | Liên kết cả thư mục chưa có trên bản hiện tại; thư mục chỉ để duyệt tìm tệp |
| 2.6 | Mở Picker bằng tài khoản B, chọn tệp trong Bộ nhớ dùng chung và tệp ở "Được chia sẻ với tôi" | Cả hai liên kết thành công. Dòng tệp Bộ nhớ dùng chung ở cột **Quyền trên Google Drive** ghi **Bộ nhớ dùng chung**; tệp được chia sẻ ghi **Đã chia sẻ** hoặc **Chưa rõ** (ghi lại giá trị thật) | ☐ | — | |
| 2.7 | Dùng tài khoản A chọn `Chia-se.docx`, sau đó dùng tài khoản B chọn lại đúng tệp đó | Lần chọn bằng B: thông báo **Đã có trong Drive: <email A>**. Danh sách vẫn một dòng cho tệp, cột **Mở bằng tài khoản** vẫn là A, không đổi sang B | ☐ | — | Không có đường nào lặng lẽ đổi tài khoản đọc |
| 2.8 | Chặn `apis.google.com` (tiện ích chặn quảng cáo hoặc ngắt mạng) rồi bấm **Mở Google Picker** | Thông báo **Không mở được Google Picker. Kiểm tra kết nối mạng rồi thử lại.** | ☐ | — | Gỡ chặn sau bước này |
| 2.9 | Chọn tệp trong Picker rồi đóng Picker không chọn gì (Hủy) | Không có tệp nào được liên kết, không có thông báo lỗi | ☐ | — | |

## 3. Mở: danh sách, trang tệp, Mở trên Google Drive, thanh bên

Chạy bằng U1 sau mục 2. Cột Desktop: làm trong app desktop với cùng người dùng, sau khi đã chạy mục 8.1.

| # | Bước | Kết quả mong đợi | Web | Desktop | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| 3.1 | Mở Tài liệu, nhìn thanh bên | Nút **Google Drive** nằm ngay dưới "Thư mục của tôi" kèm tổng số tệp; dưới nó có một dòng cho mỗi tài khoản (hiện email, mô tả **Drive: <email>**) kèm số tệp. Không có mục "Người khác liên kết" | ☐ | ☐ | |
| 3.2 | Bấm **Google Drive** (tất cả) | Địa chỉ có `view=drive` (chỉ web). Tiêu đề **Google Drive**, dòng phụ "Tệp Google Drive bạn đã liên kết hoặc cho UniWork đọc. Chỉ bạn thấy danh sách này; UniWork chỉ lưu liên kết."; bảng có cột **Tên**, **Mở bằng tài khoản**, **Quyền trên Google Drive**, **Đang dùng ở**, **Đã tạo việc**; có tệp của cả A và B | ☐ | ☐ | Mục đang chọn được tô sáng |
| 3.3 | Bấm dòng tài khoản A | Địa chỉ thêm `account=` (chỉ web). Tiêu đề **Drive: <email A>**; dòng phụ "Tệp bạn đã thêm từ tài khoản này · luôn mở bằng chính tài khoản này"; chỉ có tệp của A; nút **Thêm từ <email A>** | ☐ | ☐ | |
| 3.4 | Nhìn các cột của một tệp chưa gắn việc nào | **Mở bằng tài khoản** là email của tài khoản đã chọn tệp; **Quyền trên Google Drive** là một trong **Riêng tư**, **Đã chia sẻ**, **Bộ nhớ dùng chung**, **Chưa rõ**; **Đang dùng ở** ghi **Chưa gắn vào việc nào**; **Đã tạo việc** trống | ☐ | ☐ | `Rieng.docx` phải là **Riêng tư**; tệp trong Bộ nhớ dùng chung phải là **Bộ nhớ dùng chung** |
| 3.5 | Đăng nhập U2 (chưa kết nối gì), vào Tài liệu | Không có nút **Google Drive** ở thanh bên (U2 chưa có kết nối và chưa có tệp) | ☐ | ☐ | |
| 3.6 | U2 kết nối tài khoản Google B (như bước 1.2–1.3), vào **Google Drive** | Bảng rỗng: **Chưa có tệp Google Drive nào được liên kết.** kèm "Chọn tệp từ Google Drive của bạn để liên kết vào công việc hoặc nhờ UNI đọc." và nút **Thêm từ Google Drive**. Không thấy tệp nào của U1 | ☐ | ☐ | Danh sách chỉ gồm tệp của chính người xem. Desktop: trạng thái rỗng chỉ có dòng tiêu đề, không có mô tả; nút **Thêm từ Google Drive** nằm ở đầu trang, nên cột Desktop chỉ kiểm dòng tiêu đề |
| 3.7 | U1 bấm vào dòng `Ke-hoach-Q4.docx` | Web: mở trang tệp với đường dẫn Tài liệu › Google Drive, tiêu đề, loại và "<tên> sửa <thời gian>", nút **Mở trên Google Drive**, **Tạo việc từ tài liệu**, **Hỏi UNI**. Desktop: mở khung chi tiết bên phải với các thông tin tương tự | ☐ | ☐ | |
| 3.8 | Xem bảng thuộc tính của tệp | **Nguồn** ghi Google Drive kèm loại tệp; **Tài khoản gắn** là email A; **Bạn mở bằng** là email A; **Chủ sở hữu**; **Người liên kết** ghi "Bạn · <ngày>"; **Quyền xem và sửa**: **Theo chia sẻ trên Drive**; khối giải thích "Xem và sửa nội dung trên Google, bằng tài khoản <email A>. UniWork chỉ lưu liên kết, các việc dùng tệp và lịch sử thao tác; nội dung vẫn nằm trên Google Drive."; **Đang dùng ở · 0** | ☐ | ☐ | Desktop hiện các thông tin này trong khung bên phải, bố cục có thể khác web; ghi lại phần nào thiếu |
| 3.9 | Mở tệp trong Bộ nhớ dùng chung (tài khoản B) ở trang tệp | **Chủ sở hữu** ghi **Bộ nhớ dùng chung** | ☐ | ☐ | |
| 3.10 | Xem mục **Hoạt động trong UniWork** của tệp | Có dòng "Bạn đã liên kết tệp từ Google Drive". Mở trang tệp nhiều lần không sinh dòng "đã mở" nào | ☐ | ☐ | |
| 3.11 | Bấm **Mở trên Google Drive** một lần | Đúng một tab (hoặc cửa sổ trình duyệt) mới mở tệp trên Google; địa chỉ có `authuser=<email ở dòng Bạn mở bằng>`. Trang tệp chỉ có một nút **Mở trên Google Drive** | ☐ | ☐ | Desktop: bấm nút, và thử cả nhấp đúp (hoặc Enter) trên dòng; cả hai phải mở trình duyệt hệ thống, không mở cửa sổ trong app |
| 3.12 | Đăng nhập trình duyệt Google bằng tài khoản B làm mặc định rồi lặp lại 3.11 với tệp của A | Google mở tệp bằng đúng tài khoản A (theo `authuser`), hoặc yêu cầu đăng nhập tài khoản A; không mở nhầm bằng B rồi báo "không có quyền" | ☐ | ☐ | Nếu Google yêu cầu đăng nhập, UniWork không tự xử lý thay: `Đạt` |
| 3.13 | U2 dán địa chỉ trang tệp của U1 (trang chưa gắn việc nào, U2 chưa có quyền) vào trình duyệt của mình | **Không tìm thấy tệp này hoặc bạn không có quyền xem.** kèm nút **Về Google Drive của tôi** | ☐ | — | Không lộ việc tệp có thật |
| 3.14 | Đổi tên tệp `Theo-doi` trên Google Drive, chờ hơn 10 phút, mở lại danh sách rồi trang tệp | Tên mới hiện sau khi làm mới danh sách hoặc mở lại trang tệp | ☐ | ☐ | Làm mới siêu dữ liệu chạy khi mở danh sách hoặc trang tệp, tối đa một lần mỗi 10 phút một tệp |
| 3.15 | Ngắt mạng rồi mở **Google Drive** ở Tài liệu | **Không tải được danh sách tệp Google Drive.** kèm "Kiểm tra kết nối mạng rồi thử lại." và nút **Thử lại**; bấm lại sau khi có mạng thì hiện danh sách | ☐ | — | Desktop có câu riêng ở mục 8.14 |

## 4. Gắn tệp vào việc

| # | Bước | Kết quả mong đợi | Web | Desktop | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| 4.1 | U1 mở hộp tạo việc (chế độ thủ công), bấm kẹp giấy | Menu có **Tải tệp lên** và **Từ Google Drive** (kèm "2 tài khoản đã kết nối") và dòng "Hoặc dán liên kết Google Drive vào mô tả, UniWork gợi ý liên kết tệp" | ☐ | — | |
| 4.2 | Chọn **Từ Google Drive**, chọn tài khoản A, trong Picker chọn `Rieng.docx` | Hiện hộp **Liên kết 1 tệp** với dòng "Tên tệp sẽ hiện cho người xem được việc này. Nội dung vẫn chỉ mở trên Google Drive." Bấm **Liên kết 1 tệp**: nháp việc hiện chip tệp có nhãn Google Drive | ☐ | — | Hộp xác nhận chỉ hiện khi tệp không ở trạng thái **Đã chia sẻ** |
| 4.3 | Đặt tiêu đề, tạo việc | Việc được tạo; mở việc thấy mục **Đính kèm** có thẻ Drive của `Rieng.docx` | ☐ | — | |
| 4.4 | Nhìn thẻ Drive trong **Đính kèm** | Thẻ có tên tệp, loại, dòng "Drive: <email A>", "<tên U1> liên kết từ Google Drive", "<tên> sửa <thời gian>", "Chủ sở hữu: <tên>"; nút **Mở trên Google Drive**, **Tạo việc từ tài liệu**, **Hỏi UNI**; menu ⋯ (tên gợi ý "Thêm thao tác cho <tên tệp>") có **Xem trong Tài liệu** và **Bỏ liên kết** | ☐ | — | |
| 4.5 | Trên thẻ, mở menu ⋯ › **Xem trong Tài liệu** | Mở đúng trang tệp của tệp đó | ☐ | — | |
| 4.6 | Mở chi tiết một việc khác, trong **Đính kèm** bấm **Thêm tệp** | Menu **Tải tệp lên** và **Từ Google Drive**. Chọn **Tải tệp lên** vẫn tải được tệp thường như trước | ☐ | — | |
| 4.7 | Trong việc đó: **Thêm tệp** › **Từ Google Drive** › chọn `Chia-se.docx` (tài khoản A) | Không hiện hộp xác nhận (tệp đã chia sẻ). Thẻ Drive xuất hiện ngay; Hoạt động của việc có dòng "đã liên kết <tên tệp> từ Google Drive" | ☐ | — | Gặp lại hộp xác nhận hay không phụ thuộc giá trị **Quyền** thật của Drive; ghi lại |
| 4.8 | Trong mô tả việc dán địa chỉ `docs.google.com/document/d/<id>` của Google Doc `Bien-ban-hop` | Liên kết chèn vào mô tả như thường; dưới ô soạn thảo hiện gợi ý "Liên kết tệp Google Drive này vào việc?". Bấm gợi ý: Picker mở sẵn đúng tệp đó; chọn xong thẻ Drive xuất hiện | ☐ | — | Chưa kết nối Drive thì gợi ý ghi **Kết nối Google Drive để liên kết** (thử bằng U2 trước bước 3.6) |
| 4.9 | Từ trang tệp `Ke-hoach-Q4.docx` bấm **+ Gắn vào việc** | Hộp **Gắn tệp vào việc** có ô **Tìm việc**; chọn một việc rồi bấm **Gắn vào việc**. **Đang dùng ở · 1** hiện dòng "<mã việc> · <tiêu đề>"; mở việc thấy thẻ Drive | ☐ | — | |
| 4.10 | Gắn lại đúng tệp vào đúng việc đó | Việc đã gắn có nhãn **Đã gắn** và không chọn được | ☐ | — | |
| 4.11 | U2 mở việc đã gắn `Chia-se.docx` (U2 xem được việc) | U2 thấy thẻ với tên tệp. Khối **Bạn chưa cho UniWork đọc tệp này.** nêu "Tệp do <tên U1> liên kết từ Google Drive của họ. UNI đọc tệp bằng tài khoản Google Drive của chính bạn, nên cần bạn cho phép một lần."; nút **Cho UniWork đọc tệp** và **Mở trên Google Drive**; dòng "Nếu Google báo bạn không có quyền, hãy nhờ chủ sở hữu chia sẻ trên Google Drive. UniWork không chia sẻ thay."; **Tạo việc từ tài liệu** và **Hỏi UNI** bị khóa với gợi ý **Cần cho UniWork đọc tệp trước** | ☐ | — | Thẻ hiện email tài khoản gắn của U1: đúng thiết kế |
| 4.12 | U2 mở danh sách **Google Drive** ở Tài liệu | Tệp `Chia-se.docx` **không** có trong danh sách của U2 | ☐ | ☐ | |
| 4.13 | U2 (đã kết nối tài khoản B, B được A chia sẻ `Chia-se.docx`) bấm **Cho UniWork đọc tệp** | Picker mở với `Chia-se.docx` đã chọn sẵn; U2 xác nhận trong Picker. Thẻ chuyển trạng thái đọc được: **Tạo việc từ tài liệu** và **Hỏi UNI** hết khóa. Danh sách Google Drive của U2 giờ có tệp, cột **Mở bằng tài khoản** là email B | ☐ | — | Chưa kết nối tài khoản nào: Picker không mở thẳng mà hiện hộp **Kết nối Google Drive** ngay tại chỗ (đúng với mã hiện tại) |
| 4.14 | U2 (tài khoản B, B **không** có quyền với `Rieng.docx`): gắn `Rieng.docx` của U1 vào một việc chung rồi U2 bấm **Cho UniWork đọc tệp** | Picker không trả được tệp; thẻ giữ trạng thái chưa đọc và hiện "Google báo tài khoản của bạn chưa có quyền với tệp này. Hãy nhờ chủ sở hữu chia sẻ trên Google Drive rồi thử lại." | ☐ | — | UniWork không tự chia sẻ trên Drive; kiểm trên Drive của A: danh sách chia sẻ của `Rieng.docx` không đổi |
| 4.15 | U1 mở menu ⋯ của thẻ › **Bỏ liên kết** | Hộp **Bỏ liên kết tệp khỏi việc này?** nêu "Chỉ xóa liên kết khỏi việc này, tệp "<tên>" trên Google Drive giữ nguyên." Xác nhận: thẻ biến mất; tệp vẫn còn trong danh sách Google Drive và trên Google Drive; Hoạt động của việc có "đã bỏ liên kết <tên> từ Google Drive" | ☐ | — | |
| 4.16 | Mở việc có thẻ `Ke-hoach-Q4.docx` ở tab 1; ở tab 2 mở trang tệp, bấm **Bỏ liên kết** | Hộp **Bỏ liên kết khỏi N việc?** với dòng "Chỉ xóa liên kết trong UniWork, tệp trên Google Drive giữ nguyên. Các việc đã tạo vẫn còn, chỉ mất liên kết về tài liệu." Bấm **Bỏ liên kết**: tệp mất khỏi danh sách; tab 1 (việc đang mở) tự bỏ thẻ không cần tải lại trang; U2 mở việc cũng không còn thẻ | ☐ | ☐ | Desktop: dòng biến mất sau khi bấm **Bỏ liên kết** ở khung chi tiết; tệp trên Google Drive vẫn còn. Nút **Bỏ liên kết** chỉ có với người liên kết hoặc quản trị viên |

## 5. UNI đọc tài liệu thật, đề xuất việc, tạo việc

Cần AI bật. Dùng U1 với tài khoản A, tệp mẫu của A. Mọi lần UNI đọc phải là nội dung thật: câu đánh dấu trong tệp (ví dụ "MA-DOCX-7H3") phải xuất hiện trong phần trích dẫn nguồn của đề xuất, không phải một đoạn mẫu cố định.

| # | Bước | Kết quả mong đợi | Web | Desktop | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| 5.1 | Mở hộp tạo việc từ chi tiết một việc đang mở (việc cha), chọn lại `Ke-hoach-Q4.docx` bằng Picker (như 4.2), bấm **Chuyển sang agent** | Hàng chọn agent được thay bằng dòng **Tạo bởi** UNI; có ô yêu cầu, chip tệp, **Dự án**, **Task con của <mã việc đang mở>**; có dòng "UNI đọc tệp bằng tài khoản <email A> rồi đưa ra danh sách việc để bạn duyệt. Chưa có việc nào được tạo trước khi bạn duyệt."; nút **Gửi cho agent** | ☐ | — | Không có chip Drive: bấm gửi hiện **Tạo bằng agent chưa khả dụng trên workspace này.** — đúng, giữ nguyên hành vi cũ. Phải mở hộp từ chi tiết một việc thì mới có chip **Task con của** và toast sub-task ở 5.4, 5.10. Tệp phải chọn lại vì 4.16 đã bỏ liên kết nó |
| 5.2 | Nhập "Giao việc cho người ghi trong tài liệu" rồi bấm **Gửi cho agent** | Nút đổi thành **UNI đang đọc tài liệu…** kèm nút **Hủy**; sau vài chục giây mở hộp duyệt **UNI đề xuất N việc từ tài liệu** (N ≤ 20) | ☐ | — | Chưa việc nào được tạo ở thời điểm này (kiểm danh sách việc) |
| 5.3 | Xem đầu hộp duyệt và nội dung | Dòng "Nguồn: Ke-hoach-Q4.docx (Tài liệu Word · <email A>)". Phần mô tả mỗi việc có "Nguồn: <mục>: "<trích>" · Ke-hoach-Q4.docx" trong đó có chữ từ tệp thật, câu đánh dấu nằm đúng ở một trích dẫn hoặc trong tên việc | ☐ | — | Không thấy câu đánh dấu mà nội dung chung chung: `Không đạt` (nghi dữ liệu giả hoặc đọc sai tệp) |
| 5.4 | Xem phần **Áp dụng cho cả lô** | Có **Dự án** (mặc định theo việc đang mở), **Task cha** (mặc định là việc đang mở; dòng phụ "Việc bạn đang mở tài liệu từ đó · có thể bỏ trống"), **Trạng thái** | ☐ | — | |
| 5.5 | Xem từng việc | Mỗi việc có công tắc "Tạo việc: <tiêu đề>", tiêu đề sửa được, người phụ trách, độ ưu tiên, ngày bắt đầu, hạn, nhãn; dưới trường UNI điền có dòng "UNI · <căn cứ>"; việc có phụ thuộc ghi "Bị chặn bởi: <tiêu đề>"; mô tả gấp mở có **Mục tiêu**, **Việc cần làm** | ☐ | — | Nhãn chỉ chọn trong nhãn có sẵn của workspace |
| 5.6 | Với việc mà tệp không nêu ngày bắt đầu | Ngày bắt đầu là hôm nay, dòng căn cứ "UNI · Không thấy ngày bắt đầu trong tài liệu, đặt hôm nay". Hạn không đứng trước ngày bắt đầu | ☐ | — | |
| 5.7 | Tạo trước một việc cùng tiêu đề với một việc đề xuất (cùng dự án và task cha) rồi chạy lại 5.2 | Việc đề xuất ghi "Có thể trùng với <mã> · <tiêu đề> đang mở." với **Bỏ việc này** và **Vẫn tạo**. Bấm **Vẫn tạo**: hiện "Đã chọn Vẫn tạo dù trùng tiêu đề." | ☐ | — | |
| 5.8 | Tắt công tắc của mọi việc | Nút ghi **Chọn ít nhất 1 việc** và bị khóa | ☐ | — | |
| 5.9 | Bấm Esc hoặc **Hủy** khi hộp đang mở | Hiện **Bỏ đề xuất này?** với "UNI sẽ không giữ lại danh sách."; **Ở lại** đóng hộp hỏi; **Bỏ đề xuất** đóng hộp duyệt và không việc nào được tạo | ☐ | — | |
| 5.10 | Chạy lại 5.2, sửa một tiêu đề, bỏ chọn một việc, bấm **Tạo N việc** | Toast "Đã tạo N việc từ Ke-hoach-Q4.docx, là sub-task của <việc cha>" kèm **Xem <việc cha>**. Các việc mới là sub-task của việc cha, hiện ở Kanban, Danh sách, Bảng, Timeline, Swimlane như việc thường; việc mới có thẻ Drive của tệp; mô tả có trích dẫn nguồn; người tạo là U1 | ☐ | — | Không có việc nào do "agent" tạo |
| 5.11 | Lặp lại với `Ngan-sach.xlsx` | Đề xuất lấy từ trang tính đầu: có "MA-XLSX-4K9"; **không** có chữ "MA-XLSX-TRANG2" | ☐ | — | |
| 5.12 | Lặp lại với `Lo-trinh.pptx` | Đề xuất có chữ trên slide, câu "MA-PPTX-2Q8" xuất hiện | ☐ | — | Ghi lại: nội dung ghi chú người nói có xuất hiện hay không |
| 5.13 | Lặp lại với Google Doc `Bien-ban-hop`, Google Sheet `Theo-doi` và `Dac-ta.pdf` | Mỗi tệp cho đề xuất có câu đánh dấu tương ứng | ☐ | — | |
| 5.14 | Chọn `Anh.png` (hoặc ODT) qua Picker (như 4.2), rồi gửi cho agent | Lỗi **UNI chưa đọc được định dạng này.** kèm lối **Mở trên Google Drive**; không tạo lô nào | ☐ | — | |
| 5.15 | Bấm **Tạo việc từ tài liệu** trên thẻ Drive (hoặc trang tệp) của `Theo-doi` | Mở hộp nhỏ **Tạo việc từ tài liệu** có dòng "UNI đọc tệp bằng tài khoản <email A>…", ô "Gợi ý cho UNI (tùy chọn)" với các gợi ý mẫu, nút **Gửi cho agent**. Hộp mở ra không tự gửi | ☐ | — | |
| 5.16 | Bấm **Gửi cho agent** trong hộp ở 5.15 | Hộp duyệt mở như 5.2; hoàn tất tạo như 5.10 | ☐ | — | |
| 5.17 | Quay lại tệp `Ke-hoach-Q4.docx` (đã tạo việc ở 5.10), bấm **Tạo việc từ tài liệu** | Cảnh báo "Tài liệu này đã được dùng để tạo N việc (lần gần nhất <ngày>, bởi <tên>). Tạo thêm có thể trùng." kèm **Xem các việc đã tạo**; nút gửi đổi thành **Vẫn gửi cho UNI** | ☐ | — | Cảnh báo cũng phải hiện ở khung agent khi tệp có trong chip |
| 5.18 | Bấm **Vẫn gửi cho UNI** | Hộp duyệt mở, có dòng "Đã tạo N việc từ tài liệu này trước đây" và nút **Xem các việc đã tạo** | ☐ | — | Không chặn: vẫn tạo được lần hai |
| 5.19 | Mở trang tệp `Ke-hoach-Q4.docx`, xem khối **Việc đã tạo từ tài liệu** | Mỗi lần tạo một nhóm "<ngày> · <tên> · N việc" với liên kết đến từng việc; tóm tắt "Đã tạo N việc từ tài liệu này". Cột **Đã tạo việc** ở danh sách ghi "N việc"; thẻ trên việc ghi "Đã tạo N việc từ tài liệu · <ngày>". Hoạt động ghi "<Bạn> đã tạo N việc từ đề xuất của UNI" | ☐ | ☐ | Desktop: khối **Việc đã tạo từ tài liệu** trong khung chi tiết; mỗi việc mở trang web của việc |
| 5.20 | Xóa một trong các việc đã tạo rồi làm mới trang tệp | Số việc đã tạo giảm, việc đã xóa không còn trong nhóm | ☐ | — | |
| 5.21 | Bấm **Hỏi UNI** trên thẻ hoặc trang tệp `Ke-hoach-Q4.docx` | Mở panel Hỏi UNI với dòng "Ke-hoach-Q4.docx — UNI đang dùng tài liệu này làm ngữ cảnh", dòng "Nội dung tài liệu xem trên Google Drive. UNI đọc tệp bằng tài khoản <email A> khi trả lời." và chân panel "UNI đọc tài liệu khi trả lời, không lưu bản sao nội dung, và cuộc trò chuyện này không được lưu." | ☐ | — | |
| 5.22 | Hỏi "Câu MA-DOCX-7H3 nằm trong phần nào của tài liệu?" | UNI trả lời đúng theo nội dung tệp thật | ☐ | — | |
| 5.23 | Đóng panel rồi mở lịch sử Hỏi UNI | Không có cuộc trò chuyện nào cho tệp này | ☐ | — | |
| 5.24 | Tùy chọn: gửi yêu cầu đọc tài liệu liên tục (hơn 10 lần trong 10 phút) | Từ lần vượt hạn mức hiện **Bạn đã nhờ UNI đọc tài liệu nhiều lần. Thử lại sau ít phút.** | ☐ | — | `Bỏ qua` được nếu tiết kiệm hạn mức AI |
| 5.25 | Tùy chọn: gửi một DOCX rất dài (trên 200.000 ký tự) | Hộp duyệt hiện nhãn **UNI chỉ đọc phần đầu tài liệu** | ☐ | — | `Bỏ qua` được nếu không có tệp dài |

## 6. Ngắt kết nối, thu hồi ở Google, kết nối lại

Chạy bằng U1. Dùng tài khoản A có tệp đã liên kết và đã gắn vào việc.

| # | Bước | Kết quả mong đợi | Web | Desktop | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| 6.1 | Cài đặt › Tích hợp › **Quản lý** › **Ngắt kết nối** ở thẻ tài khoản A | Hộp **Ngắt kết nối <email A>?** nêu "UniWork sẽ ngừng đọc tệp Google Drive qua tài khoản này. Các tệp đã liên kết vẫn ở lại trong việc với trạng thái mất kết nối; tệp trên Google Drive giữ nguyên." Xác nhận: thông báo **Đã ngắt kết nối <email A>** | ☐ | — | |
| 6.2 | Sau 6.1, xem lại tệp của A ở Tài liệu, thẻ trên việc và Hỏi UNI | Tệp vẫn còn trong danh sách, cột tài khoản/trạng thái ghi **Mất kết nối · kết nối lại**; thẻ trên việc có nhãn **Mất kết nối**; **Tạo việc từ tài liệu**, **Hỏi UNI** không chạy. UniWork **không** tự đọc bằng tài khoản B | ☐ | ☐ | Trạng thái hiện trên desktop sau khi app lấy lại focus hoặc mở lại mục Drive |
| 6.3 | Mở `myaccount.google.com` › Bảo mật › Ứng dụng và dịch vụ của bên thứ ba, đợi vài phút sau 6.1 | Ứng dụng UniWork không còn trong danh sách của tài khoản A (không còn kết nối nào dùng tài khoản này) | ☐ | — | Thu hồi chạy nền, có thể mất vài phút. Quá 15 phút vẫn còn: `Không đạt` |
| 6.4 | Kết nối lại tài khoản A (**Kết nối thêm tài khoản**, chọn A) | Thông báo **Đã kết nối lại Google Drive.** Thẻ A **Đang hoạt động**, cùng số tệp đã liên kết như trước | ☐ | — | |
| 6.5 | Sau 6.4, mở lại thẻ trên việc, danh sách, trang tệp, Picker, Hỏi UNI | Tệp truy cập lại được: hết **Mất kết nối**, **Mở trên Google Drive** đúng tài khoản A, Picker mở được, UNI đọc được, không dòng nào bị nhân đôi | ☐ | ☐ | |
| 6.6 | Trên `myaccount.google.com`, **Xóa quyền truy cập** của UniWork với tài khoản A (không đụng gì trong UniWork) | Chưa có thay đổi tức thì trong UniWork. Ghi lại thời điểm | ☐ | — | Bắt đầu đồng hồ cho 6.7 |
| 6.7 | Sau 6.6, mở trang tệp của một tệp A đã liên kết quá 10 phút, hoặc bấm **Tạo việc từ tài liệu** / **Hỏi UNI**, hoặc mở Picker bằng tài khoản A | Khi UniWork gọi Google lần kế tiếp thì kết nối chuyển **Mất kết nối**: thẻ tài khoản ở Cài đặt ghi **Mất kết nối** kèm nút **Kết nối lại**; thanh bên có dấu **Mất kết nối** cạnh tài khoản A; danh sách A ghi "Kết nối hết hạn · kết nối lại để mở các tệp này", mỗi dòng **Mất kết nối · kết nối lại**; thẻ trên việc ghi "Kết nối Google Drive <email A> đã hết hạn." với nút **Kết nối lại**; yêu cầu UNI ghi "Kết nối Google Drive đã hết hạn. Kết nối lại rồi thử lại." | ☐ | ☐ | Mã hiện tại chỉ nhận ra thu hồi khi gọi Google có lỗi từ chối; kết nối có thể vẫn **Đang hoạt động** tới lúc đó. Ghi lại phải thao tác gì và đợi bao lâu mới thấy **Mất kết nối** |
| 6.8 | Bấm **Kết nối lại** ở thẻ A rồi đăng nhập **tài khoản B** thay vì A | Thông báo "Bạn đã đăng nhập bằng tài khoản Google khác với tài khoản cần kết nối lại. Chọn đúng tài khoản <email A> hoặc dùng "Kết nối thêm tài khoản"." Thẻ A vẫn **Mất kết nối**, không thêm thẻ mới | ☐ | — | |
| 6.9 | Bấm **Kết nối lại** rồi đăng nhập đúng tài khoản A | Thông báo **Đã kết nối lại Google Drive.** Thẻ A **Đang hoạt động**; các nơi ở 6.7 trở lại bình thường sau khi làm mới | ☐ | ☐ | |
| 6.10 | Từ thẻ tệp trên việc ở trạng thái mất kết nối bấm **Kết nối lại** | Mở luồng kết nối lại đúng tài khoản của tệp (gợi ý đúng email); hoàn tất thì thẻ về bình thường | ☐ | — | Desktop chuyển sang web: xem 8.8 |
| 6.11 | Tùy chọn: ngắt kết nối A rồi kết nối lại ngay lập tức | Hoặc kết nối lại thành công, hoặc thông báo "Kết nối vừa bị ngắt ở nơi khác, hãy thử lại sau ít phút." Thử lại sau vài phút thì thành công | ☐ | — | `Bỏ qua` được; ghi lại kết quả thực |
| 6.12 | Chủ tệp bỏ quyền của B với `Chia-se.docx` (hoặc xóa tệp) trên Google Drive; U2 (đang đọc bằng B) bấm **Hỏi UNI** hoặc mở thẻ tệp sau hơn 10 phút | Thẻ của U2 ghi "Tài khoản <email B> không còn quyền với tệp này." kèm **Cho UniWork đọc tệp** (chọn lại, có thể bằng tài khoản khác) | ☐ | — | |
| 6.13 | Với tệp mà tài khoản gắn đã mất quyền: người liên kết mở trang tệp | Dòng **Tài khoản gắn** ghi "Tài khoản này không còn quyền với tệp"; có nút **Liên kết lại bằng tài khoản khác** | ☐ | ☐ | Desktop: nút này chuyển sang web |
| 6.14 | Bấm **Liên kết lại bằng tài khoản khác**, chọn một tài khoản đang hoạt động, bấm **Liên kết lại**, chọn tệp trong Picker | **Tài khoản gắn** đổi sang email mới kèm "(gắn lại bởi <tên>)"; Hoạt động có "đã liên kết lại tệp bằng tài khoản khác" | ☐ | — | |

## 7. Hai người UniWork dùng chung một tài khoản Google

U1 và U2 cùng kết nối tài khoản A.

| # | Bước | Kết quả mong đợi | Web | Desktop | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| 7.1 | U1 đã kết nối A. U2 (phiên khác) kết nối cùng tài khoản A | Cho phép, không có chặn hay cảnh báo nào. Thẻ của U2 chỉ hiện email A, trạng thái **Đang hoạt động** | ☐ | — | |
| 7.2 | U1 và U2 mỗi người chọn một tệp khác nhau qua Picker | Danh sách **Google Drive** của U1 chỉ có tệp của U1; của U2 chỉ có tệp của U2 | ☐ | — | |
| 7.3 | U1 gắn `Ke-hoach-Q4.docx` vào một việc; U2 mở việc đó | U2 thấy thẻ ở trạng thái **Bạn chưa cho UniWork đọc tệp này.** (kết nối của U1 không dùng thay cho U2) | ☐ | — | |
| 7.4 | U2 bấm **Cho UniWork đọc tệp** | Picker mở (tài khoản A) với tệp chọn sẵn; sau khi xác nhận, thẻ của U2 hết khóa; **Mở bằng tài khoản** của U2 là email A | ☐ | — | |
| 7.5 | U2 bấm **Hỏi UNI** trên thẻ | UNI đọc được tệp bằng kết nối của U2 | ☐ | — | |
| 7.6 | U1 ngắt kết nối tài khoản A | Kết nối của U2 vẫn **Đang hoạt động**, Picker và Hỏi UNI của U2 vẫn chạy. `myaccount.google.com` của tài khoản A vẫn còn ứng dụng UniWork | ☐ | — | Quyền Google dùng chung nên chưa thu hồi khi U2 còn kết nối |
| 7.7 | U2 ngắt kết nối tài khoản A | Sau vài phút ứng dụng UniWork không còn trong danh sách của `myaccount.google.com` | ☐ | — | |
| 7.8 | Mở Nhật ký hoạt động hoặc mục Hoạt động của tệp `Ke-hoach-Q4.docx` | Mỗi dòng ghi đúng người UniWork đã thực hiện (U1 hay U2) | ☐ | — | Email và mã Google của tài khoản chỉ nằm trong dữ liệu kiểm toán, không hiện trên màn hình |

## 8. App desktop

Dùng U1 trong app desktop và trình duyệt hệ thống. Chạy bước 8.1 trước mục 3 cột Desktop.

| # | Bước | Kết quả mong đợi | Web | Desktop | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| 8.1 | Mở app, vào Tài liệu | Nút **Google Drive** nằm dưới "Thư mục của tôi" kèm tổng số; dưới nó là từng tài khoản với số tệp | — | ☐ | Chỉ hiện khi tổ chức bật Google Drive và người dùng có ít nhất một kết nối |
| 8.2 | Đăng nhập một người chưa kết nối gì (U2 trước bước 3.6) | Không có nút **Google Drive** | — | ☐ | |
| 8.3 | Bấm **Google Drive** rồi từng tài khoản | Cùng danh sách, cột và tệp như web (mục 3) | — | ☐ | Khác web: không có mục dán liên kết, không có trang riêng |
| 8.4 | Chọn một dòng tệp | Khung chi tiết bên phải có tên, loại, sửa lần cuối, **Nguồn**, **Tài khoản gắn**, **Bạn mở bằng**, **Chủ sở hữu**, **Người liên kết**, **Quyền xem và sửa**: **Theo chia sẻ trên Drive**, **Đang dùng ở · N**, **Việc đã tạo từ tài liệu**, **Hoạt động trong UniWork**; nút **Mở trên Google Drive**, **Tạo việc từ tài liệu**, **Hỏi UNI**, **Bỏ liên kết** | — | ☐ | |
| 8.5 | Bấm **Mở trên Google Drive** (và nhấp đúp dòng) | Trình duyệt hệ thống mở tệp trên Google, địa chỉ có `authuser=<email Bạn mở bằng>`; app không mở cửa sổ Google trong app | — | ☐ | Cùng kết quả như 3.11 |
| 8.6 | Bấm **Thêm từ Google Drive** (và **Thêm từ <email>** khi đang ở một tài khoản) | Trình duyệt mở trang Tài liệu › Google Drive của web (có `pick=1`, kèm `account=` khi chọn tài khoản), nút **Thêm từ…** được đặt focus; Picker không tự mở. Bấm nút: Picker mở và chọn được tệp | — | ☐ | |
| 8.7 | Quay lại app sau 8.6 | Danh sách tự cập nhật tệp vừa chọn khi cửa sổ app lấy lại focus, không cần làm mới tay | — | ☐ | App không nhận tin từ máy chủ, chỉ cập nhật khi mở mục, khi lấy lại focus và sau thao tác |
| 8.8 | Bấm **Quản lý kết nối** (hoặc **Kết nối lại** ở tệp mất kết nối) | Trình duyệt mở Cài đặt › Tích hợp (có `connect=drive`) với focus ở hàng Google Drive; cửa sổ kết nối **không** tự mở. Bấm **Kết nối Google Drive** hoặc **Kết nối lại**, hoàn tất ở Google; quay lại app thì nút và trạng thái cập nhật (nút **Google Drive** xuất hiện nếu trước đó chưa có) | — | ☐ | |
| 8.9 | Ở tệp đã có việc tạo từ nó, bấm **Tạo việc từ tài liệu** | Khung hiện cảnh báo tạo lại với **Xem các việc đã tạo** và **Vẫn gửi cho UNI** trước khi chuyển sang trình duyệt. Sau đó trình duyệt mở trang tệp với hộp **Tạo việc từ tài liệu** đã mở nhưng chưa gửi (có `propose=1`) | — | ☐ | |
| 8.10 | Bấm **Hỏi UNI** | Trình duyệt mở trang tệp với panel Hỏi UNI của tệp đã mở (có `ask=1`) | — | ☐ | |
| 8.11 | Với tệp mà U2 chưa cho UniWork đọc (U2 trong app), chọn dòng | Khung ghi **Bạn chưa cho UniWork đọc tệp này.** với nút **Cho UniWork đọc tệp** chuyển sang web; hoàn tất ở web, về app thì trạng thái cập nhật | — | ☐ | |
| 8.12 | Bấm **Bỏ liên kết** ở khung chi tiết | Hộp **Bỏ liên kết khỏi N việc?** với **Giữ lại** và **Bỏ liên kết**; xác nhận thì dòng biến mất, tệp trên Google Drive vẫn còn. Người không phải người liên kết/quản trị viên không thấy nút | — | ☐ | |
| 8.13 | Với tệp mất quyền ở tài khoản gắn, bấm **Liên kết lại bằng tài khoản khác** | Chuyển sang web (trang tệp); không có Picker trong app | — | ☐ | |
| 8.14 | Đang trong phiên đã thấy nút Google Drive, ngắt mạng rồi bấm **Google Drive** | Nút vẫn còn; màn hiện **Cần kết nối mạng để xem tệp Google Drive.** kèm **Thử lại**, không hiện danh sách cũ. Bật mạng, bấm **Thử lại** thì danh sách trở lại | — | ☐ | |
| 8.15 | Ngắt mạng, thoát hẳn app rồi mở lại | Nút **Google Drive** không hiện (app chưa đọc được cấu hình), không có dữ liệu Drive nào còn trên máy | — | ☐ | |
| 8.16 | Kiểm app không giữ token Google: trong app không có nút nào mở Picker hay đăng nhập Google trong cửa sổ app | Mọi chọn tệp, kết nối, kết nối lại đều mở trình duyệt hệ thống | — | ☐ | |
| 8.17 | Mở rộng một tài khoản trong thanh bên để xem thư mục của Drive | Thấy các thư mục chứa tệp đã liên kết | — | ☐ | chưa có trên bản hiện tại: máy chủ chưa trả thư mục của tệp, tài khoản không có mũi tên mở rộng. Ghi `Bỏ qua` |

## 9. Sáng/tối, tiếng Việt/tiếng Anh

Đổi ở Cài đặt › Tùy chọn: **Giao diện** (**Sáng**, **Tối**) và **Ngôn ngữ** (**Tiếng Việt**, **English**). Các màn kiểm: hàng Google Drive và thẻ tài khoản ở Tích hợp, hộp **Chọn tài khoản Google Drive**, hộp **Liên kết N tệp**, danh sách **Google Drive**, trang tệp, thẻ Drive trên việc (cả trạng thái chưa đọc và mất kết nối), khung agent, hộp **Tạo việc từ tài liệu**, hộp duyệt.

| # | Bước | Kết quả mong đợi | Web | Desktop | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| 9.1 | Tiếng Việt + **Sáng** | Chữ đọc rõ, không bị che; mọi trạng thái (**Mất kết nối**, **Riêng tư**, "UNI · căn cứ") có chữ hoặc biểu tượng, không chỉ bằng màu | ☐ | ☐ | |
| 9.2 | Tiếng Việt + **Tối** | Như 9.1; viền, chip, thẻ, bảng đều đọc được; không có nền trắng lệch tông | ☐ | ☐ | Desktop: đổi giao diện sáng/tối của app |
| 9.3 | **English** + **Sáng** | Không còn chữ tiếng Việt lẫn trong các màn kiểm; không hiện mã chuỗi kiểu `driveLibrary.list.title_all` | ☐ | ☐ | Desktop: đổi ngôn ngữ app sang tiếng Anh |
| 9.4 | **English** + **Tối** | Như 9.3 | ☐ | ☐ | |
| 9.5 | Thu hẹp cửa sổ tới khoảng 390 px chiều rộng, mở hộp duyệt | Hộp duyệt thành màn toàn khung, nút đủ lớn để chạm, bấm **Tạo N việc** được, không có nội dung bị cắt ngang | ☐ | — | |
| 9.6 | Dùng bàn phím: Tab qua hàng Google Drive, hộp chọn tài khoản, hộp duyệt, menu ⋯ | Thứ tự Tab hợp lý, thấy vòng focus, Esc đóng hộp, mục thanh bên đang chọn được đọc là trang hiện tại | ☐ | ☐ | |

## Ký xác nhận

| Mục | Giá trị |
| --- | --- |
| Người chạy | |
| Ngày chạy | `<dd/mm/yyyy>` |
| Địa chỉ staging | `https://<staging-uniwork>` |
| Bản build web (phiên bản build, xem ở Quản trị › Hệ thống) | |
| Bản build desktop (phiên bản app và tên file cài đặt) | |
| Hệ điều hành và trình duyệt | |
| Số bước Đạt / Không đạt / Bỏ qua — web | / / |
| Số bước Đạt / Không đạt / Bỏ qua — desktop | / / |
| Kết quả chung web | ☐ Đạt ☐ Không đạt |
| Kết quả chung desktop | ☐ Đạt ☐ Không đạt |
| Ghi chú và lỗi cần sửa trước khi ra mắt | |

Kết quả chung của một nền là `Đạt` khi không còn hàng `Không đạt` và mọi hàng `Bỏ qua` có lý do mà người duyệt chấp nhận.
