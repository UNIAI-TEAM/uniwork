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
| Cờ `-race` của job `backend-test` trên CI | chỉ khi push vào `develop`/`main` | mọi PR và push | như standard | `.github/workflows/ci.yml` |
| Ngân sách bundle trên CI | đo và cảnh báo, không chặn | chặn khi vượt trần | như standard | `.github/workflows/ci.yml` |
| Sàn coverage TypeScript | in số, không chặn | chặn khi tụt dưới ngưỡng | như standard | `scripts/coverage-gate.ts` |
| `pnpm lint` | in phát hiện, không chặn | lỗi lint chặn | như standard | `scripts/lint-gate.sh` |
| PR thiếu `UNI-nnn` | fail, trừ nhãn `no-issue` | fail, trừ nhãn `no-issue` | fail, nhãn không cứu | `.github/workflows/uniai-link.yml` |
| Ô DoD reviewer tick | 4 ô đánh dấu `fast` | đủ 10 ô | 10 ô, và review từ CODEOWNERS | `docs/engineering/DEFINITION_OF_DONE.md` |
| Spec + plan trước khi code | khuyến nghị; issue là đủ | bắt buộc (DoD ô 10) | bắt buộc | `docs/engineering/FEATURE_WORKFLOW.md` |

Dòng `e2e` và dòng `-race` nới cùng một cách và hết hạn cùng một lúc: ở `fast`, một PR chạy
bộ Go không có race detector, còn lần push vào `develop` ngay sau khi merge vẫn chạy
đủ `-race`. Không có nhánh nào vào được `develop` mà chưa từng qua race detector, chỉ
là qua sau khi merge chứ không phải trước. Lên `standard` là mọi PR chạy lại `-race`,
không cần sửa gì thêm.

Ngân sách bundle nới khác hai dòng kia: ở `fast` nó vẫn đo đủ, vẫn in bảng từng
route vào job summary và vẫn gắn annotation cho route vượt trần, chỉ là không
đánh đỏ lần chạy. Lý do là con số hiện tại gần như hết dư địa — initial JS
246/250 KB, `/people` 149.4/150 KB — nên mỗi component dùng chung mới lại chặn
merge, trong khi cái đang cần ở giai đoạn `fast` là ghép tính năng. Trần trong
`scripts/bundle-budget.json` vẫn chỉ được hạ, không được nâng; lên `standard` là
chặn lại như cũ, và trước khi lên mức đó phải có một lượt dọn bundle, vì bảng
trong job summary sẽ cho biết đã trôi bao xa.

Sàn coverage TypeScript và `pnpm lint` nới cùng kiểu với ngân sách bundle: đo đủ,
in đủ, không đánh đỏ. Lý do và cái giá ở `docs/adr/0014-coverage-va-lint-la-canh-bao-o-gate-level-fast.md`
— phải là ADR vì nó chạm vào một dòng trong mục dưới đây. Không rule lint nào bị
đổi mức và không con số coverage nào bị hạ; chỉ mã thoát đổi. Điều kiện để lên
`standard`: hai gói `core` và `views` trở lại trên sàn, và bốn lỗi lint trong
`packages/views/editor/` hết.

Job `backend-test` chia bộ Go thành ba shard (`service`, `handler`, `rest`), mỗi shard
một database riêng, vì `server/internal/testutil` nối tiếp mọi test DB sau một advisory
lock: hai package dùng chung một database thì cộng thời gian chứ không chồng lên nhau.
Đó là tách để chạy song song, không phải nới — cả ba shard cộng lại vẫn là `./...`, và
sàn coverage đọc trên profile đã gộp trong job `backend` (`scripts/go-cover-floor.sh`).

## Không nới ở mức nào

Đây là an toàn dữ liệu, không phải quy trình. Chúng không đọc `GATE_LEVEL` và không
có cờ tắt:

- Từ chối commit file `.env`; gitleaks trên CI.
- `server/migrations/lint_test.go`: không FK/cascade, index `CONCURRENTLY`, có `.down.sql`,
  bảng mới có `organization_id NOT NULL`.
- `server/internal/arch_test.go`: layering, membership chỉ qua `RequireMember`, chỉ
  `internal/audit` ghi audit/outbox; `TestAuditEventsAreAppendOnly`.
- `audit_coverage_test.go`, `events-catalogue.test.mjs`, `parity.test.ts`, boundary lint.
- Coverage floor không giảm — con số không bao giờ đi xuống. Ở `fast` một cú tụt
  dưới ngưỡng TypeScript in ra rồi cho qua thay vì đánh đỏ (ADR 0014); ngưỡng
  vẫn nguyên, và sàn coverage Go chặn ở mọi mức.
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
