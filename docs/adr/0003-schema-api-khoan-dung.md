# 0003 — Schema API phía client khoan dung, `parseWithFallback`

**Trạng thái:** accepted (2026-08-25)

## Bối cảnh

Backend và frontend deploy lệch nhau. Một enum mới hoặc một field đổi kiểu ở
server không được làm trắng màn hình client cũ. Cast `as T` thì im lặng sai;
zod strict thì throw ở chỗ người dùng không làm gì sai.

## Quyết định

Transport (`packages/core/api/http.ts`) trả `unknown`. Chỉ
`api/endpoints/*` định hình response, qua `parseWithFallback(raw, schema,
fallback, { endpoint })`. Enum server parse là `z.string()`, type export thu
hẹp lại; `switch` luôn có `default`. Mỗi endpoint có một test
malformed-response. Ngoại lệ cố ý: login, register, complete-onboarding —
không có session để bắt đầu nếu chúng hỏng, nên chúng fail to.

## Hệ quả

- Thêm endpoint = thêm hàm + schema + test malformed, không có ngoại lệ.
- UI phải optional-chain field từ server; lint/type không nhắc, review phải nhắc.
- Không có tầng đổi camelCase: schema chính là hình dạng dây.
