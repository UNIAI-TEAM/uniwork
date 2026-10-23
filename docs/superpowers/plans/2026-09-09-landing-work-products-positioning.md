# Landing page: Work Products và định vị so với các nền tảng hiện tại — Implementation Plan

> **Trạng thái:** in-progress — Lập 2026-09-09 (quangpd). Thực thi dưới UNI-504 (nhánh `feature/UNI-504-trang-cong-khai-landing-page-dai-tin-cay`) hoặc một sub-issue của nó.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm một khối Work Products và một khối dẫn sang phân tích thị trường vào trang chủ, cộng một trang mới `/why-uniwork` chứa toàn bộ phân tích bốn nền tảng đối thủ.

**Architecture:** Thuần front-end tĩnh. Ba component section mới trong `apps/web/features/landing/`, một component trang mới dựng theo khuôn `solution-page.tsx`, một route mới trong `apps/web/app/`, khoảng 150 khóa i18n mới cho cả `vi` và `en`, và một ảnh artwork mới đi qua pipeline `scripts/landing/prompts.json` đã có. Không có thay đổi phía Go, không migration, không endpoint.

**Tech Stack:** Next.js App Router, React 19, TypeScript strict, Tailwind + token ngữ nghĩa trong `packages/ui/styles/tokens.css`, `react-i18next`, GSAP + ScrollTrigger qua `features/landing/animation/`, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-landing-work-products-positioning-design.md`

## Global Constraints

- **Ngôn ngữ:** mọi chuỗi hiển thị đi qua `t()`. Khóa mới phải có ở **cả** `packages/core/i18n/locales/vi.json` và `en.json`, nếu không `packages/core/i18n/parity.test.ts` fail. Bản `vi` là bản gốc; bản `en` là bản dịch.
- **Màu:** chỉ dùng class ngữ nghĩa (`bg-background`, `bg-surface`, `bg-muted`, `text-muted-foreground`, `text-brand`, `text-brand-accent`, `text-info`, `text-warning`, `border-border`). Không màu cứng, không token `--uw-*` — `scripts/no-legacy-tokens.test.mjs` chặn.
- **Cỡ chữ:** dùng thang vai trò `text-caption` / `text-body` / `text-body-lg` / `text-label` / `text-title` / `text-title-sm` / `text-display` / `text-hero-sm`, không dùng thang mặc định của Tailwind.
- **Chuyển động:** chỉ dùng `revealFrom` và `withMotionPreference` từ `./animation/reveal`. Một duration, một ease, một quãng dịch cho cả trang. Không tween thuộc tính gây layout.
- **Kích thước file:** mỗi file `.ts`/`.tsx` tối đa 500 dòng (`max-lines`, bỏ dòng trắng và comment).
- **Lint:** `pnpm lint` chạy với `--max-warnings 0`. `pnpm knip` fail nếu có export không ai dùng.
- **Comment trong mã bằng tiếng Anh.** Spec và plan bằng tiếng Việt.
- **Không dùng logo đối thủ.** Chỉ tên chữ.
- **Không dùng dấu ngoặc kép cho câu tổng kết mỗi nền tảng.** Chúng là nhận định nội bộ không có nguồn; đặt trong ngoặc kép sẽ đọc như lời khách hàng. Khóa tên là `summary`, render kèm nhãn, không phải `<blockquote>`.
- **Commit:** prefix conventional (`feat(landing)`, `docs`, `chore`), hook `.githooks/prepare-commit-msg` tự thêm trailer `Refs: UNI-504`. Không dùng `--no-verify`.

---

## Cấu trúc file

**Tạo mới:**

| File | Trách nhiệm |
|---|---|
| `apps/web/features/landing/work-products.tsx` | Section Work Products trên trang chủ: tiêu đề, bốn giá trị, ảnh, khối luận điểm, dòng thời gian bốn giai đoạn |
| `apps/web/features/landing/market-gap-teaser.tsx` | Khối ngắn sau `Problem`, dẫn sang `/why-uniwork` |
| `apps/web/features/landing/why-page.tsx` | Component trang `/why-uniwork`: hero, bốn nền tảng, dải khoảng trống, bốn trụ cột |
| `apps/web/features/landing/platforms.ts` | Danh sách bốn nền tảng: khóa i18n + màu mực. Dữ liệu thuần, không JSX |
| `apps/web/app/why-uniwork/page.tsx` | Route + metadata |

**Sửa:**

| File | Thay đổi |
|---|---|
| `packages/core/i18n/locales/vi.json` | Thêm `landing.workProducts`, `landing.marketGap`, `landing.why`; thêm `landing.nav.why`, `landing.footer.why` |
| `packages/core/i18n/locales/en.json` | Như trên, bản dịch |
| `packages/core/paths/paths.ts` | Thêm `whyUniwork()` |
| `packages/core/paths/consistency.test.ts` | Thêm `paths.whyUniwork()` vào mảng `globals` |
| `server/internal/service/reserved_slugs.json` | Thêm `"why-uniwork"` |
| `packages/core/paths/reserved-slugs.ts` | Sinh lại bằng `pnpm generate:reserved-slugs` |
| `docs/conventions.md` | Ghi nhận ngoại lệ route gạch nối cho trang marketing |
| `apps/web/features/landing/anchors.ts` | Thêm `workProducts: "work-products"` |
| `apps/web/features/landing/artwork.ts` | Thêm `"work-products": true` |
| `apps/web/features/landing/landing-page.tsx` | Chèn hai section mới; cập nhật comment đầu file |
| `apps/web/features/landing/site-header.tsx` | Thêm mục nav trỏ route thật |
| `apps/web/features/landing/site-footer.tsx` | Thêm liên kết trong nhóm Tài nguyên |
| `scripts/landing/prompts.json` | Thêm mục ảnh `work-products` |
| `e2e/landing.spec.ts` | Khẳng định cho hai section mới và trang mới, cộng đo tương phản trang mới |
| `docs/vision/KEY_POINTS.md`, `docs/roadmap/FEATURE_ROADMAP.md` | Đổi tên A-09 (Task 1) |

---

### Task 1: Gỡ va chạm tên gọi "Work Product"

Spec §3, phương án (a). Phải xong trước mọi thứ khác, vì các task sau dùng tên "Work Products" cho tầng tài liệu.

**Files:**
- Modify: `docs/vision/KEY_POINTS.md` (dòng 22, 24)
- Modify: `docs/roadmap/FEATURE_ROADMAP.md` (dòng 97)

- [ ] **Step 1: Xem hai chỗ đang dùng tên**

```bash
grep -rn "Work Product" docs/vision/KEY_POINTS.md docs/roadmap/FEATURE_ROADMAP.md
```

Kỳ vọng: ba dòng — `KEY_POINTS.md:22` ("Work Product / Sell Work Foundation"), `KEY_POINTS.md:24` ("lớp doanh thu Work Products"), `FEATURE_ROADMAP.md:97` ("Work Products (bán công việc hoàn thành)").

- [ ] **Step 2: Đổi tên hạng mục A-09**

Trong `docs/vision/KEY_POINTS.md` dòng 22, đổi tên key point 9 từ `**Work Product / Sell Work Foundation**` thành `**Sell Work Foundation**`.

Trong `docs/vision/KEY_POINTS.md` dòng 24, đổi `Vision §4.2 lớp doanh thu Work Products` thành `Vision §4.2 lớp doanh thu Sell Work`.

Trong `docs/roadmap/FEATURE_ROADMAP.md` dòng 97, đổi `Work Products (bán công việc hoàn thành)` thành `Sell Work (bán công việc hoàn thành)`.

- [ ] **Step 3: Ghi lý do vào mục "Câu chữ đã điều chỉnh" của KEY_POINTS.md**

Thêm vào cuối danh sách đó:

```markdown
- Key point 9 và 11: "Work Product" → "Sell Work". Lý do: từ 2026-09-09 tên
  "Work Products" được dùng công khai trên landing page cho tầng tài liệu
  (docx/xlsx/pptx/pdf, nền là C-01 Documents). Hai nghĩa trên một sản phẩm
  gây nhầm cho chính đội ngũ; A-09 là P2 chưa công bố nên nhường tên.
  Spec: docs/superpowers/specs/2026-09-09-landing-work-products-positioning-design.md §3.
