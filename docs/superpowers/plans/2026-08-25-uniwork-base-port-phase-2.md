# UniWork Base Port — Pha 2 (Sweep Tầng 1: Frontend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mang ~160 file hạ tầng frontend của usf sang uniwork — 62 primitive, `ui/{lib,hooks,types,markdown,common}`, và lớp headless của `core` — với kiểm chứng thật cho từng lô.

**Architecture:** Copy cơ học, không sửa logic. Đổi `@multica/*` → `@uniwork/*`, bỏ file dính nghiệp vụ usf. Mỗi lô đóng bằng typecheck + lint + test; riêng 62 primitive đóng bằng một **render smoke test** viết mới.

**Tech Stack:** React 19.2.3 · Base UI 1.3 · Tailwind 4 · Vitest 4 · Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-uniwork-base-port-design.md`
**Plan trước:** `2026-08-25-uniwork-base-port-phase-0-1.md` (đã xong — đọc mục "Ghi chép thực thi" ở cuối)

## Global Constraints

- pnpm **10.28.2**; dependency dùng chung khai qua `catalog:` trong `pnpm-workspace.yaml`.
- Ranh giới package là **lỗi lint**: `ui/` không import `@uniwork/core`; `core/` không `react-dom`/`localStorage`/`process.env`; `views/` không `next/*`.
- **Mọi token có màu phải khai ở CẢ `:root` và `.dark`.** Viết dưới dạng `var(--uw-*)` KHÔNG miễn trừ điều này — custom property được tính rồi kế thừa. `packages/ui/styles/tokens.test.ts` ép luật.
- Comment trong code viết **tiếng Anh**.
- Không sửa 5 spec e2e onboarding cho vừa code mới. Chúng là hợp đồng hồi quy.
- Sau mỗi lô: `grep -ri "multica" packages/ apps/` phải rỗng.

## Quyết định phạm vi (chủ dự án chốt 2026-08-25)

1. **Lấy cả 62 primitive của usf**, kể cả 12 cái trùng tên với uniwork, và sửa views cho khớp API mới ngay trong pha này. (Phương án còn lại — giữ 12 cái của uniwork — đã cân nhắc và loại.)
2. **Port `ui/markdown` luôn ở pha này**, bỏ `issue-identifiers.ts` và tuỳ chọn `autolinkIssueIdentifiers` (nghiệp vụ usf).

## Bẫy đã biết (khảo sát trước khi viết plan — đọc trước khi bắt đầu)

### A. `packages/ui` của usf có **ZERO** test

93 file, không một test nào. Spec §6.3 viết "usf có test cho gần như mọi file" — **sai** với nửa lớn nhất của đợt sweep. Nên lô primitive không có lưới an toàn sẵn; Task 3 viết một cái mới.

### B. Button: API khác hẳn + uniwork có công a11y mà usf không có

| uniwork | usf | ghi chú |
| --- | --- | --- |
| `variant="primary"` (`bg-brand text-on-brand`) | `variant="brand"` | KHÔNG phải `default` — `default` của usf là neutral đậm |
| `variant="secondary"` (`bg-surface border`) | `variant="outline"` | |
| `variant="outline"` | `variant="outline"` | |
| `variant="ghost"` | `variant="ghost"` | |
| `variant="danger"` | `variant="destructive"` | |
| `size="md"` (h-8) | `size="default"` (h-8) | |
| `size="sm"` (h-7) | `size="sm"` (h-7) | |
| `size="lg"` (h-10) | `size="lg"` (**h-9**) | cao hơn 1px — kiểm lại vùng chạm 44px ở mobile spec |
| `size="icon-sm"` (size-7) | `size="icon-sm"` (size-7) | |

**Hợp đồng a11y phải giữ:** button của uniwork xử lý `aria-disabled` — giữ nút trong tab order (để người dùng bàn phím tới được và nghe lý do), rồi **chặn click bằng JS chứ không bằng CSS** (`pointer-events-none` cũng chặn luôn con trỏ báo "không bấm được", và không chặn được phím Enter). Dùng ở **9 call site** trong onboarding. usf **không có** thứ này. Phải cấy lại lên bản usf.

**Rủi ro vòng focus:** usf dùng `focus-visible:ring-3 focus-visible:ring-ring/50`; uniwork dùng `ring-2 ring-brand ring-offset-2 ring-offset-canvas`. Spec `onboarding-focus.spec.ts` đo "vòng focus tách khỏi nền ngay sát nó ≥ 3:1" — ring ở alpha 50% có thể trượt. Đây là chỗ dễ đỏ nhất của cả pha.

### C. `submit-button.tsx` vi phạm ranh giới

`ui/components/common/submit-button.tsx` của usf import `@multica/core`. Không port (lint sẽ chặn). `multica-icon.tsx` là branding — không port.

### D. Custom property tính-rồi-kế-thừa

Xem Global Constraints. Đây là lỗi đã làm rail onboarding render chữ ở 1.03:1 trong pha 1. Mọi token mới phải có ở cả hai khối.

### E. Công cụ

- `import.meta.url` **không** phải file: URL dưới jsdom — đọc file trong test qua `resolve(process.cwd(), …)`.
- BSD sed trên macOS **không** hỗ trợ `\b` — dùng `perl -pi -e` cho mọi lần đổi tên hàng loạt.
- Next 16 từ chối mở dev server thứ hai cùng thư mục; e2e chạy trên stack sẵn có, và phải kiểm chứng CSS server phục vụ đã cập nhật trước khi tin kết quả.

## Bản kê file

**Port (`usf/packages/ui` → `uniwork/packages/ui`):**
`components/ui/*.tsx` (62) · `lib/*.ts` (7) · `hooks/*.ts` (3) · `types/i18next.ts` (1) ·
`components/common/*.tsx` (10 — **bỏ** `submit-button.tsx`, `multica-icon.tsx`) ·
`markdown/*` (8 + `markdown.css` — **bỏ** `issue-identifiers.ts`)

**Port (`usf/packages/core` → `uniwork/packages/core`):**
`logger.ts` · `utils.ts` · `query-client.ts` · `provider.tsx` ·
`api/{schema,schema.test,ws-client,ws-client.test}.ts` ·
`platform/*` (13) · `feature-flags/*` (12) · `diagnostics/*` (5) · `analytics/*` (8) ·
`shortcuts/{platform,store,store.test}.ts` (**bỏ** `definitions.ts` → Tầng 2) ·
`hooks/*` (2) · `constants/upload.ts` ·
`i18n/*` (11 — **bỏ** `localize-portal-project*`)

**Không port:** mọi thứ còn lại trong `usf/packages/core` (nghiệp vụ usf).

---

## Task 1: Dependency cho packages/ui

**Files:** Modify `packages/ui/package.json`, `pnpm-workspace.yaml`

Danh sách lấy từ quét thực tế toàn bộ import (cả nháy đơn lẫn nháy kép) của tier-1 ui.

- [ ] **Step 1: Viết test liệt kê dependency bắt buộc**

Create `packages/ui/deps.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Every package the ported tier-1 files import. Sourced by scanning
// usf/packages/ui for both quote styles — a single-quoted import is easy to
// miss and shows up only as a runtime failure.
const REQUIRED = [
  "@base-ui/react", "@emoji-mart/data", "@number-flow/react",
  "@tanstack/react-table", "@tanstack/react-virtual",
  "class-variance-authority", "clsx", "cmdk", "embla-carousel-react",
  "emoji-mart", "input-otp", "katex", "linkify-it", "lucide-react",
  "next-themes", "react", "react-day-picker", "react-dom", "react-i18next",
  "react-markdown", "react-resizable-panels", "recharts", "rehype-katex",
  "rehype-raw", "rehype-sanitize", "remark-breaks", "remark-gfm",
  "remark-math", "shiki", "sonner", "tailwind-merge", "unicode-animations",
  "vaul",
];

describe("packages/ui dependencies", () => {
  it("declares every package the ported files import", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const declared = new Set(Object.keys(pkg.dependencies ?? {}));
    const missing = REQUIRED.filter((name) => !declared.has(name));
    expect(missing, `missing from packages/ui deps: ${missing.join(", ")}`)
      .toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `cd packages/ui && npx vitest run deps`
Expected: FAIL, liệt kê ~25 gói thiếu.

- [ ] **Step 3: Bổ sung catalog cho các gói dùng chung với views về sau**

Trong `pnpm-workspace.yaml`, thêm vào khối `catalog:`:
```yaml
  # UI primitives (packages/ui) — cố định một lần để views dùng lại cùng phiên bản
  "@base-ui/react": "^1.3.0"
  cmdk: "^1.1.1"
  motion: "^12.38.0"
  react-markdown: "^10.1.0"
  react-resizable-panels: "^4.7.5"
  recharts: "3.8.0"
  rehype-raw: "^7.0.0"
  rehype-sanitize: "^6.0.0"
  remark-breaks: "^4.0.0"
  remark-gfm: "^4.0.1"
  shiki: "^3.21.0"
  sonner: "^2.0.7"
  vaul: "^1.1.2"
  date-fns: "^4.1.0"
```

- [ ] **Step 4: Khai dependency trong `packages/ui/package.json`**

Thay khối `dependencies` bằng:
```json
  "dependencies": {
    "@base-ui/react": "catalog:",
    "@emoji-mart/data": "^1.2.1",
    "@number-flow/react": "^0.6.1",
    "@tanstack/react-table": "catalog:",
    "@tanstack/react-virtual": "catalog:",
    "class-variance-authority": "catalog:",
    "clsx": "catalog:",
    "cmdk": "catalog:",
    "embla-carousel-react": "^8.6.0",
    "emoji-mart": "^5.6.0",
    "input-otp": "^1.4.2",
    "katex": "catalog:",
    "linkify-it": "^5.0.0",
    "lucide-react": "catalog:",
    "next-themes": "^0.4.6",
    "react": "catalog:",
    "react-day-picker": "^9.14.0",
    "react-dom": "catalog:",
    "react-i18next": "catalog:",
    "react-markdown": "catalog:",
    "react-resizable-panels": "catalog:",
    "recharts": "catalog:",
    "rehype-katex": "catalog:",
    "rehype-raw": "catalog:",
    "rehype-sanitize": "catalog:",
    "remark-breaks": "catalog:",
    "remark-gfm": "catalog:",
    "remark-math": "catalog:",
    "shiki": "catalog:",
    "sonner": "catalog:",
    "tailwind-merge": "catalog:",
    "unicode-animations": "catalog:",
    "vaul": "catalog:"
  },
```

Thêm `"@types/linkify-it": "^5.0.0"` vào `devDependencies`.

- [ ] **Step 5: Cài và xác nhận xanh**

Run: `pnpm install && cd packages/ui && npx vitest run deps`
Expected: cài xong không lỗi; test PASS.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml packages/ui/package.json packages/ui/deps.test.ts pnpm-lock.yaml
git commit -m "chore(ui): declare every dependency the ported primitives need"
```

---

## Task 2: Port `ui/{lib,hooks,types}`

**Files:** Create `packages/ui/lib/{avatar-emoji,avatar-size,clipboard,code-style,data-table,motion}.ts`, `packages/ui/hooks/{use-auto-scroll,use-mobile,use-scroll-fade}.ts`, `packages/ui/types/i18next.ts`

Đây là các module lá — không phụ thuộc gì trong repo, nên port trước để 62 primitive có sẵn thứ chúng import (`lib/utils`, `lib/data-table`, `hooks/use-mobile`).

**Interfaces:**
- Produces: `cn` (đã có), `CODE_LIGATURE_CLASS` từ `lib/code-style`, `useIsMobile` từ `hooks/use-mobile`, các helper `lib/data-table` — Task 3 dùng.

- [ ] **Step 1: Copy và đổi import path**

```bash
cd /Users/phanducquang/Work/AIFactory
U=usf/packages/ui; W=uniwork/packages/ui
cp $U/lib/avatar-emoji.ts $U/lib/avatar-size.ts $U/lib/clipboard.ts \
   $U/lib/code-style.ts $U/lib/data-table.ts $U/lib/motion.ts $W/lib/
cp $U/hooks/use-auto-scroll.ts $U/hooks/use-mobile.ts $U/hooks/use-scroll-fade.ts $W/hooks/
mkdir -p $W/types && cp $U/types/i18next.ts $W/types/
cd uniwork
perl -pi -e 's{\@multica/ui}{\@uniwork/ui}g' packages/ui/lib/*.ts packages/ui/hooks/*.ts packages/ui/types/*.ts
```

**Không** ghi đè `lib/utils.ts` — bản uniwork có cấu hình `tailwind-merge` riêng cho thang `--text-*`, và `lib/utils.test.ts` đang bảo vệ nó.

- [ ] **Step 2: Mở exports trong `packages/ui/package.json`**

Thêm vào `exports`:
```json
    "./lib/*": "./lib/*.ts",
    "./types/i18next": "./types/i18next.ts",
```

- [ ] **Step 3: Xác nhận**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. Nếu `lib/data-table.ts` báo thiếu `@tanstack/react-table`, Task 1 đã sót — bổ sung rồi chạy lại.

- [ ] **Step 4: Không còn dấu vết usf**

Run: `grep -ri "multica" packages/ui/lib packages/ui/hooks packages/ui/types; echo "exit=$?"`
Expected: không có kết quả.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/lib packages/ui/hooks packages/ui/types packages/ui/package.json
git commit -m "feat(ui): port the leaf lib, hooks and types modules from usf"
```

---

## Task 3: Port 62 primitive + render smoke test

**Files:** Create/overwrite `packages/ui/components/ui/*.tsx` (62), Create `packages/ui/components/ui/render-smoke.test.tsx`

Đây là lô lớn nhất và là lô **không có lưới an toàn sẵn** (bẫy A). Smoke test là thứ biến việc chép 62 file từ "hy vọng" thành "kiểm chứng được": nó mount từng primitive và bắt lỗi thiếu token, sai API Base UI, import gãy — đúng lớp lỗi mà typecheck bỏ lọt.

- [ ] **Step 1: Viết smoke test TRƯỚC khi copy**

Create `packages/ui/components/ui/render-smoke.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, isValidElement, type ComponentType } from "react";
import { render, cleanup } from "@testing-library/react";

/**
 * Mounts every exported component in this directory once.
 *
 * There are no unit tests behind these primitives — they are vendored from a
 * shadcn/Base UI registry — so nothing else would notice that a component
 * throws on first render. `tsc` proves the types line up; only mounting proves
 * the component actually runs against the Base UI version installed here.
 *
 * A component that legitimately cannot stand alone (it must sit inside a
 * provider or a parent slot) is listed in NEEDS_CONTEXT with the reason.
 */
