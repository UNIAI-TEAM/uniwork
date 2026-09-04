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
| [0007](0007-actor-kind-agent-la-actor-hang-nhat.md) | Agent là actor hạng nhất; mọi bản ghi có `actor_kind` |
| [0008](0008-cach-ly-tenant-o-tang-service.md) | Cách ly tenant ở tầng service; `organization_id` trên mọi bảng nghiệp vụ |
| [0009](0009-audit-va-outbox-cung-transaction.md) | Audit + outbox trong cùng transaction cho mọi command |
| [0010](0010-ai-khong-ghi-truc-tiep-de-xuat-xac-nhan-thuc-thi.md) | AI không ghi nghiệp vụ trực tiếp: đề xuất → xác nhận → thực thi |
| [0011](0011-mobile-la-app-expo-doc-lap.md) | Mobile là app Expo / React Native độc lập, không PWA, không tái dùng `views` |
| [0012](0012-audit-bat-bien-bang-quyen-db-va-trigger.md) | `audit_events` bất biến bằng quyền DB và trigger; ghi qua đúng một package |

## Bản nháp

`drafts/` chứa quyết định đang đề xuất (`**Trạng thái:** proposed`), chưa có hiệu lực và
không được governance test đếm. Khi chấp nhận: chuyển ra thư mục này, đổi trạng thái
`accepted`, thêm vào bảng trên, thêm luật vào `CLAUDE.md` kèm tên test giữ luật.

(Hiện không có bản nháp.)
