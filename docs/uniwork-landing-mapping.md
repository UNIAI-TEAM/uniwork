# Landing UniWork — bảng ánh xạ từ unidigiwork

> **Trạng thái:** in-progress — bước 2 của blueprint. Đọc
> `docs/uniwork-blueprint.md` trước. Chưa viết code.

Nguồn: `unidigiwork/src/routes/index.tsx` (622 dòng), copy tiếng Việt trong
`unidigiwork/src/lib/i18n.tsx` (tiền tố `land.*`), token trong
`unidigiwork/src/styles.css`.

## 0. Quyết định đã chốt

1. **Form đăng nhập không mang sang.** Section `#login` thành khối CTA với hai
   nút dẫn tới `/register` và `/login`. Bản gốc gọi thẳng
   `supabase.auth.signInWithPassword` trong component, trái quy tắc chỉ
   `api/endpoints/*` được chạm transport.
2. **Giữ section Email Hub.** Copy và bố cục mang sang nguyên vẹn; sản phẩm đỡ
   phía sau là việc của roadmap, không phải của trang.
3. **Hai slot màu mới:** `--brand-accent` (magenta) và `--surface-emphasis`
   (dải nền đậm). Lý do đặt tên ở mục 2.
4. **Cả hai token có giá trị `.dark` thật**, không thêm vào danh sách miễn trừ
   của `packages/ui/styles/tokens.test.ts`. Giá trị và số đo tương phản ở mục 2.
5. **GSAP thêm vào catalog, chỉ app web khai báo.** `motion` giữ nguyên cho mọi
   phần còn lại. Ranh giới thực thi ở mục 4.

### Vị trí file

- Landing sống trong `apps/web/features/landing/`, route
  `apps/web/app/page.tsx`. Không đặt trong `packages/views/`: đó là
  màn hình nghiệp vụ dùng chung cho nhiều host, trang marketing chỉ có trên web.
- Copy vào `packages/core/i18n/locales/{vi,en}/landing.json`, key lồng theo
  section (`hero.title`, `hero.sub`), không giữ key phẳng `land.*` của bản gốc.

---

## 1. Ánh xạ token có sẵn

| Token unidigiwork | Giá trị | Slot UniWork |
| --- | --- | --- |
| `--landing-canvas` | `oklch(1 0 0)` | `--surface` |
| `--landing-soft` | `oklch(0.985 0.006 270)` | `--background` |
| `--landing-tint` | `oklch(0.96 0.025 255)` | `--surface-hover` |
| `--landing-ink` | `oklch(0.22 0.07 278)` | `--foreground` |
| `--landing-muted` | `oklch(0.48 0.025 270)` | `--muted-foreground` |
| `--landing-line` | `oklch(0.91 0.012 270)` | `--border` |
| `--landing-blue` | `oklch(0.59 0.22 255)` | `--brand` |
| `--landing-on-accent` | `oklch(1 0 0)` | `--brand-foreground` |
| `--landing-magenta` | `oklch(0.58 0.27 325)` | **mới:** `--brand-accent` |
| `--landing-dark` | `oklch(0.2 0.08 278)` | **mới:** `--surface-emphasis` |
| `--landing-on-dark` | `oklch(0.98 0.005 270)` | không cần slot — xem mục 2.3 |

Bóng đổ `shadow-landing-dark/5` **không** ánh xạ vào slot màu. Nó là bóng, và
UniWork đã có `--surface-shadow`, `--menu-shadow`, `--floating-shadow`.

**Font:** `DM Sans` (body), `Space Grotesk` (heading), nạp bằng `next/font`
trong `apps/web` và gán vào `--font-sans` / `--font-heading`. Cỡ chữ dùng thang
`--text-*`; h1 hero cần thêm một bậc `--text-display-lg`.

---

## 2. Hai token mới

### 2.1 `--surface-emphasis` — dải nền đậm dùng ở đâu

`--landing-dark` xuất hiện ở bốn chỗ trong bản gốc, và chúng không cùng một vai:

| Vị trí | Dòng | Vai trò |
| --- | --- | --- |
| Section Work Graph | `index.tsx:294` | nền của một dải đảo màu giữa trang sáng |
| `ProductBand` biến thể `dark` (band Họp) | `index.tsx:443` | cùng vai trò trên |
| Nút CTA chính ở hero | `index.tsx:198` | nền nút, cắt ra từ chính màu dải đó |
| `shadow-landing-dark/5` | `index.tsx:494`, `:564` | màu bóng đổ |

Ba vị trí đầu là **một vai trò duy nhất**: một mặt phẳng đậm, đảo cực so với
trang, dùng để ngắt nhịp và nhấn. Vị trí thứ tư là bóng và đi vào token bóng
sẵn có.

**Tên đề xuất: `--surface-emphasis`.** Ba lý do:

- Nó thuộc họ `--surface*` đã có (`--surface`, `--surface-raised`,
  `--surface-hover`, `--surface-selected`), tức là "một mặt phẳng nội dung",
  đúng vai trò của nó.
- Nó đặt tên theo **vai trò**, không theo màu. `--landing-dark` mô tả màu và sẽ
  sai ngay khi trang có bản tối, nơi dải này không còn là thứ tối nhất.
  `--indigo-900` thì là màu thuần, trái quy ước của repo.
- Nó không dính chữ "landing", nên dùng lại được cho một dải nhấn trong app mà
  không phải đổi tên. `--rail` đã chiếm nghĩa "khung chrome tối"; đây là nội
  dung, không phải chrome.

### 2.2 Giá trị và số đo

```css
:root {
  --brand-accent: oklch(0.58 0.27 325);      /* #c203cf */
  --surface-emphasis: oklch(0.20 0.08 278);  /* #100e39 */
}

.dark {
  --brand-accent: oklch(0.70 0.22 325);      /* #df63e8 */
  --surface-emphasis: oklch(0.28 0.07 278);  /* #21244b */
}
```

