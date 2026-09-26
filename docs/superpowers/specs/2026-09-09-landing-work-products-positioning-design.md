# UniWork — Làm giàu landing page: Work Products và định vị so với các nền tảng hiện tại

> **Trạng thái:** in-progress — Duyệt hướng 2026-09-09 (quangpd). Chưa có issue UNI; phải mở issue trước khi viết dòng mã đầu tiên (CLAUDE.md §Project Tracking).

**Ngày:** 2026-09-09
**Nguồn nội dung:** ba infographic do quangpd cung cấp — (1) ảnh giao diện Work Products, (2) trang giới thiệu Work Products tám khối, (3) trang phân tích Microsoft 365 / Notion / ClickUp / Coda và khoảng trống thị trường.
**Tham chiếu mã:** `apps/web/features/landing/` (toàn bộ), `packages/core/paths/paths.ts`, `packages/core/paths/consistency.test.ts`, `packages/core/i18n/locales/{vi,en}.json`, `packages/core/i18n/parity.test.ts`, `server/internal/service/reserved_slugs.json`, `scripts/landing/prompts.json`, `scripts/landing-artwork.test.mjs`, `e2e/landing.spec.ts`, `e2e/onboarding-contrast.spec.ts`.
**Spec liên quan:** `2026-09-08-documents-design.md` (C-01 — tầng tài liệu thật đứng sau phần Work Products), `2026-09-04-agent-actor-model-design.md` (ADR 0010 — agent đề xuất, người xác nhận).
**Tài liệu định hướng:** `PRODUCT.md`, `docs/vision/KEY_POINTS.md`, `docs/vision/PROJECT_VISION.md`, `docs/roadmap/FEATURE_ROADMAP.md`, `docs/conventions.md`.

---

## 1. Mục tiêu

Landing page hiện tại mô tả rất tốt **cái sản phẩm làm được hôm nay**, nhưng không trả lời hai câu hỏi mà người mua luôn hỏi trong buổi demo:

1. "Tôi đã có Microsoft 365 và Notion rồi, vì sao còn cần UniWork?"
2. "Rốt cuộc UniWork tạo ra cái gì, ngoài việc quản lý quá trình?"

Ba infographic trả lời đúng hai câu đó. Spec này đưa chúng lên web dưới dạng hai section mới trên trang chủ và một trang mới `/why-uniwork`.

Tính chất đo được sau khi xong:

1. Trang chủ có một khối **Work Products** đứng ngang hàng với các band sản phẩm hiện có, kèm ảnh giao diện.
2. Trang chủ có một khối ngắn dẫn sang phân tích thị trường, đặt ngay sau `Problem`.
3. `/why-uniwork` chứa toàn bộ nội dung ảnh 3: bốn nền tảng, mỗi nền tảng có định vị, năm hạn chế và một câu trích, rồi tới khoảng trống thị trường và bốn trụ cột của UniWork.
4. Mọi chuỗi mới có cả `vi` và `en`; `packages/core/i18n/parity.test.ts` xanh.
5. `/why-uniwork` có builder trong `paths.ts` và slug được đặt chỗ; `packages/core/paths/consistency.test.ts` xanh.
6. Không section mới nào dùng bảng tick tự chấm điểm.

---

## 2. Quyết định đã chốt

| # | Quyết định | Vì sao |
|---|-----------|--------|
| 1 | **Hướng A**: hai section mới trên trang chủ + một trang mới, thay vì dồn hết lên trang chủ hoặc đẩy hết sang trang phụ | Trang chủ đang 16 section với một mạch lập luận được ghi rõ trong comment đầu `landing-page.tsx`. Phân tích đối thủ là nội dung giai đoạn cân nhắc, thuộc về một route riêng; Work Products là trụ cột định vị, phải thấy sớm |
| 2 | **Giữ nguyên section `Problem`** | `Problem` nói về nỗi đau của chính đội khách hàng; ảnh 3 nói về hạn chế của công cụ. Hai nhiệm vụ khác nhau, gộp lại loãng cả hai |
| 3 | **Bỏ bảng so sánh tick** ở ảnh 2 (Xuất sắc / Tốt / Cơ bản) | Ô tự chấm điểm cho chính mình mâu thuẫn với giọng tôn trọng đã chọn cho ảnh 3, và là thứ dễ bị phản bác nhất trên trang |
| 4 | **Nêu đích danh** Microsoft 365, Notion, ClickUp, Coda, giọng công nhận điểm mạnh trước rồi mới nêu hạn chế | Giữ đúng giọng ảnh 3. Người mua đã dùng các công cụ đó; phủ nhận chúng làm mất uy tín cả trang |
| 5 | **Chỉ dùng tên chữ, không dùng logo đối thủ** | Tránh vấn đề nhãn hiệu, tránh thêm sáu asset mới và một pipeline ảnh thứ hai. Tên đặt trong `<h3>` với typography riêng đủ để nhận diện |
| 6 | **Nới luật "không nói thứ chưa chạy" chỉ trong phạm vi Work Products** | quangpd chốt 2026-09-09. Rủi ro và cách giảm ở §9 |
| 7 | **Mốc Q1–Q4 2026 in nguyên như infographic** | quangpd chốt. Rủi ro ở §9.2 |
| 8 | **Route là `/why-uniwork`**, không phải slug tiếng Việt | quangpd chốt. Hệ quả với `docs/conventions.md` ở §6.2 |

