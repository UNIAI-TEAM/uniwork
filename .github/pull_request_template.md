## UniAI

Issue: UNI-___ <!-- bắt buộc; workflow uniai-link chặn PR thiếu mã. make issue-pr KEY=UNI-123 điền sẵn. -->

## Thay đổi gì

<!-- Một đoạn: thay đổi này làm gì, và tại sao. Phần "tại sao" quan trọng hơn. -->

## Đã cố ý bỏ ra ngoài

<!-- Thứ bạn đã cân nhắc rồi quyết định không làm trong PR này, kèm lý do.
     Để trống nếu không có. -->

## Kiểm chứng

<!-- Ghi lệnh đã CHẠY THẬT, không phải lệnh lẽ ra nên chạy.
     CLAUDE.md § Verification: không tuyên bố đã kiểm nếu chưa chạy. -->

- [ ] `make check` xanh (typecheck → lint → unit + contract → Go -race → Playwright)
- [ ] Nếu bỏ qua bước nào, đã nói rõ bước nào và vì sao:

## Checklist theo vùng chạm tới

<!-- Chỉ tick dòng thuộc vùng PR này chạm vào; xoá phần còn lại. -->

- [ ] **Endpoint mới/đổi** — có schema, có `parseWithFallback`, và có case
      malformed-response trong `api/endpoints/<domain>.test.ts`
- [ ] **Migration** — không FK/cascade, index đứng một mình với `CONCURRENTLY`,
      có file `.down.sql`
- [ ] **Màn hình dùng chung** — nằm ở `packages/views/`, dùng header của shell,
      mọi chuỗi qua `t()`, có khoá ở cả `vi.json` lẫn `en.json`
- [ ] **Đổi màu/token** — khai ở cả `:root` và `.dark`, đã kiểm tương phản ở cả
      hai chế độ bằng `e2e/onboarding-contrast.spec.ts`
- [ ] **Đổi hành vi** — test thất bại được viết trước, ở đúng package
- [ ] **Reserved slug** — đã chạy `pnpm generate:reserved-slugs` và commit file sinh ra