```

- [ ] **Step 4: Nối dòng roadmap trên trang với Work Products**

Spec §4.3, ngoại lệ duy nhất được phép chạm vào section Lộ trình. Trong `packages/core/i18n/locales/vi.json`, đổi `landing.roadmap.now1` thành:

```
"now1": "Tài liệu cộng tác, có phiên bản và nhật ký truy cập — nền của Work Products",
```

và trong `en.json` đổi khóa tương ứng thành:

```
"now1": "Collaborative documents with versions and an access log, the base Work Products is built on",
```

Không đổi `landing.roadmap.note`; câu "Không mục nào dưới đây có ngày phát hành cam kết" phải giữ nguyên.

- [ ] **Step 5: Xác nhận không còn nghĩa cũ**

```bash
grep -rn "Work Product" docs/ --include=*.md | grep -v superpowers/
```

Kỳ vọng: không còn dòng nào nói về A-09 hay lớp doanh thu.

- [ ] **Step 6: Commit**

```bash
git add docs/vision/KEY_POINTS.md docs/roadmap/FEATURE_ROADMAP.md \
        packages/core/i18n/locales/vi.json packages/core/i18n/locales/en.json
git commit -m "docs: đổi tên A-09 thành Sell Work, nhường tên Work Products cho tầng tài liệu"
```

---

### Task 2: Copy tiếng Việt và tiếng Anh

Toàn bộ chữ, chưa có UI. Được duyệt riêng trước khi ai dựng giao diện cho chữ sai.

**Files:**
- Modify: `packages/core/i18n/locales/vi.json`
- Modify: `packages/core/i18n/locales/en.json`
- Test: `packages/core/i18n/parity.test.ts` (có sẵn, không sửa)

**Interfaces:**
- Produces: các không gian tên `landing.workProducts`, `landing.marketGap`, `landing.why` mà Task 3, 4 và 6 render. Mọi khóa dùng ở các task sau phải nằm trong task này.

- [ ] **Step 1: Chạy parity test để thấy nó xanh trước khi sửa**

```bash
pnpm --filter @uniwork/core test i18n/parity
```

Kỳ vọng: PASS. Đây là mốc so sánh, nếu nó đã đỏ thì dừng và sửa thứ khác trước.

- [ ] **Step 2: Thêm khối `workProducts` vào `landing` trong `vi.json`**

Chèn ngay sau khối `"email"`:

```json
"workProducts": {
  "eyebrow": "Work Products",
  "title": "Từ bối cảnh công việc đến kết quả thực tế",
  "sub": "Trong doanh nghiệp, công việc luôn kết thúc bằng một sản phẩm cụ thể: đề xuất, báo cáo, hợp đồng, file phân tích, slide thuyết trình. UniWork không dừng lại ở việc quản lý quá trình.",
  "v1Title": "Nối với Work Graph",
  "v1Desc": "Tài liệu gắn với dự án, công việc, cuộc họp, quyết định và những người đã sinh ra nó.",
  "v2Title": "AI Team hiểu bối cảnh",
  "v2Desc": "Trợ lý đọc tài liệu cùng toàn bộ ngữ cảnh quanh nó, chứ không chỉ đọc chữ trong file.",
  "v3Title": "Tài liệu thành hành động",
  "v3Desc": "Từ một đoạn văn bản tạo ra công việc, phê duyệt, lời nhắc hạn hoặc một quyết định được ghi lại.",
  "v4Title": "Định dạng chuẩn",
  "v4Desc": "Đọc và ghi .docx, .xlsx, .pptx, .pdf, để file rời khỏi UniWork vẫn mở được ở mọi nơi.",
  "imageAlt": "Thiết kế màn hình Work Products: danh sách tài liệu bên trái, trình soạn thảo ở giữa, bảng trợ lý AI bên phải",
  "notOfficeTitle": "Chúng ta không làm một Microsoft Office mới",
  "notOfficeDesc": "UniWork không chạy đua tính năng với Word, Excel hay PowerPoint, và không thay thế bộ công cụ văn phòng bạn đang dùng. Trình soạn thảo ở đây là phương tiện, không phải trọng tâm.",
  "summaryLabel": "Nói ngắn gọn",
  "summary": "Cùng một file, Microsoft hiểu file. UniWork hiểu cả câu chuyện phía sau nó.",
  "timelineTitle": "Bắt đầu nhỏ, tạo giá trị sớm",
  "timelineNote": "Đây là kế hoạch nội bộ, không phải cam kết phát hành.",
  "p1Name": "Nền tảng Work Products",
  "p1When": "Q1 2026",
  "p1Desc": "Tải lên, xem trước, tìm kiếm. AI đọc nội dung và trích xuất thông tin. Liên kết với dự án, công việc, cuộc họp và quyết định.",
  "p2Name": "Thực thi trên tài liệu",
  "p2When": "Q2 2026",
  "p2Desc": "Chỉnh sửa DOCX. PDF chỉnh sửa, chuyển đổi và OCR. Khối AI trong tài liệu, so sánh phiên bản, bình luận và phê duyệt.",
  "p3Name": "Dữ liệu có cấu trúc",
  "p3When": "Q3 2026",
  "p3Desc": "Bảng tính phân tích và biểu đồ. Trình kết nối dữ liệu từ CRM và ERP.",
  "p4Name": "Trình chiếu và tự động hóa",
  "p4When": "Q4 2026",
  "p4Desc": "Tạo slide từ dữ liệu và cuộc họp. Xuất PPTX và PDF. Quy trình và mẫu theo ngành."
},
```

- [ ] **Step 3: Thêm khối `marketGap` vào `landing` trong `vi.json`**

Chèn ngay sau khối `"problem"`:

```json
"marketGap": {
  "title": "Bạn đã có công cụ. Công việc vẫn phân mảnh.",
  "sub": "Bốn nền tảng dưới đây đang phục vụ hàng trăm triệu người, và mỗi nền tảng mạnh ở một phía khác nhau.",
  "body": "Microsoft 365 mạnh về bộ công cụ. Notion mạnh về tri thức. ClickUp mạnh về quản lý công việc. Coda mạnh về cách kết hợp tài liệu với dữ liệu. Không nền tảng nào trong số đó đóng được cả bốn phía cùng lúc, và khoảng trống giữa chúng là chỗ công việc của bạn rơi xuống.",
  "cta": "Đọc phân tích đầy đủ"
},
```

- [ ] **Step 4: Thêm khối `why` vào `landing` trong `vi.json`**

Chèn ngay sau khối `"solutions"`:

```json
"why": {
  "metaTitle": "Vì sao UniWork",
  "metaDesc": "Microsoft 365, Notion, ClickUp và Coda mạnh ở bốn phía khác nhau. Đây là khoảng trống giữa chúng, và chỗ UniWork đứng.",
  "eyebrow": "Vì sao UniWork",
  "title": "Những vấn đề lớn của các nền tảng hiện tại",
  "sub": "Nhiều công cụ. Nhiều tính năng. Nhưng công việc vẫn bị phân mảnh.",
  "lead": "Hiểu rõ hạn chế của các nền tảng hàng đầu giúp chúng ta nhìn thấy cơ hội để tạo ra một thế hệ giải pháp tốt hơn.",
  "disclaimer": "Nhận định dưới đây dựa trên tài liệu công khai của từng nền tảng tại thời điểm viết. Cả bốn đều ra tính năng mới liên tục, nên hãy tự kiểm chứng trước khi ra quyết định.",
  "issuesLabel": "Vấn đề chính",
  "summaryLabel": "Nói ngắn gọn",
  "gapTitle": "Khoảng trống thị trường",
  "gapSub": "Từ công việc phân mảnh đến một tổ chức thực sự hiệu quả.",
  "gapBody": "UniWork không chỉ cung cấp công cụ, mà hiểu bối cảnh công việc, kết nối con người, tri thức, dữ liệu và AI để tạo ra kết quả thực sự.",
  "pillarsTitle": "Chỗ UniWork đứng",
  "pillar1Title": "Một nền tảng thống nhất",
  "pillar1Desc": "Email, họp, dự án, công việc, quyết định và tài liệu trong cùng một không gian, dùng chung một bộ quyền.",
  "pillar2Title": "AI hiểu bối cảnh công việc",
  "pillar2Desc": "Trợ lý đọc dữ liệu tổ chức theo đúng quyền của người hỏi, chứ không đoán từ một đoạn văn bản dán vào.",
  "pillar3Title": "Work Products là kết quả thực",
  "pillar3Desc": "Tạo, chỉnh sửa, phê duyệt tài liệu, phân tích và trình bày ngay tại chỗ công việc sinh ra chúng.",
  "pillar4Title": "Linh hoạt triển khai",
  "pillar4Desc": "Cloud, private cloud, on-premise và BYOK, phù hợp doanh nghiệp và cơ quan tại Việt Nam.",
  "ms365": {
    "name": "Microsoft 365",
    "tagline": "The productivity powerhouse",
    "desc": "Bộ công cụ văn phòng toàn diện được hàng trăm triệu người tin dùng.",
    "i1Title": "Phức tạp và rời rạc",
    "i1Desc": "Nhiều ứng dụng riêng biệt như Word, Excel, PowerPoint, Outlook, Teams khó tạo thành một trải nghiệm thống nhất.",
    "i2Title": "Chi phí cao",
    "i2Desc": "Tổng chi phí sở hữu lớn, đặc biệt với doanh nghiệp vừa và nhỏ.",
    "i3Title": "Phụ thuộc cloud",
    "i3Desc": "Chủ yếu hướng cloud, còn lựa chọn on-premise ngày càng hạn chế.",
    "i4Title": "AI chưa thực sự theo bối cảnh công việc",
    "i4Desc": "Copilot mạnh nhưng vẫn hoạt động trong từng ứng dụng, chưa hiểu sâu quy trình và mục tiêu của tổ chức.",
    "i5Title": "Ít linh hoạt tùy chỉnh",
    "i5Desc": "Khó điều chỉnh theo đặc thù ngành và quy trình riêng.",
    "summary": "Rất mạnh về công cụ, nhưng công việc vẫn bị phân mảnh và nặng vận hành."
  },
  "notion": {
    "name": "Notion",
    "tagline": "The connected workspace",
    "desc": "Không gian làm việc linh hoạt, kết hợp tài liệu, cơ sở dữ liệu và AI.",
    "i1Title": "Chưa phù hợp cho vận hành doanh nghiệp phức tạp",
    "i1Desc": "Tốt cho ghi chép và quản lý thông tin, còn hạn chế với quy trình, phê duyệt và quản trị nhiều phòng ban.",
    "i2Title": "Thiếu khả năng xử lý file chuẩn doanh nghiệp",
    "i2Desc": "Hỗ trợ DOCX, XLSX, PPTX hạn chế, và đó không phải thế mạnh của nền tảng.",
    "i3Title": "Chưa mạnh về dự án và công việc phức tạp",
    "i3Desc": "Task và project mang tính cơ bản, khó đáp ứng nhu cầu vận hành quy mô lớn.",
    "i4Title": "Khả năng tích hợp còn giới hạn",
    "i4Desc": "Cần nhiều công cụ bên ngoài để nối với email, lịch, họp và quy trình.",
    "i5Title": "AI chủ yếu trong phạm vi workspace",
    "i5Desc": "Hiểu nội dung nhưng chưa thực sự kết nối được toàn bộ bối cảnh công việc và dữ liệu vận hành.",
    "summary": "Tuyệt vời cho tri thức và cộng tác, nhưng chưa đủ để vận hành một tổ chức phức tạp."
  },
  "clickup": {
    "name": "ClickUp",
    "tagline": "The all-in-one work platform",
    "desc": "Nền tảng quản lý công việc mạnh mẽ với tham vọng trở thành một ứng dụng cho mọi việc.",
    "i1Title": "Quá nhiều tính năng",
    "i1Desc": "Giao diện phức tạp, người dùng dễ bị quá tải, đường cong học tập cao.",
    "i2Title": "Trải nghiệm chưa thực sự liền mạch",
    "i2Desc": "Nhiều cách làm cùng một việc khiến đội nhóm khó thống nhất cách sử dụng.",
    "i3Title": "Thiếu chiều sâu về tài liệu và tri thức",
    "i3Desc": "Docs tốt ở mức cơ bản, nhưng chưa mạnh với tài liệu dài và file chuẩn.",
    "i4Title": "Chưa tối ưu cho doanh nghiệp lớn và ngành đặc thù",
    "i4Desc": "Khả năng tùy biến và quản trị đa tổ chức còn hạn chế.",
    "i5Title": "AI đã tiến bộ nhưng chưa khác biệt",
    "i5Desc": "ClickUp Brain hữu ích nhưng chưa tạo được lợi thế rõ rệt về hiểu bối cảnh tổ chức và thực thi công việc đa bước.",
    "summary": "Mạnh về quản lý công việc, nhưng dễ rơi vào quá tải tính năng và chưa đủ chiều sâu cho doanh nghiệp lớn."
  },
  "coda": {
    "name": "Coda",
    "tagline": "Docs that do more",
    "desc": "Kết hợp tài liệu, bảng dữ liệu, tự động hóa và AI trong một không gian linh hoạt.",
    "i1Title": "Độ phức tạp khi mở rộng",
    "i1Desc": "Tuy mạnh mẽ, cấu trúc document-table trở nên khó quản lý khi quy mô lớn.",
    "i2Title": "Chưa phải giải pháp toàn diện cho doanh nghiệp",
    "i2Desc": "Tập trung vào tài liệu và dữ liệu, chưa bao phủ đầy đủ email, họp, quản lý dự án và vận hành tổ chức.",
    "i3Title": "Hạn chế về file chuẩn doanh nghiệp",
    "i3Desc": "Hỗ trợ DOCX, XLSX, PPTX còn hạn chế, và đó không phải trọng tâm.",
    "i4Title": "Hệ sinh thái và tích hợp còn nhỏ",
    "i4Desc": "So với Microsoft, hệ sinh thái đối tác và tích hợp bên thứ ba còn hạn chế.",
    "i5Title": "AI mạnh nhưng trong phạm vi hẹp",
    "i5Desc": "AI hữu ích trên tài liệu và bảng, nhưng chưa thực sự kết nối với toàn bộ bối cảnh công việc của tổ chức.",
    "summary": "Rất sáng tạo trong cách kết hợp tài liệu và dữ liệu, nhưng chưa đủ rộng và sâu để trở thành nền tảng vận hành toàn diện."
  }
},
```

- [ ] **Step 5: Thêm hai khóa điều hướng vào `vi.json`**

Trong `landing.nav`, thêm `"why": "Vì sao UniWork"`.
Trong `landing.footer`, thêm `"why": "Vì sao UniWork"`.

- [ ] **Step 6: Chạy parity test để thấy nó ĐỎ**

```bash
pnpm --filter @uniwork/core test i18n/parity
```

Kỳ vọng: FAIL, liệt kê các khóa có ở `vi` mà thiếu ở `en`. Đây là bước xác nhận test thật sự bắt được thiếu sót.

- [ ] **Step 7: Thêm bản `en` tương ứng vào `en.json`**

Cùng vị trí, cùng cấu trúc khóa:

```json
"workProducts": {
  "eyebrow": "Work Products",
  "title": "From work context to finished output",
  "sub": "In a company, work always ends in something concrete: a proposal, a report, a contract, an analysis, a deck. UniWork does not stop at managing the process.",
  "v1Title": "Wired into the Work Graph",
  "v1Desc": "A document stays attached to the project, task, meeting, decision and people that produced it.",
  "v2Title": "The AI team has the context",
  "v2Desc": "The assistant reads the document together with everything around it, not just the words in the file.",
  "v3Title": "Documents become actions",
  "v3Desc": "Turn a paragraph into a task, an approval, a due-date reminder, or a decision on the record.",
  "v4Title": "Standard formats",
  "v4Desc": "Reads and writes .docx, .xlsx, .pptx and .pdf, so a file still opens anywhere once it leaves UniWork.",
  "imageAlt": "Work Products screen design: document list on the left, editor in the middle, AI assistant panel on the right",
  "notOfficeTitle": "We are not building another Microsoft Office",
  "notOfficeDesc": "UniWork does not race Word, Excel or PowerPoint on features, and it does not replace the office suite you already use. The editor here is a means, not the point.",
  "summaryLabel": "In short",
  "summary": "Given the same file, Microsoft understands the file. UniWork understands the story behind it.",
  "timelineTitle": "Start small, deliver value early",
  "timelineNote": "This is an internal plan, not a release commitment.",
  "p1Name": "Work Products foundation",
  "p1When": "Q1 2026",
  "p1Desc": "Upload, preview, search. AI reads the content and extracts what matters. Linked to projects, tasks, meetings and decisions.",
  "p2Name": "Acting on documents",
  "p2When": "Q2 2026",
  "p2Desc": "DOCX editing. PDF editing, conversion and OCR. AI blocks inside a document, version comparison, comments and approvals.",
  "p3Name": "Structured data",
  "p3When": "Q3 2026",
  "p3Desc": "Spreadsheets with analysis and charts. Data connectors for CRM and ERP.",
  "p4Name": "Presentation and automation",
  "p4When": "Q4 2026",
  "p4Desc": "Build slides from data and meetings. Export PPTX and PDF. Workflows and templates by industry."
},
```

```json
"marketGap": {
  "title": "You already bought the tools. The work is still scattered.",
  "sub": "The four platforms below serve hundreds of millions of people, and each one is strong on a different side.",
  "body": "Microsoft 365 is strong on tooling. Notion is strong on knowledge. ClickUp is strong on work management. Coda is strong on joining documents to data. None of them closes all four sides at once, and the gap between them is where your work falls through.",
  "cta": "Read the full analysis"
},
```

```json
"why": {
  "metaTitle": "Why UniWork",
  "metaDesc": "Microsoft 365, Notion, ClickUp and Coda are each strong on a different side. This is the gap between them, and where UniWork stands.",
  "eyebrow": "Why UniWork",
  "title": "The big problems with today's platforms",
  "sub": "More tools. More features. And the work is still fragmented.",
  "lead": "Understanding where the leading platforms stop is how we can see the opening for a better generation of solutions.",
  "disclaimer": "The assessments below are based on each platform's public documentation at the time of writing. All four ship new features constantly, so verify for yourself before deciding.",
  "issuesLabel": "Main problems",
  "summaryLabel": "In short",
  "gapTitle": "The gap in the market",
  "gapSub": "From fragmented work to an organisation that actually performs.",
  "gapBody": "UniWork does not just hand you tools. It understands the context of the work and connects people, knowledge, data and AI to produce real results.",
  "pillarsTitle": "Where UniWork stands",
  "pillar1Title": "One unified platform",
  "pillar1Desc": "Email, meetings, projects, tasks, decisions and documents in one space, under one set of permissions.",
  "pillar2Title": "AI that knows the work",
  "pillar2Desc": "The assistant reads organisational data under the asker's own permissions, instead of guessing from a pasted excerpt.",
  "pillar3Title": "Work Products are the real output",
  "pillar3Desc": "Create, edit, approve, analyse and present right where the work that produced them lives.",
  "pillar4Title": "Deploy it your way",
  "pillar4Desc": "Cloud, private cloud, on-premise and BYOK, built for companies and public bodies in Vietnam.",
  "ms365": {
    "name": "Microsoft 365",
    "tagline": "The productivity powerhouse",
    "desc": "A complete office suite trusted by hundreds of millions of people.",
    "i1Title": "Complex and fragmented",
    "i1Desc": "Separate applications such as Word, Excel, PowerPoint, Outlook and Teams rarely add up to one coherent experience.",
    "i2Title": "Expensive",
    "i2Desc": "Total cost of ownership is high, especially for small and mid-sized companies.",
    "i3Title": "Cloud-bound",
    "i3Desc": "Mostly cloud-first, with on-premise options narrowing over time.",
    "i4Title": "AI without real work context",
    "i4Desc": "Copilot is strong, but it works inside one application at a time and does not grasp the organisation's processes or goals.",
    "i5Title": "Hard to tailor",
    "i5Desc": "Difficult to adapt to an industry's specifics or a company's own process.",
    "summary": "Very strong on tooling, but the work stays fragmented and the operational load is heavy."
  },
  "notion": {
    "name": "Notion",
    "tagline": "The connected workspace",
    "desc": "A flexible workspace that combines documents, databases and AI.",
    "i1Title": "Not built for complex operations",
    "i1Desc": "Good for notes and information, weaker on process, approvals and governance across departments.",
    "i2Title": "Limited handling of standard files",
    "i2Desc": "DOCX, XLSX and PPTX support is limited, and is not what the platform is for.",
    "i3Title": "Thin on complex projects and tasks",
    "i3Desc": "Tasks and projects stay basic, and struggle with operations at scale.",
    "i4Title": "Integration only goes so far",
    "i4Desc": "You need several outside tools to connect email, calendar, meetings and process.",
    "i5Title": "AI stays inside the workspace",
    "i5Desc": "It understands the content but never really reaches the full context of the work or the operational data.",
    "summary": "Excellent for knowledge and collaboration, but not enough to run a complex organisation."
  },
  "clickup": {
    "name": "ClickUp",
    "tagline": "The all-in-one work platform",
    "desc": "A powerful work management platform with ambitions to be the everything app.",
    "i1Title": "Too many features",
    "i1Desc": "A crowded interface, an easily overwhelmed user, and a steep learning curve.",
    "i2Title": "Not quite seamless",
    "i2Desc": "Several ways to do the same thing make it hard for a team to settle on one.",
    "i3Title": "Shallow on documents and knowledge",
    "i3Desc": "Docs are fine at a basic level but weak for long documents and standard files.",
    "i4Title": "Not tuned for large or specialised organisations",
    "i4Desc": "Customisation and multi-organisation governance remain limited.",
    "i5Title": "AI has improved but does not differentiate",
    "i5Desc": "ClickUp Brain is useful, but it has not produced a clear edge in understanding an organisation or executing multi-step work.",
    "summary": "Strong on work management, but prone to feature overload and short on depth for larger companies."
  },
  "coda": {
    "name": "Coda",
    "tagline": "Docs that do more",
    "desc": "Documents, data tables, automation and AI combined in one flexible space.",
    "i1Title": "Complexity at scale",
    "i1Desc": "Powerful as it is, the document-table structure gets hard to manage as things grow.",
    "i2Title": "Not a complete answer for a company",
    "i2Desc": "Focused on documents and data, without full coverage of email, meetings, project management and operations.",
    "i3Title": "Limited on standard files",
    "i3Desc": "DOCX, XLSX and PPTX support is limited, and is not the focus.",
    "i4Title": "A small ecosystem",
    "i4Desc": "Compared with Microsoft, the partner ecosystem and third-party integrations are thin.",
    "i5Title": "Strong AI in a narrow range",
    "i5Desc": "The AI helps with documents and tables, but never really connects to the organisation's whole working context.",
    "summary": "Genuinely inventive in joining documents to data, but not broad or deep enough to run an organisation."
  }
},
```

Trong `landing.nav` thêm `"why": "Why UniWork"`. Trong `landing.footer` thêm `"why": "Why UniWork"`.

- [ ] **Step 8: Chạy parity test để thấy nó XANH**

```bash
pnpm --filter @uniwork/core test i18n/parity
```

Kỳ vọng: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/i18n/locales/vi.json packages/core/i18n/locales/en.json
git commit -m "feat(landing): copy vi/en cho Work Products, khoảng trống thị trường và trang Vì sao UniWork"
```