Giá trị sáng giữ nguyên của unidigiwork. Giá trị tối dựng theo đúng cách repo
đã làm với `--brand` (`#0b5bf5` → `#4d8dff`): giữ hue, nâng lightness, giảm
chroma một chút để không chói.

`--surface-emphasis` bản tối nâng lên `0.28` để dải vẫn tách khỏi nền trang
`#111113`. Tỉ số 1.27:1 nghe thấp nhưng đúng bậc nâng mà hệ thống đang dùng:
`--surface` (`#18181b`) so với `--background` (`#111113`) chỉ là 1.06:1. Dải
còn có viền `--border` nên ranh giới không phụ thuộc riêng vào độ sáng.

Tương phản đo trên giá trị thật:

| Cặp màu | Tỉ số | Ngưỡng |
| --- | --- | --- |
| `--brand-accent` sáng trên `--surface` `#ffffff` | 4.99 | AA text ✓ |
| `--brand-accent` sáng trên `--background` `#fafafa` | 4.78 | AA text ✓ |
| `--brand-accent` tối trên `--background` `#111113` | 6.37 | AA text ✓ |
| `--brand-accent` tối trên `--surface` `#18181b` | 5.98 | AA text ✓ |
| `--surface-emphasis` sáng trên nền trang sáng | 17.59 | tách rõ ✓ |
| `--surface-emphasis` tối trên nền trang tối | 1.27 | bậc nâng, có viền đỡ |

### 2.3 Chữ trên dải nhấn: bọc nội dung trong `.dark`

Không thêm `--surface-emphasis-foreground`. Nền do phần tử cha vẽ, nội dung nằm
trong một phần tử con mang `class="dark"`:

```html
<section class="bg-surface-emphasis">
  <div class="dark"> … nội dung dải … </div>
</section>
```

Đây là mẫu có sẵn của repo, không phải phát minh: dòng đầu `tokens.css` ghi
"dark via `.dark` on `<html>` (or on any subtree, e.g. the onboarding rail)",
và `packages/views/layout/brand-rail.tsx:57` đang dùng đúng cách đó.

**Khác một điểm so với brand rail:** rail đặt `.dark` và `bg-rail` trên *cùng*
phần tử, được vì `--rail` một giá trị cho cả hai theme. `--surface-emphasis` có
hai giá trị, nên nếu đặt chung một phần tử thì `.dark` sẽ ghi đè slot ngay trên
chính phần tử đó và dải luôn lấy giá trị tối ở cả hai theme. Tách cha/con là
cách giữ được cả hai: nền theo theme trang, chữ theo bảng tối.

`@custom-variant dark (&:is(.dark *))` trong `apps/web/app/globals.css` cũng là
biến thể hậu duệ, nên mọi `dark:` utility chỉ áp cho con của phần tử mang
`.dark`. Tách cha/con khớp với ràng buộc đó.

### 2.4 `.dark` kéo theo những gì — và có đúng ý không

Câu trả lời ngắn: **có, nó kéo toàn bộ bảng màu**, không chỉ ba slot. Mọi thứ
khai trong khối `.dark` đều đổi cho cây con: `--border`, `--input`, `--ring`,
`--muted`, `--muted-foreground`, `--faint-foreground`, `--card`, `--popover`,
`--surface*`, `--primary`, `--secondary`, `--accent`, `--destructive`,
`--success`, `--warning`, `--info`, `--selection`, `--sidebar-*`, `--chart-*`,
`--chat-sender-*`, `--background`, `--page-canvas`, `--app-shell`.

Rà từng thứ dải thật sự chứa:

| Slot | Giá trị trong dải | Đúng ý? |
| --- | --- | --- |
| `--foreground` | `#f4f4f5` | ✅ 16.70 / 13.47 |
| `--muted-foreground` | `#a1a1aa` | ✅ 7.16 / 5.78, thay cho `on-dark/65` của bản gốc |
| `--brand` (eyebrow) | `#4d8dff` | ✅ 5.74 / 4.63. Đây chính là lý do phải bọc: bản sáng `#0b5bf5` chỉ đạt 3.35 |
| `--brand-accent` (icon) | `#df63e8` | ✅ 6.18 / 4.98 |
| `--ring` (focus) | `#4d8dff` | ✅ 5.74 / 4.63, trên ngưỡng phi văn bản 3:1 |
| `--primary` / `--primary-foreground` | `#f4f4f5` / `#18181b` | ✅ nút mặc định thành nút trắng chữ đen, đúng cho nền đậm |
| `--border` | `#2a2a2e` | ⚠️ 1.28 trên dải sáng, **1.04** trên dải tối |
| `--surface` / `--card` | `#18181b` | ⚠️ đổi nghĩa so với bản gốc |
| `--sidebar-*`, `--chart-*`, `--chat-sender-*` | bảng tối | ➖ dải không dùng |

Hai chỗ ⚠️ cần xử lý, không phải lỗi của cách bọc mà là hệ quả thật:

- **`--border` gần như tàng hình trong dải khi trang đang ở chế độ tối** (1.04).
  Trên dải sáng nó đạt 1.28, còn nhỉnh hơn mức `--border` trên `--rail` (1.20)
  mà repo đang chấp nhận. Kết luận: **không đặt viền chịu lực bên trong dải.**
  Khối ảnh trong dải tách bằng bo góc và bóng, không bằng viền. Chỗ nào vẫn cần
  một nét thì dùng `ring-1 ring-border` và biết trước nó chỉ là gợi ý thị giác.
- **`--surface` và `--card` thành `#18181b`.** Bản gốc đặt ảnh Work Graph trên
  một tấm nền gần trắng (`bg-landing-on-dark`); qua `.dark` tấm đó thành gần
  đen. Ảnh đục và phủ kín khung nên chỉ thấy lúc đang tải, nhưng đây là một
  thay đổi có chủ ý cần biết. Nếu ảnh nào có nền trong suốt thì phải đặt nền
  sáng tường minh cho riêng nó.

