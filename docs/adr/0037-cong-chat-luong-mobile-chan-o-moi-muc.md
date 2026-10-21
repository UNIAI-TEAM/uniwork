# 0037 — Cổng chất lượng của `apps/chat-mobile` chặn ở mọi `GATE_LEVEL`

**Trạng thái:** accepted (2026-10-21) — chủ sản phẩm yêu cầu đưa UniChat mobile lên mức 8/10
(UNI-2053); bản audit cùng ngày chỉ ra ngưỡng coverage 100% của app đã tụt xuống 99.62% mà không
ai thấy. Bổ sung cho [0014](0014-coverage-va-lint-la-canh-bao-o-gate-level-fast.md), không thay nó.

## Bối cảnh

ADR 0014 cho phép, ở `GATE_LEVEL=fast`, một gói TypeScript dưới sàn coverage in số rồi pass, để
một vùng code đang dở không làm cả `develop` đỏ. `apps/chat-mobile/vitest.config.ts` đọc sàn qua
`scripts/coverage-gate.ts` như mọi gói khác, nên ở `fast` ngưỡng 100/100/100/100 của nó cũng không
được truyền cho vitest.

Ngày 2026-10-21 chạy lại với `GATE_LEVEL=strict` thì app đỏ ở 99.62% statements, 99.4% branches,
98.66% functions: tám file `lib/` và `data/` có nhánh hoặc hàm không test nào chạm, có cái là code
chết phòng thủ. Không ai thấy vì `mobile-verify.yml` chạy ở `fast` và in số.

Lý do của 0014 không áp vào app này. Mobile đã tách khỏi CI chính (ADR 0011): `mobile-verify.yml`
chỉ chạy khi PR chạm app hoặc thứ app import, nên một sàn mobile đỏ không chặn PR web hay backend
nào. Lint của app cũng đã chặn ở mọi mức (`eslint . --max-warnings 0`, không qua
`scripts/lint-gate.sh`). Còn thứ mà app này giao cho người dùng thì không vá được bằng một bản deploy
sau mười phút: một lỗi đã vào binary trên store sống tới bản tiếp theo được duyệt.

## Quyết định

1. `apps/chat-mobile/vitest.config.ts` truyền thẳng ngưỡng `100/100/100/100` cho vitest, không qua
   `coverageThresholds()`. Một file mới trong phạm vi coverage (`lib/**`, `data/**`) đến cùng test của
   nó, ở mọi mức.
2. Phạm vi `exclude` chỉ giữ các file nối vào runtime native (AppState, NetInfo, socket, LiveKit) mà
   môi trường node không chạy được; mỗi dòng ghi lý do. Không loại một file để qua sàn.
3. Nhánh không thể xảy ra thì xoá hoặc viết lại cho kiểu nói đúng, không thêm `v8 ignore`.
4. Lớp test component (jest-expo, `*.test.tsx`) có sàn riêng trong `jest.config.js`, đo trên các
   file nó phủ, và cũng chặn ở mọi mức; sàn chỉ đi lên theo luật chung.

## Hệ quả

Được: con số 100% trong config lại là sự thật, và người viết code mobile thấy đỏ ngay ở PR của mình
thay vì ở lượt dọn trước khi lên `standard`.

Mất: một thay đổi ở `packages/core` làm đổi hành vi của một hàm mobile copy lại có thể làm đỏ
`mobile-verify.yml` cho tác giả của PR core đó. Cái giá này đã có từ trước với typecheck và lint của
app; nó đúng chỗ, vì đó chính là PR làm lệch hai bên.

`scripts/governance.test.mjs` không đổi: nó vẫn giữ việc `scripts/coverage-gate.ts` đọc
`GATE_LEVEL` cho các gói còn lại.