const NEEDS_CONTEXT = new Map<string, string>([
  // filled in during Step 4 from the actual failures, each with a reason
]);

const files = readdirSync(resolve(process.cwd(), "components/ui"))
  .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
  .sort();

describe("every primitive mounts", () => {
  it("has primitives to check", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const file of files) {
    const name = file.replace(/\.tsx$/, "");
    it(`${name}`, async () => {
      const mod = (await import(`./${name}`)) as Record<string, unknown>;
      const exported = Object.entries(mod).filter(
        ([, v]) => typeof v === "function" || (v && typeof v === "object" && "render" in (v as object)),
      );
      expect(exported.length, `${name} exports nothing renderable`).toBeGreaterThan(0);

      for (const [exportName, value] of exported) {
        const key = `${name}.${exportName}`;
        if (NEEDS_CONTEXT.has(key)) continue;
        // A bare mount with no props. Anything that throws here would throw
        // the same way the first time a screen used it.
        let el: unknown;
        try {
          el = createElement(value as ComponentType, {});
        } catch (err) {
          throw new Error(`${key} could not be created: ${String(err)}`);
        }
        if (!isValidElement(el)) continue;
        try {
          render(el);
        } catch (err) {
          throw new Error(`${key} threw on render: ${String(err)}`);
        } finally {
          cleanup();
        }
      }
    });
  }
});
```

- [ ] **Step 2: Chạy để thấy nó đo được cái gì đó ngay hôm nay**

Run: `cd packages/ui && npx vitest run components/ui/render-smoke`
Expected: PASS với 14 primitive hiện có (case "has primitives to check" sẽ FAIL vì chưa đủ 50 — đó là dấu hiệu test đang thật sự đếm).

- [ ] **Step 3: Copy 62 primitive**

```bash
cd /Users/phanducquang/Work/AIFactory
cp usf/packages/ui/components/ui/*.tsx uniwork/packages/ui/components/ui/
cd uniwork
perl -pi -e 's{\@multica/ui}{\@uniwork/ui}g' packages/ui/components/ui/*.tsx
grep -ril "multica" packages/ui/components/ui/ || echo "sạch"
```

Bản uniwork của 12 file trùng tên bị ghi đè — đúng chủ ý (quyết định phạm vi 1). Task 4 lo phần call site.

- [ ] **Step 4: Chạy smoke test, điền NEEDS_CONTEXT theo lỗi thật**

Run: `cd packages/ui && npx vitest run components/ui/render-smoke`

Với mỗi lỗi, quyết định:
- Component thật sự hỏng (thiếu token, sai API) → **sửa component**.
- Component cần provider/parent (ví dụ `SidebarMenu` ngoài `SidebarProvider`) → thêm vào `NEEDS_CONTEXT` **kèm lý do cụ thể**, không phải "skip".

Lặp tới khi xanh. Danh sách NEEDS_CONTEXT là tài liệu về primitive nào không đứng một mình được.

- [ ] **Step 5: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. Lỗi typecheck ở đây gần như chắc chắn là dependency thiếu hoặc token thiếu — sửa nguồn, đừng nới `tsconfig`.

- [ ] **Step 6: Token thiếu thì thêm vào CẢ hai khối**

Nếu primitive nào tham chiếu token chưa có, thêm vào `packages/ui/styles/tokens.css` ở **cả `:root` và `.dark`** và thêm alias `--color-*`. `tokens.test.ts` sẽ ép điều này.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/components/ui packages/ui/styles
git commit -m "feat(ui): port the 62 primitives from usf with a render smoke test"
```

---

## Task 4: Chuyển views sang API Button của usf

**Files:** Modify `packages/ui/components/ui/button.tsx`, `packages/views/**/*.tsx`, `apps/web/app/**/*.tsx`

Bản usf vừa ghi đè bản uniwork, nên hai thứ đang gãy: tên variant/size ở 26 call site, và hợp đồng a11y `aria-disabled` (bẫy B).

**Interfaces:**
- Produces: `<Button>` với API của usf **cộng** hành vi `aria-disabled` của uniwork. 6 test hiện có và 2 e2e spec (focus, contrast) là hợp đồng.

- [ ] **Step 1: Chạy 3 file test hiện có để thấy chúng đỏ**

Run: `cd packages/ui && npx vitest run components/ui/button components/ui/field`
Expected: FAIL — `button.inactive.test.tsx` đỏ vì bản usf không xử lý `aria-disabled`; `button.test.tsx` đỏ vì tên variant đổi.

- [ ] **Step 2: Cấy hành vi `aria-disabled` lên bản usf**

Trong `packages/ui/components/ui/button.tsx`, sửa hàm `Button`:
```tsx
function Button({
  className,
  variant = "default",
  size = "default",
  onClick,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  // `aria-disabled` rather than `disabled` wherever the button must stay in the
  // tab order: `disabled` removes it, so a keyboard user can never reach it to
  // hear why it cannot be pressed. The action is blocked here rather than with
  // `pointer-events-none`, which also suppresses the not-allowed cursor and
  // does not stop the Enter key.
  const inactive =
    props["aria-disabled"] === true || props["aria-disabled"] === "true";
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      onClick={inactive ? (e) => e.preventDefault() : onClick}
      {...props}
    />
  );
}
```

Và thêm vào chuỗi base của `buttonVariants` (giữ nguyên phần còn lại):
```
aria-disabled:opacity-50 aria-disabled:cursor-not-allowed
```

- [ ] **Step 3: Cập nhật `button.test.tsx` sang tên variant mới**

Test khẳng định hành vi, không khẳng định tên lớp CSS cụ thể của usf. Sửa tên variant trong test theo bảng ánh xạ ở bẫy B; **không** sửa `button.inactive.test.tsx` — nó là hợp đồng a11y và phải xanh nguyên trạng.

- [ ] **Step 4: Đổi 26 call site**

```bash
cd /Users/phanducquang/Work/AIFactory/uniwork
FILES=$(grep -rlE '<Button' packages/views apps/web --include='*.tsx')
perl -pi -e 's/variant="primary"/variant="brand"/g;
             s/variant="secondary"/variant="outline"/g;
             s/variant="danger"/variant="destructive"/g;
             s/size="md"/size="default"/g' $FILES