Một quy tắc kèm theo: **bên trong dải không dùng `bg-background`.** Nó sẽ
thành `#111113`, gần nhưng không bằng màu dải, tạo một mảng vá nhìn thấy được.

### 2.5 Nút CTA chính ở hero không dùng `--surface-emphasis`

Bản gốc lấy chính màu dải làm nền nút (`index.tsx:198`). Trong UniWork nút đó
dùng `--primary`, vì đó đúng là slot dành cho nó và nó tự đổi theo theme:
`#18181b` trên nền sáng (16.97) và `#f4f4f5` trên nền tối (17.16). Bọc riêng
một `.dark` quanh nhãn nút chỉ để giữ sắc chàm là chi phí không đáng.

Nhờ vậy `--surface-emphasis` chỉ còn **một** vai trò duy nhất: nền của dải nhấn.

### 2.6 Đã áp vào code

- `packages/ui/styles/tokens.css`: thêm `--surface-emphasis` và
  `--brand-accent` ở cả `:root` lẫn `.dark`, thêm hai alias
  `--color-surface-emphasis` / `--color-brand-accent` trong `@theme inline`.
- `packages/ui/styles/tokens.test.ts`: thêm khối `emphasis band` kiểm mọi cặp
  tương phản trong bảng trên, cộng hướng độ sáng của dải tối so với nền trang
  tối, và `--brand-accent` trên `--background` / `--surface` ở cả hai theme.
  Test này là **chốt chặn tĩnh, không phải verification**: nó không thấy được
  opacity, lớp phủ hay ảnh nằm dưới chữ. `e2e/onboarding-contrast.spec.ts` đo
  trang đã render vẫn là nguồn phán quyết, và cần bổ sung dải landing vào đó
  khi trang lên.

## 3. Bảng section

