# Landing: đối chiếu develop và bản Lovable

> **Trạng thái:** đã cập nhật và xác minh landing cục bộ; chưa merge develop vào nhánh landing, chưa kiểm thử backend develop đang chạy.

## Mốc đối chiếu

### Cập nhật preview ngày 2026-09-24

- Đã đăng nhập và chỉ đọc giao diện tại `https://uniwork.demo.ubos.vn/dashboard` bằng tài khoản demo người dùng cung cấp. Không lưu thông tin đăng nhập trong repo, không thay đổi dữ liệu/cấu hình nguồn.
- Landing hiện có 18 mục (thêm Dashboard): 5 kịch bản hành động và 13 cảnh tĩnh đều có chế độ xem theo bố cục Lovable; chế độ tự khám phá giữ tương tác cũ.
- Canvas 1760×1000 thu nhỏ đồng bộ theo chiều rộng, giữ menu, toolbar và cột AI trên mobile. Có mở rộng/phóng chi tiết; điều khiển thật không bị thu nhỏ.
- Đối chiếu trực tiếp Dashboard, My Space, Tasks, Projects, Meetings, Email, Chat, Documents, Work Products, Approvals, Knowledge, Workflows, People, Agent Builder và AI Assistant. Lịch/phòng họp dùng thêm ảnh người dùng gửi; Nhật ký giữ minh họa cũ. Dùng logo chung và dữ liệu tổng hợp, không sao chép nội dung riêng của tài khoản.
- Không chứng nhận giống từng pixel hoặc các chức năng đã phát hành trên develop. Các số lượng 17 mục và bố cục cũ bên dưới là ghi nhận lịch sử trước lần cập nhật này.
- Xác minh lượt này: 27 trường hợp browser khác nhau đã đạt qua các lượt chạy (không phải một lượt 27/27), gồm fit 18 mục, mở rộng/zoom, bàn phím, giữ trạng thái thủ công, click/FLIP, dừng/phát, reduced motion và tương phản Việt/Anh sáng/tối trên desktop/mobile. Đã sửa card bị cắt, khoảng trống mobile và tương phản violet/chip. Một lần kiểm tra bắt gặp khóa dịch đang hot-reload; lượt xác nhận sau khi mã ổn định đạt 6/6. TypeScript, ESLint phần sửa, 5 kiểm tra i18n, 17 kiểm tra token và `git diff --check` đạt. Không chạy gate toàn repo hoặc kiểm thử backend.

