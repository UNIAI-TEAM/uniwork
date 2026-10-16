# Hướng dẫn: dùng UniWork trong Claude, ChatGPT, Gemini (connector MCP)

Tài liệu cho người dùng UniWork. Thiết kế: [`docs/superpowers/specs/2026-10-14-mcp-connector-write-design.md`](../superpowers/specs/2026-10-14-mcp-connector-write-design.md), ADR 0031 và ADR 0033. Vận hành và sự cố: [`docs/ops/RUNBOOK_MCP.md`](../ops/RUNBOOK_MCP.md).

Kết nối UniWork vào trợ lý AI bạn đang dùng, rồi hỏi hoặc giao việc bằng lời ngay trong trợ lý đó: "tuần này tôi có việc gì", "tạo task cho Lan", "dời cuộc họp sang 2 giờ chiều", "tóm tắt tài liệu Kế hoạch Q4". Trợ lý làm việc **thay mặt bạn**: chỉ thấy những gì bạn thấy, và mỗi thay đổi ghi tên bạn kèm tên ứng dụng.

## Ai làm gì?

| Vai trò | Việc | Ở đâu |
| --- | --- | --- |
| Owner / admin tổ chức | Bật hoặc tắt kết nối cho cả tổ chức; xem và thu hồi ứng dụng của mọi thành viên | **Cài đặt › Truy cập AI** |
| Thành viên | Lấy địa chỉ kết nối; xem và thu hồi ứng dụng của mình | **Cài đặt › Ứng dụng AI** |

## 1. Bật cho tổ chức (owner / admin)

1. Vào **Cài đặt › Truy cập AI**.
2. Bật **Cho phép trợ lý AI bên ngoài truy cập**. Thành viên được kết nối và đọc dữ liệu.
3. Muốn trợ lý tạo và sửa thay thành viên: bật thêm **Cho phép tạo và sửa**. Nếu ô này không bật được, quyền ghi chưa mở cho tổ chức của bạn.

Tắt một trong hai công tắc là có hiệu lực ngay với mọi ứng dụng đã kết nối. Tắt **Cho phép tạo và sửa** chỉ chặn thao tác ghi; trợ lý vẫn đọc được.

## 2. Kết nối trợ lý của bạn (mọi thành viên)

Lần đầu kết nối Claude hoặc ChatGPT: vào **Cài đặt › Ứng dụng AI**, bấm **Hướng dẫn kết nối** và làm theo từng bước có hình minh họa. Hộp thoại tự báo khi kết nối xong.

Hoặc tự làm: ở **Cài đặt › Ứng dụng AI**, bấm **Sao chép địa chỉ**. Địa chỉ có dạng `https://<máy chủ UniWork>/mcp`. Sau đó thêm vào trợ lý:

| Trợ lý | Cách thêm |
| --- | --- |
| Claude (web, desktop) | Settings › Connectors › Add custom connector, dán địa chỉ |
| ChatGPT (mọi gói, kể cả miễn phí) | Mở `chatgpt.com/plugins`, bấm **+**, chọn **Add custom MCP server**, dán địa chỉ ở mục **Connection**, xác thực OAuth, bấm **I understand and want to continue** rồi **Create as a plugin** và cài plugin. Trong cuộc trò chuyện, gõ `@` rồi chọn UniWork |
| Claude Code | `claude mcp add --transport http uniwork <địa chỉ>`, rồi gõ `/mcp` và chọn `uniwork` để đăng nhập |
| Gemini CLI | Thêm `"mcpServers": {"uniwork": {"httpUrl": "<địa chỉ>"}}` vào `~/.gemini/settings.json`, rồi chạy `/mcp auth uniwork` |

Tên menu trong từng trợ lý do nhà cung cấp đặt và có thể đổi theo phiên bản.

Trình duyệt mở trang đăng nhập UniWork, rồi đến màn **Cho phép … truy cập UniWork?**:

1. **Tổ chức**: chọn tổ chức trợ lý sẽ làm việc. Mỗi lần kết nối chỉ gắn với một tổ chức.
2. **Ứng dụng sẽ đọc được**: đọc kỹ danh sách. Chat và email không bao giờ được chia sẻ.
3. **Cho phép tạo và sửa**: tick nếu muốn trợ lý tạo và sửa thay bạn. Không tick thì trợ lý chỉ đọc. Muốn đổi sau thì phải kết nối lại.
4. Nhãn **Chưa xác minh**: UniWork chưa xác minh ứng dụng này. Chỉ bấm **Cho phép** khi bạn vừa tự thêm nó.
5. Bấm **Cho phép**. Trình duyệt quay lại trợ lý.

## 3. Hỏi và giao việc

Gọi đúng tên workspace, tên người, tên dự án; ngày giờ càng rõ càng tốt. Nếu bạn có nhiều workspace, trợ lý sẽ hỏi hoặc tự tra danh sách.

**Đọc**
- "Tuần này tôi có việc gì?"
- "Tìm mọi thứ liên quan 'báo cáo quý' trong workspace Saturn": ra task, cuộc họp và tài liệu, mỗi mục có link mở thẳng UniWork.
- "Task SAT-42 đang ở đâu, ai đang làm?"
- "Dự án Website mới còn những việc gì chưa xong?"
- "Tóm tắt tài liệu Kế hoạch Q4."

**Công việc**
- "Tạo task 'Chuẩn bị demo' giao cho Lan, hạn thứ Sáu, ưu tiên cao."
- "Chuyển SAT-42 sang Đang làm và thêm mô tả: …"
- "Bình luận vào SAT-42: đã gửi bản nháp." Trợ lý cũng trả lời được một bình luận cụ thể.

