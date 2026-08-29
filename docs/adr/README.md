# Architecture Decision Records

Mỗi quyết định kiến trúc mà `CLAUDE.md` diễn đạt bằng "never" / "only" có một
trang ở đây nói **vì sao**. `CLAUDE.md` giữ luật; ADR giữ lý do và cái giá đã
chấp nhận, để người đến sau (và agent) không "sửa" lại quyết định vì tưởng nó
là sơ suất.

Định dạng: một file `NNNN-ten-quyet-dinh.md`, bốn mục — Bối cảnh, Quyết định,
Hệ quả, Trạng thái. Không sửa ADR đã `accepted`; đổi ý thì viết ADR mới và
đánh dấu cái cũ `superseded by NNNN`. `scripts/governance.test.mjs` kiểm tra
số thứ tự không trùng và mỗi file có dòng Trạng thái.

| # | Quyết định |
| --- | --- |
| [0001](0001-khong-foreign-key.md) | Không `FOREIGN KEY`, không cascade; index luôn `CONCURRENTLY` |
| [0002](0002-ulid-text.md) | Id là ULID trong cột `TEXT` |
| [0003](0003-schema-api-khoan-dung.md) | Schema API phía client khoan dung, `parseWithFallback` |
| [0004](0004-khong-realip.md) | Không middleware `RealIP`; mỗi consumer tự áp `TRUSTED_PROXIES` |
| [0005](0005-turbo-cache-inputs.md) | Task hash-only `cache-inputs` trong turbo |
| [0006](0006-mot-bo-luat-cho-moi-agent.md) | Một bộ luật cho người và mọi agent |