grep -rhoE 'variant="[a-zA-Z]+"' packages/views apps/web --include='*.tsx' | sort | uniq -c
```
`outline`, `ghost`, `sm`, `lg`, `icon-sm` giữ nguyên tên ở cả hai bên.

- [ ] **Step 5: Chạy test đơn vị**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: PASS, gồm cả 3 test button/field.

- [ ] **Step 6: Phép đo thật — e2e**

Run (cần stack đang chạy; kiểm chứng CSS phục vụ đã cập nhật trước khi tin kết quả):
```bash
pnpm --filter @uniwork/e2e test
```
Expected: 13/13 PASS.

Hai spec dễ đỏ nhất, và cách xử lý đúng:
- `onboarding-focus.spec.ts` — usf dùng `focus-visible:ring-3 ring-ring/50`; alpha 50% có thể không đạt 3:1 so với nền sát cạnh. Nếu đỏ: **sửa vòng focus** trong `button.tsx` (nâng alpha hoặc thêm `ring-offset`), đừng sửa spec.
- `onboarding-mobile.spec.ts` — `size="lg"` của usf là h-9, của uniwork là h-10; ngưỡng chạm 44px có thể trượt. Nếu đỏ: bản `lg` cần `pointer-coarse:min-h-11` như bản uniwork từng có.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/components/ui/button.tsx packages/ui/components/ui/button.test.tsx packages/views apps/web
git commit -m "refactor(views): move to the usf Button API, keeping the aria-disabled contract"
```