---

### Task 3: Route `/why-uniwork` và trang phân tích bốn nền tảng

**Files:**
- Create: `apps/web/features/landing/platforms.ts`
- Create: `apps/web/features/landing/why-page.tsx`
- Create: `apps/web/app/why-uniwork/page.tsx`
- Modify: `packages/core/paths/paths.ts`
- Modify: `packages/core/paths/consistency.test.ts:56` (ngay sau `paths.solutions.operations()`)
- Modify: `server/internal/service/reserved_slugs.json`
- Modify: `docs/conventions.md` (mục §1 Routes)

**Interfaces:**
- Consumes: các khóa `landing.why.*` từ Task 2.
- Produces: `paths.whyUniwork(): string` trả `"/why-uniwork"`, dùng bởi Task 4. Export `WhyPage` từ `why-page.tsx`, không nhận props. Export `PLATFORMS` và `PLATFORM_KEYS` từ `platforms.ts`.

- [ ] **Step 1: Thêm route vào bài kiểm tra nhất quán để nó ĐỎ**

Trong `packages/core/paths/consistency.test.ts`, thêm một dòng vào mảng `globals`, ngay sau `paths.solutions.operations(),`:

```ts
    paths.whyUniwork(),
```

- [ ] **Step 2: Chạy để thấy nó fail vì builder chưa có**