---

## 3. Va chạm tên gọi phải xử lý trước

Trong repo, **"Work Product" đã có nghĩa khác với nghĩa trong infographic.**

- `docs/vision/KEY_POINTS.md` mục 9 — "Work Product / Sell Work Foundation": mỗi loại công việc có một contract gồm input, context, executor, deliverable, acceptance, SLA. Hiện thực là bảng `work_contracts`, hạng mục **A-09**, ưu tiên P2.
- `docs/vision/KEY_POINTS.md` mục 11 — "From Software to Work": lớp doanh thu bán kết quả công việc, ghi rõ **"chỉ công bố khi cohort PROVEN"**.
- `docs/roadmap/FEATURE_ROADMAP.md` dòng 97 — A-09 "Work Products (bán công việc hoàn thành)".

Còn Work Products trong infographic là **tầng tài liệu**: DOCX, XLSX, PPTX, PDF, Markdown, dựng trên engine GenOffice. Trong repo, thứ gần nhất với nó là **C-01 Documents** (`2026-09-08-documents-design.md`), cộng thêm ba engine bảng tính / trình chiếu / PDF chưa có spec.

Hai nghĩa này không thể cùng tồn tại trên một sản phẩm mà không gây nhầm cho chính đội ngũ. Trước khi viết plan, phải chốt một trong hai:

- **(a)** Đổi tên hạng mục A-09 trong `KEY_POINTS.md` và `FEATURE_ROADMAP.md` thành "Sell Work / Work-as-a-Service", nhường tên "Work Products" cho tầng tài liệu. Đây là lựa chọn tôi khuyến nghị: tên trong infographic đã đi ra ngoài, còn A-09 là P2 chưa ai nói tới.
- **(b)** Giữ A-09, đổi tên tầng tài liệu trên landing thành thứ khác.

**Spec này viết theo phương án (a).** Nếu bạn chọn (b), toàn bộ khóa `landing.workProducts.*` phải đổi tiền tố và §4 phải viết lại tiêu đề.

---

## 4. Trang chủ — thứ tự section sau thay đổi

Hai dòng có dấu `+` là mới. Mọi thứ khác giữ nguyên vị trí.

```
Hero
TrustBand
Problem
+ MarketGapTeaser          ← mới, dẫn sang /why-uniwork
Capabilities
SolutionsTeaser
ProductBand  meetings      (emphasis, split)
ProductBand  projects      (wide)
ProductBand  email         (reverse, soon)
+ WorkProducts             ← mới, layout riêng, không dùng ProductBand
AiWorkforce
Showcase
Security
Roadmap
Pricing
Faq
FinalCta
```

### 4.1 `MarketGapTeaser` đặt sau `Problem`

Đặt ở đây vì nó là câu tiếp theo của chính lập luận `Problem`. `Problem` nói "công việc của một đội đang nằm ở bốn nơi"; câu hỏi bật ra ngay sau đó là "nhưng tôi đã mua công cụ rồi mà". Khối này trả lời trong ba câu rồi mời đọc tiếp ở trang riêng.

**Ràng buộc bố cục:** `Problem` là lưới ba cột chữ. Khối này **không được** là lưới bốn cột chữ, vì hai lưới chữ liền nhau là cùng một hình dạng hai lần, đúng thứ mà comment đầu `landing-page.tsx` cấm. Hình dạng quy định: một khối tuyên bố rộng một cột, bên dưới là **một hàng ngang bốn tên nền tảng** đặt như typography thuần, không icon, không viền thẻ, rồi một liên kết văn bản sang `/why-uniwork`.