| Section | Nội dung / copy lấy sang | Phong cách (màu, font, layout) | Animation GSAP đề xuất | Skill / plugin |
| --- | --- | --- | --- | --- |
| **Header** (fixed, `h-18`) | Nav: Tính năng · Bảng giá · Giới thiệu · Blog · Liên hệ. Nút: Đăng nhập, "Bắt đầu ngay". Có `LanguageToggle` và menu mobile. **Bỏ Blog** cho tới khi có nội dung thật. | Nền `--surface`/90 + `backdrop-blur-xl`, viền dưới `--border`. Hover link đổi sang `--brand`. Wordmark PNG cao 32–36px. | **Không có hiệu ứng nổi bật.** Một tween trạng thái: cuộn quá 24px thì viền dưới và nền mờ hiện dần (`opacity` 0→1, 0.2s). Header luôn hiện, không tự ẩn. | `gsap-scrolltrigger`, `gsap-core` |
| **Hero** | Eyebrow "Không gian làm việc cho đội ngũ hiện đại". H1 hai dòng: "Con người **+**" / "Nhân sự AI". Sub: "Một nền tảng thống nhất để con người và nhân sự AI cùng trò chuyện, lập kế hoạch, thực thi và biến tri thức thành kết quả." CTA "Bắt đầu ngay" + "Xem demo Meeting". Ba bullet: Bảo mật doanh nghiệp · Hỗ trợ tiếng Việt · Triển khai trong ngày. | Ảnh nền phủ 68–74% bên phải, gradient ngang từ `--surface` sang trong suốt che phần chữ. H1 `text-hero sm:text-hero-lg lg:text-hero-xl`, `font-heading` bold; dấu `+` màu `--brand`, dòng hai màu `--brand-accent`. CTA chính nền `--primary`, CTA phụ outline. Mobile: ảnh tách xuống figure cao 410px. | **Được phép cầu kỳ nhất.** Timeline vào trang: eyebrow → dòng 1 → dòng 2 → sub → cụm CTA → hàng bullet, `y: 12, opacity: 0`, `stagger: 0.07`, `duration: 0.5`, `ease: "power2.out"`. Dấu `+` scale `0.6 → 1` với `back.out(2)` trễ một nhịp sau dòng 1, đây là điểm nhấn. Parallax rất nhẹ cho ảnh nền: `yPercent: 0 → 6`, `scrub: true`, kết ở cuối hero. **Không split ký tự**: h1 chứa `<span>` màu và đi qua `t()`, tách ký tự sẽ vỡ cả markup lẫn i18n. | `gsap-react` (`useGSAP`), `gsap-timeline`, `gsap-core`, `gsap-scrolltrigger` |
| **Platform / 6 năng lực** | Eyebrow "Một nền tảng. Một dòng công việc." H2 "Mọi thứ team cần, trong một app". Sub "Thay thế cho 5-7 công cụ rời rạc bằng một nền tảng duy nhất." Sáu ô: Chat & kênh dự án, Quy trình, Họp + AI Copilot, Email Hub, Kho tri thức, Trợ lý AI. | Nền `--background`, viền trên/dưới. Lưới `gap-px` trên nền `--border` để kẻ 1px giữa các ô, 1/2/3 cột. Icon lucide 24px màu `--brand`. | Một hiệu ứng: sáu ô vào theo lưới khi cuộn tới, `opacity: 0 → 1`, `y: 10 → 0`, `stagger: { each: 0.05, grid: "auto", from: "start" }`. Hover icon `translate-x` giữ bằng CSS, **không** đưa vào GSAP. | `gsap-scrolltrigger` (`ScrollTrigger.batch`), `gsap-core`, `gsap-utils` |
| **ProductBand — Họp** (dải nhấn) | Eyebrow "Họp". H2 "Từ cuộc trò chuyện đến tiến độ". Mô tả: "Sprint review, daily standup hay 1-on-1 — AI ghi chú, tóm tắt và sinh action items theo thời gian thực." Ba điểm: ghi âm & chuyển lời nói thành văn bản · tóm tắt quyết định · tạo việc cần làm sau họp. | Nền `--surface-emphasis`, nội dung bọc `.dark`. Hai cột `lg:grid-cols-2`, ảnh vuông bo `--radius`, không viền (xem 2.4). Eyebrow `--brand`. Check bullet trong vòng tròn `--brand` 15%. | Mẫu dùng chung cho cả ba band: cột chữ fade-up nguyên khối (`y: 16`, 0.5s); ảnh vào từ phía đối diện (`x: ±24`, `opacity`) trễ 0.1s. Band này **không** có thêm gì. | `gsap-scrolltrigger`, `gsap-timeline`, `gsap-utils` |
| **ProductBand — Dự án & Công việc** (đảo cột) | Eyebrow "Dự án · Công việc · AI". H2 "Lập kế hoạch thông minh. Tiến độ rõ ràng." Mô tả: "Theo dõi sprint, burndown, rủi ro và đề xuất hành động — tất cả trên một bảng duy nhất, đồng bộ với tài liệu và cuộc họp." CTA "Bắt đầu quản lý công việc". | Nền `--surface`. Cột chữ `lg:order-2`. Ảnh chính vuông + ảnh phụ chồng góc dưới phải, rộng 42%, viền `--surface` 4px, chỉ hiện từ `sm`. Eyebrow `--brand-accent`. | Mẫu chung, **cộng một điểm nhấn duy nhất**: ảnh phụ vào sau ảnh chính 0.15s, `y: 12 → 0` + `opacity`, `ease: "power3.out"`. Ảnh phụ chồng lớp là thứ mắt bắt vào, cho nó nhịp riêng và không cho gì khác trong band này. | `gsap-scrolltrigger`, `gsap-timeline` |
| **ProductBand — Email Hub** | Eyebrow "Email Hub". H2 "Email thông minh hơn, làm việc liền mạch hơn". Mô tả: "Kết nối Microsoft 365 & Gmail vào một hộp thư duy nhất. AI tóm tắt, đề xuất trả lời, tạo task và workflow trực tiếp từ email." CTA "Dùng Email Hub ngay". | Giống band Họp nhưng nền `--surface`, eyebrow `--brand-accent`. | Mẫu chung, không thêm gì. | `gsap-scrolltrigger`, `gsap-timeline` |
| **Work Graph / Bộ nhớ tổ chức** (dải nhấn) | Eyebrow "Work Graph · Organizational Memory". H2 "Bộ nhớ tập thể của tổ chức". Sub: "UNIWORK kết nối cuộc trò chuyện, công việc, tài liệu, cuộc họp và con người thành một nguồn tri thức có thể tìm kiếm." Ba điểm: ngữ cảnh kết nối xuyên suốt · tìm kiếm theo quyền truy cập · AI hiểu đúng dữ liệu tổ chức. | Nền `--surface-emphasis`, nội dung bọc `.dark`. Lưới lệch `lg:grid-cols-[0.85fr_1.15fr]`, chữ hẹp ảnh rộng. Icon `Layers3` màu `--brand-accent`. Ảnh có `--floating-shadow`. | Một hiệu ứng: ảnh work graph `scale: 0.96 → 1` + `opacity`, `scrub: 0.5`, chạy trong 25% viewport đầu của section. Ba bullet chỉ fade `stagger: 0.06`, không dịch chuyển. | `gsap-scrolltrigger` (scrub), `gsap-core` |
| **Nhân sự AI** | Badge "Nhân sự AI theo yêu cầu". H2 "Thuê nhân sự AI cho đội của bạn". Sub: "Chọn vai trò AI phù hợp, onboard trong vài phút và giao việc như một thành viên thật — có KPI, nhật ký và quyền hạn rõ ràng." CTA "Thuê nhân sự AI" → `/pricing`. Khớp trực tiếp với mô hình agent của UniWork (ADR 0010, `workspace_agent_members`). | Nền `--surface`, canh giữa. Badge `--brand-accent`. Ảnh lớn `max-w-5xl` bo góc, viền `--border`, nền `--background`. CTA nền `--brand`. | Một hiệu ứng: ảnh reveal bằng `clipPath: inset(100% 0 0 0) → inset(0%)` trong 0.6s `power2.inOut`. Rẻ hơn animate kích thước và không gây reflow. Hover `scale-[1.01]` giữ bằng CSS. CTA chỉ fade sau đó. | `gsap-core`, `gsap-scrolltrigger`, `gsap-performance` |
| **CTA cuối** | Icon khiên. H2 + đoạn từ `land.cta2.h` / `land.cta2.p`. **Hai nút thay cho form**: "Tạo tài khoản" → `/register`, "Đăng nhập" → `/login`. | Nền `--background`, hai cột. Thẻ CTA nền `--surface`, viền `--border`, `--floating-shadow`. Nút chính `--brand`, nút phụ outline. | **Không có hiệu ứng nổi bật.** Cả cụm fade-up một lần, `y: 16`, 0.45s. Đây là điểm chuyển đổi, không phải chỗ trình diễn. | `gsap-core`, `gsap-scrolltrigger` |
| **Footer** | Wordmark + "Nền tảng làm việc số nơi con người và nhân sự AI cùng tạo ra kết quả." Ba cột: Sản phẩm (Bảng giá, Demo Meeting, Workflow) · Công ty (Giới thiệu, Blog, Liên hệ) · © 2026 Unicom JSC, Bảo mật, Điều khoản. | Nền `--surface`, viền trên, chữ `--text-caption` màu `--muted-foreground`. Lưới `sm:grid-cols-[1.4fr_1fr_1fr]`. | **Không animation.** | — |
| **AiSalesChat** (widget nổi) | "Tư vấn viên UNIWORK" · "Giải đáp, tư vấn giải pháp và báo giá" · ba câu gợi ý · placeholder "Nhập câu hỏi của bạn...". Backend phải đi qua `ai.Gateway` (ADR 0010), không gọi thẳng provider như bản gốc. | Nút nổi góc dưới phải, nền `--brand`, `--floating-shadow`. Panel `--surface` bo `--radius`. | Một hiệu ứng: nút xuất hiện sau khi cuộn hết hero, `scale: 0.8 → 1` + `opacity`, `back.out(1.7)`, chạy **một lần**. Panel mở/đóng dùng transition CSS, không GSAP. | `gsap-core`, `gsap-scrolltrigger` |