```bash
pnpm --filter @uniwork/core test paths/consistency
```

Kỳ vọng: FAIL ở bước typecheck hoặc runtime — `paths.whyUniwork is not a function`.

- [ ] **Step 3: Thêm builder vào `paths.ts`**

Trong `packages/core/paths/paths.ts`, ngay sau khối `solutions`:

```ts
  /**
   * Positioning page: what the platforms a buyer already owns do not cover.
   * Hyphenated root, the third after forgot-password and reset-password; the
   * slug is reserved so an organization can never take it
   * (docs/conventions.md §Routes).
   */
  whyUniwork: () => "/why-uniwork",
```

- [ ] **Step 4: Chạy lại để thấy nó vẫn fail, lần này vì route chưa tồn tại**

```bash
pnpm --filter @uniwork/core test paths/consistency
```

Kỳ vọng: FAIL với thông báo rằng builder `/why-uniwork` không có trang tương ứng trong `apps/web/app`.

- [ ] **Step 5: Đặt chỗ slug**

Trong `server/internal/service/reserved_slugs.json`, thêm `"why-uniwork"` vào cuối mảng, rồi:

```bash
pnpm generate:reserved-slugs
```

Kỳ vọng: `packages/core/paths/reserved-slugs.ts` được ghi lại và có `"why-uniwork"`.

- [ ] **Step 6: Ghi nhận ngoại lệ trong quy ước**

Trong `docs/conventions.md` §1 Routes, sửa gạch đầu dòng đang viết "Never a hyphenated root" thành:

