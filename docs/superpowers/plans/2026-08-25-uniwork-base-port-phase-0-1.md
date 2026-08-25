# UniWork Base Port — Pha 0 + 1 (Nền tảng build & hợp đồng token)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa repo uniwork về trạng thái sẵn sàng nhận ~31.000 dòng code hạ tầng của usf — công cụ build đúng phiên bản, luật ranh giới package do máy kiểm, cache turbo không giả xanh, và hợp đồng design token tương thích shadcn.

**Architecture:** Không copy code usf ở plan này. Chỉ dựng khung: nâng pnpm, chốt phiên bản dependency một lần trong catalog, tách eslint thành 3 tầng và biến các luật ranh giới trong CLAUDE.md thành lỗi lint, sửa hai lỗi hash của turbo, rồi bổ sung lớp token ngữ nghĩa shadcn **cộng thêm** (additive) bên cạnh hệ `--uw-*` hiện có.

**Tech Stack:** pnpm 10 workspaces + catalog · Turborepo 2 · ESLint 9 flat config · Tailwind CSS 4 (`@theme inline`) · Vitest 4 · Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-uniwork-base-port-design.md`

## Global Constraints

- Package manager: **pnpm 10.28.2**. Trường `pnpm.onlyBuiltDependencies` chỉ pnpm 10 hiểu.
- Mọi dependency dùng chung khai báo qua `catalog:` trong `pnpm-workspace.yaml`; mỗi workspace phải tự khai báo package nó import trực tiếp.
- React **19.2.3**, TypeScript **^5.9.3**, Node ≥ 22, Go ≥ 1.27.
- Ranh giới package (luật cứng): `core/` không `react-dom`/`localStorage`/`process.env`; `ui/` không import `@uniwork/core`; `views/` không `next/*`, không `react-router-dom`; chỉ `apps/web/platform/` chạm API Next.js.
- Comment trong code viết **tiếng Anh**. Tài liệu spec/plan viết tiếng Việt.
- Không thêm FOREIGN KEY mới; mọi index mới dùng `CREATE INDEX CONCURRENTLY` (áp dụng forward-only từ migration `005`).
- Không sửa 5 spec e2e onboarding hiện có cho vừa code mới — chúng là hợp đồng hồi quy.

## Lệch có chủ ý so với spec (đã phát hiện khi đọc code, ghi lại để không ai tưởng là sai sót)

Spec §5.4 viết "rót màu vào khe ngữ nghĩa **rồi xoá** `--uw-*`", và §11 chấp nhận giao diện xấu từ pha 1 tới pha 4.

Đọc code cho thấy làm vậy là tự chuốc lấy rủi ro không cần thiết: `apps/web/app/globals.css` ánh xạ `--uw-*` sang tên Tailwind (`--color-canvas`, `--color-line-loud`, …) và **toàn bộ** 14 primitive + 38 view hiện tại dùng các class đó. Xoá `--uw-*` ở pha 1 là làm hỏng app ngay, và mất luôn `onboarding-contrast.spec.ts` — phép đo tương phản trên trang đã render — đúng lúc cần nó nhất để chứng minh bảng màu mới không phá WCAG.

**Thay bằng: cộng thêm trước, xoá sau.** Pha 1 thêm lớp slot shadcn ánh xạ vào **chính các giá trị màu** uniwork đã tính toán; `--uw-*` và các alias `--color-*` ở lại nguyên. Việc xoá dời sang cuối pha 5, khi không còn ai tham chiếu — lúc đó nó là dọn dẹp cơ học, không phải phẫu thuật.

Hệ quả tốt: app **không** xấu ở pha 1–4, và `onboarding-contrast.spec.ts` giữ nguyên giá trị làm cổng chất lượng suốt quá trình.

Một tin tốt nữa: thang `--text-*` role-named của usf (`micro/caption/label/body/body-lg/title-sm/title/title-lg/display-sm/display`) **đã có sẵn** trong `globals.css` của uniwork, khớp từng giá trị. Phần đó không phải port.

---

## Cấu trúc file

| File | Trách nhiệm | Task |
| --- | --- | --- |
| `package.json` | packageManager, `pnpm.onlyBuiltDependencies`, script `ui:add` | 1, 8 |
| `pnpm-workspace.yaml` | catalog — nguồn duy nhất chốt phiên bản dependency dùng chung | 2 |
| `packages/eslint-config/base.js` | luật TS + chặn phantom dependency | 3 |
| `packages/eslint-config/react.js` | base + react + react-hooks | 3 |
| `packages/eslint-config/next.js` | react + plugin Next.js | 3 |
| `packages/eslint-config/package.json` | exports 3 tầng, dependency plugin | 3 |
| `packages/{ui,core,views}/eslint.config.mjs` | áp cấu hình + **luật ranh giới riêng từng package** | 4 |
| `packages/{ui,core,views}/package.json` | thêm script `lint` (hiện chỉ `apps/web` có) | 3 |
| `turbo.json` | `globalDependencies` + task trung chuyển `cache-inputs` | 5 |
| `packages/ui/styles/tokens.css` | **nguồn duy nhất** của token + `@theme inline` | 6, 7 |
| `packages/ui/styles/tokens.test.ts` | hợp đồng token: mọi slot phải có ở cả light và dark | 6, 7 |
| `apps/web/app/globals.css` | chỉ còn import + `@source` + font stack | 6 |
| `packages/ui/components.json` | cấu hình shadcn/ReUI cho `pnpm ui:add` | 8 |
| `CLAUDE.md` | bản nháp: Project Shape + Package Boundaries + Commands | 9 |

---

## Task 1: Nâng pnpm 9 → 10

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: workspace chạy trên pnpm 10, trường `pnpm.onlyBuiltDependencies` khả dụng cho Task 2.

- [ ] **Step 1: Ghi lại phiên bản hiện tại để chứng minh có thay đổi thật**

Run:
```bash
cd /Users/phanducquang/Work/AIFactory/uniwork
pnpm --version
grep packageManager package.json
```
Expected: in ra `9.x` và `"packageManager": "pnpm@9.15.0"`.

- [ ] **Step 2: Xác nhận `onlyBuiltDependencies` chưa được hiểu (đây là "test đỏ")**

Thêm tạm vào `package.json`, ngay sau dòng `"packageManager"`:
```json
  "pnpm": { "onlyBuiltDependencies": ["esbuild"] },
```
Run: `pnpm install --lockfile-only 2>&1 | tail -5`
Expected: pnpm 9 cảnh báo hoặc bỏ qua trường này (không có tác dụng). Ghi lại output rồi **hoàn tác** thay đổi tạm: `git checkout package.json`.

- [ ] **Step 3: Nâng pnpm**

Sửa `package.json`:
```json
  "packageManager": "pnpm@10.28.2",
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild"]
  },
```

Đặt `"pnpm"` là key cùng cấp với `"packageManager"`, `"scripts"`, `"devDependencies"`.

- [ ] **Step 4: Kích hoạt và cài lại**

Run:
```bash
corepack enable
corepack prepare pnpm@10.28.2 --activate
pnpm --version
pnpm install
```
Expected: `pnpm --version` in `10.28.2`; `pnpm install` kết thúc không lỗi; `pnpm-lock.yaml` được ghi lại theo định dạng lockfile v9 (pnpm 10).

- [ ] **Step 5: Xác nhận repo vẫn xanh**

Run: `pnpm typecheck && pnpm test`
Expected: PASS cả hai.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: upgrade to pnpm 10"
```

---

## Task 2: Mở rộng catalog — chốt phiên bản một lần

**Files:**
- Modify: `pnpm-workspace.yaml`

**Interfaces:**
- Produces: các entry catalog mà Task 3 và toàn bộ Plan 2 (sweep Tầng 1 FE) sẽ tham chiếu bằng `catalog:`.

Lý do làm sớm: rủi ro số 1 trong spec §12 là bùng nổ dependency. Chốt tất cả phiên bản ở đây, một lần, lấy đúng số usf đang chạy — thay vì mỗi lô sweep lại tự quyết một phiên bản rồi lệch nhau.

- [ ] **Step 1: Viết test kiểm tra catalog đầy đủ**

Create `scripts/catalog-check.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Mọi package mà đợt port Tầng 1 sẽ cần. Nguồn: packages/ui/package.json và
// packages/core/package.json của usf. Giữ danh sách này đồng bộ với plan —
// nó là lý do duy nhất khiến phiên bản không trôi giữa các lô sweep.
const REQUIRED = [
  "zustand",
  "@tanstack/react-table",
  "@tanstack/react-virtual",
  "@testing-library/user-event",
  "@formatjs/intl-localematcher",
  "eslint-plugin-i18next",
  "katex",
  "rehype-katex",
  "remark-math",
  "posthog-js",
  "react-virtuoso",
  "unicode-animations",
];

test("pnpm catalog declares every shared dependency the port needs", () => {
  const yaml = readFileSync("pnpm-workspace.yaml", "utf8");
  const missing = REQUIRED.filter((name) => {
    const key = name.startsWith("@") ? `"${name}":` : `${name}:`;
    return !yaml.includes(key);
  });
  assert.deepEqual(missing, [], `missing from catalog: ${missing.join(", ")}`);
});
```

- [ ] **Step 2: Chạy test để thấy nó đỏ**

Run: `node --test scripts/catalog-check.test.mjs`
Expected: FAIL — `missing from catalog: zustand, @tanstack/react-table, ...` (đủ 12 tên).

- [ ] **Step 3: Bổ sung catalog**

Sửa `pnpm-workspace.yaml`, thêm vào cuối khối `catalog:` (giữ nguyên các entry đã có):

```yaml
  # State management — Zustand giữ client/view state; React Query giữ server state
  zustand: "^5.0.0"

  # Bảng và danh sách ảo hoá
  "@tanstack/react-table": "^8.21.3"
  "@tanstack/react-virtual": "^3.13.0"
  react-virtuoso: "^4.14.0"

  # i18n
  "@formatjs/intl-localematcher": "^0.8.4"
  eslint-plugin-i18next: "^6.1.4"

  # Markdown / toán học (packages/ui/markdown)
  katex: "^0.16.45"
  rehype-katex: "^7.0.1"
  remark-math: "^6.0.0"

  # Product analytics (packages/core/analytics)
  posthog-js: "^1.176.1"

  # Animation loading cho StatusPill
  unicode-animations: "^1.0.3"

  # Testing
  "@testing-library/user-event": "^14.6.1"
```

- [ ] **Step 4: Chạy test để thấy nó xanh**

Run: `node --test scripts/catalog-check.test.mjs`
Expected: PASS.

- [ ] **Step 5: Xác nhận catalog phân giải được**

Run: `pnpm install --lockfile-only`
Expected: kết thúc không lỗi. Catalog chỉ chốt phiên bản; chưa package nào tham chiếu nên `node_modules` không đổi.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml scripts/catalog-check.test.mjs
git commit -m "chore(deps): pin every shared version the usf port needs in the catalog"
```

---

## Task 3: Tách eslint-config thành 3 tầng + chặn phantom dependency

**Files:**
- Create: `packages/eslint-config/base.js`, `packages/eslint-config/react.js`, `packages/eslint-config/next.js`
- Modify: `packages/eslint-config/package.json`, `packages/eslint-config/index.mjs` (xoá)
- Modify: `packages/{ui,core,views}/package.json` (thêm script `lint`)
- Create: `packages/{ui,core,views}/eslint.config.mjs`
- Modify: `apps/web/eslint.config.mjs`

**Interfaces:**
- Produces: `@uniwork/eslint-config/base`, `@uniwork/eslint-config/react`, `@uniwork/eslint-config/next` — Task 4 mở rộng chúng bằng luật ranh giới.

Hiện chỉ `apps/web` có script `lint`, nên `turbo lint` **không hề lint** `packages/`. Mọi luật ranh giới viết ra sẽ vô tác dụng cho tới khi sửa chỗ này.

- [ ] **Step 1: Viết fixture vi phạm — import package không khai báo**

Create `packages/ui/phantom-fixture.tsx`:
```tsx
// TEMPORARY lint fixture. `zustand` is not in packages/ui/package.json, so the
// phantom-dependency rule must reject this file. Deleted at the end of this task.
import { create } from "zustand";

export const useFixtureStore = create(() => ({ value: 0 }));
```

- [ ] **Step 2: Chạy lint để xác nhận luật CHƯA bắt được**

Run:
```bash
cd packages/ui && npx eslint phantom-fixture.tsx --config ../eslint-config/index.mjs; echo "exit=$?"
```
Expected: `exit=0` — không lỗi. Đây là bằng chứng luật chưa tồn tại.

- [ ] **Step 3: Tạo `packages/eslint-config/base.js`**

```js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import-x";

/** @type {import("eslint").Linter.Config[]} */
export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "import-x": importPlugin,
    },
    rules: {
      // Already enforced by the TypeScript compiler
      // (noUnusedLocals / noUnusedParameters).
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      // Phantom dependencies: a package may only import what its own
      // package.json declares. Without this, a workspace silently relies on a
      // transitive hoist and breaks the moment the hoist changes.
      "import-x/no-extraneous-dependencies": ["error", {
        devDependencies: [
          "**/*.test.{ts,tsx}",
          "**/*.spec.{ts,tsx}",
          "**/test/**",
          "**/tests/**",
          "**/vitest.config.*",
          "**/vite.config.*",
          "**/eslint.config.*",
          "**/scripts/**",
        ],
        peerDependencies: true,
      }],
    },
  },
  {
    ignores: ["node_modules/", "dist/", ".next/", "out/", ".turbo/"],
  },
];
```

- [ ] **Step 4: Tạo `packages/eslint-config/react.js`**

```js
import baseConfig from "./base.js";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: { react: reactPlugin },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs["jsx-runtime"].rules,
      "react/prop-types": "off",
      "react/no-unknown-property": "off",
    },
    settings: { react: { version: "detect" } },
  },
  // Hooks rules apply to .ts too: useEffect / useCallback / useMemo live in
  // plain .ts modules and exhaustive-deps must run there as well.
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: { "react-hooks": reactHooksPlugin },
    rules: { ...reactHooksPlugin.configs["recommended-latest"].rules },
  },
];
```

- [ ] **Step 5: Tạo `packages/eslint-config/next.js`**

```js
import reactConfig from "./react.js";
import nextPlugin from "@next/eslint-plugin-next";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...reactConfig,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
];
```

- [ ] **Step 6: Cập nhật `packages/eslint-config/package.json`**

```json
{
  "name": "@uniwork/eslint-config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./base": "./base.js",
    "./react": "./react.js",
    "./next": "./next.js"
  },
  "dependencies": {
    "@eslint/js": "^9.32.0",
    "typescript-eslint": "^8.56.1",
    "eslint-plugin-import-x": "^4.12.0",
    "eslint-plugin-react": "^7.37.0",
    "eslint-plugin-react-hooks": "^5.2.0",
    "@next/eslint-plugin-next": "^16.2.0"
  },
  "peerDependencies": {
    "eslint": "^9.0.0"
  }
}
```

Xoá `packages/eslint-config/index.mjs`.

- [ ] **Step 7: Tạo eslint config cho từng package**

`packages/ui/eslint.config.mjs`:
```js
import reactConfig from "@uniwork/eslint-config/react";