Nội dung: bốn nền tảng hàng đầu, mỗi nền tảng mạnh ở một phía, và không nền tảng nào đóng được cả bốn phía một lúc. Câu chốt lấy từ dải "Khoảng trống thị trường" của ảnh 3.

### 4.2 `WorkProducts` đặt sau band email

Đặt sau ba band sản phẩm và trước `AiWorkforce`: người đọc vừa xem xong ba thứ UniWork quản lý (họp, việc, email), câu tiếp theo là "và đây là thứ nó tạo ra". `AiWorkforce` ngay sau đó nhận ý này và nói ai tạo ra.

**Không dùng `ProductBand`.** Ba lý do:

1. Ảnh giao diện Work Products là một màn hình ba cột dày chữ. Đặt nó vào nửa cột của `ProductBand` thì không đọc được ở bất kỳ khổ nào.
2. Bốn `ProductBand` liên tiếp là bốn lần cùng một hình dạng, kể cả khi đảo `reverse`/`wide`.
3. Khối này mang thêm một dòng thời gian bốn giai đoạn mà `ProductBand` không có chỗ.

**Hình dạng quy định:**

- Tiêu đề và câu dẫn ở giữa, một cột hẹp.
- Bốn giá trị khác biệt xếp một hàng ngang bốn ô, chữ nhỏ, có icon `lucide-react`. Lấy từ khối 3 của ảnh 2: nối với Work Graph, AI Team hiểu toàn bộ bối cảnh, biến tài liệu thành hành động, tương thích định dạng chuẩn.
- Ảnh giao diện chiếm hết bề rộng `Container`, đặt dưới, không bao trong thẻ.
- Một khối luận điểm ngắn "chúng ta không làm một Microsoft Office mới" đặt dưới ảnh, nền `bg-muted`, lấy từ khối 2 của ảnh 2.
- Dòng thời gian bốn giai đoạn nằm cuối khối. §9.2 nói về mốc quý.

`ANCHORS.workProducts = "work-products"`. Anchor dùng tiếng Anh vì đó là tên riêng của tính năng, cùng lối với `platform` và `email` đã có trong `anchors.ts`.

### 4.3 Không đụng vào `Roadmap`

Section `Roadmap` giữ nguyên ba cột và giữ nguyên câu `landing.roadmap.note` — "Không mục nào dưới đây có ngày phát hành cam kết". Bốn giai đoạn Work Products **không** thêm vào đó; chúng sống trong khối `WorkProducts` ở §4.2. Lý do ở §9.2.

Ngoại lệ duy nhất: nếu phương án (a) ở §3 được chọn, sửa `landing.roadmap.now1` từ "Tài liệu cộng tác, có phiên bản và nhật ký truy cập" thành câu nêu rõ nó là nền của Work Products, để hai phần trên cùng một trang không đọc như hai việc rời nhau.

---

## 5. Trang mới `/why-uniwork`

Dựng theo đúng khuôn `solution-page.tsx`: một component trang, dùng lại `SiteHeader`, `TrustBand`, `FinalCta`, `SiteFooter` và các primitive trong `layout-primitives.tsx`.

```
SiteHeader
WhyHero            tiêu đề, câu dẫn, câu miễn trừ
Platforms          bốn nền tảng, mỗi nền tảng một khối
MarketGap          dải nhấn, polarity đảo — EmphasisSection
Pillars            bốn trụ cột của UniWork
TrustBand          dùng lại, không sửa
FinalCta
SiteFooter
```

### 5.1 `Platforms`

Bốn khối, mỗi khối một nền tảng, xếp lưới hai cột trên `lg` để bốn khối không thành một cột dài bốn lần.

Mỗi khối gồm: tên nền tảng, một dòng định vị ("The productivity powerhouse"), một đoạn công nhận điểm mạnh, năm hạn chế dạng danh sách có icon, và một câu trích in nghiêng đóng khối.

Nội dung lấy nguyên từ ảnh 3, không thêm bớt luận điểm. Mỗi nền tảng có một màu mực riêng lấy từ token có sẵn (`text-info`, `text-muted-foreground`, `text-warning`, `text-brand-accent`) — không đặt màu cứng, `scripts/no-legacy-tokens.test.mjs` sẽ chặn.