```markdown
- Global routes (before the user is inside a workspace) are a single word or
  `/{noun}/{verb}`: `/login`, `/register`, `/onboarding`, `/invitations`,
  `/workspaces/new`, `/invite/{token}`. A hyphenated root
  (`/new-workspace`) is normally wrong: it collides with organization slugs
  and forces endless reserved-slug audits. Reserving the noun protects the
  whole subtree. Three exceptions exist and every one of them is in
  `reserved_slugs.json`: `/forgot-password`, `/reset-password` and
  `/why-uniwork` — a public page whose URL is read by people, where the
  hyphenated phrase is the name.
```

- [ ] **Step 7: Viết danh sách nền tảng**

Tạo `apps/web/features/landing/platforms.ts`:

```ts
/**
 * The four platforms a buyer most often already owns, in the order the page
 * argues them: the office suite first because it is the one nearly everyone
 * has, then the three that each solved one side of the same problem.
 *
 * The ink colours are semantic tokens, not brand colours. Using each vendor's
 * own brand colour would read as an endorsement badge, and none of them is in
 * this repo's palette anyway.
 */
export const PLATFORMS = {
  ms365: { ns: "landing.why.ms365", ink: "text-info" },
  notion: { ns: "landing.why.notion", ink: "text-muted-foreground" },
  clickup: { ns: "landing.why.clickup", ink: "text-warning" },
  coda: { ns: "landing.why.coda", ink: "text-brand-accent" },
} as const;

export type PlatformKey = keyof typeof PLATFORMS;

/** Stable order for every list that renders all of them. */
export const PLATFORM_KEYS = ["ms365", "notion", "clickup", "coda"] as const satisfies readonly PlatformKey[];

/** Each platform carries the same five problems; see the i18n file. */
export const PLATFORM_ISSUES = ["i1", "i2", "i3", "i4", "i5"] as const;
```

- [ ] **Step 8: Viết component trang**

Tạo `apps/web/features/landing/why-page.tsx`:

```tsx
"use client";
import { AlertCircle, Boxes, Brain, FileCheck2, Server } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, EmphasisSection, Eyebrow, SectionTitle } from "./layout-primitives";
import { FinalCta } from "./final-cta";
import { PLATFORMS, PLATFORM_ISSUES, PLATFORM_KEYS } from "./platforms";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { TrustBand } from "./trust-band";

const PILLARS = [
  { icon: Boxes, key: "pillar1", ink: "text-brand" },
  { icon: Brain, key: "pillar2", ink: "text-brand-accent" },
  { icon: FileCheck2, key: "pillar3", ink: "text-info" },
  { icon: Server, key: "pillar4", ink: "text-warning" },
] as const;

/**
 * The page a buyer reaches when they ask why they need this on top of what
 * they already pay for.
 *
 * Every claim about another vendor is a claim this repo cannot test, which is
 * why the disclaimer is in the hero rather than the footer, and why each
 * platform block opens by saying what that platform is good at. A comparison
 * that only lists the other side's faults is read as advertising and stops
 * being evidence.
 *
 * No tick table and no logos. A self-scored grid is the one thing on a
 * comparison page a reader can dismiss in a second, and a competitor's mark
 * beside our own reads as a partnership.
 */
export function WhyPage() {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <SiteHeader />
      <main>
        <WhyHero />
        <Platforms />
        <MarketGap />
        <Pillars />
        <TrustBand />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

function WhyHero() {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const lines = body.current ? Array.from(body.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(lines, { clearProps: "all" });
          return;
        }
        revealFrom(lines, root.current, 0.06);
      }),
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="why-title" className="bg-background pt-28 pb-16 sm:pt-32 sm:pb-20">
      <Container>
        <div ref={body} className="max-w-3xl">
          <Eyebrow className="text-brand">{t("landing.why.eyebrow")}</Eyebrow>
          <SectionTitle>
            <span id="why-title">{t("landing.why.title")}</span>
          </SectionTitle>
          <p className="mt-4 max-w-prose text-title-sm leading-relaxed text-pretty text-muted-foreground">
            {t("landing.why.sub")}
          </p>
          <p className="mt-4 max-w-prose text-body-lg leading-relaxed text-muted-foreground">
            {t("landing.why.lead")}
          </p>
          {/* In the hero, not the footer: a reader who acts on a comparison
              needs to know how old it is before they act, not after. */}
          <p className="mt-8 max-w-prose border-l-2 border-border pl-4 text-caption leading-relaxed text-muted-foreground">
            {t("landing.why.disclaimer")}
          </p>
        </div>
      </Container>
    </section>
  );
}

function Platforms() {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const cells = list.current ? Array.from(list.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(cells, { clearProps: "all" });
          return;
        }
        revealFrom(cells, root.current, 0.08);
      }),
    { scope: root },
  );

  return (
    <section ref={root} aria-label={t("landing.why.title")} className="bg-surface py-20 sm:py-24">
      <Container>
        <ul ref={list} className="grid gap-10 lg:grid-cols-2 lg:gap-x-14 lg:gap-y-16">
          {PLATFORM_KEYS.map((key) => {
            const { ns, ink } = PLATFORMS[key];
            return (
              <li key={key}>
                <h2 className={cn("font-heading text-title font-bold leading-snug", ink)}>{t(`${ns}.name`)}</h2>
                <p className="mt-1 text-caption font-medium tracking-wide text-muted-foreground">
                  {t(`${ns}.tagline`)}
                </p>
                <p className="mt-4 max-w-prose text-body-lg leading-relaxed text-muted-foreground">
                  {t(`${ns}.desc`)}
                </p>

                <h3 className="mt-8 text-label font-semibold">{t("landing.why.issuesLabel")}</h3>
                <ul className="mt-4 grid gap-4">
                  {PLATFORM_ISSUES.map((issue) => (
                    <li key={issue} className="flex gap-3">
                      <AlertCircle className={cn("mt-0.5 size-4 shrink-0", ink)} aria-hidden />
                      <div>
                        <p className="text-body font-semibold">{t(`${ns}.${issue}Title`)}</p>
                        <p className="mt-1 max-w-prose text-body leading-relaxed text-muted-foreground">
                          {t(`${ns}.${issue}Desc`)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>

                {/* Deliberately not a blockquote and deliberately unquoted:
                    this is our own reading, not something anyone said. */}
                <div className="mt-8 rounded-lg bg-muted p-5">
                  <p className="text-label font-semibold text-muted-foreground">{t("landing.why.summaryLabel")}</p>
                  <p className="mt-2 max-w-prose text-body-lg leading-relaxed">{t(`${ns}.summary`)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}

function MarketGap() {
  const { t } = useTranslation();

  return (
    <EmphasisSection className="py-20 sm:py-24">
      <Container>
        <div className="max-w-3xl">
          <Eyebrow className="text-brand">{t("landing.why.gapTitle")}</Eyebrow>
          <SectionTitle>{t("landing.why.gapSub")}</SectionTitle>
          <p className="mt-4 max-w-prose text-title-sm leading-relaxed text-pretty text-muted-foreground">
            {t("landing.why.gapBody")}
          </p>
        </div>
      </Container>
    </EmphasisSection>
  );
}

function Pillars() {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const cells = list.current ? Array.from(list.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(cells, { clearProps: "all" });
          return;
        }
        revealFrom(cells, root.current, 0.07);
      }),
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="why-pillars-title" className="bg-background py-20 sm:py-24">
      <Container>
        <SectionTitle className="mt-0 max-w-3xl">
          <span id="why-pillars-title">{t("landing.why.pillarsTitle")}</span>
        </SectionTitle>
        <ul ref={list} className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
          {PILLARS.map(({ icon: Icon, key, ink }) => (
            <li key={key}>
              <Icon className={cn("size-6", ink)} aria-hidden />
              <h3 className="mt-4 font-heading text-body-lg font-bold leading-snug">{t(`landing.why.${key}Title`)}</h3>
              <p className="mt-2 max-w-prose text-body leading-relaxed text-muted-foreground">
                {t(`landing.why.${key}Desc`)}
              </p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
```

- [ ] **Step 9: Viết route**

Tạo `apps/web/app/why-uniwork/page.tsx`:

```tsx
import type { Metadata } from "next";
import { WhyPage } from "../../features/landing/why-page";

// Vietnamese for the same reason the home page's metadata is: the source
// language ships to the crawler and the page itself follows the visitor.
export const metadata: Metadata = {
  title: "Vì sao UniWork",
  description:
    "Microsoft 365, Notion, ClickUp và Coda mạnh ở bốn phía khác nhau. " +
    "Đây là khoảng trống giữa chúng, và chỗ UniWork đứng.",
  alternates: { canonical: "/why-uniwork" },
};

export default function Page() {
  return <WhyPage />;
}
```