export default [...reactConfig];
```

`packages/core/eslint.config.mjs`: nội dung y hệt file trên.

`packages/views/eslint.config.mjs`:
```js
import reactConfig from "@uniwork/eslint-config/react";
import i18next from "eslint-plugin-i18next";

// Global i18n protection: every JSX text node in this package must go through
// the translation hook. A raw string becomes a lint error. `jsx-text-only`
// flags JSX children only — attribute values and plain TS literals pass.
export default [
  ...reactConfig,
  {
    files: ["**/*.tsx"],
    ignores: ["**/*.test.tsx", "test/**"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": ["error", { mode: "jsx-text-only" }],
    },
  },
];
```

Sửa `apps/web/eslint.config.mjs`:
```js
import nextConfig from "@uniwork/eslint-config/next";

export default [
  ...nextConfig,
  { ignores: [".next/", ".turbo/"] },
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}"],
    rules: { "react/display-name": "off" },
  },
];
```

- [ ] **Step 8: Thêm script `lint` cho các package**

Trong `packages/ui/package.json`, `packages/core/package.json`, `packages/views/package.json`, thêm vào `scripts`:
```json
    "lint": "eslint .",
```

Thêm vào `devDependencies` của cả ba:
```json
    "@uniwork/eslint-config": "workspace:*",
    "eslint": "^9.32.0",