**Bắt buộc có câu miễn trừ** đặt ở `WhyHero`, không giấu dưới chân trang: nhận định dựa trên tài liệu công khai của từng nền tảng tại thời điểm viết, và các nền tảng đó thay đổi liên tục. Đây là thứ giữ cho trang không thành quảng cáo so sánh sai sự thật khi đối thủ ra tính năng mới.

### 5.2 `MarketGap` và `Pillars`

`MarketGap` là `EmphasisSection` (đảo polarity, đã có trong `layout-primitives.tsx`), một câu: từ công việc phân mảnh đến một tổ chức thực sự hiệu quả.

`Pillars` là bốn ô: một nền tảng thống nhất, AI hiểu bối cảnh và thực thi công việc, Work Products là kết quả thực, linh hoạt triển khai (Cloud / Private Cloud / On-prem / BYOK). Lấy từ dải cuối ảnh 3.

### 5.3 Điều hướng

- `site-header.tsx`: thêm `{ key: "landing.nav.why", to: paths.whyUniwork() }` vào `NAV`. Mảng này hiện dùng `href(ANCHORS.x)` cho mọi mục; mục mới là route thật nên dùng `paths`, và `SiteHeader` phải chuyển sang `next/link` cho mục đó — cùng cách `site-footer.tsx` đã làm với `SOLUTIONS`.
- `site-footer.tsx`: thêm vào nhóm `landing.footer.resources`.
- Trang chủ dẫn sang nó từ `MarketGapTeaser` (§4.1).

---

## 6. Ràng buộc kỹ thuật

### 6.1 i18n

Mọi chuỗi mới vào `packages/core/i18n/locales/vi.json` **và** `en.json`. `packages/core/i18n/parity.test.ts` fail nếu lệch một khóa. `i18next/no-literal-string` chặn mọi JSX text node trong `packages/views/`; `apps/web/features/landing/` không nằm trong phạm vi rule đó nhưng vẫn theo cùng lối, vì trang phải đổi được ngôn ngữ.

Không gian tên mới:

| Không gian tên | Khóa |
|---|---|
| `landing.workProducts` | `eyebrow`, `title`, `sub`, `v1Title`–`v4Title`, `v1Desc`–`v4Desc`, `imageAlt`, `notOfficeTitle`, `notOfficeDesc`, `quote`, `timelineTitle`, `timelineNote`, `p1Name`/`p1When`/`p1Desc` … `p4Name`/`p4When`/`p4Desc` |
| `landing.marketGap` | `title`, `sub`, `body`, `cta` |
| `landing.why` | `metaTitle`, `metaDesc`, `eyebrow`, `title`, `sub`, `disclaimer`, `gapTitle`, `gapSub`, `pillarsTitle`, `pillar1Title`–`pillar4Title`, `pillar1Desc`–`pillar4Desc` |
| `landing.why.ms365` `.notion` `.clickup` `.coda` | mỗi cái: `name`, `tagline`, `desc`, `i1Title`–`i5Title`, `i1Desc`–`i5Desc`, `quote` |
| `landing.nav` | `+ why` |
| `landing.footer` | `+ why` |

Tổng khoảng 150 khóa mới mỗi ngôn ngữ. Giọng tiếng Việt theo `docs/conventions.md` §Vietnamese voice guide; bản `en` là bản dịch, không phải bản viết lại.

### 6.2 Route và slug

1. `packages/core/paths/paths.ts`: thêm `whyUniwork: () => "/why-uniwork"`.
2. `packages/core/paths/consistency.test.ts`: thêm vào danh sách route công khai đã liệt kê (`paths.solutions.product()` và `operations()` đang ở đó).
3. `server/internal/service/reserved_slugs.json`: thêm `"why-uniwork"`, chạy `pnpm generate:reserved-slugs`, commit `packages/core/paths/reserved-slugs.ts`.
4. `apps/web/app/why-uniwork/page.tsx`: metadata + render component.

**Va chạm quy ước.** `docs/conventions.md` §Routes viết "Never a hyphenated root (`/new-workspace`)". Repo đã có hai ngoại lệ là `/forgot-password` và `/reset-password`, cả hai đều nằm trong danh sách slug đặt chỗ. `/why-uniwork` là cái thứ ba. Plan phải sửa một dòng trong `docs/conventions.md` để ghi nhận ngoại lệ này thay vì để rule và mã nói ngược nhau — CLAUDE.md yêu cầu mỗi rule phải có thứ enforce nó, và một rule bị vi phạm ba lần thì không còn là rule.