- [ ] **Step 10: Chạy lại bài kiểm tra nhất quán, lần này phải XANH**

```bash
pnpm --filter @uniwork/core test paths/consistency
```

Kỳ vọng: PASS.

- [ ] **Step 11: Typecheck và lint**

```bash
pnpm typecheck && pnpm lint
```

Kỳ vọng: cả hai PASS. Nếu lint báo import thừa, xóa import đó.

- [ ] **Step 12: Xem trang thật ở hai chế độ màu**

```bash
make start
```

Mở `http://localhost:3000/why-uniwork`, đổi ngôn ngữ trên header, đổi sáng/tối. Kỳ vọng: bốn khối nền tảng hiện đủ năm vấn đề mỗi khối, dải khoảng trống đảo màu ở cả hai chế độ, không có chữ nào chìm vào nền.

- [ ] **Step 13: Commit**

```bash
git add apps/web/features/landing/platforms.ts apps/web/features/landing/why-page.tsx \
        apps/web/app/why-uniwork/page.tsx packages/core/paths/paths.ts \
        packages/core/paths/consistency.test.ts packages/core/paths/reserved-slugs.ts \
        server/internal/service/reserved_slugs.json docs/conventions.md
git commit -m "feat(landing): trang /why-uniwork phân tích bốn nền tảng và khoảng trống thị trường"
```

---

### Task 4: Dẫn đường tới trang mới

Khối trên trang chủ, mục nav trên header, liên kết ở chân trang.

**Files:**
- Create: `apps/web/features/landing/market-gap-teaser.tsx`
- Modify: `apps/web/features/landing/landing-page.tsx`
- Modify: `apps/web/features/landing/site-header.tsx:26-32`
- Modify: `apps/web/features/landing/site-footer.tsx:69-83`
- Test: `e2e/landing.spec.ts`

**Interfaces:**
- Consumes: `paths.whyUniwork()` từ Task 3, khóa `landing.marketGap.*` và `landing.nav.why`, `landing.footer.why` từ Task 2.
- Produces: `MarketGapTeaser` (không props), render bởi `landing-page.tsx`.

- [ ] **Step 1: Viết khẳng định e2e trước**

Trong `e2e/landing.spec.ts`, thêm vào cuối test `"dải tin cậy, FAQ và hai trang giải pháp"`, ngay trước dấu `});` đóng test:

```ts
    // Khối khoảng trống thị trường dẫn sang trang phân tích, và trang đó mở được.
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const gap = page.getByRole("link", { name: "Đọc phân tích đầy đủ" });
    await gap.scrollIntoViewIfNeeded();
    await gap.click();
    await expect(page).toHaveURL(/\/why-uniwork$/);
    await expect(
      page.getByRole("heading", { name: "Những vấn đề lớn của các nền tảng hiện tại" }),
    ).toBeVisible();
    // Bốn nền tảng đều được nêu tên, không nền tảng nào bị bỏ rơi khi copy đổi.
    for (const name of ["Microsoft 365", "Notion", "ClickUp", "Coda"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
```

- [ ] **Step 2: Chạy để thấy nó ĐỎ**

```bash
make start
pnpm exec playwright test e2e/landing.spec.ts -g "dải tin cậy"
```

Kỳ vọng: FAIL — không tìm thấy link "Đọc phân tích đầy đủ".

- [ ] **Step 3: Viết khối trên trang chủ**

Tạo `apps/web/features/landing/market-gap-teaser.tsx`:

```tsx
"use client";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, SectionTitle } from "./layout-primitives";
import { PLATFORMS, PLATFORM_KEYS } from "./platforms";

/**
 * The sentence that follows Problem: yes, you already bought tools, and the
 * work is still in four places.
 *
 * Shape matters more than usual here. Problem above is a three-column grid of
 * text; four columns of text underneath it would be the same figure twice in
 * a row, which is exactly what the note at the top of landing-page.tsx rules
 * out. So this is one wide statement with the four names set as a plain
 * typographic row — no cards, no icons, no borders — and the argument itself
 * lives on /why-uniwork rather than here.
 */
export function MarketGapTeaser() {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const lines = body.current ? Array.from(body.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(lines, { clearProps: "all" });
          return;
        }
        revealFrom(lines, root.current, 0.06);
      }),
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="landing-market-gap-title" className="bg-surface py-16 sm:py-20">
      <Container>
        <div ref={body} className="max-w-3xl">
          <SectionTitle className="mt-0">
            <span id="landing-market-gap-title">{t("landing.marketGap.title")}</span>
          </SectionTitle>
          <p className="mt-4 max-w-prose text-title-sm leading-relaxed text-pretty text-muted-foreground">
            {t("landing.marketGap.sub")}
          </p>
          <ul className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
            {PLATFORM_KEYS.map((key) => (
              <li key={key} className="font-heading text-body-lg font-bold text-muted-foreground">
                {t(`${PLATFORMS[key].ns}.name`)}
              </li>
            ))}
          </ul>
          <p className="mt-8 max-w-prose text-body-lg leading-relaxed text-muted-foreground">
            {t("landing.marketGap.body")}
          </p>
          <Link
            href={paths.whyUniwork()}
            className="mt-6 inline-flex items-center gap-1.5 text-body-lg font-medium text-brand transition-colors hover:text-brand-accent pointer-coarse:min-h-11"
          >
            {t("landing.marketGap.cta")}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </Container>
    </section>
  );
}
```

- [ ] **Step 4: Chèn nó vào trang chủ**

Trong `apps/web/features/landing/landing-page.tsx`, thêm import:

```tsx
import { MarketGapTeaser } from "./market-gap-teaser";
```

và chèn giữa `<Problem />` và `<Capabilities />`:

```tsx
        <Problem />
        <MarketGapTeaser />
        <Capabilities />
```

- [ ] **Step 5: Thêm mục nav trỏ route thật**

Trong `apps/web/features/landing/site-header.tsx`, thêm `import { paths } from "@uniwork/core/paths";` nếu chưa có (file đã dùng `paths.root()` nên đã có), rồi đổi `NAV` thành:

```tsx
const NAV = [
  { key: "landing.nav.features", to: href(ANCHORS.platform) },
  { key: "landing.nav.solutions", to: href(ANCHORS.solutions) },
  { key: "landing.nav.why", to: paths.whyUniwork(), route: true },
  { key: "landing.workforce.badge", to: href(ANCHORS.workforce) },
  { key: "landing.footer.roadmap", to: href(ANCHORS.roadmap) },
  { key: "landing.footer.pricing", to: href(ANCHORS.pricing) },
] as const;
```

Trong cả hai chỗ render `NAV` (thanh ngang ở desktop và ngăn kéo ở mobile), đổi từ `<a>` cố định sang chọn thẻ theo cờ `route`. Ở thanh ngang desktop:

```tsx
          {NAV.map((item) => {
            // A real route gets next/link so the page does not reload; the
            // anchors stay plain <a> because same-document scroll is what
            // they are for.
            const Tag = "route" in item && item.route ? Link : "a";
            return (
              <Tag
                key={item.key}
                href={item.to}
                className="inline-flex items-center text-body font-medium text-muted-foreground transition-colors hover:text-brand pointer-coarse:min-h-11"
              >
                {t(item.key)}
              </Tag>
            );
          })}
```

Áp dụng đúng cách đó cho khối `NAV.map` trong ngăn kéo mobile, giữ nguyên class hiện có của nó.

- [ ] **Step 6: Thêm liên kết ở chân trang**

Trong `apps/web/features/landing/site-footer.tsx`, trong `<nav aria-label={t("landing.footer.resources")}>`, thêm mục đầu tiên của `<ul>`:

```tsx
            <li>
              <Link className={LINK} href={paths.whyUniwork()}>
                {t("landing.footer.why")}
              </Link>
            </li>
```

- [ ] **Step 7: Chạy e2e để thấy nó XANH**

```bash
pnpm exec playwright test e2e/landing.spec.ts -g "dải tin cậy"
```

Kỳ vọng: PASS.

- [ ] **Step 8: Chạy bài đo tương phản, thêm trang mới vào đó**

Trong `e2e/landing.spec.ts`, trong vòng lặp `for (const mode of ["light", "dark"] as const)`, thêm sau khối đo `/solutions/product`:

```ts
      await page.goto("/why-uniwork");
      await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
      await revealEverything(page);
      const why = await auditText(page);
      expect(why.fails, `trang vì sao (${mode}): ${why.fails.join(" | ")}`).toEqual([]);
```

```bash
pnpm exec playwright test e2e/landing.spec.ts -g "tương phản"
```

Kỳ vọng: PASS ở cả `light` và `dark`. Nếu đỏ, sửa token màu trong component, không sửa ngưỡng trong bài đo.