```

Riêng `packages/views/package.json` thêm tiếp:
```json
    "eslint-plugin-i18next": "catalog:",
```

- [ ] **Step 9: Cài lại và chạy lint để thấy fixture BỊ BẮT**

Run:
```bash
cd /Users/phanducquang/Work/AIFactory/uniwork
pnpm install
cd packages/ui && npx eslint phantom-fixture.tsx; echo "exit=$?"
```
Expected: `exit=1`, thông báo `'zustand' should be listed in the project's dependencies` từ `import-x/no-extraneous-dependencies`.

- [ ] **Step 10: Xoá fixture, chạy lint toàn repo**

Run:
```bash
rm packages/ui/phantom-fixture.tsx
pnpm lint
```
Expected: PASS. Nếu `i18next/no-literal-string` báo lỗi ở các view hiện có, đó là **phát hiện thật** — sửa bằng cách bọc chuỗi vào hook dịch, không tắt luật. Nếu số lỗi quá lớn để xử lý trong task này, hạ luật đó xuống `"warn"` và ghi ngay phía trên nó đúng dòng chú thích sau, để pha 6 có cái mà tìm:
```js
      // Downgraded to "warn" on 2026-08-25 because the pre-rebuild views carry
      // raw strings. Must return to "error" once the phase-5 rebuild lands —
      // the i18n parity test is worthless if literals can still reach the UI.
```

- [ ] **Step 11: Xác nhận repo vẫn xanh**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/eslint-config packages/ui packages/core packages/views apps/web pnpm-lock.yaml
git rm packages/eslint-config/index.mjs
git commit -m "chore(lint): three-tier eslint config, phantom-dep and i18n literal rules"
```

---

## Task 4: Biến luật ranh giới package thành lỗi lint

**Files:**
- Modify: `packages/core/eslint.config.mjs`, `packages/ui/eslint.config.mjs`, `packages/views/eslint.config.mjs`

**Interfaces:**
- Consumes: `@uniwork/eslint-config/react` (Task 3).
- Produces: `pnpm lint` thất bại khi bất kỳ luật ranh giới nào trong CLAUDE.md bị vi phạm.

usf viết các ranh giới này trong CLAUDE.md nhưng **không** ép bằng máy ở phía package dùng chung — chỉ desktop mới có `no-restricted-imports`. Với ~31.000 dòng sắp đổ vào, một luật chỉ nằm trong văn bản sẽ bị vi phạm mà không ai biết. Task này đóng khoảng trống đó.

- [ ] **Step 1: Viết ba fixture, mỗi cái vi phạm một ranh giới**

Create `packages/views/boundary-fixture.tsx`:
```tsx
// TEMPORARY boundary fixture. packages/views must never import next/*.
// Deleted at the end of this task.
import { useRouter } from "next/navigation";

export function Fixture() {
  const router = useRouter();
  return <button onClick={() => router.push("/")}>x</button>;
}
```

Create `packages/ui/boundary-fixture.ts`:
```ts
// TEMPORARY boundary fixture. packages/ui must never import @uniwork/core.
// Deleted at the end of this task.
import { paths } from "@uniwork/core/paths";

export const fixturePath = paths;
```

Create `packages/core/boundary-fixture.ts`:
```ts
// TEMPORARY boundary fixture. packages/core must never touch localStorage or
// process.env — it runs in Node tests and non-browser platforms.
// Deleted at the end of this task.
export function readFixture(): string | null {
  return localStorage.getItem(process.env.FIXTURE_KEY ?? "k");
}
```

- [ ] **Step 2: Chạy lint để xác nhận cả ba LỌT LƯỚI**

Run:
```bash
cd /Users/phanducquang/Work/AIFactory/uniwork
npx eslint packages/views/boundary-fixture.tsx packages/ui/boundary-fixture.ts packages/core/boundary-fixture.ts 2>&1 | tail -20; echo "exit=$?"
```
Expected: không có lỗi nào thuộc nhóm ranh giới (có thể có lỗi `import-x` do package chưa khai báo — bỏ qua, đó là luật khác). Đây là bằng chứng ranh giới chưa được ép.

- [ ] **Step 3: Thêm luật vào `packages/views/eslint.config.mjs`**

Chèn khối sau vào mảng export, **sau** khối i18next:
```js
  // Package boundary: views is shared across platforms. Anything that reaches
  // for a framework router binds it to one host and makes the desktop/mobile
  // shells impossible without a rewrite. Navigation goes through
  // useNavigation() / <AppLink> from the platform adapter.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "test/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["next", "next/*"],
            message:
              "packages/views must stay framework-agnostic. Use useNavigation() or <AppLink> from the platform adapter; Next.js APIs belong in apps/web/platform/.",
          },
          {
            group: ["react-router-dom"],
            message:
              "packages/views must stay framework-agnostic. Use useNavigation() or <AppLink> from the platform adapter.",
          },
        ],
      }],
    },
  },
```

- [ ] **Step 4: Thêm luật vào `packages/ui/eslint.config.mjs`**

```js
import reactConfig from "@uniwork/eslint-config/react";

export default [
  ...reactConfig,
  // Package boundary: ui holds atomic primitives with zero business logic.
  // Importing core would make every primitive drag the API client, the stores
  // and the domain types along with it.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "test/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@uniwork/core", "@uniwork/core/*"],
          message:
            "packages/ui must not depend on business logic. Pass data in through props instead.",
        }],
      }],
    },
  },
];
```

- [ ] **Step 5: Thêm luật vào `packages/core/eslint.config.mjs`**

```js
import reactConfig from "@uniwork/eslint-config/react";

export default [
  ...reactConfig,
  // Package boundary: core is headless. It runs under Node in tests and under
  // non-browser platforms, so browser globals and build-time env reads must be
  // injected through the platform adapters rather than reached for directly.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "test/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["react-dom", "react-dom/*"],
          message:
            "packages/core is headless. Rendering belongs in packages/ui or packages/views.",
        }],
      }],
      "no-restricted-globals": ["error",
        {
          name: "localStorage",
          message:
            "packages/core must use StorageAdapter from ./platform — localStorage does not exist in Node tests or on every platform.",
        },
        {
          name: "sessionStorage",
          message:
            "packages/core must use StorageAdapter from ./platform.",
        },
      ],
      "no-restricted-syntax": ["error", {
        selector: "MemberExpression[object.object.name='process'][object.property.name='env']",
        message:
          "packages/core must not read process.env. Inject configuration through the platform layer.",
      }],
    },
  },
];
```

- [ ] **Step 6: Chạy lint để thấy cả ba fixture BỊ BẮT**

Run:
```bash
npx eslint packages/views/boundary-fixture.tsx 2>&1 | grep -c "no-restricted-imports"
npx eslint packages/ui/boundary-fixture.ts 2>&1 | grep -c "no-restricted-imports"
npx eslint packages/core/boundary-fixture.ts 2>&1 | grep -cE "no-restricted-globals|no-restricted-syntax"
```
Expected: lần lượt `1`, `1`, và `≥2` (localStorage + process.env).

- [ ] **Step 7: Xoá fixture, chạy lint toàn repo**

Run:
```bash
rm packages/views/boundary-fixture.tsx packages/ui/boundary-fixture.ts packages/core/boundary-fixture.ts
pnpm lint
```
Expected: PASS. Nếu code hiện có vi phạm, đó là nợ thật — sửa ngay tại đây (thường là chuyển lời gọi sang `apps/web/`), không nới luật.

- [ ] **Step 8: Commit**

```bash
git add packages/views/eslint.config.mjs packages/ui/eslint.config.mjs packages/core/eslint.config.mjs
git commit -m "chore(lint): enforce package boundaries as lint errors"
```

---

## Task 5: Sửa hai lỗi hash của turbo

**Files:**
- Modify: `turbo.json`
- Create: `.github/workflows/ci.yml` (bản tối thiểu, chỉ để `globalDependencies` có đích trỏ tới)

**Interfaces:**
- Produces: hash của `@uniwork/views#test` thay đổi khi source của `@uniwork/ui` thay đổi.

