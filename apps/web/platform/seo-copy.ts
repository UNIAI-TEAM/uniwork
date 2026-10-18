import type { SupportedLocale } from "@uniwork/core/i18n/types";

const features: Record<string, [string, string]> = {
  dashboard: ["Team dashboard and work overview", "Tổng quan công việc và dự án của đội nhóm"],
  tasks: ["Task management and assignment for teams", "Quản lý và giao việc cho đội nhóm"],
  projects: ["Project management and team progress", "Quản lý dự án và theo dõi tiến độ"],
  today: ["Plan your workday and priorities", "Lập kế hoạch công việc trong ngày"],
  calendar: ["Team calendar and work schedules", "Lịch làm việc và cuộc họp của đội nhóm"],
  workflows: ["Team workflows: capabilities and availability", "Quy trình công việc: khả năng và phạm vi hỗ trợ"],
  meetings: ["Online meetings connected to team tasks", "Họp trực tuyến kết nối với công việc"],
  chat: ["Team chat connected to your work", "Trao đổi nhóm gắn với công việc"],
  email: ["Team email alongside tasks and conversations", "Email gắn với công việc và trao đổi nhóm"],
  outputs: ["Work deliverables: examples and availability", "Kết quả công việc: ví dụ và phạm vi hỗ trợ"],
  documents: ["Team documents and connected Office editors", "Tài liệu nhóm và trình soạn thảo Office"],
  approvals: ["Work approvals: examples and availability", "Phê duyệt công việc: ví dụ và phạm vi hỗ trợ"],
  knowledge: ["Team knowledge: context and capabilities", "Tri thức đội nhóm: ngữ cảnh và khả năng hỗ trợ"],
  ask: ["AI assistant for team work and context", "Trợ lý AI cho công việc và ngữ cảnh nhóm"],
  agents: ["AI teammates: management and availability", "Nhân sự AI: quản lý và phạm vi hỗ trợ"],
  automation: ["Work automation: examples and availability", "Tự động hóa công việc: ví dụ và phạm vi hỗ trợ"],
  organization: ["Organization, workspace and team permissions", "Tổ chức, workspace và phân quyền đội nhóm"],
  audit: ["Activity history and audit trails for teams", "Nhật ký hoạt động và truy vết thay đổi"],
};
const pages: Record<string, { title: [string, string]; description: [string, string] }> = {
  home: { title: ["Work, projects and AI for teams", "Quản lý công việc, dự án và AI cho đội nhóm"], description: ["Connect tasks, projects, conversations, meetings and AI in one UniWork workspace. Explore the product and request a demo for your team.", "Kết nối công việc, dự án, trao đổi, cuộc họp và AI trong một workspace UniWork. Khám phá sản phẩm và yêu cầu demo cho đội nhóm."] },
  apps: { title: ["UniWork apps — one account on the web, desktop and phone", "Ứng dụng UniWork — một tài khoản trên web, máy tính và điện thoại"], description: ["Every UniWork app in one place: UniWork on the web, UniWork Office for Windows, macOS and Linux, and UniChat for desktop and phone. See what each one does and download the builds published for your device.", "Mọi ứng dụng UniWork ở một nơi: UniWork trên web, UniWork Office cho Windows, macOS và Linux, và UniChat cho máy tính và điện thoại. Xem mỗi ứng dụng làm gì và tải bản đã phát hành cho máy của bạn."] },
  office: { title: ["UniWork Office — documents, spreadsheets and PDF with AI", "UniWork Office — soạn thảo, bảng tính và PDF với AI"], description: ["Explore UniWork Office for Windows, macOS and Linux: documents, spreadsheets, slides, PDF, HTML and Markdown. See file, AI and workspace capabilities and available trial downloads.", "Khám phá UniWork Office cho Windows, macOS và Linux: văn bản, bảng tính, trình chiếu, PDF, HTML và Markdown. Tìm hiểu file, AI, workspace và tải bản dùng thử hiện có."] },
  unichat: { title: ["UniChat — UniWork chat for desktop and mobile", "UniChat — chat của UniWork cho máy tính và điện thoại"], description: ["UniChat is the UniWork chat app for Windows, macOS, Linux, iPhone and Android. Turn messages into tasks, link channels to projects and follow up inside the conversation. See which builds are published.", "UniChat là ứng dụng chat của UniWork cho Windows, macOS, Linux, iPhone và Android. Chuyển tin nhắn thành việc, gắn kênh với dự án và nhắc việc ngay trong cuộc trò chuyện. Xem các bản đã phát hành."] },
  features: { title: ["Team work management features", "Các tính năng quản lý công việc đội nhóm"], description: ["Explore UniWork tasks, projects, meetings, chat, documents and AI. Check examples, current capabilities and development status for each feature.", "Khám phá công việc, dự án, họp, trao đổi, tài liệu và AI trong UniWork. Xem ví dụ, khả năng hiện có và trạng thái phát triển của từng tính năng."] },
  solutions: { title: ["Work management solutions for teams", "Giải pháp quản lý công việc cho đội nhóm"], description: ["Find UniWork workflows for product and operations teams, with connected tasks, conversations and shared context.", "Tìm hiểu cách nhóm sản phẩm và vận hành dùng UniWork để kết nối công việc, trao đổi và ngữ cảnh chung."] },
  product: { title: ["Work and project management for product teams", "Quản lý công việc và dự án cho nhóm sản phẩm"], description: ["Explore how product teams connect meetings, tasks and project context in UniWork, with examples and the scope of available features.", "Tìm hiểu cách nhóm sản phẩm kết nối cuộc họp, công việc và ngữ cảnh dự án trong UniWork, kèm ví dụ và phạm vi tính năng hiện có."] },
  operations: { title: ["Work management for operations teams", "Quản lý công việc cho nhóm vận hành"], description: ["Explore task assignments, conversations and traceable context for operations teams in UniWork.", "Khám phá cách giao việc, trao đổi và theo dõi ngữ cảnh công việc của nhóm vận hành trong UniWork."] },
  pricing: { title: ["UniWork pricing and Starter plan", "Bảng giá UniWork và gói Starter"], description: ["Review the current UniWork Starter offer, usage categories and conditions to confirm before introducing the product to your team.", "Xem gói Starter hiện có của UniWork, các nhóm hạn mức sử dụng và điều kiện cần xác nhận trước khi triển khai cho đội nhóm."] },
  enterprise: { title: ["UniWork for enterprise teams and permissions", "UniWork cho doanh nghiệp và phân quyền đội nhóm"], description: ["Review organization and workspace structure, permissions and audit capabilities for your enterprise's UniWork evaluation.", "Tìm hiểu cấu trúc tổ chức, workspace, phân quyền và nhật ký hoạt động khi đánh giá UniWork cho doanh nghiệp."] },
  learn: { title: ["UniWork guides: tasks, meetings and Office", "Hướng dẫn UniWork: công việc, cuộc họp và Office"], description: ["Start with a practical workflow. Read guides on team tasks, meeting follow-up, and Office files, AI and workspace connections.", "Bắt đầu từ một quy trình thực tế. Đọc hướng dẫn về công việc nhóm, việc sau cuộc họp và file, AI, kết nối workspace trong Office."] },
  why: { title: ["Why UniWork — connected work and team context", "Vì sao chọn UniWork — kết nối công việc và ngữ cảnh nhóm"], description: ["Evaluate UniWork's connected work model, product examples and current scope before choosing it for your team.", "Đánh giá cách UniWork kết nối công việc, ví dụ sản phẩm và phạm vi hiện có trước khi lựa chọn cho đội nhóm."] },
  changelog: { title: ["UniWork changelog and product updates", "Nhật ký cập nhật sản phẩm UniWork"], description: ["Read published UniWork release notes, improvements and fixes by version and date.", "Xem ghi chú các phiên bản UniWork đã phát hành, tính năng cải tiến và lỗi được sửa theo ngày và phiên bản."] },
  demo: { title: ["Request a UniWork demo for your team", "Yêu cầu demo UniWork cho đội nhóm"], description: ["Tell UniWork about your team and the workflow you want to explore. Submit a demo request for follow-up.", "Chia sẻ về đội nhóm và quy trình bạn muốn tìm hiểu. Gửi yêu cầu demo UniWork để được tiếp nhận và trao đổi thêm."] },
  about: { title: ["About UniWork and UniWork Office", "Giới thiệu UniWork và UniWork Office"], description: ["Learn what UniWork and UniWork Office do, how to evaluate the product and where to ask about deployment, pricing and data handling.", "Tìm hiểu UniWork, UniWork Office, cách đánh giá sản phẩm và nơi trao đổi về triển khai, chi phí và xử lý dữ liệu."] },
  security: { title: ["UniWork data, access and AI connections", "Dữ liệu, quyền truy cập và kết nối AI trong UniWork"], description: ["Understand organization and workspace access, shared links, local Office files and connected AI before using UniWork with your team's data.", "Tìm hiểu quyền tổ chức và workspace, liên kết chia sẻ, file Office trên máy và AI có kết nối trước khi sử dụng dữ liệu của đội nhóm."] },
  "start-with-tasks": { title: ["How to start managing team tasks in UniWork", "Hướng dẫn bắt đầu quản lý công việc nhóm với UniWork"], description: ["A practical guide to choosing a workspace, defining a task, assigning an owner and reviewing progress in UniWork.", "Hướng dẫn chọn workspace, làm rõ công việc, giao người phụ trách và theo dõi tiến độ trong UniWork."] },
  "office-files-and-ai": { title: ["UniWork Office guide: local files, AI and workspace", "Hướng dẫn UniWork Office: file trên máy, AI và workspace"], description: ["Learn the difference between local Office files and workspace documents, when a connection is needed and how to check AI results.", "Phân biệt file Office trên máy và tài liệu trong workspace, khi nào cần kết nối và cách kiểm tra kết quả AI."] },
  "meetings-to-tasks": { title: ["From a meeting to team tasks in UniWork", "Từ cuộc họp đến công việc của nhóm trong UniWork"], description: ["A practical guide to capturing decisions, reviewing follow-up work and assigning tasks after a team meeting.", "Hướng dẫn ghi nhận quyết định, rà soát việc cần làm và giao công việc sau cuộc họp của đội nhóm."] },
};

export function seoCopy(key: string, locale: SupportedLocale) {
  const index = locale === "vi" ? 1 : 0;
  const entry = pages[key];
  if (entry) return { title: entry.title[index], description: entry.description[index] };
  const title = features[key]?.[index];
  if (!title) throw new Error(`Missing public SEO copy: ${key}`);
  return { title, description: locale === "vi" ? `Tìm hiểu ${title.toLocaleLowerCase("vi") } trong UniWork. Xem ví dụ sản phẩm, cách kết nối với đội nhóm và phạm vi hỗ trợ hiện có.` : `Explore ${title.toLowerCase()} in UniWork. See product examples, connected team workflows and the current scope of support.` };
}