- [ ] **Step 9: Commit**

```bash
git add apps/web/features/landing/market-gap-teaser.tsx apps/web/features/landing/landing-page.tsx \
        apps/web/features/landing/site-header.tsx apps/web/features/landing/site-footer.tsx \
        e2e/landing.spec.ts
git commit -m "feat(landing): khối khoảng trống thị trường trên trang chủ và đường dẫn tới /why-uniwork"
```

---

### Task 5: Ảnh Work Products

**Files:**
- Modify: `apps/web/features/landing/artwork.ts:26` (bên trong `const ARTWORK`)
- Modify: `scripts/landing/prompts.json`
- Create: `apps/web/public/landing/work-products.vi.webp`, `apps/web/public/landing/work-products.en.webp` (do script sinh)
- Test: `scripts/landing-artwork.test.mjs` (có sẵn, không sửa)

**Interfaces:**
- Produces: tên artwork `"work-products"` hợp lệ với `useArtwork()`, dùng bởi Task 6.

- [ ] **Step 1: Khai báo ảnh trong `artwork.ts`**

Thêm dòng cuối vào `const ARTWORK`, sau `"ai-workforce": true,`:

```ts
  "work-products": true,
```

- [ ] **Step 2: Chạy bài kiểm tra artwork để thấy nó ĐỎ**

```bash
node --test scripts/landing-artwork.test.mjs
```

Kỳ vọng: FAIL — `artwork.ts` hứa một ảnh mà `prompts.json` không có và đĩa không có file.

- [ ] **Step 3: Thêm prompt**

Trong `scripts/landing/prompts.json`, thêm vào `"images"`, sau mục `"ai-workforce"`:

```json
"work-products": {
  "size": "1536x1024",
  "localized": true,
  "prompt": "A wide floating document workspace interface seen straight on, filling the frame. Three columns. The LEFT column is a narrow list of documents, each row showing a small coloured format badge, a title line, a date line, and a small status pill; the first row is highlighted as selected. The MIDDLE column is a document editor: a slim toolbar across the top, then a page of a business proposal with a heading, a short paragraph, a tinted callout box, and a bulleted list. The RIGHT column is an assistant panel: a small robot avatar at the top, a bubble containing a short bulleted list of what it can do, then four rounded suggestion chips below it, and at the bottom a small list of related items each with a coloured square icon and two lines of text. Clean modern panels, generous padding, soft shadows, warm cream background. All lettering crisp and perfectly legible.",
  "text": {
    "vi": "Exact lettering, spelled precisely. Left column format badges: 'W', 'X', 'P', 'PDF', 'MD'. Left column titles top to bottom: 'Đề xuất ACME v1.2', 'Phân tích tài chính Q3', 'Slide họp ban lãnh đạo', 'Hợp đồng Mytel', 'Kế hoạch marketing 2026'. Status pills: 'Đang duyệt', 'Bản nháp', 'Bản cuối', 'Đã ký'. Editor heading: 'Đề xuất cho Công ty ACME'; the line under it reads 'Hệ điều hành công việc có AI'; the callout box heading reads 'Mục tiêu của chúng tôi'; the bulleted list heading reads 'Tóm tắt'. Assistant panel title: 'Trợ lý AI'; the four chips read 'Tóm tắt tài liệu', 'Viết thuyết phục hơn', 'Trích xuất điều khoản', 'Tạo công việc'; the bottom list heading reads 'Liên quan tới tài liệu này' and its two rows read 'Dự án ACME' and 'Họp bán hàng ACME'. No other words anywhere.",
    "en": "Exact lettering, spelled precisely. Left column format badges: 'W', 'X', 'P', 'PDF', 'MD'. Left column titles top to bottom: 'ACME Proposal v1.2', 'Q3 Financial Analysis', 'Board Meeting Deck', 'Mytel Agreement', 'Marketing Plan 2026'. Status pills: 'In review', 'Draft', 'Final', 'Signed'. Editor heading: 'Proposal for ACME Corporation'; the line under it reads 'AI-Powered Work Operating System'; the callout box heading reads 'Our mission'; the bulleted list heading reads 'Executive Summary'. Assistant panel title: 'AI Assistant'; the four chips read 'Summarize this document', 'Make it more persuasive', 'Extract key terms', 'Create action items'; the bottom list heading reads 'Related to this document' and its two rows read 'ACME Project' and 'Sales Meeting ACME'. No other words anywhere."
  }
}
```

- [ ] **Step 4: Sinh ảnh**

```bash
pnpm landing:gen
```

Kỳ vọng: hai file `apps/web/public/landing/work-products.vi.webp` và `work-products.en.webp` xuất hiện.

- [ ] **Step 5: Nhìn hai ảnh bằng mắt**

Mở cả hai file. Kỳ vọng: bố cục ba cột, chữ trên giao diện đọc được, không có chữ méo hay bịa. Nếu chữ hỏng, chạy lại `pnpm landing:gen` cho tới khi đạt; đây là bước có thể phải lặp vài lần.

- [ ] **Step 6: Chạy bài kiểm tra artwork để thấy nó XANH**

```bash
node --test scripts/landing-artwork.test.mjs
```

Kỳ vọng: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/features/landing/artwork.ts scripts/landing/prompts.json \
        apps/web/public/landing/work-products.vi.webp apps/web/public/landing/work-products.en.webp
git commit -m "feat(landing): ảnh giao diện Work Products cho hai ngôn ngữ"
```

---

### Task 6: Section Work Products trên trang chủ

**Files:**
- Create: `apps/web/features/landing/work-products.tsx`
- Modify: `apps/web/features/landing/anchors.ts`
- Modify: `apps/web/features/landing/landing-page.tsx` (chèn section, sửa comment đầu file)
- Modify: `apps/web/features/landing/site-header.tsx` (thêm mục nav)
- Test: `e2e/landing.spec.ts`

**Interfaces:**
- Consumes: `useArtwork()` với tên `"work-products"` từ Task 5, khóa `landing.workProducts.*` từ Task 2, `ANCHORS.workProducts`.
- Produces: `WorkProducts` (không props).

- [ ] **Step 1: Viết khẳng định e2e trước**

Trong `e2e/landing.spec.ts`, thêm vào test `"dải tin cậy, FAQ và hai trang giải pháp"`, sau khối kiểm tra section `Problem`:

```ts
    // Work Products: tiêu đề, luận điểm và dòng thời gian đều có mặt.
    const wp = page.getByRole("heading", { name: "Từ bối cảnh công việc đến kết quả thực tế" });
    await wp.scrollIntoViewIfNeeded();
    await expect(wp).toBeVisible();
    await expect(page.getByText("Chúng ta không làm một Microsoft Office mới")).toBeVisible();
    await expect(page.getByText("Đây là kế hoạch nội bộ, không phải cam kết phát hành.")).toBeVisible();
```

- [ ] **Step 2: Chạy để thấy nó ĐỎ**

```bash
pnpm exec playwright test e2e/landing.spec.ts -g "dải tin cậy"
```

Kỳ vọng: FAIL — không tìm thấy tiêu đề.

- [ ] **Step 3: Thêm mỏ neo**

Trong `apps/web/features/landing/anchors.ts`, thêm vào `ANCHORS`, sau `email: "email",`:

```ts
  /** English because it is the feature's own name, like `platform` above. */
  workProducts: "work-products",
```

- [ ] **Step 4: Viết section**

Tạo `apps/web/features/landing/work-products.tsx`:

```tsx
"use client";
import { FileCheck2, FileStack, Network, Sparkles } from "lucide-react";
import Image from "next/image";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { ANCHORS } from "./anchors";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { useArtwork } from "./artwork";
import { Container, Eyebrow, SectionTitle } from "./layout-primitives";

const VALUES = [
  { icon: Network, key: "v1", ink: "text-brand" },
  { icon: Sparkles, key: "v2", ink: "text-brand-accent" },
  { icon: FileCheck2, key: "v3", ink: "text-info" },
  { icon: FileStack, key: "v4", ink: "text-warning" },
] as const;

const PHASES = ["p1", "p2", "p3", "p4"] as const;

/**
 * What UniWork produces, as opposed to what it keeps track of.
 *
 * This section deliberately does NOT use ProductBand, for three reasons. The
 * artwork is a dense three-column screen that is unreadable at half a
 * column's width; a fourth band in a row of bands is the same figure a fourth
 * time whichever way it is flipped; and this is the only section on the page
 * carrying a phased timeline, which the band has no slot for.
 *
 * It is also the one section on this page that describes software that is not
 * running yet. That is a deliberate exception to the rule the rest of the page
 * keeps, approved 2026-09-09 — see the note at the top of landing-page.tsx.
 * The copy earns it by naming the phases and by saying, in timelineNote, that
 * the schedule is a plan rather than a promise. If that note ever comes off,
 * this section has to come off with it.
 */