---

## 4. GSAP: phạm vi và ranh giới

### Khai báo

Thêm vào khối `catalog:` của `pnpm-workspace.yaml`:

```yaml
  # Animation cho landing page (apps/web/features/landing) — xem docs/uniwork-landing-mapping.md.
  # Phần còn lại của sản phẩm dùng `motion`; hai thư viện không trộn trong một module.
  gsap: "^3.13.0"
  "@gsap/react": "^2.1.2"
```

Chỉ `apps/web/package.json` khai báo hai gói này. `packages/ui`,
`packages/views` và `packages/core` không khai báo và không import. `motion`
giữ nguyên ở mọi nơi đang dùng, không gỡ gói nào.

### Ranh giới thực thi

Quy tắc "landing chỉ dùng gsap, module khác giữ motion" phải là lỗi lint, không
phải quy ước miệng. Hai khối trong `apps/web/eslint.config.mjs`, theo đúng mẫu
mà `packages/core/eslint.config.mjs` và `packages/views/eslint.config.mjs` đang
dùng:

- Trong `features/landing/**`, `app/page.tsx` và `app/solutions/**`: cấm import `motion`,
  `motion/*`, `framer-motion`. Thông điệp chỉ sang GSAP.
- Ngoài hai thư mục đó: cấm import `gsap`, `gsap/*`, `@gsap/react`. Thông điệp
  chỉ sang `motion`.

Hai chiều cùng lúc, nếu không thì một trong hai thư viện sẽ rò sang phía kia và
trang tải cả hai runtime.

### Quy tắc animation áp cho toàn trang

- **Một hiệu ứng nổi bật mỗi section.** Bảng trên đã chỉ rõ hiệu ứng nào là nổi
  bật; mọi thứ còn lại là fade-up 0.45–0.5s và không được leo thang.
- **Không animate khối text dài.** Sub của hero, mô tả của ba ProductBand, sub
  của Work Graph và của Nhân sự AI đều fade **nguyên khối**: không tách dòng,
  không tách từ, không tách ký tự.
- **`gsap.matchMedia()` với `(prefers-reduced-motion: reduce)` là bắt buộc.**
  Nhánh reduce thay mọi tween bằng `gsap.set()` ở trạng thái cuối. Repo có bốn
  hợp đồng accessibility đã được test; animation không được là ngoại lệ duy
  nhất không ai kiểm.
- **Chỉ animate `transform`, `opacity` và `clip-path`.** Không animate `width`,
  `height`, `top`, `margin`.
- **`useGSAP` từ `@gsap/react`** cho mọi component, để `ScrollTrigger` được dọn
  khi unmount. Landing là client component.
- **Trạng thái ban đầu đặt bằng CSS, không bằng JS.** Dùng `gsap.from()` để
  trạng thái cuối là mặc định trong DOM, nếu không trang không JS sẽ trống.
- **`:focus-visible` không nằm trong bất kỳ tween nào.** Outline focus toàn cục
  là chỉ báo duy nhất và có test giữ nó.

---

## 5. Điều hướng: chỉ trỏ vào route đã có hoặc neo trong trang

Quy tắc: có route tương đương thì dùng route; chưa có thì trỏ neo trong trang;
không tạo route mới; không để 404.

Route đã tồn tại trong `apps/web/app/`: `/login`, `/register`,
`/forgot-password`, `/reset-password`, `/verify`, `/invitations`,
`/workspaces`, `/workspaces/new`, `/onboarding`. Không có `/pricing`,
`/about`, `/blog`, `/contact`, `/privacy`, `/terms`, và không có trang demo
họp công khai (`/invite/meeting/[linkId]` cần một link id thật).

| Liên kết bản gốc | Đích trong UniWork | Loại |
| --- | --- | --- |
| Nút "Bắt đầu ngay" (header + hero) | `/register` | route |
| "Đăng nhập" (header) | `/login` | route |
| CTA cuối, nút chính | `/register` | route |
| CTA cuối, nút phụ | `/login` | route |
| "Bắt đầu quản lý công việc" | `/register` | route |
| "Dùng Email Hub ngay" | `/register` | route |
| "Thuê nhân sự AI" (bản gốc `/pricing`) | `/register` | route |
| "Tính năng" | `#platform` | neo |
| "Bảng giá" (chưa có route) | `#nhan-su-ai` — khối duy nhất nói về thuê và chi phí | neo |
| "Liên hệ" (chưa có route) | `#lien-he` — khối CTA cuối | neo |
| "Xem demo Meeting" (chưa có trang demo) | `#hop` — band Họp | neo |
| Footer "Workflow" | `#platform` | neo |

Bốn liên kết **không** có đích hợp lý và nên bỏ khỏi nav/footer cho tới khi có
route thật: **Giới thiệu**, **Blog**, **Bảo mật**, **Điều khoản**. Ép chúng vào
một neo bất kỳ chỉ để tránh 404 thì tệ hơn là không hiện: người dùng bấm
"Điều khoản" và bị cuộn tới một khối tiếp thị. Hai trang pháp lý nên là việc
đầu tiên làm sau khi landing lên.

Id neo cần đặt: `#platform`, `#hop`, `#du-an`, `#email`, `#work-graph`,
`#nhan-su-ai`, `#lien-he`. Đặt tiếng Việt không dấu, khớp quy ước slug trong
`docs/conventions.md`.

## 6. Thang chữ: đã có sẵn, chỉ thiếu một bậc

Đề xuất `--text-display-lg` ở vòng trước là **sai** — tôi đã bỏ sót phần cuối
của `@theme inline`. `tokens.css` đã có một thang riêng cho tiêu đề dẫn màn
hình, kèm sẵn leading và tracking:

