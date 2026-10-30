import type { SupportedLocale } from "@uniwork/core/i18n/types";
import { legalEntity } from "../../platform/site-information";
import type { GuideContent } from "./guide-content";

/**
 * The privacy policy (UNI-2014): the URL Google Play and the App Store ask for.
 * Every statement mirrors what the code and the production configuration do;
 * change the product, change this page in the same PR. UniOffice desktop lives
 * in UNIAI-TEAM/uniwork-office, so its lines follow the API contract and ADRs
 * 0028/0034. The deletion section keeps the fixed anchor #delete-account in
 * both languages: it is the account deletion URL given to Google Play.
 */
const vi: GuideContent = {
  introduction: "Chính sách này giải thích UniWork, UniOffice và ứng dụng UniChat (web, máy tính, Android, iPhone) thu thập dữ liệu cá nhân nào, dùng để làm gì, lưu ở đâu, chia sẻ với ai và bạn yêu cầu xem hoặc xóa dữ liệu bằng cách nào.",
  effective: { dateTime: "2026-10-28", text: "28/10/2026" },
  sections: [
    { title: "Ai chịu trách nhiệm về dữ liệu", paragraphs: [
      `UniWork, UniOffice và UniChat do ${legalEntity.nameVi} (mã số doanh nghiệp ${legalEntity.enterpriseCode}, trụ sở: ${legalEntity.addressVi}) vận hành. Liên hệ về dữ liệu cá nhân: ${legalEntity.email}.`,
      "Khi tổ chức của bạn dùng UniWork, tổ chức đó quyết định ai được vào workspace và nội dung nào được đưa vào. Chúng tôi xử lý nội dung của workspace để cung cấp dịch vụ cho tổ chức; quản trị viên của tổ chức có thể xem thông tin thành viên và nội dung theo quyền của họ.",
    ] },
    { title: "Dữ liệu chúng tôi thu thập", paragraphs: [
      "Chúng tôi chỉ thu thập dữ liệu cần để bạn đăng nhập, làm việc và trò chuyện với đồng nghiệp. Ứng dụng không đọc danh bạ, vị trí hay tin nhắn SMS của bạn.",
    ], table: { caption: "Loại dữ liệu và mục đích", columns: ["Loại dữ liệu", "Gồm những gì", "Để làm gì"], rows: [
      ["Tài khoản", "Email, tên hiển thị, ảnh đại diện, mật khẩu (chỉ lưu dạng băm), mã tài khoản và email của tài khoản Google hay Apple bạn đã liên kết (kèm ngày liên kết), ngôn ngữ, múi giờ, cài đặt xác thực hai lớp", "Đăng nhập, nhận diện bạn và bảo vệ tài khoản"],
      ["Hồ sơ trong tổ chức", "Chức danh, mã nhân viên, số điện thoại (mặc định ẩn), nơi làm việc, giới thiệu — do bạn hoặc quản trị viên nhập", "Giúp đồng nghiệp biết bạn là ai"],
      ["Nội dung", "Tin nhắn, ảnh, tệp, tin thoại, công việc, tài liệu và các phiên bản của chúng, nội dung và phụ đề cuộc họp, email khi tổ chức kết nối hộp thư", "Cung cấp chính tính năng bạn dùng"],
      ["Cuộc gọi", "Âm thanh và video được truyền trực tiếp giữa người tham gia qua máy chủ cuộc gọi; chỉ được ghi lại khi một người trong cuộc gọi chủ động bật ghi", "Gọi thoại và gọi video"],
      ["Thiết bị và phiên đăng nhập", "Mã nhận thông báo đẩy (push token), nền tảng, tên thiết bị, phiên bản ứng dụng, địa chỉ IP và trình duyệt/ứng dụng của phiên đăng nhập", "Gửi thông báo, quản lý phiên, phát hiện truy cập bất thường"],
      ["Nhật ký hoạt động", "Hành động thay đổi dữ liệu (ai, lúc nào, làm gì) kèm địa chỉ IP và trình duyệt/ứng dụng", "Bảo mật, truy vết và giải quyết tranh chấp trong tổ chức"],
      ["Đo hiệu năng web", "Thời gian tải trang và độ phản hồi, không gắn với tài khoản", "Giữ trang web nhanh"],
      ["Thống kê sử dụng ứng dụng điện thoại", "Bộ đếm ẩn danh của UniChat cho Android và iPhone: lần mở ứng dụng, thời gian màn hình đầu tiên hiện ra, tin gửi được hay hỏng và thời gian gửi, lần mở từ thông báo, cuộc gọi nối được hay không và thời gian nối, lần chạy trước có bị tắt đột ngột không và bản cập nhật có khởi động được không — chỉ cộng theo hệ điều hành và phiên bản ứng dụng, không gắn với tài khoản; bạn tắt được", "Biết một phiên bản ứng dụng có chạy tốt không"],
      ["Báo cáo lỗi ứng dụng điện thoại", "Khi ứng dụng UniChat cho Android và iPhone gặp lỗi: diễn biến lỗi, kiểu máy, hệ điều hành, phiên bản ứng dụng và mã người dùng (không email, tên hay nội dung tin); thời gian mở ứng dụng và tải màn hình của một phần nhỏ phiên dùng", "Tìm và sửa lỗi, giữ ứng dụng nhanh"],
    ], layout: "wide-middle" } },
    { title: "Quyền truy cập trên điện thoại và máy tính", paragraphs: [
      "Ứng dụng chỉ xin quyền khi bạn dùng tính năng cần nó, và bạn có thể tắt trong cài đặt của thiết bị bất cứ lúc nào.",
    ], steps: [
      "Camera: gọi video.",
      "Micro: gọi điện và ghi tin thoại.",
      "Ảnh: chỉ những ảnh bạn chọn để gửi vào cuộc trò chuyện.",
      "Thông báo: báo tin nhắn mới, lượt nhắc tên và cuộc gọi.",
      "Âm thanh nền (iPhone): giữ tiếng cuộc gọi khi bạn rời màn hình ứng dụng hoặc khóa máy. Tin thoại dừng phát khi bạn rời ứng dụng.",
    ] },
    { title: "Chúng tôi dùng dữ liệu để làm gì", paragraphs: [
      "Để cung cấp và bảo vệ dịch vụ: đăng nhập, đồng bộ nội dung giữa các thiết bị, gửi thông báo, chống lạm dụng và khắc phục sự cố.",
      "Đăng nhập bằng Google hoặc Apple: bạn đăng nhập với chính Google hay Apple, nên chúng tôi không bao giờ thấy mật khẩu của tài khoản đó. Google cho chúng tôi biết mã tài khoản Google, email, tên và ảnh đại diện; Apple cho biết mã tài khoản Apple, email (có thể là email ẩn của Apple nếu bạn chọn Ẩn địa chỉ email) và tên ở lần đầu nếu bạn chia sẻ. Chúng tôi không xin gì khác trong tài khoản Google hay Apple của bạn. Mã (token) mà Google hay Apple cấp cho một lần đăng nhập chỉ dùng để xác nhận đó là bạn và không được chia sẻ với ai; riêng mã của Apple được mã hóa và giữ lại để chúng tôi báo Apple thu hồi khi bạn xóa tài khoản. Mật khẩu UniWork bạn gõ trong ứng dụng UniChat đi thẳng tới máy chủ qua kết nối mã hóa và không được lưu trên máy.",
      "Chúng tôi không bán dữ liệu cá nhân, không dùng dữ liệu để quảng cáo và không cài công cụ quảng cáo hay phân tích của bên thứ ba trong ứng dụng UniChat và UniOffice. Chúng tôi không dùng nội dung của bạn để huấn luyện mô hình AI.",
      "Thống kê sử dụng ẩn danh: ứng dụng UniChat cho Android và iPhone gửi về chính máy chủ UniWork các bộ đếm — lần mở ứng dụng, thời gian màn hình đầu tiên hiện ra, tin gửi được hay hỏng hẳn và thời gian gửi, lần mở từ thông báo (tin nhắn hay cuộc gọi), cuộc gọi nối được hay không và thời gian nối, lần chạy trước có bị tắt đột ngột không và bản cập nhật của ứng dụng có khởi động được không. Máy chủ chỉ cộng chúng theo hệ điều hành và phiên bản ứng dụng: không gắn với bạn, tổ chức, cuộc trò chuyện hay nội dung nào, và không gửi cho bên thứ ba. Tính năng bật sẵn; bạn tắt được ở Cài đặt → Quyền riêng tư và bảo mật → Gửi thống kê sử dụng ẩn danh, và khi tắt thì những gì chưa gửi bị bỏ.",
      "Báo cáo lỗi: khi ứng dụng UniChat cho Android và iPhone gặp lỗi, ứng dụng gửi báo cáo lỗi tới Sentry, nhà cung cấp dịch vụ xử lý thay chúng tôi. Báo cáo gồm diễn biến lỗi, kiểu máy, hệ điều hành, phiên bản ứng dụng và mã người dùng UniWork. Ứng dụng không đưa nội dung tin nhắn hay tên của ai vào báo cáo; trước khi gửi, ứng dụng còn lọc bỏ email, mã đăng nhập, tham số trong địa chỉ, mọi đoạn nằm trong dấu ngoặc kép và lời báo lỗi do máy chủ trả về. Không chụp màn hình và không ghi lại phiên dùng.",
      "Thông báo đẩy có thể hiện tên người gửi, tên phòng và tối đa 120 ký tự đầu của tin nhắn văn bản (tin thoại, ảnh, tệp chỉ hiện nhãn), cùng tên công việc, cuộc họp hay tài liệu mà thông báo nói tới; nội dung đó đi qua Expo, Google hoặc Apple để tới máy của bạn. Bạn tắt được trong ứng dụng UniChat ở Cài đặt → Quyền riêng tư và bảo mật → Hiện nội dung trong thông báo, và chủ sở hữu hoặc quản trị viên có thể tắt cho cả tổ chức. Khi đó thông báo chỉ nói có tin hay việc mới, không có tên người, tên phòng, tiêu đề hay chữ trong tin; riêng chuông cuộc gọi đến vẫn hiện tên người gọi để bạn biết ai gọi. Bạn cũng có thể tắt xem trước thông báo trong cài đặt của thiết bị.",
      `Báo cáo và chặn: khi bạn báo cáo một tin nhắn hoặc một người trong UniChat, chúng tôi lưu lý do, mô tả bạn viết và tin nhắn hoặc người liên quan. Chủ sở hữu và quản trị viên tổ chức của bạn thấy báo cáo trong Nhật ký hoạt động của tổ chức — lý do, người hoặc tin nhắn bị báo cáo và ai đã báo cáo — để xử lý; mô tả bạn viết không vào nhật ký mà được lưu cùng báo cáo, nằm trong bản xuất dữ liệu của tổ chức mà chỉ chủ sở hữu tải được. Người bị báo cáo không nhận thông báo nào, nhưng nếu họ là chủ sở hữu hoặc quản trị viên thì họ cũng xem được báo cáo. Chúng tôi, đơn vị vận hành, cũng thấy từng báo cáo — lý do, mã của người và tin nhắn liên quan và của người báo cáo, không bao giờ nội dung tin hay mô tả bạn viết — để mọi báo cáo được xử lý trong 24 giờ. Bạn cũng có thể báo cáo thẳng với chúng tôi qua ${legalEntity.email}. Khi bạn chặn một người, hai bên không nhắn tin riêng được cho tới khi bạn bỏ chặn.`,
    ] },
    { title: "Tính năng AI", paragraphs: [
      "Khi bạn dùng một tính năng AI — hỏi Hỏi UNI, tóm tắt các tin chưa đọc, tóm tắt cuộc gọi, AI trong UniOffice — nội dung liên quan (tin nhắn kèm tên người gửi và thời gian, hoặc tài liệu và tệp bạn chọn) được máy chủ UniWork gửi tới nhà cung cấp mô hình AI, hiện là Anthropic, để tạo câu trả lời. Trong cuộc trò chuyện hay cuộc gọi chung, nội dung đó gồm cả tin nhắn và nội dung cuộc gọi của các thành viên khác: khi bất kỳ thành viên nào dùng AI trên cuộc trò chuyện hay cuộc gọi đó, tin nhắn của bạn trong đó cũng được gửi đi. AI chỉ chạy khi một thành viên yêu cầu; nội dung không được gửi tới AI ở chế độ nền. Trong ứng dụng UniChat cho Android và iPhone, trước lần đầu bạn dùng AI trên điện thoại, bạn được hỏi đồng ý (thông báo nêu tên nhà cung cấp và dữ liệu gửi đi); sự đồng ý đó chỉ áp dụng cho yêu cầu AI của chính bạn từ điện thoại, không áp dụng khi thành viên khác dùng AI trên web hay máy tính. Bạn rút lại đồng ý, hay chọn không cho phép, được bất cứ lúc nào trong Cài đặt → Quyền riêng tư và pháp lý của ứng dụng; khi đó tin nhắn bạn viết trong các cuộc trò chuyện được loại khỏi Bắt kịp, Hỏi UNI và tóm tắt cuộc gọi, kể cả khi thành viên khác yêu cầu trên web hay máy tính. Lựa chọn này không áp dụng cho lời nói và tin nhắn trong cuộc họp, bình luận công việc hay tài liệu.",
      "Lịch sử hội thoại AI được mã hóa khi lưu. Cuộc hội thoại AI trong UniOffice tự hết hạn sau 30 phút không dùng và tối đa 24 giờ.",
    ] },
    { title: "UniOffice", paragraphs: [
      "UniOffice cho máy tính mở và lưu tệp ngay trên máy của bạn. Tệp trên máy chỉ được tải lên UniWork khi bạn chọn lưu nó vào một workspace; khi đó mỗi lần lưu tạo một phiên bản mới thay vì ghi đè. Bạn đăng nhập qua trình duyệt, và có thể xem hoặc thu hồi từng máy đã đăng nhập.",
      "Khi bạn mở hoặc xuất PDF, bảng tính hay định dạng cũ trên web, tệp được xử lý trên máy chủ chuyển đổi của chúng tôi trong cùng hạ tầng. Tệp chỉ nằm trong bộ nhớ tạm của lượt xử lý, bị xóa ngay khi xong và không được gửi cho bên thứ ba.",
      "Khi bạn nhập khóa API AI trực tiếp trong UniOffice cho máy tính, khóa được lưu trên máy đó và ứng dụng gọi thẳng nhà cung cấp; UniWork không nhận khóa hay nội dung. Nội dung được xử lý theo điều khoản của nhà cung cấp bạn chọn, có thể ở ngoài Việt Nam.",
      "Liên kết chia sẻ công khai chỉ cho xem, hết hạn sau 7 ngày theo mặc định (tối đa 90 ngày) và có thể thu hồi; lượt xem được đếm mà không ghi địa chỉ của người xem. Máy chủ MCP cục bộ của UniOffice cho máy tính mặc định tắt; khi bạn bật, các chương trình trên cùng máy tính có thể điều khiển tài liệu đang mở.",
    ] },
    { id: "google-drive", title: "Google Drive", paragraphs: [
      "Khi bạn kết nối Google Drive trong một workspace, UniWork chỉ xin quyền drive.file của Google, cùng địa chỉ email và mã tài khoản Google để biết tài khoản nào đã kết nối. Quyền drive.file chỉ cho UniWork truy cập những tệp bạn tự chọn trong cửa sổ chọn tệp của Google (Google Picker); UniWork không xem được các tệp hay thư mục khác trong Drive của bạn. Khi bạn chọn một thư mục, UniWork chỉ biết tên thư mục đó, không thấy các tệp bên trong.",
      "Với mỗi tệp bạn chọn, UniWork lưu: mã tệp, tên, loại tệp, đường dẫn mở trên Drive, tên chủ sở hữu và người sửa gần nhất, thời điểm sửa, trạng thái chia sẻ và số người được chia sẻ, cùng mã và tên thư mục chứa tệp khi đọc được. Mã truy cập và mã làm mới mà Google cấp được mã hóa khi lưu và không bao giờ gửi về trình duyệt hay ứng dụng. UniWork không lưu bản sao nội dung tệp Drive.",
      "Nội dung tệp chỉ được đọc khi bạn yêu cầu (hỏi Hỏi UNI về một tệp Drive, hoặc nhờ AI tạo việc từ tài liệu), bằng chính kết nối Google của bạn, không bao giờ bằng kết nối của thành viên khác. Nội dung được xử lý trong bộ nhớ và gửi tới nhà cung cấp mô hình AI (xem mục Tính năng AI) để tạo câu trả lời hoặc đề xuất việc, rồi không được lưu lại. Cuộc hỏi đáp Hỏi UNI về một tệp Drive không được lưu vào lịch sử. Đề xuất việc do AI soạn (tiêu đề, mô tả, ngày, độ ưu tiên) được giữ để bạn duyệt và hết hạn sau 7 ngày; việc bạn chọn tạo ra thuộc về workspace như mọi việc khác.",
      "Việc UniWork sử dụng và chuyển cho ứng dụng khác thông tin nhận được từ Google API tuân thủ Chính sách dữ liệu người dùng của Google API Services (Google API Services User Data Policy), bao gồm các yêu cầu Sử dụng giới hạn (Limited Use). Chúng tôi chỉ dùng dữ liệu Google Drive để cung cấp các tính năng bạn thấy trong UniWork; không dùng cho quảng cáo, không bán, không chuyển cho bên khác ngoài nhà cung cấp mô hình AI nêu trên khi bạn yêu cầu, và không dùng để huấn luyện hay cải thiện mô hình AI chung. Nhân viên của chúng tôi không đọc dữ liệu này, trừ khi bạn đồng ý, khi cần để điều tra sự cố bảo mật hay lạm dụng, hoặc khi pháp luật buộc phải làm.",
      "Bạn có thể gỡ liên kết từng tệp bất cứ lúc nào, hoặc ngắt kết nối tài khoản Google Drive trong UniWork; khi ngắt kết nối, UniWork yêu cầu Google thu hồi quyền truy cập đã cấp. Bạn cũng có thể gỡ quyền của UniWork tại trang quyền truy cập của tài khoản Google (myaccount.google.com/permissions).",
    ] },
    { title: "Bên nhận dữ liệu và nơi lưu trữ", paragraphs: [
      "Máy chủ ứng dụng, cơ sở dữ liệu, máy chủ chuyển đổi tài liệu và máy chủ cuộc gọi do chúng tôi vận hành tại Việt Nam. Chúng tôi chỉ chia sẻ dữ liệu với các nhà cung cấp dưới đây, trong phạm vi việc họ làm cho chúng tôi, hoặc khi pháp luật buộc phải cung cấp.",
    ], table: { caption: "Nhà cung cấp dịch vụ", columns: ["Nhà cung cấp", "Việc họ làm", "Nơi xử lý"], rows: [
      ["CMC Telecom", "Lưu ảnh, tệp, tài liệu và tin thoại", "Hà Nội, Việt Nam"],
      ["Anthropic", "Xử lý yêu cầu AI khi bạn dùng tính năng AI", "Hoa Kỳ"],
      ["Tavily hoặc Brave; OpenAI", "Chỉ khi tổ chức bật công cụ AI đám mây trong UniOffice: tìm kiếm web (câu truy vấn), tạo ảnh (mô tả và ảnh tham chiếu), chuyển giọng nói thành văn bản (tệp âm thanh)", "Hoa Kỳ"],
      ["Expo (650 Industries)", "Chuyển thông báo đẩy tới điện thoại; phân phối bản cập nhật ứng dụng di động", "Hoa Kỳ"],
      ["Sentry (Functional Software)", "Nhận báo cáo lỗi và số đo hiệu năng của ứng dụng UniChat cho Android và iPhone", "Hoa Kỳ"],
      ["Google (Firebase Cloud Messaging), Apple (APNs)", "Đưa thông báo đẩy tới máy Android và iPhone", "Theo hạ tầng của Google và Apple"],
      ["Google", "Đăng nhập bằng Google (khi bạn chọn) trên web, máy tính và trong ứng dụng UniChat qua thư viện đăng nhập của Google: Google cho chúng tôi biết mã tài khoản Google, email, tên và ảnh đại diện; gửi email hệ thống như mã xác minh", "Theo hạ tầng của Google"],
      ["Google (Google Drive)", "Khi bạn kết nối Google Drive: cửa sổ chọn tệp, thông tin và nội dung của các tệp bạn đã chọn", "Theo hạ tầng của Google"],
      ["Apple", "Đăng nhập bằng Apple (khi bạn chọn) trên web, máy tính, Android và iPhone: Apple cho chúng tôi biết mã tài khoản Apple, email (có thể là email ẩn của Apple nếu bạn chọn Ẩn địa chỉ email) và tên ở lần đầu nếu bạn chia sẻ; thư chúng tôi gửi tới email ẩn đi qua Apple để tới hộp thư của bạn", "Theo hạ tầng của Apple"],
      ["GitHub", "Lưu bản cài và bản cập nhật UniChat, UniOffice cho máy tính", "Theo hạ tầng của GitHub"],
    ], layout: "wide-middle" } },
    { id: "delete-account", title: "Lưu giữ và xóa dữ liệu", paragraphs: [
      "Nội dung được giữ khi tổ chức còn dùng dịch vụ. Tin nhắn bạn xóa bị ẩn với mọi người ngay; tài liệu bị xóa nằm trong thùng rác 30 ngày rồi bị xóa vĩnh viễn; mỗi tài liệu giữ tối đa 500 phiên bản; tệp không còn được dùng ở đâu bị xóa khỏi kho lưu trữ trong lần dọn dẹp hằng ngày.",
      "Xóa tài khoản: trong ứng dụng UniChat vào Cài đặt → Xóa tài khoản (khi bạn chưa ở workspace nào, Cài đặt nằm ở màn chọn workspace), hoặc đăng nhập UniWork trên web và vào Cài đặt → Bảo mật → Xóa tài khoản; sau đó xác nhận lại danh tính. Email, tên, ảnh đại diện, mật khẩu, liên kết Google và Apple, số điện thoại và thông tin hồ sơ bị xóa; mọi phiên đăng nhập và mã nhận thông báo bị thu hồi, và nếu bạn đã đăng nhập bằng Apple, chúng tôi báo Apple thu hồi quyền đăng nhập bằng Apple của ứng dụng. Nội dung bạn đã gửi trong tổ chức vẫn thuộc tổ chức đó và hiển thị dưới tên \"Người dùng đã xóa\". Nếu bạn đang là chủ một tổ chức còn thành viên khác, hãy chuyển quyền sở hữu trước; nếu bạn là thành viên duy nhất, bạn có thể đóng tổ chức cùng lúc với việc xóa tài khoản, ngay trong ứng dụng.",
      "Xóa tổ chức: chủ tổ chức vào Cài đặt → Dữ liệu tổ chức để tải bản xuất dữ liệu hoặc yêu cầu xóa. Nội dung của tổ chức bị xóa vĩnh viễn sau 5 ngày và có thể hủy trong thời gian đó. Hóa đơn, chứng từ thanh toán và nhật ký hoạt động được giữ lại theo nghĩa vụ kế toán và bảo mật.",
      `Nếu không đăng nhập được, gửi yêu cầu xóa tới ${legalEntity.email} từ email của tài khoản.`,
    ] },
    { title: "Quyền của bạn", paragraphs: [
      `Theo Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân, bạn có quyền được biết, đồng ý hoặc rút lại đồng ý, xem và tải về, chỉnh sửa, xóa, hạn chế hoặc phản đối việc xử lý dữ liệu của mình, và khiếu nại. Phần lớn thông tin tài khoản bạn có thể tự sửa trong Cài đặt; các yêu cầu khác gửi tới ${legalEntity.email}. Chúng tôi xác minh danh tính trước khi xử lý và trả lời trong thời hạn pháp luật quy định.`,
      "Với nội dung thuộc workspace của tổ chức, chúng tôi có thể chuyển yêu cầu tới quản trị viên của tổ chức đó, vì họ quản lý nội dung này.",
    ] },
    { title: "Bảo mật", paragraphs: [
      "Dữ liệu được mã hóa khi truyền (HTTPS, WSS). Mật khẩu chỉ lưu dạng băm; khóa xác thực hai lớp và lịch sử hội thoại AI được mã hóa khi lưu. Quyền truy cập được kiểm tra theo tổ chức và workspace ở mọi yêu cầu, và mọi thay đổi dữ liệu được ghi vào nhật ký hoạt động không sửa được.",
      "Ứng dụng UniChat trên Android và iPhone giữ một bản trên điện thoại để dùng được khi mất mạng: danh sách cuộc trò chuyện, số tin chưa đọc, danh bạ của workspace, các tin mới nhất của những cuộc trò chuyện gần đây, và tin, lượt đọc, biểu cảm, bình chọn bạn đã gửi khi chưa có mạng. Bản này được mã hóa trên máy bằng khóa giữ trong Keychain hoặc Keystore của điện thoại; khóa không rời máy nên bản sao lưu hay máy khác không đọc được bản này. Ảnh và tệp chờ gửi nằm trong thư mục riêng của ứng dụng và bị xóa khi đã gửi. Mọi thứ bị xóa khi bạn đăng xuất hoặc xóa tài khoản.",
    ] },
    { title: "Độ tuổi", paragraphs: [
      "UniWork, UniOffice và UniChat là công cụ làm việc cho tổ chức, dành cho người từ 18 tuổi. Chúng tôi không cố ý thu thập dữ liệu của trẻ em.",
    ] },
    { title: "Thay đổi chính sách", paragraphs: [
      "Khi chính sách thay đổi, chúng tôi cập nhật trang này và ngày hiệu lực dưới tiêu đề; thay đổi quan trọng được thông báo trong ứng dụng hoặc qua email trước khi áp dụng.",
    ] },
  ],
  related: ["/security", "/apps/unichat", "/apps/office"],
};