**Dự án**
- "Tạo dự án 'Ra mắt v2', tôi phụ trách, hạn 30/11."
- "Đổi hạn dự án Ra mắt v2 sang 15/12."

**Cuộc họp**
- "Đặt họp 'Sync tuần' 10 giờ sáng mai, 30 phút." Giờ tính theo múi giờ của bạn.
- "Mời Lan và Minh vào cuộc họp đó." Người được mời nhận thông báo.
- "Dời sang 2 giờ chiều", "Hủy cuộc họp đó", "À không, khôi phục lại."

**Tài liệu**
- "Thêm mục Rủi ro với 3 gạch đầu dòng vào cuối tài liệu Kế hoạch Q4."
- "Viết lại tài liệu đó cho ngắn hơn."
- "Tạo tài liệu 'Biên bản họp 16/10' từ ghi chú này: …"
- "Bình luận vào tài liệu đó: cần chị Hoa duyệt."

## 4. Những điều nên biết

- **Không bao giờ xóa.** Trợ lý không xóa được gì; muốn xóa thì làm trên UniWork.
- **Mọi thay đổi đều để lại dấu.** Lịch sử của task, dự án, cuộc họp ghi tên bạn kèm "qua Claude" (hoặc tên ứng dụng khác).
- **Hoàn tác được.** Sửa sai thì bảo trợ lý sửa lại, hoặc sửa trên UniWork. Cuộc họp bị hủy thì khôi phục được, bằng lời hoặc bằng nút **Khôi phục** trên trang cuộc họp.
- **Không ghi đè việc của người khác.** Nếu ai đó vừa sửa cùng mục trên UniWork, lệnh sửa của trợ lý bị từ chối, không thay đổi gì. Trợ lý đọc lại bản mới rồi mới làm tiếp.
- **Sửa tài liệu có phiên bản dự phòng.** Trước mỗi lần trợ lý sửa nội dung trang, UniWork lưu một phiên bản tên "Trước khi sửa qua <ứng dụng>". Mở lịch sử phiên bản của trang để xem hoặc khôi phục.
- **Có trang không viết lại được.** Trợ lý đọc và ghi tài liệu dưới dạng Markdown. Trang có định dạng Markdown không giữ được (màu chữ, ô gộp trong bảng…) hoặc dài hơn 16.000 ký tự chỉ cho **thêm vào cuối**, không cho viết lại toàn bộ, để không làm mất nội dung. Mỗi lần ghi tối đa 50.000 ký tự.
- **Lặp lệnh là tạo hai lần.** Bảo trợ lý "tạo task X" hai lần thì có hai task. Kiểm tra trước khi nhắc lại.
- **Đặt họp kèm người dự thì không ai được báo.** Muốn người dự nhận thông báo, hãy bảo trợ lý *mời* họ.
- **Danh sách có giới hạn.** Mỗi lần liệt kê tối đa 50 mục; trợ lý sẽ nói khi còn nhiều hơn. Hãy lọc theo trạng thái, dự án hoặc từ khóa.

## 5. Thu hồi

- **Thành viên:** **Cài đặt › Ứng dụng AI**, bấm **Thu hồi** cạnh ứng dụng. Ứng dụng mất quyền ngay; muốn dùng lại phải kết nối lại.
- **Owner / admin:** **Cài đặt › Truy cập AI**, mục *Ứng dụng đã kết nối trong tổ chức*, thu hồi ứng dụng của bất kỳ thành viên nào. Hoặc tắt hẳn công tắc để chặn tất cả.

## 6. Gặp lỗi

| Hiện tượng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Màn đồng ý báo "Quản trị viên chưa bật kết nối cho tổ chức này" | Tổ chức chưa bật | Nhờ owner/admin bật ở **Cài đặt › Truy cập AI** |
| Không có mục **Ứng dụng AI** trong cài đặt | Tính năng chưa mở cho tổ chức | Nhờ admin gửi địa chỉ ở **Truy cập AI**, hoặc chờ mở |
| Trợ lý chỉ đọc, không tạo hay sửa được | Lúc đồng ý chưa tick **Cho phép tạo và sửa**, hoặc admin đã tắt quyền ghi | Kết nối lại và tick; hoặc nhờ admin bật |
| Trợ lý báo cần đăng nhập lại | Bạn hoặc admin đã thu hồi, hoặc phiên đã hết hạn | Kết nối lại từ trợ lý |
| Trợ lý báo không tìm thấy | Mục không tồn tại, bạn không có quyền xem, hoặc nằm ở tổ chức khác | Kiểm tra tên, mã task, workspace |
| "Yêu cầu kết nối đã hết hạn" | Để màn đồng ý quá lâu | Thêm lại UniWork từ trợ lý |

## Chuẩn bị máy chủ (DevOps)

1. **Địa chỉ công khai**: `API_PUBLIC_URL` phải là origin `https` mà trợ lý AI ở ngoài Internet gọi tới được. Đây cũng là issuer OAuth; đặt sai thì không trợ lý nào đăng nhập được.
2. **Feature flag**: `mcp_connector` (đọc) và `mcp_connector_write` (ghi), mặc định tắt. Bật ở `/admin/flags` (cần platform role) hoặc bằng `FF_MCP_CONNECTOR`, `FF_MCP_CONNECTOR_WRITE`.
3. **Kiểm tra nhanh**: `GET <API_PUBLIC_URL>/.well-known/oauth-authorization-server` phải trả `issuer` đúng bằng `API_PUBLIC_URL`.
