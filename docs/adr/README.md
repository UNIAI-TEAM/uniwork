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
| [0013](0013-man-tong-quan-la-cua-vao-console-admin.md) | Console `/admin` mở bằng màn Tổng quan; trần màn hình lên 7 |
| [0014](0014-coverage-va-lint-la-canh-bao-o-gate-level-fast.md) | Coverage TypeScript và lint là cảnh báo ở `GATE_LEVEL=fast`; các con số không giảm |
| [0015](0015-va-cache-tu-frame-realtime-theo-catalogue.md) | Vá cache từ frame realtime chỉ với trường catalogue khai ở `Patch`; guard `revision_before`/`revision` |
| [0016](0016-work-product-la-bounded-context-tai-lieu-la-kho-duy-nhat.md) | Work Product là bounded context riêng; Document là kho duy nhất, không có bảng artifact riêng |
| [0017](0017-mot-bang-execution-cho-nguoi-va-ai.md) | Một bảng execution cho người và AI; nguồn gốc là bảng nối, cấm suy diễn; hai cổng duyệt tách |
| [0018](0018-engine-office-chay-o-sidecar-node.md) | Engine Office chạy ở sidecar Node dùng chung với UniWork Office; chỉ DOCX — **superseded by 0021** |
| [0019](0019-do-thi-cong-viec-la-projection.md) | Đồ thị công việc là projection qua outbox; cấm suy diễn quan hệ |
| [0020](0020-truy-van-bang-cong-viec-dung-sql-dong-trong-tablequery.md) | View Bảng dựng SQL động trong `pkg/db/tablequery` (whitelist, tham số hóa, luôn lọc tenant); sqlc vẫn là mặc định |
| [0021](0021-runtime-engine-office-da-dinh-dang.md) | Runtime đa định dạng cho UniWork Office: editor ở trang host qua adapter tiêm, service nội bộ cho phần chạy ngoài trang, engine native riêng; thay thế 0018 — phần editor ở trang host **superseded by 0030** |
| [0022](0022-email-hub-cache-retention-trong-postgres.md) | Email Hub: retention cache Postgres (cap metadata, TTL body, prefetch); body offload object storage |
| [0023](0023-file-theo-tenant-va-ngoai-le-avatar-ca-nhan.md) | FileService giữ `organization_id` cho file theo tenant; NULL chỉ là nhánh avatar cá nhân (purpose `user_avatar` + `user_id`), không phải public hay tenant mờ |
| [0024](0024-fileservice-so-huu-blob-intent-gc.md) | FileService sở hữu byte, ý định upload và dọn rác của Documents; Documents chỉ giữ `file_id`, claim/release trong transaction của mình; thay phần "sổ object mồ côi" trong QĐ3 của 0021 |
| [0025](0025-mot-process-cho-api-va-worker.md) | Chưa tách API và worker; khi tách thì cùng binary theo `SERVER_ROLE`; mọi job phải an toàn đa replica trước khi tăng `be.replicaCount` |
| [0026](0026-office-desktop-host.md) | Desktop host Electron tách main/preload/renderer, sandbox renderer và kiểm IPC allowlist có kiểu — **deprecated** (host đã gỡ, UNI-1240) |
| [0027](0027-inspector-script-uniwork-cho-che-do-visual-edit.md) | Script inspector do UniWork sở hữu, chỉ trong chế độ visual-edit của preview HTML (G3-D2 vẫn giữ) — **deprecated** (gỡ cùng trình soạn G3, UNI-1240) |
| [0028](0028-ai-phia-client-cua-uniwork-office.md) | AI phía client của UniWork Office: khóa của người dùng gọi thẳng nhà cung cấp; mọi thứ tốn credit/công cụ cloud đi qua UniWork API + `ai.Gateway`; 0010 chỉ điều chỉnh runtime server |
| [0029](0029-ai-cua-office-tren-web-qua-ai-gateway.md) | AI của Office trên web: khóa của người dùng lưu mã hóa phía server, proxy pass-through qua `ai.Gateway` (rào SSRF, entitlement `office.ai_byok`/`office.ai_cloud`, credit `ai.tokens`); bổ sung dòng frame web của 0028 |
| [0030](0030-go-trinh-soan-g3-office-tren-web-chi-con-frame.md) | Gỡ các trình soạn G3 và lối vào trình duyệt của engine Office (2026-10-11); web mở tài liệu Office chỉ qua frame genoffice; thay mục editor ở trang host của 0021, 0027 deprecated |
| [0031](0031-uniwork-la-oauth-server-cho-client-ai-ben-ngoai.md) | UniWork là OAuth authorization server cho client AI bên ngoài (Claude, ChatGPT, Gemini): token MCP opaque tách khỏi JWT phiên, chỉ `/mcp` chấp nhận; route OAuth/MCP ngoài wrapper `api`; mặc định tắt theo tổ chức; chỉ đọc |
| [0032](0032-mot-tai-khoan-mot-to-chuc.md) | Một tài khoản, một tổ chức đang hoạt động: advisory lock theo user ở mọi đường ghi membership, không unique index; tài khoản đa tổ chức cũ giữ nguyên; đóng tổ chức là lưu trữ (`archived`), không xóa; chuyển tổ chức là một lệnh atomic |
| [0033](0033-tool-ghi-qua-mcp-chay-truc-tiep-bang-actor-human.md) | Tool ghi qua MCP chạy trực tiếp bằng actor human của người đã đồng ý, không qua `action_proposals`; cần scope `write`, công tắc ghi của tổ chức, không có tool xóa, mọi tool ghi có hoàn tác, `revision` cho mọi lệnh sửa, audit ghi `via`; thay §3 của 0031 |
| [0034](0034-desktop-dung-khoa-luu-tren-uniwork-qua-proxy-byok.md) | Desktop đã đăng nhập dùng khóa cá nhân đã lưu trên UniWork qua proxy BYOK của 0029: khóa không bao giờ rời server, dùng lại route proxy và cổng của web, khóa trên máy thắng theo từng nhà cung cấp, dòng sử dụng ghi `office.byok_desktop`; khóa dùng chung do quản trị tổ chức đặt là hướng mở rộng; bổ sung cho 0028/0029 |
| [0035](0035-thu-muc-khong-bao-gio-duoc-chia-se.md) | Thư mục không bao giờ được chia sẻ (không visibility workspace, không share, không link); chỉ tài liệu được chia sẻ; con của thư mục bắt đầu riêng tư; người nhận không thấy thư mục của chủ (`parent_id` bị che, gốc danh sách/cây); dọn dữ liệu cũ bằng `uniwork-admin folders-unshare` |

