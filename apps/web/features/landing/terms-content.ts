import type { SupportedLocale } from "@uniwork/core/i18n/types";
import { legalEntity } from "../../platform/site-information";
import type { GuideContent } from "./guide-content";

/**
 * The terms of use (audit "i18n & store compliance", missed: no terms or EULA):
 * what every account agrees to on sign-up and sign-in, the URL the stores and
 * the UniChat app link (apps/chat-mobile/lib/legal-links.ts). Apple 1.2 and
 * Google Play's UGC policy want the terms to forbid objectionable content and
 * abusive users with no tolerance and to say how reports are handled: the
 * section with the fixed anchor #acceptable-use does, and its 24-hour
 * commitment is what the operator's queue (/admin/chat-reports, alert
 * UniChatReportFiled) and contact inbox have to honour. It promises only
 * what the operator and an organization can do today: deactivate a member,
 * suspend an organization; no one deletes another member's message. The App Store section carries
 * Apple's minimum terms for a custom EULA. A statement about the product
 * mirrors what the code does, as in privacy-content.ts: change the product,
 * change this page in the same PR.
 */
const vi: GuideContent = {
  introduction: "Điều khoản này là thỏa thuận giữa bạn và đơn vị vận hành khi bạn dùng UniWork, UniOffice và ứng dụng UniChat (web, máy tính, Android, iPhone). Khi tạo tài khoản hoặc đăng nhập, bạn đồng ý với điều khoản này và với chính sách quyền riêng tư.",
  effective: { dateTime: "2026-10-22", text: "22/10/2026" },
  sections: [
    { title: "Các bên và phạm vi", paragraphs: [
      `UniWork, UniOffice và UniChat do ${legalEntity.nameVi} (mã số doanh nghiệp ${legalEntity.enterpriseCode}, trụ sở: ${legalEntity.addressVi}) vận hành, gọi là "chúng tôi". Liên hệ: ${legalEntity.email}.`,
      "Dịch vụ dành cho người từ 18 tuổi dùng trong công việc. Nếu bạn tạo một tổ chức hoặc quản trị nó, bạn đồng ý thay mặt tổ chức đó và xác nhận mình có thẩm quyền làm vậy. Khi tổ chức của bạn có hợp đồng riêng với chúng tôi, hợp đồng đó được ưu tiên ở phần nó quy định khác điều khoản này.",
    ] },
    { title: "Tài khoản của bạn", paragraphs: [
      "Hãy dùng thông tin thật khi đăng ký, giữ mật khẩu và mã xác thực hai lớp cho riêng mình, và báo cho chúng tôi ngay khi nghi tài khoản bị người khác dùng. Bạn chịu trách nhiệm về hoạt động diễn ra trong tài khoản của mình.",
      "Bạn có thể xem và thu hồi từng thiết bị đã đăng nhập, và xóa tài khoản bất cứ lúc nào — trong ứng dụng UniChat ở Cài đặt → Xóa tài khoản, hoặc trên web ở Cài đặt → Bảo mật → Xóa tài khoản. Chính sách quyền riêng tư nói dữ liệu nào bị xóa và dữ liệu nào ở lại với tổ chức.",
    ] },
    { title: "Tổ chức, workspace và nội dung", paragraphs: [
      "Nội dung bạn đưa vào workspace — tin nhắn, tệp, công việc, tài liệu, cuộc họp — thuộc tổ chức sở hữu workspace đó. Chủ sở hữu và quản trị viên của tổ chức quyết định ai được tham gia, có thể xem nội dung theo quyền của họ, và có thể gỡ bạn khỏi tổ chức.",
      "Bạn giữ quyền đối với nội dung của mình. Bạn cho phép chúng tôi lưu trữ, sao chép, truyền và xử lý nội dung đó chỉ trong phạm vi cần để cung cấp, bảo vệ và khắc phục sự cố dịch vụ cho bạn và tổ chức của bạn, như chính sách quyền riêng tư mô tả. Bạn bảo đảm mình có quyền đưa nội dung đó vào dịch vụ.",
    ] },
    { id: "acceptable-use", title: "Không chấp nhận nội dung phản cảm và hành vi lạm dụng", paragraphs: [
      "Chúng tôi không chấp nhận bất kỳ nội dung phản cảm nào hay người dùng lạm dụng người khác. Bạn không được dùng dịch vụ để tạo, gửi hoặc chia sẻ:",
    ], steps: [
      "Nội dung vi phạm pháp luật Việt Nam hoặc pháp luật nơi bạn dùng dịch vụ.",
      "Quấy rối, bắt nạt, đe dọa, hoặc kích động bạo lực đối với bất kỳ ai.",
      "Nội dung thù ghét hay phân biệt đối xử vì chủng tộc, dân tộc, tôn giáo, giới tính, xu hướng tính dục, khuyết tật hay đặc điểm tương tự.",
      "Nội dung khiêu dâm; bất kỳ nội dung nào lạm dụng hoặc tình dục hóa trẻ em.",
      "Nội dung cổ vũ tự gây hại hoặc tự tử.",
      "Spam, lừa đảo, mã độc, hoặc mạo danh người hay tổ chức khác.",
      "Nội dung xâm phạm quyền sở hữu trí tuệ, bí mật kinh doanh hay dữ liệu cá nhân của người khác.",
    ] },
    { title: "Báo cáo, chặn và cách chúng tôi xử lý", paragraphs: [
      "Trong UniChat, bạn báo cáo một tin nhắn hoặc một người bằng cách nhấn giữ tin nhắn rồi chọn Báo cáo, hoặc từ thông tin cuộc trò chuyện; bạn cũng chặn được người đó. Chủ sở hữu và quản trị viên tổ chức của bạn thấy báo cáo để xử lý trong tổ chức.",
      `Chúng tôi cũng nhận mọi báo cáo gửi trong ứng dụng, và bạn có thể báo cáo thẳng với chúng tôi qua ${legalEntity.email}. Chúng tôi xem xét mọi báo cáo trong vòng 24 giờ. Khi nội dung vi phạm điều khoản, chúng tôi yêu cầu tổ chức vô hiệu hoá tài khoản đã đăng nó, và tạm ngưng tổ chức — khi đó không ai trong tổ chức xem được nội dung nữa — nếu việc đó không được làm hoặc vi phạm nghiêm trọng.`,
    ] },
    { title: "Tính năng AI", paragraphs: [
      "Các tính năng AI tạo ra câu trả lời, bản tóm tắt và nội dung có thể sai hoặc thiếu. Hãy kiểm tra kết quả trước khi dựa vào nó hay gửi cho người khác. AI chỉ chạy khi một thành viên yêu cầu; nội dung được gửi tới nhà cung cấp mô hình AI như chính sách quyền riêng tư mô tả, và không được dùng để huấn luyện mô hình AI.",
    ] },
    { title: "Dùng dịch vụ đúng cách", paragraphs: [
      "Bạn không được tìm cách vượt qua kiểm soát truy cập hay bảo mật, truy cập dữ liệu của tổ chức khác, làm quá tải hay gián đoạn dịch vụ, hoặc thu thập dữ liệu hàng loạt bằng công cụ tự động ngoài các API và kết nối chúng tôi công bố. Bạn không được dịch ngược phần mềm, trừ khi pháp luật cho phép.",
    ] },
    { title: "Phần mềm và thương hiệu", paragraphs: [
      "Phần mềm, giao diện và thương hiệu UniWork, UniOffice, UniChat thuộc về chúng tôi. Khi bạn dùng dịch vụ, chúng tôi cấp cho bạn quyền sử dụng cá nhân, không độc quyền, không chuyển nhượng được và có thể thu hồi để dùng ứng dụng theo điều khoản này. Các thành phần mã nguồn mở đi kèm tuân theo giấy phép riêng của chúng (danh sách trong ứng dụng UniChat ở Cài đặt → Quyền riêng tư và pháp lý → Giấy phép mã nguồn mở).",
    ] },
    { title: "Tạm ngưng và chấm dứt", paragraphs: [
      "Chúng tôi có thể gỡ nội dung, tạm ngưng hoặc chấm dứt tài khoản hay tổ chức vi phạm điều khoản này hoặc gây rủi ro cho người dùng khác hay cho dịch vụ, và sẽ báo cho bạn khi pháp luật và hoàn cảnh cho phép. Bạn có thể ngừng dùng dịch vụ và xóa tài khoản bất cứ lúc nào.",
    ] },
    { title: "Dịch vụ được cung cấp như thế nào", paragraphs: [
      "Chúng tôi cố gắng giữ dịch vụ ổn định và an toàn, nhưng dịch vụ có thể bị gián đoạn để bảo trì hoặc vì sự cố, và tính năng có thể thay đổi. Trong phạm vi pháp luật cho phép, dịch vụ được cung cấp theo hiện trạng, và chúng tôi không chịu trách nhiệm về thiệt hại gián tiếp hay mất lợi nhuận phát sinh từ việc dùng dịch vụ. Không điều gì ở đây hạn chế quyền của bạn mà pháp luật về bảo vệ người tiêu dùng không cho phép hạn chế.",
    ] },
    { title: "Ứng dụng tải từ App Store hoặc Google Play", paragraphs: [
      "Thỏa thuận này là giữa bạn và chúng tôi, không phải với Apple hay Google. Chúng tôi, không phải Apple hay Google, chịu trách nhiệm về ứng dụng UniChat, việc bảo trì, hỗ trợ và mọi khiếu nại liên quan đến nó, kể cả khiếu nại về trách nhiệm sản phẩm, tuân thủ pháp luật hay quyền sở hữu trí tuệ của bên thứ ba. Apple không có nghĩa vụ bảo trì hay hỗ trợ ứng dụng; nếu ứng dụng không đúng với cam kết bảo hành nào áp dụng, bạn có thể báo cho Apple để được hoàn tiền mua ứng dụng (nếu có), và Apple không có nghĩa vụ bảo hành nào khác. Bạn xác nhận mình không ở quốc gia bị Hoa Kỳ cấm vận và không thuộc danh sách bị hạn chế của chính phủ Hoa Kỳ. Bạn còn phải tuân theo điều khoản của cửa hàng ứng dụng. Apple và các công ty con của Apple là bên thụ hưởng thứ ba của điều khoản này và có quyền thực thi nó với bạn.",
    ] },
    { title: "Luật áp dụng", paragraphs: [
      "Điều khoản này được điều chỉnh bởi pháp luật Việt Nam. Tranh chấp được giải quyết trước hết bằng thương lượng; nếu không thành, tranh chấp được đưa ra tòa án có thẩm quyền tại Hà Nội, trừ khi pháp luật cho bạn quyền chọn nơi khác.",
    ] },
    { title: "Thay đổi điều khoản", paragraphs: [
      "Khi điều khoản thay đổi, chúng tôi cập nhật trang này và ngày hiệu lực dưới tiêu đề; thay đổi quan trọng được thông báo trong ứng dụng hoặc qua email trước khi áp dụng. Tiếp tục dùng dịch vụ sau ngày hiệu lực nghĩa là bạn đồng ý với điều khoản mới.",
    ] },
  ],
  related: ["/privacy", "/security", "/apps/unichat"],
};