- Ngày đối chiếu source: 2026-09-22; mở rộng danh mục theo ảnh Lovable người dùng gửi ngày 2026-09-23, vẫn dùng cùng mốc source, không pull/merge thêm.
- UniWork `develop`: `26e56c4b`, đã pull fast-forward trong worktree riêng `.impeccable/references/develop`.
- Nhánh landing giữ nguyên `feature/UNI-504-trang-cong-khai-landing-page-dai-tin-cay` cùng các thay đổi chưa commit. Backend đang chạy không được cập nhật bởi bước đối chiếu này.
- Bản tham khảo: [UNIAI-TEAM/unidigiwork](https://github.com/UNIAI-TEAM/unidigiwork), commit `ccdaec2c87fbf5eb9db953b21c6ed9426a8d7cc1`, `src/routes/index.tsx` và [preview Lovable](https://unidigiwork.lovable.app).

## Thông tin được đưa lên landing

Các đường dẫn bằng chứng dưới đây thuộc mốc `develop` trên, không phải backend hiện tại của nhánh landing.

| Chức năng | Phạm vi đã thấy trong code | Bằng chứng |
| --- | --- | --- |
| Email Hub | Kết nối IMAP bằng mật khẩu ứng dụng, gửi SMTP, đọc thư, gắn sao, thư mục và tệp đính kèm | `server/internal/handler/router/email_hub.go`, `packages/views/email-hub/email-hub-view.tsx` |
| Chat Work Hub | Kênh dự án, tạo việc từ tin nhắn, liên kết việc, tùy chọn đồng bộ bình luận hai chiều | `server/internal/handler/router/chat_links.go`, `chat_channels.go` |
| Họp trực tuyến | Họp ngay/đặt lịch, liên kết mời, camera/mic, chia sẻ màn hình, người tham gia và phòng chờ | `packages/views/meetings/instant-meeting-dialog.tsx`, `meeting-conference.tsx`, `meeting-control-bar-controls.tsx`, `meeting-join-requests-panel.tsx` |
| Cuộc họp + AI | Tóm tắt quyết định, đề xuất việc, người dùng chọn người phụ trách và xác nhận tạo việc | `docs/guides/meeting-ai-tasks.md`, `server/internal/handler/router/meetings.go` |
| Home | Việc cá nhân, cuộc họp sắp tới, hộp việc; bản tổng hợp tính từ dữ liệu, không phải LLM | `packages/views/home/home-view.tsx` |
| Công việc | Chế độ bảng trạng thái, danh sách và bảng dữ liệu; lọc/nhóm | `packages/views/tasks/surface/task-surface.tsx`, `packages/views/tasks/modes/table-view.tsx` |
| Dự án | Phạm vi dự án, thuộc tính, người phụ trách, tài nguyên; board/list/table/gantt/swimlane | `packages/views/projects/project-detail-page.tsx`, `project-properties.tsx`, `project-resources-section.tsx` |
| Thành viên và quyền | Thành viên, lời mời, vai trò, chuyển quyền sở hữu, quản lý truy cập cấp tổ chức/workspace | `packages/views/settings/components/organization-tab.tsx`, `members-tab.tsx` |
| Nhật ký hoạt động | Nhật ký audit, chi tiết, xuất dữ liệu và truy vết | `packages/views/settings/components/audit-tab.tsx`, `audit-log.tsx`, `audit-detail-sheet.tsx` |
| Nhân sự AI (một phần) | API danh tính agent, người chịu trách nhiệm và thành viên workspace; không phải bộ chạy tự chủ | `server/internal/handler/router/agents.go` |
| Điều kiện khả dụng | Home, Chat Work Hub và AI họp có feature flag; mô hình AI, email và ghi hình cần cấu hình | `server/internal/featureflags/keys.go`, hướng dẫn cuộc họp, màn hình kết nối email |

Đây là đối chiếu source, không phải xác nhận các dịch vụ đã được bật hoặc kiểm thử tích hợp trên develop. Một số mô tả PRODUCT/roadmap cũ vẫn xếp toàn bộ Email Hub vào kế hoạch; phạm vi IMAP/SMTP trong code mới được ưu tiên hơn mô tả đó.

## Bố cục áp dụng

Giữ nhận diện, lõi 3D và linh vật ngựa. Một khung sản phẩm có sáu **nhóm chức năng** bên trái và một màn hình bên phải, thay cho sáu chức năng đơn lẻ. Chỉ nhóm đang chọn mở các mục con. Trên mobile, sáu nhóm thành lưới 3×2, danh sách mục con của nhóm đang chọn nằm ngay bên dưới; bảng công việc chỉ cuộn ngang bên trong. Không thêm lại mục lục thẻ, bộ chọn trùng trong hero hay các phần Họp/Chat/Email riêng.

| Nhóm | Mục trong khung chung | Phân biệt khả dụng |
| --- | --- | --- |
| Công việc & dự án | Công việc, Dự án, Hôm nay, Lịch, Quy trình | Lịch tổng hợp và Quy trình là định hướng; đặt lịch cuộc họp và xuất iCalendar đã có |
| Trao đổi | Họp trực tuyến, Trao đổi, Email Hub | Điều kiện feature flag/cấu hình vẫn hiện cạnh demo |
| Kết quả | Kết quả công việc, Tài liệu, Phê duyệt kết quả | Luồng dự kiến, không mô phỏng như module đã dùng được; rich text và tài nguyên dự án là phạm vi riêng đã có |
| Tri thức | Kho tri thức | Luồng dự kiến, không quảng bá Work Graph đã triển khai |
| AI & tự động hóa | Hỏi UNI, Nhân sự AI, Tự động hóa | Hỏi UNI chỉ đọc; Nhân sự AI có một phần nền tảng; Tự động hóa còn kế hoạch |
| Tổ chức | Thành viên & quyền, Nhật ký hoạt động | Demo cục bộ dựa trên phạm vi có trong source |

Tổng cộng 17 mục: 9 mục minh họa phạm vi hiện có, 1 mục có một phần và 7 mục định hướng. Đây không phải 17 chức năng được xác nhận hoạt động trên backend hiện tại. Các màn hình kế hoạch có thông báo “Chưa triển khai”, luồng dự kiến và liên kết đến lộ trình, không có nút giả để tạo/phê duyệt/thực thi. Không suy diễn AI Project Copilot, báo cáo AI hay bộ thiết kế workflow là đã phát hành chỉ từ ảnh Lovable.

Tìm kiếm nằm trong Công việc, hộp việc nằm trong Hôm nay. Chuyển tab đổi nội dung tại chỗ và giữ trạng thái; tạo việc từ chat thêm một việc minh họa vào bảng. Nút đặt lại chung xóa các thay đổi cục bộ của toàn bộ demo. Các hash `#du-an`, `#hop`, `#trao-doi`, `#email`, `#hoi-uni`, `#daily-tools` mở đúng tab trong `#platform`; `#nhan-su-ai` vẫn là phần linh vật. Tab dùng hướng dọc và phím lên/xuống trên desktop, hướng ngang trên mobile. Mỗi màn hình có điều kiện khả dụng riêng, không nhắc lại toàn bộ lời giới thiệu.

Lượt tinh gọn theo phản hồi: bỏ sơ đồ luồng bốn bước và sáu demo lặp trong explorer; giữ ba nhà cung cấp AI nhưng bỏ bốn cam kết lặp lại phần bảo mật. Gom Work Products/Work Graph thành một mục trong lộ trình, bỏ hai dòng trùng khỏi nhóm đang phát triển. Phim sau họp chuyển vào mục mở rộng để phòng họp trực tuyến là nội dung chính. Xóa component `problem.tsx` cùng CSS không còn dùng; nội dung thiết kế cũ vẫn có thể đối chiếu lịch sử Git.

Phòng họp là mô phỏng cục bộ: mic/camera/chia sẻ/danh sách người tham gia có trạng thái tương tác, không xin quyền thiết bị, không thu âm, không gọi API cuộc họp. Avatar chữ không phải video thật. FAQ Việt/Anh phân biệt Hỏi UNI chỉ đọc, đề xuất tạo việc cần xác nhận và bộ chạy agent còn trên lộ trình; không cam kết mọi thao tác đều hoàn tác, vị trí lưu trữ cố định hay miễn phí không giới hạn.

Không mang form Supabase, router TanStack, chatbot bán hàng hoặc claim chưa được chứng minh từ Lovable sang ứng dụng Next/Go. Không sử dụng hình Email cũ có chữ AI tóm tắt vì không đúng phạm vi IMAP/SMTP đã kiểm tra.

Các preview mới dùng dữ liệu minh họa trong bộ nhớ, không gọi API nghiệp vụ. Scroll reveal dùng cơ chế hiện có, có reduced motion và hoàn thành ngay khi nhận focus. Các bản Việt/Anh được cập nhật cùng nhau.

## Lượt preview tự diễn — 2026-09-23

Lượt tự diễn ban đầu dùng các nhịp chung cho nhiều chức năng. Theo phản hồi về tính thực tế, bản này đã được thay bằng năm kịch bản đối chiếu với source develop `26e56c4b`:

- Công việc: mở chi tiết → mở danh sách người phụ trách → chọn Hoàng Anh → chỉ cập nhật người phụ trách, giữ `in_progress`. Không tự thêm bình luận hoặc hoàn thành công việc.
- Họp: từ menu Thêm đã mở → chọn cửa sổ trong bước hệ thống được ghi rõ là minh họa → xác nhận chia sẻ → nội dung xuất hiện cạnh người tham gia. Không xin quyền hoặc dùng thiết bị thật.
- Chat: menu tin nhắn → tạo việc → kiểm tra tiêu đề lấy từ tin nhắn, dự án/người phụ trách tùy chọn → trạng thái đang tạo → công việc mới liên kết với tin nhắn. Kịch bản này có năm bước; các kịch bản khác có bốn bước.
- Email: mở một thư → gắn sao → ngôi sao xuất hiện ở chính thư đó trong danh sách và phần chi tiết. Nội dung, người gửi không bị đổi theo nhịp.
- Hỏi UNI: gửi câu hỏi trong bảng bên phải → chờ câu trả lời → đọc đáp án và nguồn `[S1]` → chuyển sang bản minh họa công việc gốc để đối chiếu. Chỉ đọc, không thay đổi công việc.

Con trỏ được đặt theo vị trí phần tử mục tiêu trong từng cảnh, không dùng chung tọa độ phần trăm cho mọi chức năng. Đây là phim minh họa bằng UI, không phải quay màn hình hay agent điều khiển ứng dụng.

Nút “Tự khám phá” chuyển sang các tương tác cục bộ đã có; “Xem demo” quay lại chuỗi tự diễn. Hai chế độ không ghi đè dữ liệu của nhau. Chỉ scene đang chọn được phát; dừng khi ra ngoài màn hình/ẩn tab, giữ thời gian còn lại khi dừng, bắt đầu tĩnh nếu người dùng bật giảm chuyển động. Không thêm API nghiệp vụ hay quyền thiết bị.

Chỉ năm mục trên có chế độ tự diễn. Mười hai mục còn lại giữ bản tương tác/tĩnh và điều kiện khả dụng đã có; các mục trên lộ trình không tự diễn thực thi. Nền tảng agent vẫn ghi “Có một phần”. Tổng phạm vi 9/1/7 không đổi. Phim không chứng minh backend develop đang chạy hoặc chức năng kế hoạch đã phát hành. Từ Hôm nay/Dự án, liên kết tới việc hoặc cuộc họp mở bản tương tác tương ứng, không tự chuyển sang phim.

Khung preview dùng một đường bao chung cho thanh chức năng và màn hình sản phẩm; nền sáng, trạng thái cobalt và các lớp chi tiết có thứ bậc. Giữ Be Vietnam Pro, token sáng/tối và logo dùng chung. UI/UX Pro Max được cập nhật từ nhánh `main` của `nextlevelbuilder/ui-ux-pro-max-skill` ngày 2026-09-23; bản trước được giữ ở thư mục sao lưu skill ngoài repo.

Linh vật dùng ảnh WebP và logo UniWork chính thức trên áo, với chuyển động 2.5D. Bản thử mô hình 3D sau đó đã bị người dùng từ chối vì không giống nguyên bản; hiện dùng lại chính ảnh gốc với chuyển động tay giới hạn riêng. Không tạo video AI mới.

## Lượt đồng bộ hướng giao diện Lovable — 2026-09-23

Người dùng xác nhận bảy ảnh mới là bản Lovable, phần lớn giao diện develop sẽ cập nhật theo hướng này trong tương lai. Vì vậy, ảnh chỉ làm chuẩn bố cục cho landing, không xác nhận tính năng đã phát hành. Không pull/merge thêm develop trong lượt này và không sửa UI sau đăng nhập.

- Demo Công việc dùng bảng ba cột, chỉ số tổng quan và chi tiết người phụ trách; trên mobile tập trung cột đang xử lý, không cắt thẻ công việc. Phần footer của trang không còn áp padding lên footer thẻ và hộp thoại demo.
- Phòng họp dùng nền tối, lưới người tham gia, thanh điều khiển dưới và khung trao đổi bên phải trên desktop. Avatar chữ vẫn là minh họa, không phải video thật. Luồng chọn nguồn/xác nhận chia sẻ giữ nguyên; chế độ tự khám phá dùng cùng hệ màu tối.
- Email Hub có cấu trúc thư mục → danh sách → nội dung; màn hình nhỏ xếp theo chiều dọc. Không thêm trợ lý AI email, gửi thư hoặc kết nối tài khoản thật.
- Hôm nay gom công việc, thông báo và lịch sắp tới. Mỗi liên kết công việc mở đúng dữ liệu minh họa tương ứng, không tự chạy hành động khác. Các hàng và tổng số việc dùng chung state với bảng công việc: hoàn thành, mở lại và đặt lại đều cập nhật đồng bộ.
- Lịch có hình giao diện tháng minh họa, vẫn nằm trong mục “Chưa triển khai”. Nhãn thứ Việt/Anh được khai báo cố định trong i18n để tránh sai khác ICU giữa server và trình duyệt gây lỗi hydration. Không bổ sung Dashboard hay AI Project Copilot dưới dạng tính năng đang có.
- Phần giải pháp dùng ba hàng nội dung có liên kết thay cho ba thẻ màu. Tiêu đề, giới hạn Hỏi UNI, các mục mở rộng và linh vật nằm chung một khung cyan; lượt này vẫn giữ hình ngựa/logo và cơ chế chuyển động tại thời điểm đó.
- Bảo mật có ví dụ nhật ký đổi người phụ trách, sáu mục giải thích cô đọng và dải nhà cung cấp không tương tác. Lộ trình chia hai cột, Starter và các hạng mục sử dụng cùng một khung, FAQ dùng hàng phân cách; CTA cuối dùng nền navy đồng nhất.

Phạm vi 17 mục (9 demo / 1 một phần / 7 kế hoạch) và năm kịch bản tự diễn không đổi. Mọi dữ liệu mới là dữ liệu mẫu cục bộ, không ghi API. Giữ theme, Việt/Anh, bàn phím và reduced motion; UI/UX Pro Max hướng dẫn thứ bậc, khả năng đọc và tính nhất quán, không thay nhận diện UniWork bằng bảng màu/font mẫu của skill.

## Bản thử UNI 3D trên landing — đã được thay thế

- Khối Nhân sự AI vẫn giới thiệu cùng giới hạn Ask UNI đọc theo quyền và không tự ghi. Giao diện dùng nền cyan/violet, nhóm giải thích có ranh giới rõ và một sân khấu cho UNI; nội dung và chức năng ứng dụng sau đăng nhập không đổi.
- Ảnh ngựa phẳng không còn bị uốn bằng shader. UNI được dựng bằng các khối Three.js tách đầu/mắt/mõm khỏi khớp tay vẫy và đuôi, nên cử động tay không kéo méo khuôn mặt. Logo trên áo dùng đúng hình học mark được sinh từ thư viện thương hiệu; ảnh WebP cũ và Logo component vẫn là fallback khi WebGL lỗi. Khung lời chào có trạng thái ban đầu rõ ràng.
- Chuyển động bắt đầu gần vùng nhìn, dừng khi ra ngoài màn hình/ẩn tab hoặc người dùng nhấn dừng; `prefers-reduced-motion` mặc định tĩnh. Không giới thiệu mô hình 3D này như chức năng AI của sản phẩm và không thay dữ liệu demo.

## Khôi phục đúng tạo hình UNI nguyên bản — 2026-09-23

Người dùng yêu cầu giữ giống nguyên bản 2.5D, không chấp nhận mô hình xấp xỉ. Đã bỏ mô hình procedural và dùng lại nguyên file `uni-horse-v2.webp`, không sửa ảnh, màu, khuôn mặt, tỷ lệ hay chất liệu. Logo chính thức vẫn là lớp DOM cố định trên áo. Chỉ vùng tay được vẫy nhẹ với mask loại trừ mặt và bờm; thân, đuôi và biểu cảm giữ nguyên, không trộn ảnh chớp mắt. Dừng chuyển động trả lại tư thế gốc. Giữ khung AI mới cùng các cơ chế reduced motion, tạm dừng ngoài màn hình và fallback. Đây là chuyển động 2.5D của ảnh đã duyệt, không gọi là mô hình 3D tái tạo giống nguyên bản.

## Menu và phần mở đầu — 2026-09-23

Làm mới riêng menu và hero theo Bright Studio: thanh điều hướng nổi, danh mục nhanh cho công việc/họp/chat/email/Hỏi UNI, tiêu đề và CTA căn giữa, lõi công việc 3D cùng bốn nhãn ngữ cảnh. Giữ đường dẫn thật, bộ chọn Việt/Anh và sáng/tối, logo chính thức; không đổi linh vật 2.5D đã duyệt hoặc các chức năng sau đăng nhập. Menu hỗ trợ Tab, Escape trả focus, đóng khi chọn mục hoặc bấm ra ngoài; thu gọn ở dưới 1100px.

Hiệu ứng vào trang ngắn dùng opacity/translate; chuyển động lõi vẫn có dừng/phát, tuân thủ reduced motion. Nút chuyển động nằm ở hàng chú thích riêng, không che nhãn tính năng. Mobile tách nhãn minh họa và mô tả thành hai dòng. Không thêm số liệu hoặc cam kết sản phẩm.

Kiểm tra riêng lượt này: 6 ca opening đạt ở 1440/1280/768/390px, Việt/Anh, sáng/tối, điều hướng bàn phím, không tràn ngang, chú thích và nút không chồng lên nhãn, dừng/phát và đổi reduced motion; 5 ca `landing.spec.ts` đạt, gồm độ tương phản; 1 ca điều khiển 3D/phim/reduced motion đạt. TypeScript web, ESLint phần sửa, 5 ca i18n parity/resource sync và 15 ca token contract đạt. Cỡ chữ hero mới nằm trong các role của `tokens.css`, không khai báo riêng tại component. Ảnh đối chiếu ở `.impeccable/review/opening-*`. Không phải gate toàn repo; `make check` chưa chạy được do môi trường thiếu `make`.

## Tinh giản ba vùng landing — 2026-09-23

Hero rút còn “Cả nhóm. Một workspace.” / “Your team. One workspace.”, một câu mô tả và một CTA. Giảm cỡ tiêu đề, chiều cao lõi minh họa và bốn nhãn xuống tên chức năng; bỏ dòng ngôn ngữ lặp lại. Không thay menu, lõi chuyển động hoặc linh vật đã duyệt.

Bảo mật gom sáu thông tin thành ba nhóm mở rộng: Quyền truy cập & AI, Lịch sử thay đổi, Sử dụng & riêng tư. Bên cạnh là một ví dụ nhật ký với người thực hiện, thay đổi trước/sau, phạm vi và liên kết khám phá. Giữ nguyên nội dung và giới hạn của cả sáu thông tin; các hàng có chiều rộng ổn định khi mở bằng bàn phím.

CTA cuối thành dải gọn với “Sẵn sàng cùng làm việc?” / “Ready to work together?” và một nút bắt đầu. Bỏ logo, mô tả, nút đăng nhập và chú thích ngôn ngữ lặp lại tại đây; đăng nhập và đổi ngôn ngữ vẫn có trên header. Đồng bộ phần thay đổi vào `apps/web/DESIGN.md` và sidecar thiết kế.

Kiểm tra lượt tinh giản: 6 ca opening, 4 ca distill, 5 ca landing và 2 ca scroll liên quan đạt qua các lượt riêng; gồm desktop/mobile, Việt/Anh, sáng/tối, tương phản, bàn phím, reduced motion và không tràn ngang. Đã xem ảnh `.impeccable/review/distill-*`, xác nhận lại hai ảnh bảo mật sau chỉnh hàng mở rộng. TypeScript web, ESLint các component sửa và 5 ca i18n parity/resource sync đạt. Không diễn giải đây là gate toàn repo; môi trường vẫn thiếu `make`.

15 ca token contract đạt; JSON sidecar hợp lệ và `git diff --check` không báo lỗi.

## Hai lớp điều hướng trong preview — 2026-09-24

Theo ảnh ClickUp người dùng cung cấp, menu khám phá chức năng được tách khỏi cửa sổ ứng dụng minh họa. Bên trong cửa sổ có thanh navy gồm Hôm nay, Công việc, Trao đổi, Tài liệu, AI và Tổ chức. Hai lớp dùng chung lựa chọn và hash, chỉ có một preview hiện ra; bấm lại nhóm ứng dụng đang chọn giữ nguyên chức năng con. Menu ngoài vẫn có sáu nhóm và đủ 17 mục. Đây là thay đổi landing, không sửa sidebar sau đăng nhập hay trạng thái tính năng trong code develop.

Menu ngoài rộng 204px, còn 176px dưới 1100px; thanh trong rộng 76px/68px. Dưới 900px menu ngoài nằm trên cửa sổ; dưới 600px thanh trong thành hàng ngang. Giữ dữ liệu demo, nút xem/tự khám phá, bàn phím, reduced motion và giới hạn quyền đã ghi. UI/UX Pro Max được dùng để phân biệt trạng thái đang chọn; Impeccable layout giữ hai vai trò điều hướng riêng nhưng cùng một màn hình nội dung.

TypeScript web, ESLint các component sửa và 5 ca i18n đạt. Bộ dual-navigation + workspace đầu đạt 7/7 ở 1440/768/390px; hai kiểm tra tương phản sáng/tối cùng ca giao người phụ trách đạt 3/3. Đã xem ảnh Việt desktop/tablet/mobile và Anh dark desktop/mobile trong `.impeccable/review/dual-navigation-*`. `make check` chưa chạy được vì thiếu `make`.

Lượt xác nhận dual-navigation + realism đạt 11/12; ca email bị race giữa đồng hồ giả và lúc preview sẵn sàng. Đã thêm điều kiện chờ đúng preview vào màn hình và xác nhận đang phát trước khi tiến đồng hồ; chạy lại ca email đạt 1/1, không đổi logic phát hay nới assertion nội dung. Tổng 18 ca browser khác nhau có kết quả đạt qua các lượt riêng (5 điều hướng mới, 4 workspace, 7 realism, 2 tương phản), không phải một lần chạy 18/18. `git diff --check` và JSON sidecar hợp lệ.

## Không quảng bá như đã có

Lượt làm mới ba chương landing theo phản hồi tiếp theo: Solutions chuyển từ ba hàng chữ sang bộ chọn nhóm có một preview UniWork thay đổi theo lựa chọn; Roadmap đặt sơ đồ Work Products/Work Graph minh họa cạnh thông điệp kế hoạch và vẫn giữ nhãn chưa phát hành; FAQ có khối nhận diện và các câu trả lời dễ quét hơn. Đây là trình diễn thị giác cho trang giới thiệu, dựa trên định hướng Lovable, không sửa chức năng đã đăng nhập hoặc đổi phân loại 9 demo / 1 một phần / 7 kế hoạch. Hiệu ứng xuất hiện một lần khi cuộn, tắt theo reduced motion; các disclosure và liên kết vẫn thao tác được.

Lượt làm mới tiếp theo theo hai ảnh phản hồi: khung giới thiệu chức năng giữ một bộ chọn và một preview nhưng chuyển thành sân khấu cyan/violet với thanh nhóm navy, cửa sổ sản phẩm có chiều sâu và bố cục tablet xếp bộ chọn phía trên ở ≤900px. Starter giữ đúng một gói miễn phí hiện tại, một CTA và tám hạng mục được theo dõi; trình bày lại thành mảng navy có logo UniWork chính thức bên cạnh bảng hạng mục dễ quét. Cảnh báo về các gói/hạn mức chưa chốt vẫn hiện rõ. Đây chỉ là thay đổi trình bày landing, không mở quyền dùng tính năng hay sửa ứng dụng đã đăng nhập.

Lượt tinh chỉnh Starter/FAQ theo hai ảnh tiếp theo: Starter thêm sơ đồ tín hiệu Thành viên–Họp–AI cạnh logo; FAQ thay dấu hỏi phóng lớn bằng mạng Công việc–Hỏi UNI–Tài liệu quanh logo UniWork. Các đường tín hiệu chạy một lượt ngắn (tối đa 4,5 giây), chỉ khi phần tương ứng ở trong khung nhìn và tab đang hiện, tắt với reduced motion; tám hạng mục Starter xuất hiện ngắn theo thứ tự mà chữ không bị làm mờ. Không đổi nội dung gói, hạn mức, câu trả lời FAQ, CTA hay chức năng ứng dụng đã đăng nhập.

- AI tóm tắt/trả lời email, Gmail OAuth và Microsoft Graph.
- Work Graph, Work Products, kho tri thức đầy đủ và bộ chạy agent tự thực thi.
- KPI tự động, thay thế một số lượng công cụ cố định hoặc cam kết triển khai trong ngày.

Các mục này vẫn là kế hoạch. Thông tin đối chiếu này thay thế các claim Email cũ trong tài liệu ánh xạ landing ban đầu; không thay thế roadmap kỹ thuật của nhóm.

## Kiểm tra cục bộ

- Lượt khôi phục tạo hình gốc: TypeScript web, ESLint component/renderer, 3 kiểm tra provenance/logo và 7 kiểm tra Chrome liên quan đạt. Ca mới xác nhận đúng asset gốc, tay có chuyển động nhưng vùng mặt không đổi hình học; sai số màu từng kênh tối đa 1/255 do compositor. Các ca còn lại kiểm tra logo, desktop/mobile, dừng/tiếp tục, nghỉ ngoài màn hình, reduced motion và fallback. Đã xem hai ảnh `uni-original-desktop.png`/`uni-original-mobile.png`. JSON sidecar và `git diff --check` hợp lệ; chưa chạy gate toàn repo vì Windows không có `make`.
- Lượt nâng cấp UNI 3D: TypeScript web và ESLint các component/renderer sửa đạt; i18n parity 1/1 đạt. Bộ Chrome `landing-scenes`, `landing-motion`, `landing-playback` đạt 20/20; sau chỉnh lời chào/bố cục mobile, `landing-scenes` + `landing` đạt 9/9 (gồm tương phản WCAG AA sáng/tối). Hai ảnh khối UNI 1440px/390px đã được mở xem; mô hình không cắt chân, mặt giữ nguyên khi chào và lời chào có trạng thái đầu. `design.json` hợp lệ, `git diff --check` cho file theo dõi đã sửa đạt. Không tải thêm browser Playwright; dùng Chrome cài sẵn qua `PLAYWRIGHT_CHANNEL=chrome`.
- Lượt tinh chỉnh Starter/FAQ: TypeScript web và ESLint các component sửa đạt; 24/24 ca trong `landing-motion`, `landing-scroll`, `landing-reference` và `landing` đạt ở lượt chạy lại sau khi bổ sung nền đặc cho gradient Starter để bộ đo tương phản đọc đúng. Ca mới kiểm tra animation chỉ chạy trong khung nhìn, dừng ngoài màn hình và tắt dưới reduced motion; FAQ vẫn mở được. Sau lượt đó, đường tín hiệu được giới hạn một lượt dưới 5 giây để không cần nút dừng bổ sung; ca motion/tương phản liên quan được chạy lại. Đã xem ảnh 1440px/390px, sáng/tối, không tràn ngang hoặc lỗi trang. `git diff --check` và JSON sidecar hợp lệ; `make check` không chạy được vì môi trường Windows này không có lệnh `make`.
- Lượt làm mới preview/Starter: TypeScript web và ESLint các component liên quan đạt; bộ `landing-playback`, `landing-reference`, `landing-workspace` đạt 17/17 trước chỉnh breakpoint tablet. Sau chỉnh ngưỡng ≤900px, `landing-workspace` đạt 4/4 (gồm ca mới cho bố cục 768px, cuộc họp, một CTA Starter và tám hạng mục); `landing-scroll` + `landing` đạt 12/12 (i18n, bàn phím, reduced motion, tương phản sáng/tối). Đã xem ảnh 1440/768/390px, hai chế độ màu, không tràn ngang; `git diff --check` và JSON sidecar hợp lệ. Không cộng các lượt chồng lặp thành một tổng ca duy nhất.
- Lượt làm mới Solutions/Roadmap/FAQ: TypeScript và ESLint các component sửa đạt; `landing.spec.ts` đạt 5/5 (chọn nhóm, điều hướng, FAQ, tương phản sáng/tối). `landing-motion.spec.ts` đạt 6/6. Lượt `landing-scroll.spec.ts` đầu đạt 5/7 và phát hiện tương phản nhãn minh họa/chiều rộng icon FAQ; đã sửa nguyên nhân, chạy lại ba ca liên quan đạt 3/3. Ảnh desktop/mobile và dark mode được kiểm tra, không tràn ngang ở 1440px/390px. Không diễn giải đây là một lượt 13/13 liên tục.
- Lượt đồng bộ hướng giao diện Lovable: 30/30 ca browser trong `landing-reference`, `landing-realism`, `landing-playback`, `landing-scroll`, `landing` đạt. Hai ca cấu trúc mới kiểm tra desktop 1440px/mobile 390px, không có lỗi hydration, thẻ công việc nằm trọn khung, đích liên kết từ Hôm nay và các phần cuối landing. Giữ kiểm tra tương phản Việt/Anh sáng/tối, tự diễn, reduced motion và bàn phím.
- Sau rà soát độc lập: đã sửa hai phát hiện về liên kết bỏ qua nội dung và trạng thái Hôm nay. Liên kết nằm ngoài viewport khi không focus nhưng bị compositor đưa vào ảnh chụp vùng dài; CSS thực tế bổ sung clip khi ẩn và bỏ clip khi focus, không che bằng stylesheet chụp ảnh. Reviewer chấm cả hai phát hiện resolved; kết luận này chỉ áp dụng danh sách sửa, không phải xác nhận toàn bộ sản phẩm.
- Lượt xác nhận bổ sung: toàn bộ `landing-realism` đạt 7/7 sau chỉnh điều kiện khởi tạo của test email. `apps/web/DESIGN.md` và sidecar `apps/web/.impeccable/design.json` đã đồng bộ các bố cục mới; giữ nguyên chuẩn thương hiệu, token và asset/chuyển động. JSON và ánh xạ nội dung tài liệu được kiểm tra; `git diff --check` đạt.
- Bộ xác nhận cuối `landing-reference`: 5/5 đạt (hai chiều rộng, hoàn thành/mở lại/reset, Tab hiện skip link và ẩn lại sau blur). Bộ hồi quy 28 ca đạt 27 ca, ca email gặp race với lần remount của Providers sau auth/config; test đã chờ cây cuối trước khi cài đồng hồ, chạy lại ca email đạt 1/1. Tổng cộng 33 ca khác nhau đã có kết quả đạt qua các lượt này, không mô tả là một lượt 33/33. TypeScript và ESLint phần sửa cuối đạt. Toàn bộ 24 ảnh bố cục và 6 ảnh trạng thái/focus mới đã được mở kiểm tra.
- TypeScript web, ESLint 11 component landing và 5 ca i18n parity/resource sync đạt bằng executable trong `node_modules`. Lệnh `pnpm` thông thường gặp `fetch failed` ở launcher; không coi lần gọi đó là kiểm tra đạt. `make check` vẫn không chạy được vì thiếu `make`.
- Kiểm tra artwork/nhà cung cấp/linh vật trong lượt này: 10/10 đạt; không thay ảnh hoặc checksum. Ảnh đối chiếu bố cục tại `.impeccable/review/reference-*-1440.png` và `reference-*-390.png`.
- TypeScript web và ESLint các component sửa: đạt.
- i18n parity/resource sync: 5 kiểm tra đạt.
- Shared UI: 64 kiểm tra đã đạt ở lượt gom workspace trước; primitive Tabs không đổi trong lượt mở rộng danh mục ngày 2026-09-23.
- Lượt mở rộng danh mục: 41 trường hợp browser landing đạt (18 danh mục/tương tác/hiển thị + 23 hồi quy). Sau khi rút gọn chú thích kỹ thuật, lượt xác nhận mobile Việt với 17 mục trong cả hai chế độ màu: 1/1 đạt.
- Có kiểm tra tương phản sáng/tối, Việt/Anh, cả 17 mục trên desktop/mobile, không tràn ngang, thao tác demo không ghi API, scroll reveal, reduced motion, bàn phím từng nhóm và giữ/reset trạng thái khi đổi tab.
- Đã xem ảnh Dự án và Tài liệu desktop/mobile, Nhật ký dark English; xác nhận lại Tài liệu mobile sau chỉnh câu chữ. Ảnh trong `.impeccable/review/catalog-*`.
- `git diff --check`: không có lỗi. Ở lượt mở rộng danh mục trước, artwork, logo, linh vật và media không thay đổi.
- Lượt preview tự diễn ban đầu (trước khi sửa tính thực tế): bộ browser 50 ca chạy được 49 ca, một ca tương phản timeout vì hiệu ứng chữ ngắn bị giữ ở trạng thái pause. Đã sửa component để chữ hiện trọn khi dừng/ra ngoài màn hình; chạy lại toàn bộ `landing.spec.ts` và `landing-playback.spec.ts`: 14/14 đạt, bao gồm ca timeout. Không nới phép đo tương phản.
- Ở lượt ban đầu, các kiểm tra bao gồm tự phát theo bước, giao người phụ trách, dừng/tiếp tục, nghỉ ngoài màn hình, reduced motion, giữ dữ liệu thao tác tay, logo dùng chung trên áo, cả 17 mục ở desktop/mobile Việt/Anh sáng/tối và bước cuối của chín kiểu scene cũ không bị cắt dọc. Ảnh lịch sử ở `.impeccable/review/playback-*` và `branded-horse-*`; số scene này không mô tả bản hiện tại.
- TypeScript web, ESLint phần landing sửa, 5 kiểm tra i18n và 12 kiểm tra artwork/logo/media đạt trong lượt tự diễn. Hai ảnh ngựa giữ nguyên nội dung và checksum; phần mới là lớp logo và chuyển động khi render.
- Lượt sửa tính thực tế ngày 2026-09-23: `landing-playback.spec.ts` và `landing-realism.spec.ts` đạt 16/16 trong lần chạy cuối. Kiểm tra cả năm kịch bản, trạng thái đang tạo trước khi liên kết việc từ chat, đích nguồn của Hỏi UNI, điều hướng thủ công từ Hôm nay/Dự án, và giới hạn hộp thoại ở mọi bước tại 1440px/390px. Cả 17 mục được đo tương phản Việt/Anh, sáng/tối, desktop/mobile. Không biến chức năng kế hoạch thành demo tự thực thi.
- Lượt hồi quy rộng trước đó đạt 36/37: 21 ca motion/scroll/workspace/landing đạt; một ca storyboard bắt đầu đồng hồ trước khi preview thực sự vào màn hình. Đã đồng bộ điều kiện hiển thị trong test, giữ nguyên phép kiểm tra, và xác nhận bằng lượt 16/16 trên. TypeScript web, ESLint phần sửa, 5 kiểm tra i18n và 12 kiểm tra artwork/logo/media tiếp tục đạt.
- Đã xem ảnh cuối `.impeccable/review/realism-*`: hero sau khi lõi 3D tải xong, hộp thoại chat/chọn cửa sổ và trang nguồn Hỏi UNI ở desktop/mobile. Đã sửa hộp thoại mobile bị cắt bên phải bằng grid track co giãn và giới hạn chiều rộng của dialog, không chỉ kiểm tra tràn ngang toàn trang.
- Chưa chạy được gate toàn repo: Windows thiếu `make`; script legacy-token dùng `grep` cũng không chạy được. Không coi đây là xác nhận backend develop đã chạy.
- CLI UniAI không kết nối được máy chủ nên chưa ghi được bình luận kết thúc vào UNI-504. Không đổi trạng thái issue, không commit/push.

## Trang giới thiệu riêng từ menu — 2026-09-24

Menu Sản phẩm, Giải pháp và Tìm hiểu mở danh mục; Nhân sự AI, Giá và Doanh nghiệp dẫn tới trang riêng. Sáu nhóm sản phẩm có đủ 18 đường dẫn `/features/[slug]`, cùng `/features`, `/solutions`, `/learn`, `/pricing` và `/enterprise`; giữ các trang giải pháp và `/why-uniwork` hiện có. Chỉ liên kết ghi rõ xem demo trong menu dẫn về phần minh họa trên trang chủ. Menu desktop bắt đầu từ 1200px; mobile dùng nhóm details/summary. Nhân sự AI ở đầu và cuối trang cùng dẫn tới `/features/agents`.

Mỗi trang chức năng có thông điệp riêng, CTA, thông báo trạng thái, một preview Lovable có sẵn, ba lợi ích và liên kết liên quan. Trang Tìm hiểu dùng FAQ chung với icon/chevron thẳng hàng và nút mở thêm/thu gọn tối thiểu 44px. Giữ Bright Studio, logo, Be Vietnam Pro, màu theo theme, Việt/Anh và các giới hạn trước phát hành; không thêm raster, chức năng backend, gói doanh nghiệp đã phát hành hay bằng chứng khách hàng. Đã hợp nhất hướng dẫn vào `apps/web/DESIGN.md` và sidecar, giữ nội dung thiết kế trước đó.

Theo kết quả xác minh của lượt triển khai: TypeScript web, ESLint phần sửa và 7 kiểm tra paths/i18n đạt; bộ `landing-product-pages.spec.ts` cuối đạt 5/5 trong một lượt. Phạm vi gồm 18 trang với tiêu đề riêng/canonical, slug lạ có giao diện 404 và noindex, desktop 1440px sáng/mobile 390px tối, bàn phím và menu mobile, tiếng Anh, đích Nhân sự AI và FAQ mở thêm/thu gọn. Reviewer kết luận `ship` cho cả ba điểm đã chấm: điều hướng Nhân sự AI, bố cục FAQ và cập nhật tài liệu; kết luận này chỉ áp dụng danh sách sửa. Đây không phải gate toàn repo; không deploy, commit hoặc push.

## CTA cuối trang theo bố cục ClickUp — 2026-09-24

Thay thanh CTA navy bằng một khung xanh–tím: logo UniWork, lời mời hiện có và một liên kết đăng ký ở giữa, bên dưới là giao diện công việc mẫu. Khung dùng chung tối đa 1400px; desktop cắt phần dưới của cửa sổ minh họa, mobile thu nhỏ đầy đủ. Dùng lại TaskScene và canvas Lovable, không tạo thêm sandbox, nút điều khiển hoặc mẫu ứng dụng điện thoại. Có nhãn dữ liệu minh họa; nội dung giao diện nằm trong vùng inert/ẩn với trình đọc màn hình, còn hình tổng thể có tên truy cập. Màu giao diện mẫu theo theme; bốn token nền/chữ CTA được khai báo trong cả hai theme. Không đổi copy, lời hứa sản phẩm hoặc đường dẫn đăng ký.

CTA được dùng ở trang chủ, các trang giải pháp/giới thiệu cũ và cuối MarketingShell. CSS khung minh họa được nhập tại cấp trang để không đổi thứ tự stylesheet của phần quản trị trên trang chủ.

Xác minh cuối: 5/5 kiểm tra CTA ở 1440/1554/768/390px, Việt/Anh và sáng/tối; 5/5 kiểm tra trang giới thiệu; 4/4 kiểm tra hồi quy mật độ trang chủ; 1/1 kiểm tra mở rộng/phát demo; 17/17 kiểm tra token. TypeScript web, ESLint các component sửa và `git diff --check` đạt. Kiểm tra tương phản onboarding tối đạt; sáng timeout ở bước tạo workspace lần đầu rồi đạt khi chạy lại riêng. Gate toàn repo chưa chạy được vì máy Windows thiếu `make`. Không deploy, commit hoặc push.

## Thu gọn khối quản trị và mô hình AI — 2026-09-24

Khối trust trên trang chủ chuyển thành bố cục hai cột: tiêu đề và ba nhóm mở rộng bên trái, bản ghi minh họa bên phải. Giữ sáu nội dung gốc, cơ chế mở từng nhóm của Accordion, liên kết nhật ký và trang phân tích. Bản ghi ưu tiên tên công việc, người thay đổi, trước/sau và thông tin truy vết. Dải mô hình AI có padding dọc 20px, logo nguyên bản không tương tác; phần phân tích phía dưới được thu gọn. Dùng màu/token có sẵn, không thêm dữ liệu hoặc tuyên bố sản phẩm.

CSS module riêng sở hữu khối này; các quy tắc quản trị cũ chồng chéo được gỡ khỏi stylesheet chung. TrustBand ở các trang khác không đổi. Desktop cao khoảng 640–660px khi các mục đóng; từ 900px xếp một cột, từ 600px giảm lề và xếp thông tin bản ghi theo chiều dọc.

Xác minh cuối: 6/6 kiểm tra mới ở 1536/1280/768/390/320px, Việt/Anh và sáng/tối, gồm điều hướng client từ trang tính năng, bàn phím, sáu nội dung mở rộng, không tràn ngang và tương phản khối; 4/4 kiểm tra mật độ trang chủ và 2/2 kiểm tra tương phản onboarding đạt. TypeScript web, ESLint phần sửa, kiểm tra bố cục và `git diff --check` đạt. Gate toàn repo chưa chạy được vì thiếu `make`. Không deploy, commit hoặc push.