### 6.3 Ảnh Work Products

Đi qua đúng pipeline artwork hiện có, không thêm đường thứ hai:

1. `apps/web/features/landing/artwork.ts`: thêm `"work-products": true` vào `ARTWORK` (có chữ trên giao diện nên phải sinh theo từng ngôn ngữ).
2. `scripts/landing/prompts.json`: thêm mục `work-products`, `"size": "1536x1024"`, `"localized": true`, kèm `text.vi` và `text.en` chỉ định chính xác từng chữ trên giao diện. Chữ trên ảnh phải lấy từ `packages/core/i18n/locales/*.json` chứ không được bịa từ đồng nghĩa — đây là hợp đồng đã ghi trong `__text` của chính file đó.
3. `pnpm landing:gen`, commit hai file WebP vào `apps/web/public/landing/`.
4. `scripts/landing-artwork.test.mjs` đối chiếu `artwork.ts` với `prompts.json` và với file trên đĩa; nó fail nếu thiếu bất kỳ vế nào.

Prompt phải tả đúng bố cục ảnh 1: sidebar điều hướng trái, danh sách tài liệu có nhãn định dạng và trạng thái, trình soạn thảo ở giữa, bảng trợ lý AI bên phải với danh sách gợi ý và khối "Related to this document" ở dưới.

### 6.4 Kiểm thử và gate

| Thứ phải chạy | Vì sao |
|---|---|
| `packages/core/i18n/parity.test.ts` | Khóa mới phải có đủ hai ngôn ngữ |
| `packages/core/paths/consistency.test.ts` | Route mới phải có builder và ngược lại |
| `scripts/landing-artwork.test.mjs` | Ảnh mới phải khớp ba nơi |
| `e2e/landing.spec.ts` | Thêm khẳng định cho hai section mới trên trang chủ |
| `e2e/onboarding-contrast.spec.ts` | Mọi màu mới phải đo được ở cả hai chế độ; đọc giá trị token không tính là đã kiểm |
| `pnpm knip` | Component mới phải có người dùng, không export thừa |
| `max-lines` 500 | Mỗi section mới là một file riêng trong `features/landing/`; trang `/why-uniwork` tách thành `why-page.tsx` cộng file con nếu vượt |

Không có thay đổi phía server, không migration, không endpoint mới. Đây thuần là trang tĩnh và copy.

---

## 7. Lát cắt triển khai

Chia theo thứ tự để mỗi lát cắt đều review được riêng, và để phần chữ được duyệt trước khi ai đó dựng UI cho chữ sai.

| Lát | Nội dung | Xong khi |
|---|---|---|
| 1 | Chốt §3 (đổi tên A-09 hay đổi tên tầng tài liệu). Sửa `KEY_POINTS.md` + `FEATURE_ROADMAP.md` theo phương án chọn | Không còn hai nghĩa "Work Product" trong repo |
| 2 | Toàn bộ copy `vi` + `en` cho ba không gian tên mới, chưa có UI | `parity.test.ts` xanh; quangpd duyệt bản chữ |
| 3 | Route `/why-uniwork`: `paths.ts`, reserved slug, `conventions.md`, trang + `WhyHero`, `Platforms`, `MarketGap`, `Pillars` | `consistency.test.ts` xanh; trang đọc được ở hai ngôn ngữ, hai chế độ màu |
| 4 | Liên kết điều hướng: header, footer, `MarketGapTeaser` trên trang chủ | Không link nào 404; `e2e/landing.spec.ts` có khẳng định mới |
| 5 | Ảnh `work-products` qua `pnpm landing:gen`, hai ngôn ngữ | `scripts/landing-artwork.test.mjs` xanh |
| 6 | Section `WorkProducts` trên trang chủ + anchor + mục nav | `make check` xanh |

Lát 2 và lát 3 là phần lớn công sức. Lát 5 phụ thuộc quota ảnh và có thể phải sinh lại vài lần để chữ trên giao diện đọc được.

---

## 8. Ngoài phạm vi