## Bản nháp

`drafts/` chứa quyết định đang đề xuất (`**Trạng thái:** proposed`), chưa có hiệu lực và
không được governance test đếm. Khi chấp nhận: chuyển ra thư mục này, đổi trạng thái
`accepted`, thêm vào bảng trên, thêm luật vào `CLAUDE.md` kèm tên test giữ luật.

`drafts/documents-office-runtime.md` đã được chấp nhận thành
[0021](0021-runtime-engine-office-da-dinh-dang.md) ngày 2026-09-25 (DOC-001/UNI-665). Guard test của
0021 land cùng G1/G2; đến lúc đó 0021 không thêm luật vào `CLAUDE.md`.

`drafts/0022-fileservice-so-huu-blob-intent-gc.md` được chấp nhận thành
[0024](0024-fileservice-so-huu-blob-intent-gc.md) ngày 2026-09-27 (U-2, plan G1-G2; đánh số 0022 lúc chấp nhận, đổi thành 0024 khi merge develop vì 0022 đã là Email Hub).

`drafts/0034-desktop-dung-khoa-luu-tren-uniwork-qua-proxy-byok.md` (G6-05k, UNI-1637,
2026-10-14) được chấp nhận thành [0034](0034-desktop-dung-khoa-luu-tren-uniwork-qua-proxy-byok.md)
ngày 2026-10-15 (người dùng trả lời Q-K1 = (a): khóa cá nhân đã lưu trên UniWork; khóa dùng chung
do quản trị tổ chức đặt là hướng mở rộng). Giữ số 0034.

[0025](0025-mot-process-cho-api-va-worker.md) chưa có guard test (test chạy hai bản của mỗi
job, land cùng việc làm worker an toàn đa replica); đến lúc đó 0025 không thêm luật vào `CLAUDE.md`.