`turbo.json` hiện có `"test": {}` — không cạnh phụ thuộc nào. Nghĩa là sửa `packages/ui` xong, hash task test của `views` **y hệt**, và turbo phát lại một lượt pass cũ trên code đã đổi. Đây là lỗi giả-xanh, nguy hiểm nhất trong nhóm lỗi CI.

- [ ] **Step 1: Viết test đo hash**

Create `scripts/turbo-cache-check.sh`:
```bash
#!/usr/bin/env bash
# Proves that a change inside packages/ui changes the task hash of a package
# that depends on it. Without a dependency edge turbo replays a stale pass.
set -euo pipefail

hash_of() {
  # `--dry=json` shares stdout with whatever the package manager prints, so slice
  # from the first brace instead of assuming the stream is pure JSON.
  npx turbo run test --filter=@uniwork/views --dry=json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s.slice(s.indexOf("{")));const t=j.tasks.find(t=>t.taskId==="@uniwork/views#test");console.log(t?t.hash:"NOTASK")})'
}

BEFORE="$(hash_of)"
printf '\n/* turbo cache probe */\n' >> packages/ui/lib/utils.ts
AFTER="$(hash_of)"
git checkout packages/ui/lib/utils.ts

echo "before=$BEFORE"
echo "after=$AFTER"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "FAIL: editing packages/ui did not change @uniwork/views#test hash"
  exit 1
fi
echo "PASS: hash tracks dependency sources"
```

Run: `chmod +x scripts/turbo-cache-check.sh`

- [ ] **Step 2: Chạy để thấy nó đỏ**

Run: `bash scripts/turbo-cache-check.sh`
Expected: FAIL — `before` và `after` bằng nhau, in ra `FAIL: editing packages/ui did not change @uniwork/views#test hash`.

- [ ] **Step 3: Tạo file CI tối thiểu để `globalDependencies` có đích**

Create `.github/workflows/ci.yml`:
```yaml
# Placeholder pipeline. The full four-job workflow lands in the phase-6 plan.
# It exists now because turbo.json lists this file in globalDependencies: the
# toolchain versions pinned here must be part of every task hash, so that
# bumping Node can never replay results produced by the previous runtime.
name: CI

on:
  push:
    branches: [main]
  pull_request:

env:
  NODE_VERSION: "22"
  GO_VERSION: "1.27.0"
  PNPM_VERSION: "10.28.2"

jobs:
  placeholder:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Real jobs land with the phase-6 plan."
```

- [ ] **Step 4: Sửa `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".github/workflows/ci.yml"],
  "globalEnv": [
    "DATABASE_URL",
    "PORT",
    "FRONTEND_PORT",
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_WS_URL",
    "NEXT_PUBLIC_APP_URL"
  ],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "lint": {},
    "cache-inputs": { "dependsOn": ["^cache-inputs"] },
    "test": { "dependsOn": ["^cache-inputs"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

Giải thích hai thay đổi, cần giữ lại khi ai đó dọn file này về sau:

- `globalDependencies` đưa phiên bản toolchain của CI vào hash toàn cục. Không có nó, nâng Node sẽ phát lại kết quả sinh bởi runtime cũ và giấu lỗi tương thích sau dấu tích xanh.
- `cache-inputs` là task trung chuyển thuần hash: **không** package nào định nghĩa script này, nên mọi node phân giải thành `<NONEXISTENT>` và không có gì được thực thi — nhưng cạnh phụ thuộc vẫn kéo hash file của từng dependency vào thứ phụ thuộc nó. `dependsOn: ["^cache-inputs"]` khiến việc đó đệ quy. Dùng `^typecheck` cũng được nhưng lôi cả `tsc --noEmit` vào job test; dùng `^test` thì các suite phải chạy nối đuôi nhau.

- [ ] **Step 5: Chạy test để thấy nó xanh**

Run: `bash scripts/turbo-cache-check.sh`
Expected: PASS — `before` khác `after`, in ra `PASS: hash tracks dependency sources`.

- [ ] **Step 6: Xác nhận turbo vẫn chạy bình thường**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: PASS cả ba. Không task nào báo lỗi do `cache-inputs` không tồn tại — đó là hành vi đúng.

- [ ] **Step 7: Commit**

```bash
git add turbo.json .github/workflows/ci.yml scripts/turbo-cache-check.sh
git commit -m "fix(turbo): hash dependency sources and CI toolchain into task hashes"
```

---

## Task 6: Đưa `@theme inline` về `packages/ui`

**Files:**
- Modify: `packages/ui/styles/tokens.css`
- Modify: `apps/web/app/globals.css`
- Create: `packages/ui/styles/tokens.test.ts`

**Interfaces:**
- Produces: `packages/ui/styles/tokens.css` là **nguồn duy nhất** của token và ánh xạ Tailwind. Task 7 mở rộng chính file này.

Hiện khối `@theme inline` nằm trong `apps/web/app/globals.css`. Nghĩa là `packages/ui` không tự mô tả được hệ màu của nó: ai thêm app thứ hai (hoặc chạy Storybook/test render) phải chép lại khối đó. usf đặt nó trong `packages/ui/styles/tokens.css` — đúng chỗ.

- [ ] **Step 1: Viết test hợp đồng token**

Create `packages/ui/styles/tokens.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  fileURLToPath(new URL("./tokens.css", import.meta.url)),
  "utf8",
);

/** Lấy nội dung một khối `selector { ... }` ở cấp cao nhất của file. */
function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) return "";
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return "";
}

/** Tên mọi custom property được ĐỊNH NGHĨA trong một khối. */
function definedVars(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
  );
}