```
--text-hero-sm: 36px / 38px / -0.02em
--text-hero:    48px / 50px / -0.025em
--text-hero-lg: 60px / 62px / -0.03em
```

"Giá trị mobile" trong hệ này **không** là một media query bên trong token. Ba
bậc là ba token, và màn hình chọn bậc bằng breakpoint. Bản gốc dùng
48 → 60 → 72, nên h1 hero là:

```
text-hero sm:text-hero-lg lg:text-hero-xl
```

Bậc 72px là thứ duy nhất còn thiếu và đã được thêm, nội suy đúng theo nhịp của
ba bậc trước (leading nhích 2px, tracking chặt thêm một nấc):

```
--text-hero-xl: 72px;  --text-hero-xl--line-height: 74px;  --text-hero-xl--letter-spacing: -0.035em;
```

H2 của các section dùng `text-display sm:text-hero-sm` (36 → 36) hoặc
`text-display sm:text-hero` (36 → 48) tuỳ mật độ, không dùng `text-4xl`/`5xl`.

## 7. Ảnh: WebP trong `public/`, theo mẫu pipeline đã có

Tám ảnh nằm trên CDN của Lovable, tổng **11,2 MB** PNG:

| Tệp | PNG |
| --- | --- |
| `uniwork-people-ai.png` (hero) | 1,77 MB |
| `uniwork-meetings.png` | 1,59 MB |
| `uniwork-ai-workforce.png` | 1,57 MB |
| `uniwork-work-graph.png` | 1,56 MB |
| `uniwork-projects-tasks-ai.png` | 1,51 MB |
| `uniwork-email-hub.png` | 1,49 MB |
| `uniwork-chat-tasks-ai.png` | 1,45 MB |
| `uniwork-ai-workforce-alt.png` | 0,27 MB |

Không nhúng thẳng vào repo ở dạng đó, và không giữ liên kết CDN Lovable — nó
là hạ tầng của một sản phẩm khác.

**Repo đã có pipeline ảnh**, và mẫu của nó dùng lại được nguyên vẹn:

- `scripts/brand/build-assets.mjs` render raster từ SVG bằng Chromium của
  Playwright.
- `scripts/brand/squeeze.py` mã hoá lại bằng Pillow — **Pillow đã là phụ thuộc
  của repo**, nên chuyển WebP không cần thêm gói nào.
- `packages/ui/brand/assets.lock.json` ghi sha của từng nguồn.
- `scripts/brand-assets.test.mjs` fail khi một nguồn đổi mà chưa chạy lại build.

> **Đã thay (2026-09-09).** Mục này mô tả đợt lấy ảnh từ CDN của bản Lovable.
> Ảnh đó vẽ giao diện của một sản phẩm khác, có chữ tiếng Anh nướng cứng vào
> pixel, và nằm trên hạ tầng của dự án cũ. Nay ảnh được sinh từ prompt nằm
> trong repo. Phần dưới giữ lại để hiểu vì sao khuôn lock có hình dạng như vậy.

Ảnh landing không có nguồn SVG, nên dùng lại **mẫu** của brand chứ không dùng
lại script:

1. `scripts/landing/gen-images.py` — dựng ảnh qua OpenAI Images API rồi xuất
   WebP bề rộng 1600 vào `apps/web/public/landing/`, chất lượng 82, `method=6`.
2. `scripts/landing/prompts.json` — prompt của từng ảnh, cỡ khung, và cờ
   `localized` quyết định ảnh đó có bản riêng cho mỗi ngôn ngữ hay không.
3. `scripts/landing/artwork.lock.json` — mỗi tệp ghi sha256 của prompt và của
   WebP đã xuất, nên một ảnh sửa tay hoặc thiếu lock đều lộ ra.
4. `scripts/landing-artwork.test.mjs` — fail khi lock, tệp trên đĩa và
   `apps/web/features/landing/artwork.ts` lệch nhau.
5. `pnpm landing:gen` trong `package.json` gốc, cạnh `brand:build`.

**Chỉ commit tệp WebP đã xuất.** Prompt là nguồn, và nó nằm trong repo, nên
dựng lại được mà không cần giữ PNG gốc.

Năm trong sáu ảnh vẽ giao diện, tức là có chữ. Chữ trong ảnh không dịch được,
không đo tương phản được và screen reader không đọc được, nên mỗi ảnh loại này
dựng một bản cho mỗi ngôn ngữ và `artwork.ts` chọn bản đúng. Ảnh hero không có
chữ nên chỉ có một tệp.

Hiển thị qua `next/image` để có `srcset`, `sizes` và lazy loading. Ảnh hero đặt
`priority`; bảy ảnh còn lại giữ `loading="lazy"` như bản gốc.

## 8. Còn hở

1. Bổ sung dải landing vào `e2e/onboarding-contrast.spec.ts` (hoặc một spec
   contrast riêng cho landing) khi trang lên — test tĩnh trong `tokens.test.ts`
   không thay thế phép đo trên trang đã render.
2. Trang `/privacy` và `/terms` phải có trước khi landing công khai.
3. Nội dung `land.cta2.h` / `land.cta2.p` chưa được trích trong tài liệu này;
   lấy khi viết file locale.

## 9. Đã dựng (bước khung, chưa có animation)

Route `/` giờ là landing. `apps/web/app/page.tsx` không còn redirect sang
`/login`; chính nó render `LandingPage`.

