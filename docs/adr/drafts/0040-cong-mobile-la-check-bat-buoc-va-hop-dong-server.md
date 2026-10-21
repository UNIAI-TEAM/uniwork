# 0040 — Cổng mobile là check bắt buộc, và PR đổi hợp đồng server chạy test mobile

**Trạng thái:** proposed (UNI-2053, 2026-10-22). Số 0040 là tạm, đổi nếu ADR khác land trước. Code đã land cùng
bản nháp (job `gate` của `mobile-verify.yml`, `scripts/branch-protection.json`); quyết định chỉ có hiệu lực khi
owner bật branch protection (`node scripts/branch-protection.mjs --apply`). Chấp nhận thì chuyển ra `docs/adr/`,
thêm vào bảng của `README.md`, đưa luật vào `CLAUDE.md` kèm test giữ luật.
**Liên quan:** [0011](../0011-mobile-la-app-expo-doc-lap.md) §6 (mobile không chặn PR web/backend),
[0037](../0037-cong-chat-luong-mobile-chan-o-moi-muc.md) (cổng mobile chặn ở mọi `GATE_LEVEL`).

## Bối cảnh

Bản audit mobile 2026-10-22 (chiều "Kiểm thử & quality gates", 5.5/10) tìm ra ba lỗ:

1. `main` và `develop` không có branch protection (`gh api …/protection` trả 404, rulesets rỗng). ADR 0037 nói cổng
   mobile "chặn ở mọi mức", nhưng không gì bắt một run đỏ phải xanh trước khi merge.
2. Require từng job không đủ: GitHub coi job bị skip (vì `if:`) là thành công, nên một job `scope` hỏng làm skip bản
   build native và PR vẫn xanh; còn workflow bị path filter chặn không chạy thì check bắt buộc treo `pending` mãi.
3. `data/realtime/frames.test.ts` đọc `docs/events/CATALOGUE.md`, và schema của app đọc response của Go, nhưng
   `mobile-verify.yml` không chạy khi chỉ server đổi: PR backend đổi tên một trường làm app hỏng âm thầm tới PR mobile
   kế tiếp.

## Quyết định

1. Check bắt buộc của `main`/`develop` ghi ở `scripts/branch-protection.json`; `scripts/branch-protection.mjs` áp nó
   bằng API của GitHub (chỉ admin chạy, CI không chạy). `scripts/branch-protection.test.mjs` giữ để mỗi tên là một job
   có thật, chạy ở mọi PR vào hai nhánh, không bị path filter, không phải matrix.
2. Mobile có đúng một check bắt buộc: job `gate` (`UniChat mobile gate`) của `mobile-verify.yml`, chạy `if: always()`
   sau mọi job khác và đỏ khi một job mà thay đổi cần (theo output `mobile`/`native` của `scope`) không `success`
   (`scripts/mobile-verify-gate.mjs`).
3. `mobile-verify.yml` chạy ở mọi PR, không path filter; job `scope` quyết phần việc. `mobile=true` khi thay đổi chạm
   `MOBILE_PATHS` của `scripts/mobile-native-scope.mjs`, gồm cả hợp đồng phía server mà test của app đọc
   (`docs/events/CATALOGUE.md`, `server/internal/handler/dto/sdo/**`).

## Hệ quả

Được: một run mobile đỏ không merge được; một PR server làm lệch hợp đồng với app đỏ ngay ở PR đó.

Mất: điểm 3 thu hẹp §6 của ADR 0011. PR backend chỉ chạm catalogue hay SDO giờ chạy typecheck, lint và test của app
(khoảng 10 phút) và có thể bị chặn bởi chúng; PR không chạm `MOBILE_PATHS` chỉ trả hai job nhỏ (`scope`, `gate`). Giá
này đúng chỗ như ADR 0037 đã nói về `packages/core`: PR làm lệch hai bên là PR phải sửa.
