# 0005 — Task hash-only `cache-inputs` trong turbo

**Trạng thái:** accepted (2026-08-26)

## Bối cảnh

Turbo chỉ đưa source của workspace phụ thuộc vào hash khi có một cạnh task
tới nó. `test` không phụ thuộc `^build` (package export `.ts` thô), nên sửa
`packages/ui` để `@uniwork/views#test` giữ nguyên hash — cache trả lại một
lần pass cũ trên code đã đổi.

## Quyết định

Task `cache-inputs` không có script ở package nào (mọi node là
`<NONEXISTENT>`, không chạy gì) nhưng `dependsOn: ["^cache-inputs"]` kéo hash
source của dependency vào. `test` phụ thuộc `^cache-inputs`.
`.github/workflows/ci.yml` nằm trong `globalDependencies` để bump toolchain
cũng đổi hash. `scripts/turbo-cache-check.sh` chứng minh điều này mỗi lần CI.

## Hệ quả

- Không bao giờ thêm script tên `cache-inputs` vào package.
- `^typecheck` cũng làm được nhưng kéo `tsc` thật vào job test; `^test` thì
  tuần tự hoá suite. Đã cân nhắc, không chọn.
