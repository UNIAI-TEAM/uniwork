# Mức cổng quy trình — `GATE_LEVEL`

> **Trạng thái:** shipped · **Áp dụng từ:** 2026-09-05 · **Cho:** mọi người và mọi agent (ADR 0006)

Một bộ luật, ba mức siết. Mức hiện tại là **một từ trong file `GATE_LEVEL`** ở
gốc repo: `fast`, `standard` hoặc `strict`. Mọi cổng đọc file đó; đổi mức là một PR
sửa file đó, thân commit nói vì sao, và người merge là chủ sở hữu sản phẩm hoặc kiến
trúc sư trưởng. `make gate` in mức hiện tại. Từ nào không phải ba từ trên thì mọi cổng
coi là `strict`: gõ nhầm chỉ có thể siết, không thể nới.

Ghi đè cho một lần chạy bằng biến môi trường: `GATE_LEVEL=strict make check`
(`make check-full` là cách viết ngắn). Biến môi trường không ảnh hưởng CI.

## Mức nào cho giai đoạn nào

| Mức | Khi nào | Dấu hiệu để chuyển |
| --- | --- | --- |
| `fast` | Xây nền, chưa có tổ chức ngoài UNICOM dùng thật; ưu tiên tốc độ ghép tính năng | chuyển lên `standard` khi có org thật trên staging, hoặc khi hai PR liên tiếp bị đỏ e2e sau merge |
| `standard` | Có người dùng thật; luật `CLAUDE.md` đúng như đã viết | chuyển lên `strict` khi có tenant trả tiền hoặc trước audit bảo mật; xuống `fast` chỉ khi mở một vùng sản phẩm mới hoàn toàn trên nhánh riêng |
| `strict` | Production có nhiều tenant, hoặc tuần trước release lớn | xuống `standard` sau release ổn định |

## Cổng nào đổi theo mức

| Cổng | `fast` | `standard` | `strict` | Đọc mức ở |
| --- | --- | --- | --- | --- |
| Hook `pre-commit` | chỉ chặn `.env` + `gofmt` | thêm lint + typecheck workspace chạm tới | như standard | `.githooks/pre-commit` |
| `make check` | dừng sau Go tests, không E2E | đủ 6 bước gồm E2E | như standard | `scripts/check.sh` |
| Job `e2e` trên CI | chỉ khi push vào `develop`/`main` | mọi PR và push | như standard | `.github/workflows/ci.yml` |
| PR thiếu `UNI-nnn` | fail, trừ nhãn `no-issue` | fail, trừ nhãn `no-issue` | fail, nhãn không cứu | `.github/workflows/uniai-link.yml` |
| Ô DoD reviewer tick | 4 ô đánh dấu `fast` | đủ 10 ô | 10 ô, và review từ CODEOWNERS | `docs/engineering/DEFINITION_OF_DONE.md` |
| Spec + plan trước khi code | khuyến nghị; issue là đủ | bắt buộc (DoD ô 10) | bắt buộc | `docs/engineering/FEATURE_WORKFLOW.md` |

## Không nới ở mức nào

Đây là an toàn dữ liệu, không phải quy trình. Chúng không đọc `GATE_LEVEL` và không
có cờ tắt:

- Từ chối commit file `.env`; gitleaks trên CI.
- `server/migrations/lint_test.go`: không FK/cascade, index `CONCURRENTLY`, có `.down.sql`,
  bảng mới có `organization_id NOT NULL`.
- `server/internal/arch_test.go`: layering, membership chỉ qua `RequireMember`, chỉ
  `internal/audit` ghi audit/outbox; `TestAuditEventsAreAppendOnly`.
- `audit_coverage_test.go`, `events-catalogue.test.mjs`, `parity.test.ts`, boundary lint.
- Coverage floor không giảm.
- Hook `commit-msg`: prefix rẻ, lịch sử sạch là thứ khó lấy lại.
- `pnpm audit`, `govulncheck`.
- Agent không được `--no-verify` (`.claude/hooks/block-no-verify.sh`).

Muốn nới một trong số này là một ADR, không phải một mức.

## Đổi mức như thế nào

1. `make issue-new TITLE="GATE_LEVEL → standard: <lý do>"`, `make issue-start`.
2. Sửa `GATE_LEVEL`, một từ, xuống dòng cuối.
3. Thân commit: vì sao đổi, dấu hiệu nào đã đến, dự kiến giữ mức này đến khi nào.
4. `make issue-pr`; người merge là chủ sở hữu sản phẩm hoặc kiến trúc sư trưởng.

Siết lên (`fast → standard → strict`) có thể merge ngay. Nới xuống cần một dòng trong
`docs/roadmap/FEATURE_ROADMAP.md` nói giai đoạn nào đang mở, để nới có ngày hết hạn.

`scripts/governance.test.mjs` kiểm: file là một trong ba từ; mỗi cổng trong bảng trên
thật sự đọc `GATE_LEVEL`; trang này và `CLAUDE.md` cùng nêu ba mức.
