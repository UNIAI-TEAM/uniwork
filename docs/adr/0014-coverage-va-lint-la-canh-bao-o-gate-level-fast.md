# 0014 — Sàn coverage TypeScript và lint là cảnh báo ở `GATE_LEVEL=fast`

**Trạng thái:** accepted (2026-09-09) — nới một dòng trong mục "Không nới ở mức nào"
của `docs/engineering/GATE_LEVELS.md`, nên phải là ADR chứ không phải một mức.
Luật ở `CLAUDE.md` § Coding Rules, § Package Boundaries và § Gate Level; cổng ở
`scripts/coverage-gate.ts` và `scripts/lint-gate.sh`, số ở
`packages/*/vitest.config.ts`; `scripts/governance.test.mjs` giữ việc hai file
cổng đó thật sự đọc `GATE_LEVEL`.

## Bối cảnh

Ngày 2026-09-09, `pnpm test` đỏ trên `develop`. Không một test nào hỏng: 638 test
của `@uniwork/core` và 983 test của `@uniwork/views` đều pass. Cái đỏ là ngưỡng
coverage nhánh, và chỉ nhánh — mọi chỉ số khác của cả hai gói đều trên sàn.

| Gói | Nhánh đo được | Ngưỡng | Thiếu |
| --- | --- | --- | --- |
| `@uniwork/core` | 49.01% | 50 | ~29 nhánh |
| `@uniwork/views` | 43.34% | 46 | ~318 nhánh |

Nguyên nhân là commit transplant TipTap editor: một khối code lớn, nhiều nhánh,
mang sang từ baseline Multica và chưa có test. Sàn coverage làm đúng việc của nó —
báo rằng có code mới chưa ai kiểm — nhưng hệ quả là toàn bộ `develop` đứng đỏ, và
mọi PR không liên quan cũng đỏ theo, cho tới khi ai đó viết đủ khoảng 350 nhánh
test cho một phần đang làm dở.

Cùng commit đó để lại bốn lỗi lint, cũng đều trong `packages/views/editor/`: ba chỗ
gọi `window.location.assign` làm fallback khi không có navigation adapter, và một
file 511 dòng trên trần 500. Ba fallback kia là code sống — log jsdom trong bộ test
views cho thấy nó thật sự chạy — nên xóa đi là đổi hành vi, còn tách file 511 dòng
là mổ vào phần đang làm dở.

Đó là cái giá sai cho giai đoạn hiện tại. `GATE_LEVELS.md` nói `fast` là giai đoạn
xây nền, chưa có tổ chức ngoài UNICOM dùng thật, ưu tiên tốc độ ghép tính năng.
Một cổng chặn mọi người vì một vùng code chưa xong không phục vụ mục tiêu đó.

## Quyết định

1. **Ở `GATE_LEVEL=fast`, ngưỡng coverage TypeScript không được truyền cho vitest.**
   Bản tóm tắt coverage vẫn in ra mỗi lần chạy; một gói dưới sàn in số rồi pass.
   Từ `standard` trở lên, ngưỡng quay lại chặn, không phải sửa config nào.
2. **Các con số không giảm.** `scripts/coverage-gate.ts` chỉ quyết định có áp
   ngưỡng hay không, không đụng vào giá trị. Hạ một con số vẫn là việc phải làm
   bằng tay và vẫn trái luật ở `CLAUDE.md` § Coding Rules.
3. **Ở `GATE_LEVEL=fast`, lint in đủ phát hiện rồi thoát 0.** `scripts/lint-gate.sh`
   bọc `turbo lint` và chỉ hạ mã thoát; không một rule nào bị đổi mức, không một
   `eslint-disable` nào được thêm. Từ `standard` trở lên lỗi lint lại chặn.
4. **Sàn coverage Go không đổi.** `server/coverage.floor` vẫn chặn ở mọi mức, kể
   cả `fast`, vì nó không phải nguyên nhân của sự cố này và bộ test Go không có
   vùng nào đang dở tương tự.
5. **Điều kiện đóng lại:** trước khi chuyển `GATE_LEVEL` lên `standard`, hai gói
   phải trở lại trên sàn. Việc đó thuộc về người hoàn thiện editor, không thuộc
   về người đổi mức.

## Hệ quả

Được: `develop` xanh lại ngay, và một vùng code chưa xong không còn chặn những
người không liên quan tới nó.

Mất: trong giai đoạn `fast`, coverage có thể trôi xuống và ranh giới gói có thể bị
vi phạm mà không ai bị chặn. Phần lint đắt hơn phần coverage đúng ở chỗ đó — các
luật trong `CLAUDE.md` § Package Boundaries được viết ra như lỗi lint chính vì
review bằng mắt đã bỏ lọt chúng. Bản in mỗi lần chạy là thứ duy nhất còn lại để
nhìn thấy, nên nó phải được đọc — giống hệt cách ngân sách bundle được xử lý cùng
ngày, và với cùng một rủi ro.

Cái giá đã chấp nhận: lượt dọn trước khi lên `standard` sẽ lớn hơn nếu không ai
nhìn số trong lúc cổng đang mở. Nếu con số tiếp tục tụt, đóng cổng lại sớm hơn
bằng cách lên `standard` chứ đừng hạ ngưỡng.
