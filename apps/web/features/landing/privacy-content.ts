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
  effective: { dateTime: "2026-10-21", text: "21/10/2026" },
  sections: [
    { title: "Ai chịu trách nhiệm về dữ liệu", paragraphs: [
      `UniWork, UniOffice và UniChat do ${legalEntity.nameVi} (mã số doanh nghiệp ${legalEntity.enterpriseCode}, trụ sở: ${legalEntity.addressVi}) vận hành. Liên hệ về dữ liệu cá nhân: ${legalEntity.email}.`,
      "Khi tổ chức của bạn dùng UniWork, tổ chức đó quyết định ai được vào workspace và nội dung nào được đưa vào. Chúng tôi xử lý nội dung của workspace để cung cấp dịch vụ cho tổ chức; quản trị viên của tổ chức có thể xem thông tin thành viên và nội dung theo quyền của họ.",
    ] },
    { title: "Dữ liệu chúng tôi thu thập", paragraphs: [
      "Chúng tôi chỉ thu thập dữ liệu cần để bạn đăng nhập, làm việc và trò chuyện với đồng nghiệp. Ứng dụng không đọc danh bạ, vị trí hay tin nhắn SMS của bạn.",
    ], table: { caption: "Loại dữ liệu và mục đích", columns: ["Loại dữ liệu", "Gồm những gì", "Để làm gì"], rows: [
      ["Tài khoản", "Email, tên hiển thị, ảnh đại diện, mật khẩu (chỉ lưu dạng băm), mã tài khoản Google nếu bạn đăng nhập bằng Google, ngôn ngữ, múi giờ, cài đặt xác thực hai lớp", "Đăng nhập, nhận diện bạn và bảo vệ tài khoản"],
      ["Hồ sơ trong tổ chức", "Chức danh, mã nhân viên, số điện thoại (mặc định ẩn), nơi làm việc, giới thiệu — do bạn hoặc quản trị viên nhập", "Giúp đồng nghiệp biết bạn là ai"],
      ["Nội dung", "Tin nhắn, ảnh, tệp, tin thoại, công việc, tài liệu và các phiên bản của chúng, nội dung và phụ đề cuộc họp, email khi tổ chức kết nối hộp thư", "Cung cấp chính tính năng bạn dùng"],
      ["Cuộc gọi", "Âm thanh và video được truyền trực tiếp giữa người tham gia qua máy chủ cuộc gọi; chỉ được ghi lại khi một người trong cuộc gọi chủ động bật ghi", "Gọi thoại và gọi video"],
      ["Thiết bị và phiên đăng nhập", "Mã nhận thông báo đẩy (push token), nền tảng, tên thiết bị, phiên bản ứng dụng, địa chỉ IP và trình duyệt/ứng dụng của phiên đăng nhập", "Gửi thông báo, quản lý phiên, phát hiện truy cập bất thường"],
      ["Nhật ký hoạt động", "Hành động thay đổi dữ liệu (ai, lúc nào, làm gì) kèm địa chỉ IP và trình duyệt/ứng dụng", "Bảo mật, truy vết và giải quyết tranh chấp trong tổ chức"],
      ["Đo hiệu năng web", "Thời gian tải trang và độ phản hồi, không gắn với tài khoản", "Giữ trang web nhanh"],
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
      "Chúng tôi không bán dữ liệu cá nhân, không dùng dữ liệu để quảng cáo và không cài công cụ quảng cáo hay phân tích của bên thứ ba trong ứng dụng UniChat và UniOffice. Chúng tôi không dùng nội dung của bạn để huấn luyện mô hình AI.",
      "Thông báo đẩy có thể hiện tên người gửi, tên phòng và tối đa 120 ký tự đầu của tin nhắn văn bản (tin thoại, ảnh, tệp chỉ hiện nhãn). Nếu không muốn nội dung xuất hiện trên màn hình khóa, hãy tắt xem trước thông báo trong cài đặt của thiết bị.",
      `Báo cáo và chặn: khi bạn báo cáo một tin nhắn hoặc một người trong UniChat, chúng tôi lưu lý do, mô tả bạn viết và tin nhắn hoặc người liên quan. Chủ sở hữu và quản trị viên tổ chức của bạn thấy báo cáo trong Nhật ký hoạt động của tổ chức — lý do, người hoặc tin nhắn bị báo cáo và ai đã báo cáo — để xử lý; mô tả bạn viết không vào nhật ký mà được lưu cùng báo cáo, nằm trong bản xuất dữ liệu của tổ chức mà chỉ chủ sở hữu tải được. Người bị báo cáo không nhận thông báo nào, nhưng nếu họ là chủ sở hữu hoặc quản trị viên thì họ cũng xem được báo cáo. Bạn cũng có thể báo cáo thẳng với chúng tôi qua ${legalEntity.email}. Khi bạn chặn một người, hai bên không nhắn tin riêng được cho tới khi bạn bỏ chặn.`,
    ] },
    { title: "Tính năng AI", paragraphs: [
      "Khi bạn dùng một tính năng AI — hỏi Hỏi UNI, tóm tắt các tin chưa đọc, tóm tắt cuộc gọi, AI trong UniOffice — nội dung liên quan (tin nhắn kèm tên người gửi và thời gian, hoặc tài liệu và tệp bạn chọn) được máy chủ UniWork gửi tới nhà cung cấp mô hình AI, hiện là Anthropic, để tạo câu trả lời. Trong cuộc trò chuyện hay cuộc gọi chung, nội dung đó gồm cả tin nhắn và nội dung cuộc gọi của các thành viên khác: khi bất kỳ thành viên nào dùng AI trên cuộc trò chuyện hay cuộc gọi đó, tin nhắn của bạn trong đó cũng được gửi đi. AI chỉ chạy khi một thành viên yêu cầu; nội dung không được gửi tới AI ở chế độ nền. Trong ứng dụng UniChat cho Android và iPhone, trước lần đầu bạn dùng AI trên điện thoại, bạn được hỏi đồng ý (thông báo nêu tên nhà cung cấp và dữ liệu gửi đi); sự đồng ý đó chỉ áp dụng cho yêu cầu AI của chính bạn từ điện thoại, không áp dụng khi thành viên khác dùng AI trên web hay máy tính. Bạn rút lại đồng ý được bất cứ lúc nào trong Cài đặt → Quyền riêng tư và pháp lý của ứng dụng.",
      "Lịch sử hội thoại AI được mã hóa khi lưu. Cuộc hội thoại AI trong UniOffice tự hết hạn sau 30 phút không dùng và tối đa 24 giờ.",
    ] },
    { title: "UniOffice", paragraphs: [
      "UniOffice cho máy tính mở và lưu tệp ngay trên máy của bạn. Tệp trên máy chỉ được tải lên UniWork khi bạn chọn lưu nó vào một workspace; khi đó mỗi lần lưu tạo một phiên bản mới thay vì ghi đè. Bạn đăng nhập qua trình duyệt, và có thể xem hoặc thu hồi từng máy đã đăng nhập.",
      "Khi bạn mở hoặc xuất PDF, bảng tính hay định dạng cũ trên web, tệp được xử lý trên máy chủ chuyển đổi của chúng tôi trong cùng hạ tầng. Tệp chỉ nằm trong bộ nhớ tạm của lượt xử lý, bị xóa ngay khi xong và không được gửi cho bên thứ ba.",
      "Khóa API AI riêng: khóa bạn lưu trên UniWork được mã hóa và không bao giờ gửi về trình duyệt hay máy tính; yêu cầu đi qua máy chủ UniWork tới nhà cung cấp bạn chọn, và chúng tôi chỉ ghi số liệu sử dụng (nhà cung cấp, mô hình, số token), không ghi nội dung. Khóa bạn nhập trực tiếp trong UniOffice cho máy tính được lưu trên máy đó và ứng dụng gọi thẳng nhà cung cấp; UniWork không thấy khóa hay nội dung. Trong cả hai trường hợp, nội dung được xử lý theo điều khoản của nhà cung cấp bạn chọn, có thể ở ngoài Việt Nam.",
      "Liên kết chia sẻ công khai chỉ cho xem, hết hạn sau 7 ngày theo mặc định (tối đa 90 ngày) và có thể thu hồi; lượt xem được đếm mà không ghi địa chỉ của người xem. Máy chủ MCP cục bộ của UniOffice cho máy tính mặc định tắt; khi bạn bật, các chương trình trên cùng máy tính có thể điều khiển tài liệu đang mở.",
    ] },
    { title: "Bên nhận dữ liệu và nơi lưu trữ", paragraphs: [
      "Máy chủ ứng dụng, cơ sở dữ liệu, máy chủ chuyển đổi tài liệu và máy chủ cuộc gọi do chúng tôi vận hành tại Việt Nam. Chúng tôi chỉ chia sẻ dữ liệu với các nhà cung cấp dưới đây, trong phạm vi việc họ làm cho chúng tôi, hoặc khi pháp luật buộc phải cung cấp.",
    ], table: { caption: "Nhà cung cấp dịch vụ", columns: ["Nhà cung cấp", "Việc họ làm", "Nơi xử lý"], rows: [
      ["CMC Telecom", "Lưu ảnh, tệp, tài liệu và tin thoại", "Hà Nội, Việt Nam"],
      ["Anthropic", "Xử lý yêu cầu AI khi bạn dùng tính năng AI", "Hoa Kỳ"],
      ["Tavily hoặc Brave; OpenAI", "Chỉ khi tổ chức bật công cụ AI đám mây trong UniOffice: tìm kiếm web (câu truy vấn), tạo ảnh (mô tả và ảnh tham chiếu), chuyển giọng nói thành văn bản (tệp âm thanh)", "Hoa Kỳ"],
      ["Expo (650 Industries)", "Chuyển thông báo đẩy tới điện thoại; phân phối bản cập nhật ứng dụng di động", "Hoa Kỳ"],
      ["Google (Firebase Cloud Messaging), Apple (APNs)", "Đưa thông báo đẩy tới máy Android và iPhone", "Theo hạ tầng của Google và Apple"],
      ["Google", "Đăng nhập bằng Google (khi bạn chọn); gửi email hệ thống như mã xác minh", "Theo hạ tầng của Google"],
      ["GitHub", "Lưu bản cài và bản cập nhật UniChat, UniOffice cho máy tính", "Theo hạ tầng của GitHub"],
    ], layout: "wide-middle" } },
    { id: "delete-account", title: "Lưu giữ và xóa dữ liệu", paragraphs: [
      "Nội dung được giữ khi tổ chức còn dùng dịch vụ. Tin nhắn bạn xóa bị ẩn với mọi người ngay; tài liệu bị xóa nằm trong thùng rác 30 ngày rồi bị xóa vĩnh viễn; mỗi tài liệu giữ tối đa 500 phiên bản; tệp không còn được dùng ở đâu bị xóa khỏi kho lưu trữ trong lần dọn dẹp hằng ngày.",
      "Xóa tài khoản: trong ứng dụng UniChat vào Cài đặt → Xóa tài khoản, hoặc đăng nhập UniWork trên web và vào Cài đặt → Bảo mật → Xóa tài khoản; sau đó xác nhận lại danh tính. Email, tên, ảnh đại diện, mật khẩu, liên kết Google, số điện thoại và thông tin hồ sơ bị xóa; mọi phiên đăng nhập và mã nhận thông báo bị thu hồi. Nội dung bạn đã gửi trong tổ chức vẫn thuộc tổ chức đó và hiển thị dưới tên \"Người dùng đã xóa\". Nếu bạn đang là chủ một tổ chức, hãy chuyển quyền sở hữu trước.",
      "Xóa tổ chức: chủ tổ chức vào Cài đặt → Dữ liệu tổ chức để tải bản xuất dữ liệu hoặc yêu cầu xóa. Nội dung của tổ chức bị xóa vĩnh viễn sau 5 ngày và có thể hủy trong thời gian đó. Hóa đơn, chứng từ thanh toán và nhật ký hoạt động được giữ lại theo nghĩa vụ kế toán và bảo mật.",
      `Nếu không đăng nhập được, gửi yêu cầu xóa tới ${legalEntity.email} từ email của tài khoản.`,
    ] },
    { title: "Quyền của bạn", paragraphs: [
      `Theo Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân, bạn có quyền được biết, đồng ý hoặc rút lại đồng ý, xem và tải về, chỉnh sửa, xóa, hạn chế hoặc phản đối việc xử lý dữ liệu của mình, và khiếu nại. Phần lớn thông tin tài khoản bạn có thể tự sửa trong Cài đặt; các yêu cầu khác gửi tới ${legalEntity.email}. Chúng tôi xác minh danh tính trước khi xử lý và trả lời trong thời hạn pháp luật quy định.`,
      "Với nội dung thuộc workspace của tổ chức, chúng tôi có thể chuyển yêu cầu tới quản trị viên của tổ chức đó, vì họ quản lý nội dung này.",
    ] },
    { title: "Bảo mật", paragraphs: [
      "Dữ liệu được mã hóa khi truyền (HTTPS, WSS). Mật khẩu chỉ lưu dạng băm; khóa xác thực hai lớp, khóa API AI riêng và lịch sử hội thoại AI được mã hóa khi lưu. Quyền truy cập được kiểm tra theo tổ chức và workspace ở mọi yêu cầu, và mọi thay đổi dữ liệu được ghi vào nhật ký hoạt động không sửa được.",
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
  effective: { dateTime: "2026-10-21", text: "21 October 2026" },
  sections: [
    { title: "Who is responsible for your data", paragraphs: [
      `UniWork, UniOffice and UniChat are operated by ${legalEntity.nameEn} (enterprise code ${legalEntity.enterpriseCode}, registered office: ${legalEntity.addressEn}). Personal data contact: ${legalEntity.email}.`,
      "When your organization uses UniWork, it decides who joins its workspaces and what content goes into them. We process workspace content to provide the service to the organization; its administrators can see member information and content within their permissions.",
    ] },
    { title: "Data we collect", paragraphs: [
      "We collect only what is needed for you to sign in, work and talk with colleagues. The apps do not read your contacts, location or SMS messages.",
    ], table: { caption: "Data types and purposes", columns: ["Data type", "What it includes", "Why"], rows: [
      ["Account", "Email, display name, profile photo, password (stored only as a hash), Google account id if you sign in with Google, language, time zone, two-factor settings", "Sign-in, identifying you and protecting your account"],
      ["Organization profile", "Job title, employee code, phone number (hidden by default), location, bio — entered by you or an administrator", "Letting colleagues know who you are"],
      ["Content", "Messages, photos, files, voice messages, tasks, documents and their versions, meeting content and captions, email when the organization connects a mailbox", "Providing the feature you use"],
      ["Calls", "Audio and video relayed live between participants through the call server; recorded only when a participant explicitly starts a recording", "Voice and video calls"],
      ["Devices and sessions", "Push notification token, platform, device name, app version, IP address and browser/app of each session", "Sending notifications, managing sessions, detecting unusual access"],
      ["Activity log", "Actions that change data (who, when, what) with IP address and browser/app", "Security, traceability and resolving disputes within the organization"],
      ["Web performance", "Page load and responsiveness timings, not linked to an account", "Keeping the website fast"],
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
      "We do not sell personal data, do not use it for advertising and do not include third-party advertising or analytics tools in the UniChat and UniOffice apps. We do not use your content to train AI models.",
      "Push notifications may show the sender's name, the room name and up to the first 120 characters of a text message (voice messages, photos and files show only a label). To keep content off your lock screen, turn off notification previews in your device settings.",
      `Reports and blocking: when you report a message or a person in UniChat, we store the reason, the words you add and the message or person concerned. Your organization's owners and admins see the report in the organization's Activity log — the reason, the person or message reported and who reported it — so they can act on it; the words you add stay out of the log and are kept with the report, in the organization's data export that only the owner can download. The person reported is not notified, but if they are an owner or admin they can see the report too. You can also report directly to us at ${legalEntity.email}. When you block someone, neither of you can message the other directly until you unblock them.`,
    ] },
    { title: "AI features", paragraphs: [
      "When you use an AI feature — asking Ask UNI, summarizing unread messages, summarizing a call, AI in UniOffice — the relevant content (messages with sender names and times, or the documents and files you choose) is sent by the UniWork server to the AI model provider, currently Anthropic, to produce the answer. In a shared conversation or call, that content includes other members' messages and call content: whenever any member uses AI on a conversation or call, your messages in it are sent too. AI runs only when a member asks; content is not sent to AI in the background. In the UniChat apps for Android and iPhone you are asked to agree before you first use AI on the phone (the notice names the provider and what is sent); that agreement covers only your own AI requests from the phone, not another member's use of AI on the web or desktop. You can withdraw at any time in the app's Settings → Privacy & legal.",
      "AI conversation history is encrypted at rest. A UniOffice AI conversation expires after 30 minutes of inactivity and after 24 hours at most.",
    ] },
    { title: "UniOffice", paragraphs: [
      "UniOffice for desktop opens and saves files on your computer. A local file is uploaded to UniWork only when you choose to save it to a workspace; each save then creates a new version instead of overwriting the last one. You sign in through your browser and can review or revoke each signed-in computer.",
      "When you open or export a PDF, spreadsheet or legacy format on the web, the file is processed by our conversion server in the same infrastructure. The file exists only in the job's temporary storage, is deleted as soon as the job ends and is not sent to any third party.",
      "Your own AI API key: a key you save on UniWork is encrypted and never sent back to a browser or computer; requests pass through the UniWork server to the provider you chose, and we record only usage figures (provider, model, token counts), never content. A key you enter directly in UniOffice for desktop is stored on that computer and the app calls the provider directly; UniWork sees neither the key nor the content. Either way, content is processed under the terms of the provider you chose, which may be outside Vietnam.",
      "Public share links are view-only, expire after 7 days by default (90 at most) and can be revoked; views are counted without recording the viewer's address. UniOffice for desktop's local MCP server is off by default; once you turn it on, programs on the same computer can control the open document.",
    ] },
    { title: "Who receives data and where it is stored", paragraphs: [
      "The application servers, database, document conversion server and call server are operated by us in Vietnam. We share data only with the providers below, for the work they do for us, or when the law requires it.",
    ], table: { caption: "Service providers", columns: ["Provider", "What they do", "Where"], rows: [
      ["CMC Telecom", "Storing photos, files, documents and voice messages", "Hanoi, Vietnam"],
      ["Anthropic", "Processing AI requests when you use an AI feature", "United States"],
      ["Tavily or Brave; OpenAI", "Only when an organization turns on UniOffice cloud AI tools: web search (the query), image generation (the prompt and reference images), speech to text (the audio file)", "United States"],
      ["Expo (650 Industries)", "Relaying push notifications to phones; delivering mobile app updates", "United States"],
      ["Google (Firebase Cloud Messaging), Apple (APNs)", "Delivering push notifications to Android phones and iPhones", "Google's and Apple's infrastructure"],
      ["Google", "Sign in with Google (when you choose it); sending system email such as verification codes", "Google's infrastructure"],
      ["GitHub", "Hosting UniChat and UniOffice desktop installers and updates", "GitHub's infrastructure"],
    ], layout: "wide-middle" } },
    { id: "delete-account", title: "Retention and deletion", paragraphs: [
      "Content is kept while the organization uses the service. A message you delete is hidden from everyone immediately; a deleted document stays in the trash for 30 days and is then permanently deleted; each document keeps up to 500 versions; files no longer used anywhere are removed from storage by a daily clean-up.",
      "Deleting your account: in the UniChat app open Settings → Delete account, or sign in to UniWork on the web and open Settings → Security → Delete account; then confirm your identity. Your email, name, profile photo, password, Google link, phone number and profile details are removed, and every session and notification token is revoked. Content you posted in an organization stays with that organization and is shown as \"Deleted user\". If you own an organization, transfer ownership first.",
      "Deleting an organization: the owner opens Settings → Organization data to download a data export or request deletion. The organization's content is permanently deleted after 5 days and the request can be cancelled until then. Invoices, payment records and the activity log are kept for accounting and security obligations.",
      `If you cannot sign in, email a deletion request to ${legalEntity.email} from the account's email address.`,
    ] },
    { title: "Your rights", paragraphs: [
      `Under Vietnam's Decree 13/2023/ND-CP on personal data protection, you may be informed, give or withdraw consent, view and download, correct, delete, restrict or object to the processing of your data, and complain. You can edit most account details yourself in Settings; send other requests to ${legalEntity.email}. We verify your identity before acting and reply within the time the law requires.`,
      "For content that belongs to an organization's workspace, we may refer your request to that organization's administrators, since they manage it.",
    ] },
    { title: "Security", paragraphs: [
      "Data is encrypted in transit (HTTPS, WSS). Passwords are stored only as hashes; two-factor secrets, your own AI API keys and AI conversation history are encrypted at rest. Access is checked against the organization and workspace on every request, and every data change is written to an activity log that cannot be altered.",
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