- Bảng so sánh tick (quyết định 3).
- Logo đối thủ (quyết định 5).
- Trang riêng cho Work Products. Nếu khối trên trang chủ chứng minh được giá trị thì tách sau, dùng lại đúng copy này.
- Sơ đồ kiến trúc Work Context ↔ UniWork ↔ Document Engine ở khối 6 ảnh 2. Nó là ngôn ngữ dành cho người mua kỹ thuật, thuộc về tài liệu bán hàng chứ không phải landing; đưa lên trang sẽ đòi một asset SVG mới và một pipeline vẽ mà repo chưa có.
- Khối 8 "Lợi ích mang lại" của ảnh 2. Nội dung của nó trùng gần hết với `Capabilities` và `Security` đã có trên trang.
- Dịch trang sang ngôn ngữ thứ ba.

---

## 9. Rủi ro

### 9.1 Nới luật "không nói thứ chưa chạy"

Comment đầu `landing-page.tsx`, `problem.tsx`, `capabilities.tsx` và `roadmap.tsx` đều ghi cùng một luật, và trang đã từng **xóa** một section Work Graph cùng một gallery ảnh vì luật đó. Section `WorkProducts` mới, kèm ảnh giao diện của màn hình chưa tồn tại, là ngoại lệ đầu tiên.

Hệ quả phải chấp nhận: comment trong bốn file kia sẽ nói ngược với thứ nằm trên trang. Plan phải sửa comment đầu `landing-page.tsx` để ghi rõ ngoại lệ này và ai duyệt nó, ngày nào — nếu không, người sửa trang tiếp theo sẽ đọc comment, thấy `WorkProducts` vi phạm, và xóa nó đúng như đã xóa Work Graph.

Cách giảm rủi ro mà không phá quyết định: `imageAlt` của ảnh và câu `landing.workProducts.sub` mô tả nó là thiết kế sản phẩm, chứ không viết như một màn hình đang chạy. Đây là chỉnh giọng, không phải thêm nhãn "sắp có" mà bạn đã từ chối.

### 9.2 Mốc Q1–Q4 2026

Hôm nay là 2026-09-09. In "Phase 1 — Q1 2026" nghĩa là trang tự công bố một lộ trình đã trễ hai quý, và Phase 2 (Q2) cùng Phase 3 (Q3) cũng đã qua hạn. Người đọc kỹ sẽ thấy trước tiên là một kế hoạch trượt, không phải một tầm nhìn.

Thêm nữa, section `Roadmap` cách đó vài trăm pixel đang in "Không mục nào dưới đây có ngày phát hành cam kết". Hai câu trên cùng một trang.

Vì vậy §4.3 giữ mốc quý **chỉ trong khối `WorkProducts`** và không đưa vào `Roadmap`, và `landing.workProducts.timelineNote` phải nói rõ đây là kế hoạch nội bộ chứ không phải cam kết phát hành. Đó là mức giảm rủi ro cao nhất còn giữ được quyết định của bạn.

Tôi vẫn khuyến nghị bỏ quý và chỉ in thứ tự bốn giai đoạn. Quyết định là của bạn; nếu đổi ý, chỉ cần xóa các khóa `pNWhen`.

### 9.3 Nội dung về đối thủ cũ đi

Bốn nền tảng trong ảnh 3 ra tính năng mới liên tục. Một trang nói "Notion chưa mạnh về dự án" sẽ sai vào một ngày nào đó mà không ai nhận ra.

Giảm bằng hai thứ: câu miễn trừ ở §5.1, và một dòng trong `docs/` ghi rằng `/why-uniwork` phải rà lại mỗi sáu tháng. Repo chưa có cơ chế nhắc theo lịch cho tài liệu marketing, nên đây là rà tay.

---

## 10. Câu hỏi mở

1. **§3 chọn (a) hay (b).** Chặn lát cắt 1, và do đó chặn tất cả.
2. **Ai viết bản `en`?** Khoảng 150 khóa. Nếu dịch máy rồi người rà thì cần một lượt duyệt riêng ở lát cắt 2.
3. **Câu trích trong bốn khối nền tảng ở ảnh 3 là do ai nói?** Trên infographic chúng không có nguồn. Nếu là nhận định nội bộ thì phải bỏ dấu ngoặc kép, vì một câu trong ngoặc kép không nguồn đọc như trích lời khách hàng.
4. **Số nền tảng.** Ảnh 3 có bốn. Google Workspace vắng mặt và là đối thủ mà khách Việt Nam hỏi nhiều. Thêm ở đợt này hay để sau?