---

## Task 5: Port `ui/components/common`

**Files:** Create `packages/ui/components/common/*.tsx` (10)

- [ ] **Step 1: Copy, trừ hai file**

```bash
cd /Users/phanducquang/Work/AIFactory
mkdir -p uniwork/packages/ui/components/common
for f in actor-avatar capability-banner emoji-picker error-boundary file-upload-button \
         mention-hover-card quick-emoji-picker reaction-bar theme-provider unicode-spinner; do
  cp usf/packages/ui/components/common/$f.tsx uniwork/packages/ui/components/common/
done
cd uniwork && perl -pi -e 's{\@multica/ui}{\@uniwork/ui}g' packages/ui/components/common/*.tsx
```

**Bỏ:** `submit-button.tsx` (import `@multica/core` — vi phạm ranh giới, lint sẽ chặn), `multica-icon.tsx` (branding usf).

- [ ] **Step 2: Mở exports**

Thêm vào `packages/ui/package.json` → `exports`:
```json
    "./components/common/*": "./components/common/*.tsx",
```

- [ ] **Step 3: Xác nhận**

Run: `pnpm typecheck && pnpm lint && cd packages/ui && npx vitest run`
Expected: PASS. Nếu file nào còn tham chiếu kiểu của `@uniwork/core`, đó là ranh giới bị vi phạm — bỏ file đó và ghi lại lý do, đừng nới luật.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/components/common packages/ui/package.json
git commit -m "feat(ui): port the shared common components from usf"
```

---

## Task 6: Port `ui/markdown`

**Files:** Create `packages/ui/markdown/*` (8 file + `markdown.css`)

- [ ] **Step 1: Copy, bỏ file nghiệp vụ usf**

```bash
cd /Users/phanducquang/Work/AIFactory
mkdir -p uniwork/packages/ui/markdown
for f in CodeBlock.tsx file-cards.ts index.ts linkify.ts markdown.css \
         Markdown.tsx mentions.ts sanitize.ts StreamingMarkdown.tsx; do
  cp usf/packages/ui/markdown/$f uniwork/packages/ui/markdown/
done
cd uniwork && perl -pi -e 's{\@multica/ui}{\@uniwork/ui}g' packages/ui/markdown/*.ts*
```

**Bỏ:** `issue-identifiers.ts` — nó tự động liên kết mã issue kiểu `MUL-1234`, là nghiệp vụ usf.

- [ ] **Step 2: Gỡ tuỳ chọn `autolinkIssueIdentifiers` khỏi `Markdown.tsx`**

Gỡ dòng import `preprocessIssueIdentifiers`, thuộc tính `autolinkIssueIdentifiers?: boolean`, tham số cùng tên, dòng gọi `if (autolinkIssueIdentifiers) …`, và mục trong mảng dependency của `useMemo`. Kiểm tra `index.ts` không còn re-export nó.

- [ ] **Step 3: Mở exports**

```json
    "./markdown": "./markdown/index.ts",
    "./markdown/*": "./markdown/*.ts",
```

- [ ] **Step 4: Viết test cho lớp sanitize**

Đây là bề mặt duy nhất trong lô này có hệ quả bảo mật: markdown do người dùng nhập được render kèm `rehype-raw`, nên cấu hình sanitize là thứ chặn XSS.

Create `packages/ui/markdown/sanitize.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { markdownSanitizeSchema, markdownUrlTransform } from "./sanitize";

describe("markdown sanitize", () => {
  it("does not allow script tags through", () => {
    expect(markdownSanitizeSchema.tagNames).toBeDefined();
    expect(markdownSanitizeSchema.tagNames).not.toContain("script");
  });

  it("rejects javascript: urls", () => {
    // rehype-raw renders user-authored HTML, so the url transform is the last
    // thing standing between a pasted link and script execution.
    expect(markdownUrlTransform("javascript:alert(1)")).not.toMatch(/^javascript:/i);
  });

  it("keeps ordinary links intact", () => {
    expect(markdownUrlTransform("https://uniwork.app/x")).toBe("https://uniwork.app/x");
  });
});
```

Nếu API thật khác chữ ký giả định ở trên, sửa test cho khớp **API thật** rồi chạy — mục tiêu là khẳng định hành vi, không phải khớp tên.

- [ ] **Step 5: Xác nhận**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/markdown packages/ui/package.json
git commit -m "feat(ui): port the markdown renderer from usf without the issue-id autolink"
```

---

## Task 7: Port lớp lá của `core`

**Files:** Create `packages/core/logger.ts`; overwrite `packages/core/{query-client.ts}`; Create `packages/core/utils.ts`, `packages/core/provider.tsx`

`api/schema.ts` (Task 8) import `../logger`, nên logger phải có trước.

- [ ] **Step 1: Copy**

```bash
cd /Users/phanducquang/Work/AIFactory
cp usf/packages/core/logger.ts usf/packages/core/utils.ts usf/packages/core/provider.tsx uniwork/packages/core/
cd uniwork && perl -pi -e 's{\@multica/(core|ui)}{\@uniwork/$1}g' packages/core/logger.ts packages/core/utils.ts packages/core/provider.tsx
```

**Không** ghi đè `query-client.ts` — bản uniwork đang được `apps/web/app/providers.tsx` dùng; so hai bản, chỉ mang sang phần cấu hình khác biệt nếu có lý do rõ ràng.

- [ ] **Step 2: Mở exports**

```json
    "./logger": "./logger.ts",
    "./utils": "./utils.ts",
    "./provider": "./provider.tsx",
```

- [ ] **Step 3: Xác nhận + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
```bash
git add packages/core && git commit -m "feat(core): port the leaf logger, utils and provider modules"
```

---

## Task 8: Port `core/api/{schema,ws-client}` kèm test

**Files:** Create `packages/core/api/{schema.ts,schema.test.ts,ws-client.ts,ws-client.test.ts}`

Đây là hợp đồng chống drift API — `parseWithFallback` là thứ biến "hợp đồng API đổi" từ sự cố màn trắng thành trang giảm chất lượng nhưng vẫn render.

- [ ] **Step 1: Copy kèm test**

```bash
cd /Users/phanducquang/Work/AIFactory
cp usf/packages/core/api/schema.ts usf/packages/core/api/schema.test.ts \
   usf/packages/core/api/ws-client.ts usf/packages/core/api/ws-client.test.ts \
   uniwork/packages/core/api/
cd uniwork && perl -pi -e 's{\@multica/(core|ui)}{\@uniwork/$1}g' packages/core/api/*.ts
```

- [ ] **Step 2: Nối `ws-client` với runtime config**

`ws-client.ts` của usf nhận URL qua tham số. Nếu nó đọc cấu hình ở đâu khác, đổi sang `runtimeConfig().wsUrl` từ `../runtime-config` — `core` không được đọc `process.env` (lint chặn).

- [ ] **Step 3: Mở exports**

```json
    "./api/schema": "./api/schema.ts",
    "./api/ws-client": "./api/ws-client.ts",
```

- [ ] **Step 4: Xác nhận — test đi kèm phải xanh nguyên trạng**

Run: `cd packages/core && npx vitest run api`
Expected: PASS. Test này là lưới an toàn của lô; sửa test để nó xanh là làm hỏng mục đích.

- [ ] **Step 5: Commit**

```bash
git add packages/core/api packages/core/package.json
git commit -m "feat(core): port the API schema guard and ws client with their tests"
```

---

## Task 9: Port `core/platform`

**Files:** Create `packages/core/platform/*` (13 file, gồm 4 test)

Lớp `StorageAdapter` — lý do `core` không được chạm `localStorage`. Nó cũng là nơi `runtime-config.ts` (viết ở pha 0) cuối cùng sẽ về.

- [ ] **Step 1: Copy**

```bash
cd /Users/phanducquang/Work/AIFactory
mkdir -p uniwork/packages/core/platform
cp usf/packages/core/platform/* uniwork/packages/core/platform/
cd uniwork && perl -pi -e 's{\@multica/(core|ui)}{\@uniwork/$1}g' packages/core/platform/*.ts*
```

- [ ] **Step 2: Gỡ phần dính nghiệp vụ usf**

`auth-initializer.tsx` và `core-provider.tsx` tham chiếu store auth/workspace của usf. Nếu chúng không biên dịch được mà không kéo theo nghiệp vụ usf, **bỏ hai file đó** và ghi lại — chúng thuộc Tầng 2 (Plan 4), không phải hạ tầng thuần.

- [ ] **Step 3: Mở exports + xác nhận**

```json
    "./platform": "./platform/index.ts",
```
Run: `pnpm typecheck && pnpm lint && cd packages/core && npx vitest run platform`
Expected: PASS, 4 test đi kèm xanh.

- [ ] **Step 4: Commit**

```bash
git add packages/core/platform packages/core/package.json
git commit -m "feat(core): port the platform storage layer from usf"
```

---

## Task 10: Port `core/{feature-flags,diagnostics,analytics}`

**Files:** Create `packages/core/feature-flags/*` (12), `packages/core/diagnostics/*` (5), `packages/core/analytics/*` (8)

Cả ba đều có test đi kèm (4 + 2 + 4), nên lô này tự chứng minh được.

- [ ] **Step 1: Copy**

```bash
cd /Users/phanducquang/Work/AIFactory
for d in feature-flags diagnostics analytics; do
  mkdir -p uniwork/packages/core/$d && cp usf/packages/core/$d/* uniwork/packages/core/$d/
done
cd uniwork && perl -pi -e 's{\@multica/(core|ui)}{\@uniwork/$1}g' \
  packages/core/feature-flags/*.ts* packages/core/diagnostics/*.ts packages/core/analytics/*.ts
```

- [ ] **Step 2: `feature-flags/keys.ts` — thay khoá của usf bằng khoá rỗng**

File đó liệt kê cờ tính năng của usf (agent, autopilot, skill…). Giữ **cấu trúc**, thay nội dung bằng một hằng rỗng có chú thích rằng uniwork chưa có cờ nào. Đừng mang tên cờ của usf sang.

- [ ] **Step 3: `analytics` — posthog là tuỳ chọn**

Nếu `analytics/index.ts` import `posthog-js`, khai `posthog-js` vào `packages/core/package.json` (đã có trong catalog từ pha 0).

- [ ] **Step 4: Xác nhận + commit**

Run: `pnpm typecheck && pnpm lint && cd packages/core && npx vitest run feature-flags diagnostics analytics`
Expected: PASS, 10 test đi kèm xanh.
```bash
git add packages/core && git commit -m "feat(core): port feature flags, diagnostics and analytics from usf"
```

---

## Task 11: Port `core/{shortcuts,hooks,constants}`

**Files:** Create `packages/core/shortcuts/{platform.ts,store.ts,store.test.ts,index.ts}`, `packages/core/hooks/*` (2), `packages/core/constants/upload.ts`

- [ ] **Step 1: Copy, bỏ `definitions.ts`**

```bash
cd /Users/phanducquang/Work/AIFactory
mkdir -p uniwork/packages/core/shortcuts uniwork/packages/core/hooks uniwork/packages/core/constants
cp usf/packages/core/shortcuts/{platform.ts,store.ts,store.test.ts,index.ts} uniwork/packages/core/shortcuts/
cp usf/packages/core/hooks/* uniwork/packages/core/hooks/
cp usf/packages/core/constants/upload.ts uniwork/packages/core/constants/
cd uniwork && perl -pi -e 's{\@multica/(core|ui)}{\@uniwork/$1}g' \
  packages/core/shortcuts/*.ts packages/core/hooks/*.ts packages/core/constants/*.ts
```

**Bỏ:** `definitions.ts` — mã hoá phím tắt của usf (`g i` issues, `g a` agents). Phím tắt uniwork viết ở Plan 4.

- [ ] **Step 2: Gỡ tham chiếu tới `definitions` trong `index.ts` và `store.ts`**

Nếu `store.ts` import danh sách phím tắt từ `definitions`, đổi sang nhận qua tham số đăng ký — store là hạ tầng, danh sách là domain.

- [ ] **Step 3: Xác nhận + commit**

Run: `pnpm typecheck && pnpm lint && cd packages/core && npx vitest run shortcuts hooks`
```bash
git add packages/core && git commit -m "feat(core): port the shortcut store, upload hooks and constants"
```

---

## Task 12: Port `core/i18n`

**Files:** Create/overwrite `packages/core/i18n/*` (11 file)

uniwork đã có `i18n/index.ts` + `locales/` + `parity.test.ts`. Lớp của usf giàu hơn: adapter cho cookie, chọn locale, provider, đồng bộ locale theo user.

- [ ] **Step 1: Copy, bỏ file nghiệp vụ usf**

```bash
cd /Users/phanducquang/Work/AIFactory
for f in adapter-context.tsx browser-cookie-adapter.ts browser-cookie-adapter.test.ts \
         browser.ts create-i18n.ts pick-locale.ts pick-locale.test.ts provider.tsx \
         provider.test.tsx react.ts types.ts user-locale-sync.tsx; do
  cp usf/packages/core/i18n/$f uniwork/packages/core/i18n/ 2>/dev/null
done
cd uniwork && perl -pi -e 's{\@multica/(core|ui)}{\@uniwork/$1}g' packages/core/i18n/*.ts*
```

**Bỏ:** `localize-portal-project.ts` + test (nghiệp vụ usf). **Không** ghi đè `index.ts` và `locales/` của uniwork — `parity.test.ts` đang bảo vệ chúng.

- [ ] **Step 2: `pick-locale` — danh sách locale là của uniwork**

usf hỗ trợ `en/zh/ko`; uniwork là `vi/en` với **`vi` là ngôn ngữ gốc**. Sửa danh sách và locale mặc định cho khớp; giữ nguyên thuật toán khớp locale.

- [ ] **Step 3: Xác nhận + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS, gồm cả `parity.test.ts` hiện có.
```bash
git add packages/core/i18n packages/core/package.json
git commit -m "feat(core): port the i18n adapter layer, keeping vi as the source locale"
```

---

## Task 13: Cổng chống rò rỉ domain + xác nhận toàn bộ

- [ ] **Step 1: Viết cổng thành test, không phải lệnh chạy tay**

Create `scripts/no-usf-leak.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

// A ported file that still says "multica" is a file nobody re-read. The domain
// words are a weaker signal — they appear in ordinary English — so they are
// reported for review rather than asserted on.
test("no usf branding survives the port", () => {
  const hits = execSync(
    `grep -ril "multica" packages apps server --include='*.ts' --include='*.tsx' --include='*.go' --include='*.json' --include='*.css' || true`,
    { encoding: "utf8" },
  ).trim();
  assert.equal(hits, "", `files still referencing usf branding:\n${hits}`);
});
```

- [ ] **Step 2: Chạy và dọn tới khi xanh**

Run: `node --test scripts/no-usf-leak.test.mjs`

- [ ] **Step 3: Soát tay các từ nghiệp vụ**

Run:
```bash
grep -rin "issue\|agent\|autopilot\|squad\|runtime\|skill" packages/ui packages/core \
  --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -viE "runtime-config|runtimeConfig" | head -40
```
Mỗi hit hoặc được viết lại hoặc được ghi nhận là tiếng Anh thông thường. Đây là bước đọc, không phải bước tự động.

- [ ] **Step 4: Cổng ra đầy đủ**

```bash
pnpm install && pnpm typecheck && pnpm test && pnpm lint
bash scripts/turbo-cache-check.sh
node --test scripts/catalog-check.test.mjs
node --test scripts/no-usf-leak.test.mjs
pnpm --filter @uniwork/web build
pnpm --filter @uniwork/e2e test    # 13/13
```

- [ ] **Step 5: Commit**

```bash
git add scripts/no-usf-leak.test.mjs
git commit -m "test: fail the build if usf branding survives a port"
```

---

## Cổng ra của Plan 2

Tất cả lệnh ở Task 13 Step 4 phải xanh, **gồm cả 13 spec e2e**. Nếu spec focus hoặc mobile đỏ, đó là vòng focus hoặc chiều cao nút của usf không đạt ngưỡng đã đo — sửa component, không sửa spec.