const en: GuideContent = {
  introduction: "These terms are the agreement between you and the operator when you use UniWork, UniOffice and the UniChat apps (web, desktop, Android, iPhone). By creating an account or signing in, you agree to these terms and to the privacy policy.",
  effective: { dateTime: "2026-10-22", text: "22 October 2026" },
  sections: [
    { title: "Who we are and what this covers", paragraphs: [
      `UniWork, UniOffice and UniChat are operated by ${legalEntity.nameEn} (enterprise code ${legalEntity.enterpriseCode}, registered office: ${legalEntity.addressEn}), "we". Contact: ${legalEntity.email}.`,
      "The service is for people aged 18 or over, for their work. If you create or administer an organization, you agree on its behalf and confirm you have the authority to do so. When your organization has a separate contract with us, that contract prevails where it differs from these terms.",
    ] },
    { title: "Your account", paragraphs: [
      "Use accurate details when you sign up, keep your password and two-factor codes to yourself, and tell us straight away if you think someone else is using your account. You are responsible for what happens in your account.",
      "You can see and revoke each device that is signed in, and delete your account at any time — in the UniChat app under Settings → Delete account, or on the web under Settings → Security → Delete account. The privacy policy says which data is erased and which stays with the organization.",
    ] },
    { title: "Organizations, workspaces and content", paragraphs: [
      "What you put in a workspace — messages, files, tasks, documents, meetings — belongs to the organization that owns the workspace. The organization's owners and admins decide who joins, can see content within their permissions, and can remove you from the organization.",
      "You keep your rights in your content. You let us store, copy, transmit and process it only as far as needed to provide, protect and troubleshoot the service for you and your organization, as the privacy policy describes. You confirm that you have the right to put that content in the service.",
    ] },
    { id: "acceptable-use", title: "Zero tolerance for objectionable content and abuse", paragraphs: [
      "We do not tolerate objectionable content or users who abuse others. You may not use the service to create, send or share:",
    ], steps: [
      "Content that breaks the law of Vietnam or of the place where you use the service.",
      "Harassment, bullying, threats, or incitement to violence against anyone.",
      "Hateful or discriminatory content based on race, ethnicity, religion, gender, sexual orientation, disability or a similar trait.",
      "Sexually explicit content; any content that abuses or sexualizes children.",
      "Content that encourages self-harm or suicide.",
      "Spam, scams, malware, or impersonation of another person or organization.",
      "Content that infringes someone else's intellectual property, trade secrets or personal data.",
    ] },
    { title: "Reporting, blocking and how we act", paragraphs: [
      "In UniChat, report a message or a person by long-pressing the message and choosing Report, or from the conversation's details; you can block that person too. Your organization's owners and admins see the report and act on it within the organization.",
      `We also receive every report made in the apps, and you can report content or a user to us directly at ${legalEntity.email}. We review every report within 24 hours. When the content breaks these terms, we have the organization deactivate the account that posted it, and we suspend the organization — after which no one in it can see the content — if that is not done or the breach is serious.`,
    ] },
    { title: "AI features", paragraphs: [
      "AI features produce answers, summaries and content that can be wrong or incomplete. Check the result before you rely on it or share it. AI runs only when a member asks; content goes to the AI model provider as the privacy policy describes, and it is not used to train AI models.",
    ] },
    { title: "Using the service properly", paragraphs: [
      "You may not try to get around access or security controls, reach another organization's data, overload or disrupt the service, or bulk-collect data with automated tools other than the APIs and connections we publish. You may not reverse-engineer the software except where the law allows it.",
    ] },
    { title: "Software and brands", paragraphs: [
      "The UniWork, UniOffice and UniChat software, interfaces and brands are ours. While you use the service, we grant you a personal, non-exclusive, non-transferable, revocable license to use the apps under these terms. Open-source components shipped with them are under their own licenses (listed in the UniChat app under Settings → Privacy & legal → Open-source licenses).",
    ] },
    { title: "Suspension and termination", paragraphs: [
      "We may remove content, and suspend or terminate an account or organization that breaks these terms or puts other users or the service at risk, and we will tell you when the law and the circumstances allow. You can stop using the service and delete your account at any time.",
    ] },
    { title: "How the service is provided", paragraphs: [
      "We work to keep the service stable and secure, but it can be interrupted for maintenance or by incidents, and features can change. To the extent the law allows, the service is provided as is, and we are not liable for indirect damage or lost profits arising from its use. Nothing here limits rights you have under consumer protection law that cannot be limited.",
    ] },
    { title: "Apps from the App Store or Google Play", paragraphs: [
      "This agreement is between you and us, not Apple or Google. We, not Apple or Google, are responsible for the UniChat app, its maintenance and support, and any claim about it, including product liability, legal compliance and third-party intellectual property claims. Apple has no obligation to maintain or support the app; if it fails to conform to any applicable warranty, you may notify Apple for a refund of its purchase price (if any), and Apple has no other warranty obligation. You confirm that you are not in a country under a United States embargo and are not on a United States government list of restricted parties. You must also follow the app store's terms. Apple and its subsidiaries are third-party beneficiaries of these terms and may enforce them against you.",
    ] },
    { title: "Governing law", paragraphs: [
      "These terms are governed by the law of Vietnam. A dispute is first settled by negotiation; failing that, it goes to the competent court in Hanoi, unless the law gives you the right to choose another forum.",
    ] },
    { title: "Changes to these terms", paragraphs: [
      "When these terms change, we update this page and the effective date under its title; important changes are announced in the app or by email before they apply. Continuing to use the service after the effective date means you accept the new terms.",
    ] },
  ],
  related: ["/privacy", "/security", "/apps/unichat"],
};

export function termsContent(locale: SupportedLocale): GuideContent {
  return locale === "vi" ? vi : en;
}