export function WorkProducts() {
  const { t } = useTranslation();
  const artwork = useArtwork();
  const root = useRef<HTMLElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const values = useRef<HTMLUListElement>(null);
  const rest = useRef<HTMLDivElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const lines = intro.current ? Array.from(intro.current.children) : [];
        const cells = values.current ? Array.from(values.current.children) : [];
        const tail = rest.current ? Array.from(rest.current.children) : [];
        if (!motion || !root.current) {
          gsap.set([...lines, ...cells, ...tail], { clearProps: "all" });
          return;
        }
        revealFrom([...lines, ...cells, ...tail], root.current, 0.05);
      }),
    { scope: root },
  );

  return (
    <section
      ref={root}
      id={ANCHORS.workProducts}
      aria-labelledby="landing-work-products-title"
      className="scroll-mt-16 bg-background py-20 sm:scroll-mt-18 sm:py-28"
    >
      <Container>
        <div ref={intro} className="max-w-3xl">
          <Eyebrow className="text-brand">{t("landing.workProducts.eyebrow")}</Eyebrow>
          <SectionTitle>
            <span id="landing-work-products-title">{t("landing.workProducts.title")}</span>
          </SectionTitle>
          <p className="mt-4 max-w-prose text-title-sm leading-relaxed text-pretty text-muted-foreground">
            {t("landing.workProducts.sub")}
          </p>
        </div>

        <ul ref={values} className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
          {VALUES.map(({ icon: Icon, key, ink }) => (
            <li key={key}>
              <Icon className={cn("size-6", ink)} aria-hidden />
              <h3 className="mt-4 font-heading text-body-lg font-bold leading-snug">
                {t(`landing.workProducts.${key}Title`)}
              </h3>
              <p className="mt-2 max-w-prose text-body leading-relaxed text-muted-foreground">
                {t(`landing.workProducts.${key}Desc`)}
              </p>
            </li>
          ))}
        </ul>

        <div ref={rest}>
          {/* Full container width: the screen is three columns of small type
              and shrinking it into a half column makes it decoration. */}
          <Image
            src={artwork("work-products")}
            alt={t("landing.workProducts.imageAlt")}
            width={1536}
            height={1024}
            sizes="(min-width: 1280px) 1216px, 100vw"
            className="mt-16 w-full rounded-xl border border-border"
          />

          <div className="mt-16 rounded-xl bg-muted p-8 sm:p-10">
            <h3 className="font-heading text-title font-bold leading-snug">
              {t("landing.workProducts.notOfficeTitle")}
            </h3>
            <p className="mt-3 max-w-prose text-body-lg leading-relaxed text-muted-foreground">
              {t("landing.workProducts.notOfficeDesc")}
            </p>
            <p className="mt-6 text-label font-semibold text-muted-foreground">
              {t("landing.workProducts.summaryLabel")}
            </p>
            <p className="mt-2 max-w-prose text-body-lg leading-relaxed">{t("landing.workProducts.summary")}</p>
          </div>

          <h3 className="mt-16 font-heading text-title font-bold leading-snug">
            {t("landing.workProducts.timelineTitle")}
          </h3>
          <p className="mt-2 text-body text-muted-foreground">{t("landing.workProducts.timelineNote")}</p>
          <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
            {PHASES.map((phase) => (
              <li key={phase} className="border-t border-border pt-4">
                <p className="text-label font-semibold text-brand">{t(`landing.workProducts.${phase}When`)}</p>
                <h4 className="mt-2 font-heading text-body-lg font-bold leading-snug">
                  {t(`landing.workProducts.${phase}Name`)}
                </h4>
                <p className="mt-2 max-w-prose text-body leading-relaxed text-muted-foreground">
                  {t(`landing.workProducts.${phase}Desc`)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}
```

- [ ] **Step 5: Chèn vào trang chủ**

Trong `apps/web/features/landing/landing-page.tsx`, thêm import:

```tsx
import { WorkProducts } from "./work-products";
```

và chèn giữa band `email` và `<AiWorkforce />`:

```tsx
        <WorkProducts />
        <AiWorkforce />
```

- [ ] **Step 6: Cập nhật comment đầu `landing-page.tsx`**

Đây là bước bắt buộc, không phải trang trí: comment hiện tại nói trang không được tuyên bố thứ chưa chạy, và người sửa tiếp theo sẽ đọc nó rồi xóa section vừa thêm, đúng như đã xóa Work Graph. Thêm đoạn sau vào comment đó, ngay dưới đoạn nói về section Work Graph bị gỡ:

```
 * Work Products is the one exception to the rule those two paragraphs
 * describe, approved by quangpd on 2026-09-09 (spec
 * docs/superpowers/specs/2026-09-09-landing-work-products-positioning-design.md
 * §9.1). No module implements it yet; it is on the page because it is the
 * clearest answer to what UniWork produces rather than tracks. It carries its
 * own honesty instead: the section prints its phases and says in
 * timelineNote that the schedule is a plan, not a release commitment. Delete
 * the section rather than the note.
```

Sửa luôn đoạn mô tả thứ tự section ở đầu comment để nó kể đúng mạch mới: sau `Problem` là khối khoảng trống thị trường, và sau band email là Work Products.

- [ ] **Step 7: Thêm mục nav**

Trong `apps/web/features/landing/site-header.tsx`, thêm vào `NAV` sau mục `landing.nav.solutions`:

```tsx
  { key: "landing.workProducts.eyebrow", to: href(ANCHORS.workProducts) },
```

- [ ] **Step 8: Chạy e2e để thấy nó XANH**

```bash
pnpm exec playwright test e2e/landing.spec.ts
```

Kỳ vọng: cả bốn test PASS, gồm cả hai bài đo tương phản.

- [ ] **Step 9: Commit**

```bash
git add apps/web/features/landing/work-products.tsx apps/web/features/landing/anchors.ts \
        apps/web/features/landing/landing-page.tsx apps/web/features/landing/site-header.tsx \
        e2e/landing.spec.ts
git commit -m "feat(landing): section Work Products trên trang chủ"
```

---

### Task 7: Cổng cuối

**Files:** không tạo, không sửa trừ khi có gate đỏ.

- [ ] **Step 1: Chạy toàn bộ cổng**

```bash
make check
```

Kỳ vọng: PASS. `GATE_LEVEL` hiện là `fast`, nên e2e chỉ chạy khi vượt mức đó; chạy tay ở bước 2 cho chắc.

- [ ] **Step 2: Chạy e2e đầy đủ**

```bash
make e2e
```

Kỳ vọng: PASS.

- [ ] **Step 3: Kiểm tra export thừa**

```bash
pnpm knip
```

Kỳ vọng: PASS. Nếu `platforms.ts` báo export không dùng, đó là dấu hiệu Task 4 chưa nối `PLATFORMS` vào khối trang chủ.

- [ ] **Step 4: Xem lại bằng mắt lần cuối**

Với `make start` đang chạy, mở `/` và `/why-uniwork`, ở cả hai ngôn ngữ và cả hai chế độ màu, trên khổ 1440px và khổ điện thoại. Kỳ vọng: không có tràn ngang, ảnh Work Products đọc được ở khổ hẹp, và hai section mới không đứng cạnh section có cùng hình dạng lưới.

- [ ] **Step 5: Commit nếu có sửa vặt**

```bash
git add -A
git commit -m "fix(landing): sửa sau khi chạy cổng đầy đủ"
```

---

## Ghi chú cho người thực thi

- **Thứ tự bắt buộc.** Task 1 trước tất cả, Task 2 trước mọi task dựng UI, Task 5 trước Task 6. Task 3 và Task 4 phải theo thứ tự đó vì Task 4 gọi `paths.whyUniwork()`.
- **Nếu §3 của spec bị đảo sang phương án (b)**, dừng lại và báo: toàn bộ tiền tố khóa `landing.workProducts.*` và tên section phải đổi, và Task 1 không còn cần thiết.
- **Không thêm bảng tick** ở bất kỳ task nào, kể cả khi thấy nó sẽ lấp chỗ trống trên `/why-uniwork`. Đó là quyết định số 3 trong spec.
- **Google Workspace không có trong đợt này.** Spec §10 câu 4 để ngỏ. Nếu quangpd muốn thêm, đó là một khóa `landing.why.google` theo đúng khuôn bốn khối kia, một dòng trong `PLATFORMS` và `PLATFORM_KEYS`, và lưới `lg:grid-cols-2` vẫn chứa được năm khối; không cần đổi gì khác.
- **Không đổi ngưỡng trong `e2e/contrast.ts`.** Nếu bài đo tương phản đỏ, sửa màu trong component.