| Tệp | Vai trò |
| --- | --- |
| `apps/web/app/page.tsx` | Metadata + render `LandingPage` |
| `apps/web/features/landing/landing-page.tsx` | Thứ tự section |
| `apps/web/features/landing/layout-primitives.tsx` | `Container`, `EmphasisSection`, `SectionTitle`, `Eyebrow` |
| `apps/web/features/landing/site-header.tsx` | Header cố định + menu mobile |
| `apps/web/features/landing/hero.tsx` | Hero |
| `apps/web/features/landing/capabilities.tsx` | Lưới 6 năng lực |
| `apps/web/features/landing/product-band.tsx` | Một component cho cả ba band |
| `apps/web/features/landing/work-graph.tsx` | Dải Work Graph |
| `apps/web/features/landing/ai-workforce.tsx` | Khối nhân sự AI |
| `apps/web/features/landing/final-cta.tsx` | CTA cuối, hai nút |
| `apps/web/features/landing/site-footer.tsx` | Footer |
| `apps/web/features/landing/anchors.ts` | Bảy id neo |
| `apps/web/features/landing/animation/register-gsap.ts` | Chỗ đăng ký GSAP, **để trống** |

Ba thay đổi ngoài thư mục landing:

- `packages/ui/styles/tokens.css` — thêm `--font-heading`, giải về font body
  khi `--font-space-grotesk` không được định nghĩa, nên phần còn lại của sản
  phẩm không đổi và không tải thêm font nào.
- `apps/web/package.json` — thêm `lucide-react` và `react-i18next` (catalog).
  Chưa thêm `gsap`: knip sẽ báo dependency không dùng khi chưa có file nào
  import nó.
- Hai luồng onboarding đi tới `paths.workspaces()` thay vì `paths.root()` khi
  hoàn tất mà không tạo được workspace. `/` giờ là trang tiếp thị, không còn là
  cửa chuyển hướng sang đăng nhập.

Ảnh: 11 tệp WebP dựng bằng `pnpm landing:gen` (một hero, năm ảnh giao diện nhân hai ngôn ngữ).
Hiển thị qua `next/image`; hero là `priority`, còn lại lazy.

Font body vẫn là Inter. DM Sans của unidigiwork **chưa** mang sang — đổi mặt
chữ thân bài là quyết định thương hiệu cho cả sản phẩm, không phải một chi tiết
của landing.

Widget "Tư vấn viên UNIWORK" chưa dựng: nó cần một endpoint đi qua `ai.Gateway`
(ADR 0010), không phải một component.

## 10. Animation đã lắp

`gsap@3.15` và `@gsap/react@2.1` ghim trong catalog, chỉ `apps/web` khai báo.
`apps/web/eslint.config.mjs` chặn **hai chiều**: `motion` bị cấm dưới
`features/landing/**`, `app/page.tsx` và `app/solutions/**`, `gsap` bị cấm ở
mọi nơi khác. Đã
thử bằng hai tệp probe, cả hai chiều đều báo lỗi.

Tất cả tween nằm trong `useGSAP` với `scope` là ref của section, nên
ScrollTrigger và tween được revert khi unmount. Bên trong là
`gsap.matchMedia()` với hai điều kiện `reduce` / `motion`; nhánh reduce
`gsap.set(..., { clearProps: "all" })` để phần tử vẫn hiện, không phải chỉ bỏ
qua tween — bỏ qua sẽ để nguyên trạng thái `from` và làm mất nội dung.

Chỉ `transform` và `opacity` được animate. Không có tween nào chạm `width`,
`height`, `top`, `margin` hay `clip-path`.

| Section | Hiệu ứng | Ghi chú so với bảng đã duyệt |
| --- | --- | --- |
| Header | `ScrollTrigger.create` bật class bóng sau 24px | GSAP quyết định *khi nào*, CSS vẽ. Bóng không phải transform/opacity nên không thể là tween. Header không thể mờ nền vào vì nó nằm trên ảnh hero, nền trong suốt sẽ làm nav không đọc được |
| Hero | Timeline stagger các con của cột chữ, dấu `+` `back.out(2)`, parallax `yPercent -3 → 3` scrub | Đúng bảng. Ảnh nền được `scale: 1.06` trước nên ±3% không hở mép |
| 6 năng lực | `ScrollTrigger.batch`, stagger lưới 0.05 | Đúng bảng |
| Ba product band | Chữ fade-up theo stagger, ảnh vào từ phía đối diện `x: ±24` | Đúng bảng |
| Band Dự án | Thêm ảnh phụ trễ một nhịp, `y: 12`, `power3.out` | Đúng bảng |
| Work Graph | Ảnh `scale 0.96 → 1` + opacity, `scrub: 0.5` | Đúng bảng. Bullet chỉ fade |
| Nhân sự AI | Ảnh `yPercent: 8 → 0` + opacity trong khung đã `overflow-hidden` | **Đổi so với bảng**: bảng ghi `clip-path`, nhưng ràng buộc chỉ cho transform/opacity. Khung đã cắt sẵn nên một transform đọc ra vẫn là hiệu ứng lộ dần |
| CTA cuối | Fade-up hai cột, stagger 0.08 | Đúng bảng |
| Footer | Không có | Đúng bảng |

Thứ tự tạo ScrollTrigger đi từ trên xuống theo thứ tự component, nên không cần
`refreshPriority`.

Một bẫy đã sửa: `end: "max"` cho trigger của header khiến nó thành *không hoạt
động* đúng ở pixel cuối trang, làm bóng header nhấp nháy khi cuộn tới footer.
Dùng `end: () => ScrollTrigger.maxScroll(window) + window.innerHeight` để điểm
kết luôn nằm ngoài tầm cuộn.

Điểm neo animation lấy **các phần tử con trực tiếp** của cột chữ thay vì
selector theo class tiện ích. Nhờ vậy markup gần như không đổi: chỉ thêm `ref`,
một `inline-block` cho dấu `+` (transform không áp được lên inline box), và
`transition-shadow` trên header. Không có phần tử bọc mới nào.

## 11. Đợt sửa sau audit (P0 + P1)

`/impeccable audit` chấm 11/20. Sáu vấn đề P0 và P1 đã sửa; số đo trước và sau
đều lấy trên trang đã render.

### P0 — Chữ hero nằm trên ảnh ở khổ tablet

Nguyên nhân: ảnh nền bật từ `sm` (640px) nhưng lớp phủ bảo vệ chữ dùng mốc
phần trăm. Ở 768px vùng đục kết thúc ở 284px trong khi cột chữ chạy tới 672px.