const en: GuideContent = {
  introduction: "This policy explains what personal data UniWork, UniOffice and the UniChat apps (web, desktop, Android, iPhone) collect, why, where it is kept, who it is shared with and how to ask to see or delete it.",
  effective: { dateTime: "2026-10-28", text: "28 October 2026" },
  sections: [
    { title: "Who is responsible for your data", paragraphs: [
      `UniWork, UniOffice and UniChat are operated by ${legalEntity.nameEn} (enterprise code ${legalEntity.enterpriseCode}, registered office: ${legalEntity.addressEn}). Personal data contact: ${legalEntity.email}.`,
      "When your organization uses UniWork, it decides who joins its workspaces and what content goes into them. We process workspace content to provide the service to the organization; its administrators can see member information and content within their permissions.",
    ] },
    { title: "Data we collect", paragraphs: [
      "We collect only what is needed for you to sign in, work and talk with colleagues. The apps do not read your contacts, location or SMS messages.",
    ], table: { caption: "Data types and purposes", columns: ["Data type", "What it includes", "Why"], rows: [
      ["Account", "Email, display name, profile photo, password (stored only as a hash), the account id and email of the Google or Apple account you linked (with the date you linked it), language, time zone, two-factor settings", "Sign-in, identifying you and protecting your account"],
      ["Organization profile", "Job title, employee code, phone number (hidden by default), location, bio — entered by you or an administrator", "Letting colleagues know who you are"],
      ["Content", "Messages, photos, files, voice messages, tasks, documents and their versions, meeting content and captions, email when the organization connects a mailbox", "Providing the feature you use"],
      ["Calls", "Audio and video relayed live between participants through the call server; recorded only when a participant explicitly starts a recording", "Voice and video calls"],
      ["Devices and sessions", "Push notification token, platform, device name, app version, IP address and browser/app of each session", "Sending notifications, managing sessions, detecting unusual access"],
      ["Activity log", "Actions that change data (who, when, what) with IP address and browser/app", "Security, traceability and resolving disputes within the organization"],
      ["Web performance", "Page load and responsiveness timings, not linked to an account", "Keeping the website fast"],
      ["Phone app usage statistics", "Anonymous counters from UniChat for Android and iPhone: app opens, how long the first screen takes, whether a message was sent or failed and how long it took, opens from a notification, whether a call connected and how long it took, whether the previous run ended in a crash and whether an app update could start — added up by operating system and app version only, not linked to an account; you can turn them off", "Knowing whether an app release works well"],
      ["Phone app error reports", "When UniChat for Android or iPhone hits an error: what led to it, device model, operating system, app version and user id (no email, name or message content); app start and screen load times for a small share of sessions", "Finding and fixing bugs, keeping the app fast"],
    ], layout: "wide-middle" } },
    { title: "Device permissions", paragraphs: [
      "The apps ask for a permission only when you use the feature that needs it, and you can turn it off in your device settings at any time.",
    ], steps: [
      "Camera: video calls.",
      "Microphone: calls and voice messages.",
      "Photos: only the photos you pick to send to a conversation.",
      "Notifications: new messages, mentions and calls.",
      "Background audio (iPhone): keeping a call audible when you leave the app or lock the phone. Voice messages stop playing when you leave the app.",
    ] },
    { title: "How we use data", paragraphs: [
      "To provide and protect the service: sign-in, syncing content across devices, notifications, abuse prevention and troubleshooting.",
      "Signing in with Google or Apple: you sign in with Google or Apple themselves, so we never see that account's password. Google tells us your Google account id, email, name and profile photo; Apple tells us your Apple account id, your email (Apple's hidden email if you choose Hide My Email) and, the first time, your name if you share it. We ask for nothing else in your Google or Apple account. The token Google or Apple issues for a sign-in is used only to confirm it is you and is never shared with anyone; Apple's alone is encrypted and kept, so that we can ask Apple to revoke it when you delete your account. The UniWork password you type in the UniChat app goes straight to our servers over an encrypted connection and is never stored on the device.",
      "We do not sell personal data, do not use it for advertising and do not include third-party advertising or analytics tools in the UniChat and UniOffice apps. We do not use your content to train AI models.",
      "Anonymous usage statistics: the UniChat apps for Android and iPhone send counters to UniWork's own server — app opens, how long the first screen takes to appear, whether a message was sent or failed for good and how long it took, opens from a notification (a message or a call), whether a call connected and how long it took, whether the previous run ended in a crash and whether an app update could start. The server only adds them up by operating system and app version: they are not linked to you, your organization, a conversation or any content, and are not shared with third parties. This is on by default; you can turn it off in Settings → Privacy & security → Share anonymous usage statistics, and anything not yet sent is then dropped.",
      "Error reports: when the UniChat app for Android or iPhone hits an error, it sends an error report to Sentry, a service provider acting on our behalf. A report includes what led to the error, the device model, operating system, app version and your UniWork user id. The app does not put message content or anyone's name into a report, and before sending it also strips email addresses, sign-in tokens, URL parameters, anything in quotation marks and the text of error messages returned by the server. No screenshots or session recordings are taken.",
      "Push notifications may show the sender's name, the room name and up to the first 120 characters of a text message (voice messages, photos and files show only a label), as well as the name of the task, meeting or document they are about; that content travels through Expo, Google or Apple to reach your device. You can turn this off in the UniChat app under Settings → Privacy & security → Show content in notifications, and an owner or admin can turn it off for the whole organization. A notification then only says that something new arrived, without names, room names, titles or the message's words; only an incoming call still shows who is calling. You can also turn off notification previews in your device settings.",
      `Reports and blocking: when you report a message or a person in UniChat, we store the reason, the words you add and the message or person concerned. Your organization's owners and admins see the report in the organization's Activity log — the reason, the person or message reported and who reported it — so they can act on it; the words you add stay out of the log and are kept with the report, in the organization's data export that only the owner can download. The person reported is not notified, but if they are an owner or admin they can see the report too. We, the operator, also see each report — the reason, the ids of the people and message concerned and of who reported it, never the message or the words you add — so that every report is acted on within 24 hours. You can also report directly to us at ${legalEntity.email}. When you block someone, neither of you can message the other directly until you unblock them.`,
    ] },
    { title: "AI features", paragraphs: [
      "When you use an AI feature — asking Ask UNI, summarizing unread messages, summarizing a call, AI in UniOffice — the relevant content (messages with sender names and times, or the documents and files you choose) is sent by the UniWork server to the AI model provider, currently Anthropic, to produce the answer. In a shared conversation or call, that content includes other members' messages and call content: whenever any member uses AI on a conversation or call, your messages in it are sent too. AI runs only when a member asks; content is not sent to AI in the background. In the UniChat apps for Android and iPhone you are asked to agree before you first use AI on the phone (the notice names the provider and what is sent); that agreement covers only your own AI requests from the phone, not another member's use of AI on the web or desktop. You can withdraw, or say no, at any time in the app's Settings → Privacy & legal; from then on the messages you write in conversations are left out of catch-up, Ask UNI and call summaries, including when another member asks on the web or desktop. The choice does not cover what you say or write in a meeting, task comments or documents.",
      "AI conversation history is encrypted at rest. A UniOffice AI conversation expires after 30 minutes of inactivity and after 24 hours at most.",
    ] },
    { title: "UniOffice", paragraphs: [
      "UniOffice for desktop opens and saves files on your computer. A local file is uploaded to UniWork only when you choose to save it to a workspace; each save then creates a new version instead of overwriting the last one. You sign in through your browser and can review or revoke each signed-in computer.",
      "When you open or export a PDF, spreadsheet or legacy format on the web, the file is processed by our conversion server in the same infrastructure. The file exists only in the job's temporary storage, is deleted as soon as the job ends and is not sent to any third party.",
      "If you enter an AI API key directly in UniOffice for desktop, the key is stored on that computer and the app calls the provider directly; UniWork receives neither the key nor the content. The content is processed under the terms of the provider you chose, which may be outside Vietnam.",
      "Public share links are view-only, expire after 7 days by default (90 at most) and can be revoked; views are counted without recording the viewer's address. UniOffice for desktop's local MCP server is off by default; once you turn it on, programs on the same computer can control the open document.",
    ] },
    { id: "google-drive", title: "Google Drive", paragraphs: [
      "When you connect Google Drive in a workspace, UniWork asks Google only for the drive.file permission, together with your email address and Google account id so it knows which account is connected. drive.file lets UniWork reach only the files you pick yourself in Google's file picker (Google Picker); UniWork cannot see any other file or folder in your Drive. When you pick a folder, UniWork learns only that folder's name, not the files inside it.",
      "For each file you pick, UniWork stores: the file id, name, file type, link to open it in Drive, the owner's and last editor's names, when it was modified, its sharing state and number of people it is shared with, and the id and name of the folder that holds it when that can be read. The access and refresh tokens Google issues are encrypted at rest and never sent to a browser or app. UniWork does not keep a copy of your Drive files' content.",
      "File content is read only when you ask for it (asking Ask UNI about a Drive file, or asking AI to create tasks from a document), through your own Google connection, never another member's. The content is processed in memory and sent to the AI model provider (see AI features) to produce the answer or the task proposals, and is not stored afterwards. An Ask UNI conversation about a Drive file is not saved to your history. Task proposals the AI writes (title, description, dates, priority) are kept for you to review and expire after 7 days; tasks you choose to create belong to the workspace like any other task.",
      "UniWork's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements. We use Google Drive data only to provide the features you see in UniWork; we do not use it for advertising, do not sell it, do not transfer it to anyone other than the AI model provider above when you ask, and do not use it to train or improve general AI models. Our staff do not read this data unless you agree, it is needed to investigate a security incident or abuse, or the law requires it.",
      "You can unlink any file at any time, or disconnect your Google Drive account in UniWork; when you disconnect, UniWork asks Google to revoke the access it granted. You can also remove UniWork's access on your Google Account's permissions page (myaccount.google.com/permissions).",
    ] },
    { title: "Who receives data and where it is stored", paragraphs: [
      "The application servers, database, document conversion server and call server are operated by us in Vietnam. We share data only with the providers below, for the work they do for us, or when the law requires it.",
    ], table: { caption: "Service providers", columns: ["Provider", "What they do", "Where"], rows: [
      ["CMC Telecom", "Storing photos, files, documents and voice messages", "Hanoi, Vietnam"],
      ["Anthropic", "Processing AI requests when you use an AI feature", "United States"],
      ["Tavily or Brave; OpenAI", "Only when an organization turns on UniOffice cloud AI tools: web search (the query), image generation (the prompt and reference images), speech to text (the audio file)", "United States"],
      ["Expo (650 Industries)", "Relaying push notifications to phones; delivering mobile app updates", "United States"],
      ["Sentry (Functional Software)", "Receiving error reports and performance measurements from the UniChat apps for Android and iPhone", "United States"],
      ["Google (Firebase Cloud Messaging), Apple (APNs)", "Delivering push notifications to Android phones and iPhones", "Google's and Apple's infrastructure"],
      ["Google", "Sign in with Google (when you choose it) on the web, desktop and in the UniChat app through Google's sign-in library: Google tells us your Google account id, email, name and profile photo; sending system email such as verification codes", "Google's infrastructure"],
      ["Google (Google Drive)", "When you connect Google Drive: the file picker, and the details and content of the files you picked", "Google's infrastructure"],
      ["Apple", "Sign in with Apple (when you choose it) on the web, desktop, Android and iPhone: Apple tells us your Apple account id, your email (Apple's hidden email if you choose Hide My Email) and, the first time, your name if you share it; email we send to a hidden address passes through Apple to reach your inbox", "Apple's infrastructure"],
      ["GitHub", "Hosting UniChat and UniOffice desktop installers and updates", "GitHub's infrastructure"],
    ], layout: "wide-middle" } },
    { id: "delete-account", title: "Retention and deletion", paragraphs: [
      "Content is kept while the organization uses the service. A message you delete is hidden from everyone immediately; a deleted document stays in the trash for 30 days and is then permanently deleted; each document keeps up to 500 versions; files no longer used anywhere are removed from storage by a daily clean-up.",
      "Deleting your account: in the UniChat app open Settings → Delete account (when you are not in any workspace, Settings is on the workspace picker), or sign in to UniWork on the web and open Settings → Security → Delete account; then confirm your identity. Your email, name, profile photo, password, Google and Apple links, phone number and profile details are removed, and every session and notification token is revoked; if you signed in with Apple, we also ask Apple to revoke the app's Sign in with Apple authorization. Content you posted in an organization stays with that organization and is shown as \"Deleted user\". If you own an organization that has other members, transfer ownership first; if you are its only member, you can close the organization as you delete your account, right in the app.",
      "Deleting an organization: the owner opens Settings → Organization data to download a data export or request deletion. The organization's content is permanently deleted after 5 days and the request can be cancelled until then. Invoices, payment records and the activity log are kept for accounting and security obligations.",
      `If you cannot sign in, email a deletion request to ${legalEntity.email} from the account's email address.`,
    ] },
    { title: "Your rights", paragraphs: [
      `Under Vietnam's Decree 13/2023/ND-CP on personal data protection, you may be informed, give or withdraw consent, view and download, correct, delete, restrict or object to the processing of your data, and complain. You can edit most account details yourself in Settings; send other requests to ${legalEntity.email}. We verify your identity before acting and reply within the time the law requires.`,
      "For content that belongs to an organization's workspace, we may refer your request to that organization's administrators, since they manage it.",
    ] },
    { title: "Security", paragraphs: [
      "Data is encrypted in transit (HTTPS, WSS). Passwords are stored only as hashes; two-factor secrets and AI conversation history are encrypted at rest. Access is checked against the organization and workspace on every request, and every data change is written to an activity log that cannot be altered.",
      "The UniChat apps for Android and iPhone keep a copy on the phone so they work without a connection: your conversation list, unread counts, the workspace's people, the latest messages of recent conversations, and the messages, reads, reactions and votes you made while offline. That copy is encrypted on the phone with a key held in the phone's Keychain or Keystore; the key never leaves the phone, so a backup or another device cannot read the copy. Photos and files waiting to be sent sit in the app's private folder and are deleted once sent. All of it is erased when you sign out or delete your account.",
    ] },
    { title: "Age", paragraphs: [
      "UniWork, UniOffice and UniChat are work tools for organizations, intended for people aged 18 and over. We do not knowingly collect children's data.",
    ] },
    { title: "Changes to this policy", paragraphs: [
      "When this policy changes, we update this page and the effective date under its title; significant changes are announced in the app or by email before they apply.",
    ] },
  ],
  related: ["/security", "/apps/unichat", "/apps/office"],
};

export function privacyContent(locale: SupportedLocale): GuideContent {
  return locale === "vi" ? vi : en;
}
