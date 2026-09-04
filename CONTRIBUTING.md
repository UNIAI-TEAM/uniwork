# Đóng góp vào UniWork

Tài liệu này dành cho **người**. Luật kỹ thuật đầy đủ nằm ở
[`CLAUDE.md`](CLAUDE.md) — `AGENTS.md` là symlink tới chính file đó, nên agent
và người đọc cùng một bộ luật. Trang này chỉ nói: vào việc thế nào, và cái gì
sẽ chặn bạn lại.

## 1. Vào việc

```sh
corepack enable          # pnpm lấy version từ package.json
make doctor              # Node / Go / pnpm / Docker / hook có đúng không
make dev                 # tạo .env, cài deps, dựng DB, migrate, chạy cả hai service
```

`make doctor` đọc version từ chính file giữ nó — `.nvmrc`, `server/go.mod`,
`packageManager` trong `package.json`. Không có bảng version chép tay ở đâu cả.

`make help` liệt kê mọi target. Chạy nhiều nhánh song song thì mỗi git worktree
có DB và cổng riêng: `make worktree-env && make setup-worktree`.

## 2. Đọc gì trước khi sửa

| Bạn sắp làm gì | Đọc trước |
| --- | --- |
| Bất cứ việc gì | [`CLAUDE.md`](CLAUDE.md) |
| Thắc mắc "sao lại cấm X" | [`docs/adr/`](docs/adr/README.md) |
| Đặt tên route/package/file/cột DB/type | [`docs/conventions.md`](docs/conventions.md) § 1 |
| Thêm / sửa HTTP API (SDI, SDO, Swagger) | [`docs/api-sdi-sdo.md`](docs/api-sdi-sdo.md) |
| Sửa `packages/core/i18n/locales/` | `docs/conventions.md` § 2 (glossary vi–en) |
| Viết chữ tiếng Việt lên UI | `docs/conventions.md` § 3 (giọng văn) |
| Hiểu vì sao sản phẩm tồn tại | [`PRODUCT.md`](PRODUCT.md) |
| Hiểu vì sao xây lại và đích đến | [`docs/vision/PROJECT_VISION.md`](docs/vision/PROJECT_VISION.md) |
| Chọn việc gì làm tiếp, spec nào bám theo | [`docs/roadmap/FEATURE_ROADMAP.md`](docs/roadmap/FEATURE_ROADMAP.md) |
| Xem bản cũ (Lovable) làm gì | [`docs/roadmap/LEGACY_REFERENCE_MAP.md`](docs/roadmap/LEGACY_REFERENCE_MAP.md) |
| Đi từ roadmap đến release | [`docs/engineering/FEATURE_WORKFLOW.md`](docs/engineering/FEATURE_WORKFLOW.md) |
| Biết khi nào được gọi là xong | [`docs/engineering/DEFINITION_OF_DONE.md`](docs/engineering/DEFINITION_OF_DONE.md) |
| Nhận việc, mở PR, đóng việc trên UniAI | [`docs/engineering/UNIAI_TRACKING.md`](docs/engineering/UNIAI_TRACKING.md) (`make issue-start`, `make issue-pr`, `make issue-done`) |

Đừng đọc lướt CLAUDE.md. Mỗi luật trong đó đều có tên một test, một lint rule
hoặc một lệnh đứng cạnh — biết luật nào chặn mình sẽ nhanh hơn là để CI nói.

## 3. Cái gì sẽ chặn bạn

Ba tầng, từ nhanh tới chậm:

**Lúc commit** (`.githooks/`, tự nối qua `pnpm install`)

- không commit được file `.env`
- file Go phải `gofmt`
- lint + typecheck cho đúng những workspace bạn chạm vào
- commit message phải theo prefix trong `CLAUDE.md` § Commits

Bỏ qua bằng `git commit --no-verify` — nhưng khi đó `make check` trước khi push
là bắt buộc, không phải tuỳ chọn.

**Lúc chạy `make check`**

typecheck → lint → unit + contract test → Go (`-race`) → Playwright.
Đây là cổng đầy đủ. Chạy nó trước khi mở PR.

**Lúc CI chạy** (`.github/workflows/ci.yml`)

Tất cả những gì `make check` chạy, cộng thêm `pnpm audit`, `govulncheck` và
gitleaks. Job `e2e` tự dựng server + bản build production của web rồi chạy
Playwright — spec đỏ trên CI là chặn merge, không phải "chạy lại ở máy tôi".

## 4. Ranh giới package là lỗi lint, không phải quy ước

Đây là chỗ người mới hay vấp nhất. `pnpm lint` chạy với `--max-warnings 0`:

- `packages/core/` — không `react-dom`, không `localStorage`, không `process.env`
- `packages/ui/` — không import `@uniwork/core`
- `packages/views/` — không `next/*`, không `react-router-dom`, không
  `window.location`; điều hướng qua `useNavigation()` / `<AppLink>`
- mọi chuỗi hiện trên UI trong `packages/views/` phải qua `t()`

Mỗi rule đều kèm message giải thích *tại sao*. Đọc message trước khi tìm cách
đi vòng — nếu ranh giới thật sự sai, sửa ranh giới và nói rõ trong PR, đừng
thêm ngoại lệ im lặng.

## 5. Commit và PR

Prefix: `feat(scope)`, `fix(scope)`, `refactor(scope)`, `test(scope)`, `docs`,
`chore(scope)`, `ci`, `style(scope)`. Hook `commit-msg` từ chối thứ khác.

Commit nhỏ, gom theo ý định. Phần thân commit mang **lý do** và **thứ đã cố ý
không làm** — không mô tả lại diff, diff tự nói được.

Mở PR thì template tự hiện. Mục "Kiểm chứng" ghi lệnh **đã chạy thật**. Bỏ qua
bước nào thì nói bỏ qua bước nào — báo cáo sai còn tệ hơn kiểm thiếu.

## 6. Viết test trước, khi thay đổi là hành vi

Test thất bại viết trước, đặt đúng package:

| Thứ được kiểm | Chỗ đặt |
| --- | --- |
| Logic dùng chung, store, endpoint, hook | `packages/core/**/*.test.ts(x)` |
| Màn hình, component dùng chung | `packages/views/**/*.test.tsx` |
| Primitive, token | `packages/ui/**/*.test.ts(x)` |
| Hợp đồng toàn repo | `scripts/*.test.mjs` |
| Luồng end-to-end | `e2e/*.spec.ts` |
| Backend | `server/**/*_test.go` |

Năm spec e2e onboarding (contrast, focus, mobile, shell, smoke) là hợp đồng
chống hồi quy. Chúng đỏ thì sửa component, không sửa spec.

## 7. Báo lỗi bảo mật

Đừng mở issue công khai. Xem [`SECURITY.md`](SECURITY.md).