Sửa: chỗ chia hai cột chuyển từ `sm` sang `xl` (1280px), và mốc gradient neo
vào cạnh thật của cột chữ bằng `--hero-copy-edge`
(`calc(max(0px,(100vw - 80rem)/2) + 1.5rem + 42rem)`) thay vì phần trăm.

| Bề rộng | Tiêu đề trước → sau | Đoạn mô tả trước → sau |
| --- | --- | --- |
| 768px | 1.10 → **16.97** | 1.62 → **7.41** |
| 1024px | 9.16 → **16.97** | 4.12 → **7.41** |
| 1440px | 14.59 → **16.97** | 6.44 → **7.41** |

### P0 — Trang nêu năng lực chưa có

Đối chiếu với `packages/core` và `server/internal`:

- **Bỏ hẳn** section Work Graph / Bộ nhớ tổ chức. Không có module nào, cả
  section là một lời tuyên bố. Nó quay lại khi tính năng có thật.
- **Bỏ** hai ô "Kho tri thức" và "Quy trình" khỏi lưới năng lực. Thay bằng hai
  thứ có thật mà trang đang thiếu: **Công việc & bảng** và **Tổ chức & không
  gian làm việc**.
- **Email Hub** giữ theo quyết định trước, nhưng mang nhãn "Sắp có" ở lưới và
  "Đang phát triển" ở band, và bỏ nút CTA vì chưa có gì để bấm vào.
- **Bỏ mục "Bảng giá"** khỏi nav và footer. Không có bảng giá, và PRODUCT.md
  cấm quảng cáo giá.
- Khối nhân sự AI đổi từ "Thuê nhân sự AI" (một lời chào hàng có giá) sang
  "Agent làm việc như một thành viên" — đúng ADR 0010 và đúng định vị.
- Ba bullet hero bỏ "Bảo mật doanh nghiệp" và "Triển khai trong ngày"; thay
  bằng ba điều đúng: tiếng Việt là ngôn ngữ gốc, agent là thành viên, mọi việc
  agent làm đều hoàn tác được.
- Bỏ con số "5-7 công cụ" và cụm "dữ liệu lưu tại Việt Nam".
- Ba điểm của band Cuộc họp trước đây hứa ghi âm, tóm tắt và sinh việc — không
  có gì trong số đó tồn tại. Thay bằng phòng video trong không gian làm việc,
  lời mời qua link cho người ngoài, và quyền đi theo thành viên.

### P1 — Runtime của app rời khỏi trang tiếp thị (ĐÃ HOÀN TÁC 2026-09-09)

Bản dựng ban đầu gom mọi route ứng dụng vào `app/(app)/` và mount `AppShell`
một lần, còn `app/(landing)/` chỉ mount theme và từ điển dịch. Nhóm route đó đã
được hoàn tác theo yêu cầu: route ứng dụng trở lại top level và root layout
mount `Providers` cho mọi trang, kể cả `/`.

Hệ quả phải chấp nhận: trang tiếp thị lại tải query cache, auth store và cờ
tính năng, và lại gửi **2** request API khi tải (`POST /auth/refresh`,
`GET /config`). `LandingProviders` không còn. Khi hai request đó xong, React
dựng lại nhánh cây một lần, nên mọi thao tác tự động trên trang phải chờ
`networkidle` — `e2e/landing.spec.ts` ghi rõ điều này tại chỗ.

### P1 — Font

`Source Serif 4` chuyển từ root layout xuống `(auth)/layout.tsx`, nhóm
duy nhất render `font-serif`. Space Grotesk bị gỡ hẳn. Phần này giữ nguyên
sau khi hoàn tác nhóm `(app)`.

Trang tiếp thị tải: **10 tệp font → 3**. Số họ chữ dùng trên trang: **2 → 1**.

### P1 — Cặp mặt chữ

Space Grotesk + Inter là hai sans gần giống nhau, và cả hai đều nằm trong danh
sách reflex-reject. Bỏ mặt chữ thứ hai; `--font-heading` trỏ về chính Inter.
Phân cấp đến từ trọng lượng và thang `--text-*` vốn đã mang letter-spacing.

### P1 — Vùng chạm

Link footer và link logo là thẻ `a` trần nên không thừa hưởng sàn 44px của
Button. Thêm `pointer-coarse:min-h-11` (và `min-w-11` cho logo).
Số phần tử dưới 44px với con trỏ thô: **7 → 0** ở cả 390px và 768px.

### Cổng bundle đổi cách đo

Tách provider khỏi root layout làm phần "shared" tụt từ 245.5 KB xuống 42.1 KB,
và cùng số byte đó chuyển sang cột riêng của từng route — dưới thước đo cũ nó
đọc thành một cú tụt hạng 200 KB trên hai mươi route không hề đổi. "Shared"
không phải thuộc tính của code mà là giao của mọi route, nên nó dịch chuyển khi
một route chính đáng ngừng chia sẻ.

`scripts/bundle-budget.mjs` giờ đo **tổng mỗi route** (shared + riêng) với trần
400 KB, xấp xỉ đúng độ chặt cũ (150 + 245.5). Số kiểm chứng: `/login` là
266.5 KB, trước là 266.7 KB — không đổi. Landing là 282.0 KB, trước 309.9 KB.
Trần trong `scripts/bundle-budget.json` đặt bằng số đo hiện tại, đều thấp hơn
mức mà trần cũ cộng shared cũ cho phép.

### Chưa sửa

Bảy ảnh trên trang là ảnh chụp giao diện của unidigiwork, không phải của
UniWork, và một số ảnh có chữ tiếng Anh in sẵn quảng cáo tính năng không tồn
tại. Không thể sửa bằng code; cần ảnh chụp thật từ sản phẩm. Đây là vấn đề cùng
loại với P0 về nội dung và nên xử lý trước khi trang công khai.