describe("token contract", () => {
  it("declares the Tailwind theme mapping inside the ui package", () => {
    // The mapping must live with the primitives that consume it, otherwise a
    // second app (or a render test) has to duplicate it to render anything.
    expect(css).toContain("@theme inline");
  });

  it("defines the role-named type scale", () => {
    const theme = block("@theme inline");
    for (const step of [
      "--text-micro",
      "--text-caption",
      "--text-label",
      "--text-body",
      "--text-body-lg",
      "--text-title-sm",
      "--text-title",
      "--text-title-lg",
      "--text-display-sm",
      "--text-display",
    ]) {
      expect(definedVars(theme), `missing type step ${step}`).toContain(step);
    }
  });

  it("defines every colour token in both light and dark", () => {
    // The classic failure is adding a token to :root and forgetting .dark —
    // it renders correctly in the theme the author happened to be using and
    // falls back to an inherited colour in the other one.
    const light = definedVars(block(":root"));
    const dark = definedVars(block(".dark"));
    const singleTheme = new Set([
      // Deliberately identical in both themes; see the comment in tokens.css.
      "--uw-rail-bg",
      "--uw-radius",
    ]);
    const missing = [...light].filter(
      (name) => !dark.has(name) && !singleTheme.has(name),
    );
    expect(missing, `defined in :root but not in .dark: ${missing.join(", ")}`)
      .toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test để thấy nó đỏ**

Run: `pnpm --filter @uniwork/ui test -- tokens`
Expected: FAIL ở case đầu — `expected '...' to contain '@theme inline'`, vì khối đó còn nằm ở `apps/web`.

- [ ] **Step 3: Chuyển khối `@theme inline` sang `packages/ui/styles/tokens.css`**

Cắt **nguyên văn** khối `@theme inline { ... }` từ `apps/web/app/globals.css` và dán vào **cuối** `packages/ui/styles/tokens.css`, phía dưới khối `.dark`. Không sửa nội dung ở bước này.

Thêm ngay phía trên khối vừa dán:
```css
/* Tailwind mapping. Lives beside the tokens it maps so that any consumer —
   a second app, a render test, Storybook — gets the whole contract from one
   import instead of copying this block. */
```

- [ ] **Step 4: Rút gọn `apps/web/app/globals.css`**

Sau khi cắt, file chỉ còn:
```css
@import "tailwindcss";
@import "@uniwork/ui/styles/tokens.css";
@import "@uniwork/ui/styles/base.css";

@custom-variant dark (&:is(.dark *));

/* Tailwind v4 không tự quét workspace package (symlink qua node_modules) —
   khai báo source để sinh class dùng trong ui/views. */
@source "../../../packages/ui";
@source "../../../packages/views";
```

Khối `@custom-variant dark` phải nằm ở **app**, không phải ở `tokens.css`: nó thuộc cấu hình Tailwind của điểm vào, và `tokens.css` được import vào Tailwind chứ không cấu hình Tailwind.

Phần font (`--font-sans`, `--font-serif`, `--font-mono` trỏ tới biến của `next/font`) đi cùng khối `@theme inline` sang `tokens.css`; các biến `--font-inter` / `--font-source-serif` vẫn do `apps/web/app/layout.tsx` gắn lên `<html>`, không đổi.

- [ ] **Step 5: Chạy test để thấy nó xanh**

Run: `pnpm --filter @uniwork/ui test -- tokens`
Expected: PASS cả ba case.

- [ ] **Step 6: Xác nhận app còn build và giao diện không đổi**

Run:
```bash
pnpm --filter @uniwork/web build
```
Expected: build thành công.

Run (cần `make dev` đang chạy ở terminal khác):
```bash
pnpm --filter @uniwork/e2e test
```
Expected: cả 6 spec PASS, gồm `onboarding-contrast.spec.ts`. Đây là bằng chứng việc di chuyển không đổi một pixel nào.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/styles/tokens.css packages/ui/styles/tokens.test.ts apps/web/app/globals.css
git commit -m "refactor(ui): move the Tailwind theme mapping into the ui package"
```

---

## Task 7: Thêm lớp slot ngữ nghĩa shadcn (cộng thêm, không xoá)

**Files:**
- Modify: `packages/ui/styles/tokens.css`
- Modify: `packages/ui/styles/tokens.test.ts`

**Interfaces:**
- Produces: mọi slot mà 62 primitive của usf tham chiếu (`--background`, `--muted-foreground`, `--sidebar-*`, `--chart-*`, …) đều tồn tại ở cả light và dark, ánh xạ vào **chính** các giá trị màu uniwork đã tính WCAG. Plan 2 copy 62 primitive vào là chúng render đúng ngay.

Nguyên tắc ánh xạ: ở đâu uniwork đã có giá trị được tính toán thì dùng nó; ở đâu không có (thang biểu đồ, tô sáng tìm kiếm, bóng đổ) thì kế thừa giá trị của usf. **Không** phát minh màu mới.

Hai ánh xạ đáng chú ý:
- `--input` ← `--uw-line-loud`. Trong shadcn, `--input` là đường bao ô nhập; `--uw-line-loud` chính là token uniwork đã tính đạt 3:1 trên cả ba nền cho "đường bao của MỌI control". Ánh xạ này giữ nguyên công sức WCAG đó.
- `--border` ← `--uw-line` (1.27:1) — đúng ý định của uniwork (đường phân cách, mép thẻ). Nhưng shadcn dùng `border` rộng hơn, đôi khi trên control. **Đây là chỗ rủi ro duy nhất của task này**; `onboarding-contrast.spec.ts` ở Step 5 là phép đo quyết định.

- [ ] **Step 1: Mở rộng test — liệt kê slot bắt buộc**

Thêm vào `packages/ui/styles/tokens.test.ts`, bên trong `describe("token contract", ...)`:
```ts
  it("defines every semantic slot the shadcn primitives consume", () => {
    // Sourced from the 62 primitives in usf packages/ui/components/ui.
    // A missing slot renders as an inherited colour rather than an error, so
    // only an explicit list catches it.
    const REQUIRED = [
      "--background", "--foreground",
      "--card", "--card-foreground",
      "--popover", "--popover-foreground",
      "--primary", "--primary-foreground",
      "--secondary", "--secondary-foreground",
      "--muted", "--muted-foreground", "--faint-foreground",
      "--accent", "--accent-foreground",
      "--destructive", "--success", "--warning", "--info",
      "--brand", "--brand-foreground",
      "--border", "--input", "--ring", "--radius",
      "--app-shell", "--page-canvas",
      "--surface", "--surface-foreground", "--surface-raised",
      "--surface-hover", "--surface-selected",
      "--surface-selected-foreground", "--surface-border",
      "--sidebar", "--sidebar-foreground",
      "--sidebar-primary", "--sidebar-primary-foreground",
      "--sidebar-accent", "--sidebar-accent-foreground",
      "--sidebar-border", "--sidebar-ring",
      "--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5",
    ];
    const light = definedVars(block(":root"));
    const missing = REQUIRED.filter((name) => !light.has(name));
    expect(missing, `missing semantic slots: ${missing.join(", ")}`).toEqual([]);
  });

  it("exposes every semantic slot to Tailwind", () => {
    // A slot that exists in :root but has no --color-* alias is unreachable
    // from a utility class, which is the only way primitives consume it.
    const theme = block("@theme inline");
    for (const name of ["background", "foreground", "muted-foreground", "border", "input", "ring", "sidebar", "chart-1"]) {
      expect(theme, `no Tailwind alias for --${name}`).toContain(`--color-${name}:`);
    }
  });
```

- [ ] **Step 2: Chạy test để thấy nó đỏ**

Run: `pnpm --filter @uniwork/ui test -- tokens`
Expected: FAIL ở **cả hai** case vừa thêm — `missing semantic slots: --background, --foreground, --card, ...` (toàn bộ danh sách), và `no Tailwind alias for --background`. Ba case của Task 6 vẫn xanh.

- [ ] **Step 3: Thêm slot light vào khối `:root` của `tokens.css`**

Chèn vào **cuối** khối `:root` (giữ nguyên mọi `--uw-*` đang có):
```css
  /* ---------------------------------------------------------------------
   * Semantic slot layer (shadcn / Base UI contract).
   *
   * Additive on purpose: the --uw-* palette above stays the source of the
   * actual colour values, and every slot here points at one of them. That
   * keeps the WCAG ratios documented on those tokens — measured, not
   * guessed — while giving the ported primitives the names they expect.
   * The --uw-* aliases are removed only once nothing references them, at
   * the end of the frontend rebuild.
   * ------------------------------------------------------------------- */
  --app-shell: var(--uw-subtle);
  --page-canvas: var(--uw-canvas);
  --background: var(--uw-canvas);
  --foreground: var(--uw-text-primary);

  --surface: var(--uw-surface);
  --surface-foreground: var(--uw-text-primary);
  --surface-raised: var(--uw-surface);
  --surface-hover: var(--uw-subtle);
  --surface-selected: var(--uw-brand-soft);
  --surface-selected-foreground: var(--uw-text-primary);
  --surface-border: var(--uw-line);

  --card: var(--uw-surface);
  --card-foreground: var(--uw-text-primary);
  --popover: var(--uw-surface);
  --popover-foreground: var(--uw-text-primary);

  /* shadcn's "primary" is the high-contrast neutral used by solid buttons,
     not the brand hue. Brand keeps its own slot. */
  --primary: var(--uw-text-primary);
  --primary-foreground: var(--uw-text-inverse);
  --secondary: var(--uw-subtle);
  --secondary-foreground: var(--uw-text-primary);
  --accent: var(--uw-subtle);
  --accent-foreground: var(--uw-text-primary);
  --muted: var(--uw-subtle);
  --muted-foreground: var(--uw-text-secondary);
  /* Non-text marks only (chevrons, separators, empty-state glyphs): clears
     the 3:1 floor of WCAG 1.4.11 but not the 4.5:1 text floor. */
  --faint-foreground: var(--uw-text-tertiary);

  --brand: var(--uw-brand);
  --brand-foreground: var(--uw-on-brand);
  --destructive: var(--uw-danger);
  --success: var(--uw-success);
  --warning: var(--uw-warning);
  --info: var(--uw-brand);

  /* --border is the quiet divider (uw-line); --input is the control outline
     and must stay on uw-line-loud, the token measured at 3:1 against every
     surface it sits on. */
  --border: var(--uw-line);
  --input: var(--uw-line-loud);
  --ring: var(--uw-focus);
  --radius: var(--uw-radius);

  --sidebar: var(--uw-subtle);
  --sidebar-foreground: var(--uw-text-primary);
  --sidebar-primary: var(--uw-brand);
  --sidebar-primary-foreground: var(--uw-on-brand);
  --sidebar-accent: var(--uw-surface);
  --sidebar-accent-foreground: var(--uw-text-primary);
  --sidebar-border: var(--uw-line);
  --sidebar-ring: var(--uw-focus);

  /* Chart ramp: no uniwork equivalent, so the usf ramp is inherited as-is.
     chart-1 is the brand hue so the leading series anchors to the product
     colour; 2..5 step lighter and less saturated so a stacked bar reads as a
     hierarchy instead of five equally loud greys. */
  --chart-1: oklch(0.55 0.16 255);
  --chart-2: oklch(0.66 0.13 255);
  --chart-3: oklch(0.76 0.10 255);
  --chart-4: oklch(0.85 0.06 255);
  --chart-5: oklch(0.92 0.03 255);

  --surface-shadow: 0 1px 2px rgb(15 23 42 / 0.04), 0 1px 1px rgb(15 23 42 / 0.03);
  --menu-shadow: 0 8px 24px rgb(15 23 42 / 0.08), 0 2px 6px rgb(15 23 42 / 0.05);
  --floating-shadow: 0 16px 40px rgb(15 23 42 / 0.14), 0 3px 10px rgb(15 23 42 / 0.08);
```

- [ ] **Step 4: Thêm slot dark vào khối `.dark`**

Vì mọi slot đều trỏ qua `var(--uw-*)` và khối `.dark` đã định nghĩa lại toàn bộ `--uw-*`, phần lớn slot **tự động** đúng ở dark. Chỉ những slot có giá trị tuyệt đối mới cần khai lại. Chèn vào cuối khối `.dark`:

```css
  /* Slots pointing at --uw-* inherit the dark palette automatically. Only the
     absolute values need restating. */
  --chart-1: oklch(0.62 0.16 255);
  --chart-2: oklch(0.70 0.13 255);
  --chart-3: oklch(0.78 0.10 255);
  --chart-4: oklch(0.85 0.06 255);
  --chart-5: oklch(0.91 0.03 255);
  --surface-shadow: 0 1px 2px rgb(0 0 0 / 0.2), 0 1px 1px rgb(0 0 0 / 0.16);
  --menu-shadow: 0 8px 24px rgb(0 0 0 / 0.35), 0 2px 6px rgb(0 0 0 / 0.25);
  --floating-shadow: 0 16px 40px rgb(0 0 0 / 0.5), 0 3px 10px rgb(0 0 0 / 0.35);
```

Test "defined in both light and dark" ở Task 6 chỉ so tên được **định nghĩa** trong `:root` với tên trong `.dark`. Các slot chỉ có ở `:root` mà giá trị là `var(--uw-*)` sẽ làm test đỏ. Sửa test cho đúng ý định: thay `singleTheme` bằng phép loại trừ theo giá trị.

Sửa case đó trong `tokens.test.ts`:
```ts
  it("defines every colour token in both light and dark", () => {
    // A slot whose value is var(--uw-*) follows the palette automatically, so
    // restating it under .dark would be duplication, not safety. Only tokens
    // holding an absolute value must appear in both blocks.
    const lightBlock = block(":root");
    const dark = definedVars(block(".dark"));
    const absolute = [...lightBlock.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)]
      .filter(([, , value]) => !value.trim().startsWith("var("))
      .map(([, name]) => name);
    const singleTheme = new Set(["--uw-rail-bg", "--uw-radius"]);
    const missing = absolute.filter(
      (name) => !dark.has(name) && !singleTheme.has(name),
    );
    expect(missing, `absolute token missing from .dark: ${missing.join(", ")}`)
      .toEqual([]);
  });
```

- [ ] **Step 5: Thêm alias Tailwind vào `@theme inline`**

Chèn vào khối `@theme inline`, phía trên các alias `--color-canvas` đang có (giữ nguyên chúng):
```css
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-app-shell: var(--app-shell);
  --color-page-canvas: var(--page-canvas);
  --color-surface: var(--surface);
  --color-surface-foreground: var(--surface-foreground);
  --color-surface-raised: var(--surface-raised);
  --color-surface-hover: var(--surface-hover);
  --color-surface-selected: var(--surface-selected);
  --color-surface-selected-foreground: var(--surface-selected-foreground);
  --color-surface-border: var(--surface-border);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-faint-foreground: var(--faint-foreground);
  --color-brand: var(--brand);
  --color-brand-foreground: var(--brand-foreground);
  --color-destructive: var(--destructive);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-info: var(--info);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
```

**Xung đột tên — kiểm tra từng cái, chỉ MỘT cái thật sự xung đột.**

Khối `@theme inline` đã có sẵn các alias `--color-{canvas,surface,subtle,primary,secondary,tertiary,inverse,line,line-strong,line-loud,brand,on-brand,danger,success,warning,danger-text,success-text,warning-text,brand-soft}`. Sáu tên trùng với lớp slot mới. Đối chiếu giá trị:

| Alias | Giá trị cũ | Giá trị mới | Kết luận |
| --- | --- | --- | --- |
| `--color-primary` | `--uw-text-primary` | `--primary` → `--uw-text-primary` | y hệt, giữ nguyên |
| `--color-surface` | `--uw-surface` | `--surface` → `--uw-surface` | y hệt, giữ nguyên |
| `--color-brand` | `--uw-brand` | `--brand` → `--uw-brand` | y hệt, giữ nguyên |
| `--color-success` | `--uw-success` | `--success` → `--uw-success` | y hệt, giữ nguyên |
| `--color-warning` | `--uw-warning` | `--warning` → `--uw-warning` | y hệt, giữ nguyên |
| `--color-secondary` | `--uw-text-secondary` `#52525b` | `--secondary` → `--uw-subtle` `#f4f4f5` | **XUNG ĐỘT** |

`--color-tertiary` không có slot shadcn cùng tên — không đụng gì tới nó.

Chỉ `secondary` phải xử lý. Bỏ qua nó thì 54 chỗ dùng `text-secondary` sẽ đổi từ xám đậm sang xám gần trắng — chữ tàng hình trên nền sáng, và **build vẫn xanh**. Không có test nào bắt được ngoài `onboarding-contrast.spec.ts`.

Giải quyết: đổi tên alias cũ, cập nhật đúng 56 chỗ dùng (54 `text-`, 1 `bg-`, 1 `ring-`):

```bash
cd /Users/phanducquang/Work/AIFactory/uniwork
# Đếm trước để đối chiếu sau
grep -rhoE '\b(text|bg|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|caret)-secondary(/[0-9]+)?\b' \
  packages/ui packages/views apps/web/app --include='*.tsx' | wc -l   # kỳ vọng: 56

grep -rlE '\b(text|bg|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|caret)-secondary\b' \
  packages/ui packages/views apps/web/app --include='*.tsx' \
  | xargs sed -i '' -E 's/\b(text|bg|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|caret)-secondary\b/\1-text-secondary/g'

# Sau khi sửa phải còn 0
grep -rhoE '\b(text|bg|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|caret)-secondary(/[0-9]+)?\b' \
  packages/ui packages/views apps/web/app --include='*.tsx' | grep -v 'text-secondary\b' | wc -l
```

Trong `@theme inline`, đổi dòng alias cũ và ghi rõ vì sao:
```css
  /* Renamed out of the way of the shadcn `secondary` slot, which is a muted
     SURFACE while this one is a text colour. Transitional: the rebuilt views
     use text-muted-foreground and this alias goes away with the --uw-* layer. */
  --color-text-secondary: var(--uw-text-secondary);
```

- [ ] **Step 6: Chạy test để thấy nó xanh**

Run: `pnpm --filter @uniwork/ui test -- tokens`
Expected: PASS toàn bộ 5 case.

- [ ] **Step 7: Xác minh bằng phép đo, không bằng niềm tin**

Run:
```bash
pnpm --filter @uniwork/web build
```
Expected: build thành công.

Run (cần `make dev` đang chạy):
```bash
pnpm --filter @uniwork/e2e test
```
Expected: cả 6 spec PASS. `onboarding-contrast.spec.ts` là cổng quyết định — nó đo tương phản trên trang đã render ở cả hai theme. Nếu nó đỏ ở một cặp màu nào đó, **sửa ánh xạ**, đừng sửa test: khả năng cao nhất là một control đang lấy `--border` trong khi phải lấy `--input`.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/styles/tokens.css packages/ui/styles/tokens.test.ts packages/ui packages/views apps/web
git commit -m "feat(ui): add the shadcn semantic slot layer over the uniwork palette"
```

---

## Task 8: Nối shadcn CLI để `pnpm ui:add` dùng được

**Files:**
- Create: `packages/ui/components.json`
- Modify: `package.json` (script `ui:add`)

**Interfaces:**
- Produces: lệnh `pnpm ui:add <component>` đặt primitive mới vào `packages/ui/components/ui/` với alias đúng.

Đây là điều kiện để Plan 2 không phải chép tay 62 file, và để về sau còn thêm được component mới.

- [ ] **Step 1: Xác nhận lệnh chưa tồn tại**

Run: `pnpm ui:add --help; echo "exit=$?"`
Expected: lỗi `Command "ui:add" not found`, `exit` khác 0.

- [ ] **Step 2: Tạo `packages/ui/components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "styles/tokens.css",
    "baseColor": "zinc",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@uniwork/ui/components",
    "ui": "@uniwork/ui/components/ui",
    "hooks": "@uniwork/ui/hooks",
    "lib": "@uniwork/ui/lib",
    "utils": "@uniwork/ui/lib/utils"
  }
}
```

Bỏ registry `@reui` của usf: nó cần `REUI_LICENSE_KEY` và uniwork chưa có. Thêm lại khi nào thực sự cần.

- [ ] **Step 3: Thêm script vào `package.json` gốc**

Trong `scripts`:
```json
    "ui:add": "cd packages/ui && npx shadcn@latest add",
```

- [ ] **Step 4: Thử thêm một primitive để chứng minh đường dẫn đúng**

Run:
```bash
pnpm ui:add separator
```
Expected: tạo `packages/ui/components/ui/separator.tsx`, import `cn` từ `@uniwork/ui/lib/utils`.

- [ ] **Step 5: Kiểm tra file sinh ra hợp lệ**

Run:
```bash
head -5 packages/ui/components/ui/separator.tsx
pnpm --filter @uniwork/ui typecheck
pnpm lint
```
Expected: import alias đúng `@uniwork/ui/lib/utils`; typecheck PASS; lint PASS. Nếu lint báo phantom dependency (ví dụ `@base-ui/react`), thêm gói đó vào `packages/ui/package.json` — đó chính là luật ở Task 3 làm việc đúng.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/components.json packages/ui/components/ui/separator.tsx package.json pnpm-lock.yaml packages/ui/package.json
git commit -m "chore(ui): wire the shadcn CLI to packages/ui"
```

---

## Task 9: CLAUDE.md bản nháp

**Files:**
- Create: `CLAUDE.md`

**Interfaces:**
- Produces: luật ranh giới và lệnh dựng, ở dạng agent đọc được, trước khi ~31.000 dòng bắt đầu đổ vào.

Bản chính thức 16 mục viết ở pha 6, khi mọi luật đã kiểm chứng được. Bản nháp này **chỉ** chứa những gì đã đúng **ngay bây giờ** — mỗi dòng phải soi được vào một file hoặc một lệnh có thật.

- [ ] **Step 1: Viết `CLAUDE.md`**

```markdown
# CLAUDE.md

Guidance for Claude Code in this repository. This is the DRAFT written at the
start of the usf base port; the authoritative version lands with the phase-6
plan. Everything below is already true today — do not add aspirational rules
here.

**Spec:** `docs/superpowers/specs/2026-08-25-uniwork-base-port-design.md`

## Project Shape

UniWork is an AI-native Work OS for Vietnamese teams: tasks, meetings,
documents and workflows co-owned by people and agents.

- `server/` — Go backend: Chi router, pgx, sqlc, gorilla/websocket.
- `apps/web/` — Next.js App Router. The only place Next.js APIs may be used.
- `packages/core/` — headless logic: API client, React Query hooks, stores.
- `packages/ui/` — atomic UI primitives only.
- `packages/views/` — shared business screens.
- `packages/tsconfig/`, `packages/eslint-config/` — shared config.
- `e2e/` — Playwright.

Shared packages export raw `.ts` / `.tsx`, compiled by the consuming app.
Dependency direction is `views -> core + ui`; `core` and `ui` stay independent
of each other.

## Package Boundaries

These are lint errors, not conventions. `pnpm lint` fails on any of them:

- `packages/core/` — no `react-dom`, no `localStorage` / `sessionStorage`
  (use the platform `StorageAdapter`), no `process.env`.
- `packages/ui/` — no `@uniwork/core` imports, no business logic.
- `packages/views/` — no `next/*`, no `react-router-dom`. Navigate through the
  platform adapter.
- Every workspace declares the packages it imports in its own `package.json`
  (`import-x/no-extraneous-dependencies`).
- Every JSX text node in `packages/views/` goes through the translation hook
  (`i18next/no-literal-string`).

Shared dependency versions are pinned once in the `catalog:` block of
`pnpm-workspace.yaml`. Do not write a version number in a package manifest for
anything the catalog already covers.

## Design Tokens

`packages/ui/styles/tokens.css` is the single source: the `--uw-*` palette, the
semantic slot layer over it, and the Tailwind `@theme inline` mapping.

- Use semantic classes (`bg-background`, `text-muted-foreground`); never
  hardcode a colour.
- Font sizes come from the role-named `--text-*` scale (`text-caption`,
  `text-body`, `text-title`, …). Tailwind's default `text-sm` / `text-base`
  ramp is not in use.
- Every colour change is verified in both light and dark. The gate is
  `e2e/onboarding-contrast.spec.ts`, which measures contrast on the rendered
  page — reading the token values is not verification.
- The `--uw-*` aliases are transitional and get removed once the frontend
  rebuild finishes. Write new code against the semantic slots.

## Database and Migration Rules

Applied forward-only from migration `005`; migrations `001`–`004` predate these
rules and are not rewritten.

- No `FOREIGN KEY` / `REFERENCES`, no cascading deletes or updates. Resolve
  relationships and dependent cleanup in application code, inside a transaction
  when parent and cleanup must commit together.
- Every index uses `CREATE INDEX CONCURRENTLY` or
  `CREATE UNIQUE INDEX CONCURRENTLY`, including on new tables. PostgreSQL
  rejects concurrent index builds inside a transaction or a multi-command
  string, so each one gets its own single-statement migration file.

## Commands

```bash
make dev              # db-up + migrate + server + web
make test             # Go tests
make e2e              # Playwright (needs make dev running)
pnpm typecheck
pnpm test
pnpm lint
pnpm ui:add <name>    # add a shadcn primitive into packages/ui
```

## Coding Rules

- TypeScript strict mode; keep types explicit.
- Go follows `gofmt`, `go vet`, checked errors.
- **Code comments in English.** Spec and plan documents are in Vietnamese.
- Prefer existing patterns over new parallel abstractions.
- Do not claim verification passed unless you ran it. If you skipped checks,
  say so.
```

- [ ] **Step 2: Kiểm chứng từng luật trong file bằng lệnh thật**

Run:
```bash
cd /Users/phanducquang/Work/AIFactory/uniwork
# Ranh giới thật sự là lỗi lint?
pnpm lint && echo "lint OK"
# Các lệnh liệt kê có tồn tại?
grep -E '^(dev|test|e2e):' Makefile
node -e 'const p=require("./package.json");for(const s of ["typecheck","test","lint","ui:add"]) if(!p.scripts[s]) throw new Error("missing script: "+s); console.log("scripts OK")'
# tokens.css đúng là nguồn duy nhất?
grep -c "@theme inline" packages/ui/styles/tokens.css
grep -c "@theme inline" apps/web/app/globals.css
```
Expected: `lint OK`; Makefile có cả ba target; `scripts OK`; `tokens.css` trả `1` và `globals.css` trả `0`.

Bất kỳ dòng nào trong CLAUDE.md không qua được bước này thì **xoá dòng đó**, đừng sửa thực tế cho vừa văn bản.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: draft CLAUDE.md with the rules that already hold"
```

---

## Cổng ra của Plan 1

Chạy trọn bộ trước khi tuyên bố xong:

```bash
cd /Users/phanducquang/Work/AIFactory/uniwork
pnpm install
pnpm typecheck
pnpm test
pnpm lint
bash scripts/turbo-cache-check.sh
node --test scripts/catalog-check.test.mjs
pnpm --filter @uniwork/web build
# terminal khác: make dev
pnpm --filter @uniwork/e2e test
```

Tất cả phải xanh, **gồm cả 6 spec e2e**. Nếu spec contrast đỏ, ánh xạ token ở Task 7 sai — sửa ánh xạ, không sửa spec.

## Sang plan tiếp theo

Plan 2 (sweep Tầng 1 FE) chỉ bắt đầu khi Plan 1 xanh toàn bộ. Nó phụ thuộc trực tiếp vào: catalog ở Task 2, luật ranh giới ở Task 4, lớp slot token ở Task 7, và `components.json` ở Task 8.

---

## Ghi chép thực thi (2026-08-25)

Hoàn tất trên nhánh `feat/base-port-phase-0-1`, 9 commit, toàn bộ cổng ra xanh
(gồm 13/13 spec e2e). Ba chỗ plan đoán sai, đã sửa trong lúc làm — ghi lại vì
Plan 2–6 dựa trên chính các giả định này.

### 1. `import-x/no-extraneous-dependencies` không bắt cái tôi tưởng

Plan viết fixture import `zustand` (không khai báo) và kỳ vọng rule bắn. Nó
không bắn: rule chỉ báo lỗi khi module **resolve được** nhưng thiếu khai báo.
Dưới layout strict của pnpm, `packages/ui/node_modules` chỉ chứa đúng dependency
đã khai, nên `zustand` không resolve nổi — và ca đó **tsc đã bắt rồi**.

Giá trị thật của rule là ca khác: **devDependency bị import từ code production**
(ship được trong monorepo, vỡ với người cài không kèm dev deps). Fixture đã đổi
sang ca đó và rule bắn đúng. Comment trong `base.js` đã viết lại cho khớp.

### 2. Slot trỏ `var(--uw-*)` **không** tự theo palette dark

Đây là lỗi nghiêm trọng nhất, và chỉ e2e bắt được.

Plan viết: "mọi slot đều trỏ qua `var(--uw-*)` và khối `.dark` đã định nghĩa lại
toàn bộ `--uw-*`, nên phần lớn slot **tự động** đúng ở dark". Sai. Custom
property được **tính rồi kế thừa**: `--foreground: var(--uw-text-primary)` khai
ở `:root` được resolve **tại `:root`** ra giá trị sáng, và giá trị đã tính đó kế
thừa xuống mọi subtree `.dark`. Định nghĩa lại `--uw-text-primary` trong `.dark`
không với tới nó.

Hậu quả đo được: rail onboarding (panel tối lồng trong trang sáng) render tiêu
đề ở **1.03:1** — chữ gần như tàng hình. Typecheck, lint, unit test, `next build`
đều xanh; chỉ `onboarding-contrast.spec.ts` thấy.

Sửa: khai lại trọn 42 slot có màu dưới `.dark`. Và sửa luôn test — bản plan viết
đã **mã hoá chính giả định sai đó** (miễn trừ giá trị `var()`); nay test đòi mọi
token phải có ở cả hai khối, chỉ miễn `--radius` và hai token cố ý một-theme.

**Áp cho Plan 2:** mọi token thêm vào khi port 62 primitive phải có mặt ở cả
`:root` và `.dark`. Không tin vào indirection.

### 3. Xung đột alias hẹp hơn nhiều so với plan lo

Plan cảnh báo `primary`/`secondary`/`tertiary`. Đối chiếu giá trị thực tế: chỉ
**`secondary`** xung đột thật (`#52525b` màu chữ ↔ `#f4f4f5` nền mờ). `primary`,
`surface`, `brand`, `success`, `warning` trùng tên nhưng trùng luôn giá trị;
`tertiary` không có slot shadcn cùng tên. Đã đổi 56 chỗ dùng sang
`-text-secondary`, và trỏ 5 alias trùng-giá-trị sang slot mới để chúng sống sót
khi lớp `--uw-*` bị xoá.

### Việc phát sinh ngoài plan

- **Nợ `process.env` trong `packages/core`** — luật ranh giới ở Task 4 bắt được
  ngay 3 chỗ (`api/client.ts`, `config.ts`, `realtime/use-workspace-events.ts`).
  Sửa theo khuôn usf (core ở đó có **0** chỗ đọc env): thêm
  `packages/core/runtime-config.ts` và `apps/web/platform/runtime-config.ts`.
  Đây là hạt giống của lớp platform mà Plan 4 sẽ mở rộng.
- **`paths` trong `packages/ui/tsconfig.json`** — thiếu nó thì shadcn CLI từ chối
  chạy. usf có sẵn; uniwork thì không. Đã thêm.
- **`@custom-variant dark`** — thêm vào `globals.css`. Repo hiện có 0 class
  `dark:` nên nó bất biến hôm nay; 62 primitive của usf dùng 81 chỗ nên Plan 2
  cần nó.
- **Hai lỗi công cụ vặt** — `import.meta.url` không phải file: URL dưới jsdom
  (đọc token qua `process.cwd()`); BSD sed trên macOS không hỗ trợ `\b` (dùng
  perl cho các lần đổi tên hàng loạt).

### Lưu ý môi trường

`make dev` chạy đè cổng khi anh đã có stack sẵn (8090/3000), và Next 16 từ chối
mở dev server thứ hai cùng thư mục. e2e trong đợt này chạy trên stack sẵn có,
sau khi đã kiểm chứng CSS server phục vụ chứa slot mới (tức HMR đã bắt kịp) —
nếu không thì kết quả contrast là pass giả.
