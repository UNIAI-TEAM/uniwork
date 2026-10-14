# 0034 — Desktop đã đăng nhập dùng khóa lưu trên UniWork qua proxy BYOK của tổ chức

**Trạng thái:** proposed (bản nháp G6-05k, UNI-1637; quyết định người dùng 2026-10-14 16:15 UTC+7, câu Q-M3 = (b): "desktop đã đăng nhập dùng khóa của tổ chức lưu trên UniWork qua proxy BYOK của server"). Advisor/người dùng chấp nhận; số 0034 là tạm, đổi nếu ADR khác land trước.
**Issue:** UNI-1637 · **Parent:** UNI-635 (G6) · **Liên quan:** [0028](../0028-ai-phia-client-cua-uniwork-office.md) (AI phía client), [0029](../0029-ai-cua-office-tren-web-qua-ai-gateway.md) (proxy BYOK cho web), [0010](../0010-ai-khong-ghi-truc-tiep-de-xuat-xac-nhan-thuc-thi.md), [0008](../0008-cach-ly-tenant-o-tang-service.md), [0032](../0032-mot-tai-khoan-mot-to-chuc.md).
**Bổ sung cho 0028** (không sửa nó): thêm một nguồn khóa thứ ba cho desktop bên cạnh Quyết định 2 (khóa cục bộ / CLI) và Quyết định 3 (credit UniWork). Mở phần "desktop có thể dùng proxy về sau, v1 thì không" ở Quyết định 1 của 0029.
**Hợp đồng API:** [`docs/office/g5g6g7/contracts/g6-05k-org-keys-api.md`](../../office/g5g6g7/contracts/g6-05k-org-keys-api.md).

> Vì sao là ADR mới chứ không sửa 0028: `docs/adr/README.md` cấm sửa ADR đã `accepted`
> ("đổi ý thì viết ADR mới"); tiền lệ gần nhất là 0029, cũng "bổ sung cho 0028 (không sửa
> nó)". Vì sao nằm trong `drafts/`: trạng thái `proposed` chưa có hiệu lực, và
> `scripts/governance.test.mjs` chỉ đếm `docs/adr/NNNN-*.md` ở thư mục gốc (tiền lệ:
> bản nháp 0022 → 0024, commit 51c3f6de6).

---

## Bối cảnh

ADR 0028 cho desktop gọi thẳng nhà cung cấp bằng khóa **cục bộ** của người dùng
(`ai-settings.json` trên máy) và cấm app giữ bất kỳ credential provider phía server nào
(Quyết định 4). ADR 0029 dựng kho khóa phía server (`ai_provider_credentials`, mã hóa
bằng `AI_CREDENTIAL_KEY`) và proxy pass-through qua `ai.Gateway` cho **web**: frame
genoffice gửi wire format gốc của nhà cung cấp tới route UniWork, server gắn khóa đã lưu
và trả byte nguyên vẹn.

Hệ quả hôm nay: người đã lưu khóa trong Cài đặt AI trên web mở app desktop thì không
thấy khóa đó; phải nhập lại khóa trên từng máy. G6-05m (UNI-1632) đã để danh sách nguồn
model của chip (`AiModelSource`) mở để thêm nguồn này mà không đổi hình chip. Ngày
2026-10-14 người dùng chọn Q-M3 = (b).

Kiểm lại với code (2026-10-14, root 9d987d353):

- Hàng khóa lưu trên server là **khóa riêng của người gọi trong một tổ chức**, khóa theo
  (`organization_id`, `user_id`, `provider`) — `server/migrations/9991791524388000_ai_provider_credentials.up.sql:1-25`,
  mọi query lọc cả hai cột (`server/pkg/db/queries/ai_credentials.sql:7-75`). Chưa có
  khóa dùng chung do quản trị tổ chức đặt.
- Các route proxy và route khóa đã nằm trong nhóm `authed` dùng
  `mw.RequireAuthWithDevice` (`server/internal/handler/router/router.go:204-209`), tức đã
  nhận access token phiên thiết bị desktop như route UniWork AI desktop đang dùng
  (`router/ai_uniwork.go:35-37`). Thiếu là **hợp đồng phía client** và quyết định này,
  không phải đường vào.

## Quyết định

1. **"Khóa của tổ chức" trên desktop (QĐ1).** Là các khóa người dùng **đã lưu trên
   UniWork** cho tổ chức đang chọn của phiên desktop — đúng những hàng
   `GET /orgs/{orgID}/ai/credentials` trả về (`handler/ai_credentials.go:40-66`), mà Cài
   đặt AI trên web hiển thị. Tổ chức = tổ chức đang chọn của tài khoản UniWork trên app
   (`deps.orgId()` của shell, F `apps/shell/src/main/uniwork-auth/cloud.ts:43-44`, `:202-205`);
   theo 0032 một tài khoản có một tổ chức đang hoạt động, tài khoản đa tổ chức cũ dùng tổ
   chức đang chọn. Nhà cung cấp: giao của bảng cố định phía server
   (`server/internal/ai/provider/byok.go:31-51`) với danh mục của app; không bao giờ
   `codex`, `genspark`, `uniwork` (0029 QĐ4). Ai được dùng: đúng cổng của frame web và host
   web, không thêm cổng riêng — `OrganizationService.RequireMember`
   (`server/internal/service/organization.go:135`, người ngoài nhận 404) rồi
   `EntitlementService.Can(ctx, orgID, "office.ai_byok")`
   (`server/internal/service/entitlement.go:221`), cả hai gọi trong
   `AIBYOKService.Proxy` (`server/internal/service/ai_byok.go:42-69`); khóa giải mã bởi
   `AICredentialService.Resolve` (`server/internal/service/ai_credentials.go:368`), chỉ
   khóa của chính người gọi.
2. **Khóa không bao giờ rời server (QĐ2, giữ QĐ4 của 0028).** Desktop không đọc, không
   nhận, không lưu khóa đã lưu trên UniWork. Main process của shell gửi request đúng wire
   format của nhà cung cấp tới route proxy UniWork kèm access token phiên thiết bị (gắn
   trong main, không bao giờ qua renderer — cùng mẫu với `ai-chat.ts` của UniWork AI,
   F `apps/shell/src/main/uniwork-auth/ai-chat.ts:25-36`); server gắn khóa và gọi nhà cung
   cấp chỉ trong `ai.Gateway.Proxy` (`server/internal/ai/proxy.go:109-196`) qua
   `internal/ai/provider` (`TestProviderSDKOnlyInAIProvider`,
   `TestAIPackageOnlyCallsAiQueries`). Phản hồi chỉ có `key_hint`.
3. **Dùng lại route proxy hiện có, không dựng route desktop mới (QĐ3).** Chat:
   `POST /orgs/{orgID}/ai/byok/{aiProvider}/chat/completions` | `/messages` | `/generate`;
   danh sách model cho chip: `GET /orgs/{orgID}/ai/byok/{aiProvider}/models`
   (`server/internal/handler/router/ai_byok.go:19-52`, handler `byokProxy`
   `server/internal/handler/ai_byok.go:22-45`). Stream giữ nguyên dạng nhà cung cấp (SSE
   vẫn là SSE), nên `packages/ai-provider` của desktop chạy không đổi; URL được viết lại
   bằng đúng bảng ánh xạ của web (`toProxyRequest`, F `web/modules/shared/ai/transport.ts:44-86`),
   chuyển vào `packages/ai-provider` để main process dùng chung. Thay đổi phía server chỉ
   gồm: (a) trường cộng thêm `byok` (`enabled`, `reason`) trên
   `GET /orgs/{orgID}/ai/credentials` để desktop biết trước khi gửi, tính bằng
   `AIBYOKService.Enabled` có sẵn (`service/ai_byok.go:76-91`); (b) dòng sử dụng của lệnh
   gọi đến từ phiên thiết bị ghi capability `office.byok_desktop` thay vì `office.byok`
   (`ai/proxy.go:33`, `:126-130`), nhận diện bằng `middleware.DeviceSession`
   (`server/internal/middleware/auth.go:99`) ở handler rồi truyền xuống service.
   Giới hạn giữ nguyên: body ≤ 16 MiB (`handler/ai_byok.go:17`), bucket `ai-byok` 60/phút
   **mỗi người chung cho web, frame và desktop** (`router/router.go:196`, `:219`; khóa
   `user:<id>`, `:285-297`), 15 s tới header, nghỉ 60 s giữa hai chunk, tổng 10 phút
   (`server/internal/ai/provider/byok_client.go:66-75`), hạn chót ghi 60 s mỗi chunk
   (`handler/ai_byok.go:51`).
4. **Đo đếm, không ghi nội dung (QĐ4).** Mỗi lệnh gọi (trừ `GET models`) có một dòng
   `ai_usage_events`: tổ chức, người, capability, nhà cung cấp, model, trạng thái, mã lý do,
   số token nếu nhà cung cấp báo, độ trễ, `correlation_id`; `credits = 0` (khóa không phải
   của UniWork). **Không** prompt, phản hồi, khóa, tên tệp. Không có dòng `audit_events`
   cho mỗi lệnh gọi: proxy không đổi trạng thái nghiệp vụ (0029 QĐ7), nên
   `audit_coverage_test.go` không thêm lệnh. Lưu/xóa khóa vẫn chỉ ở web, vẫn audit
   `ai.credential.saved` / `ai.credential.deleted` như cũ.
5. **Lỗi (QĐ5).** Dùng nguyên mã của proxy (`server/internal/ai/errors.go:55-59` và 0029):
   403 `entitlement_required`, 404 `credential_missing` (cũng là câu trả lời cho người
   không phải thành viên), 400 `provider_not_supported` / `base_url_refused` /
   `invalid_request`, 424 `provider_auth_failed`, 429 (bucket hoặc nhà cung cấp, có
   `Retry-After`), 502 `provider_unreachable`, 401 `device_revoked`
   (`middleware/auth.go:44-49`). Desktop hiện chúng bằng đúng các trạng thái `KEY_CODES`
   mà frame web đã có (F `web/e2e/ai-web.spec.ts:15-22`). Đây là lưu lượng BYOK nên runbook
   `docs/runbooks/UniworkAiModelErrors.md` (capability `office_uniwork_ai`) **không** tính
   nó; capability mới tách được trong `uniwork_ai_calls_total{capability}`.
6. **Thứ tự ưu tiên trên desktop: khóa trên máy thắng (QĐ6).** Một luật, theo từng nhà
   cung cấp: nếu `ai-settings.json` có khóa dùng được cho nhà cung cấp đó thì gọi thẳng như
   0028; nếu không có mà UniWork có khóa đã lưu và `byok.enabled` thì gọi qua proxy. Main
   process quyết định từ trạng thái của chính nó (tệp cài đặt + danh sách khóa server đã
   đọc), không từ settings renderer gửi lên. Người dùng thấy nguồn: nhóm của nhà cung cấp
   trong chip có nhãn "Khóa trên UniWork" / "Key on UniWork" khi đi qua proxy; muốn dùng khóa
   UniWork cho nhà cung cấp đã có khóa cục bộ thì gỡ khóa cục bộ trong Cài đặt.
7. **Ngoại tuyến, server cũ, đăng xuất, đổi tổ chức, khóa bị gỡ (QĐ7).**
   - Server cũ (không có trường `byok` trên `GET …/ai/credentials`, hoặc route trả 404
     không phải `credential_missing`): nguồn khóa UniWork **vắng mặt**, chip giữ đúng hành
     vi G6-05m.
   - Ngoại tuyến hoặc chưa đăng nhập: nguồn vắng mặt; khóa cục bộ chạy như cũ. Không cache
     danh sách khóa server ra đĩa.
   - Đăng xuất, đổi tổ chức, thiết bị bị thu hồi: xóa nguồn khỏi bộ nhớ, hủy mọi stream
     proxy đang chạy (như `ai-chat.ts` hủy lượt UniWork AI khi đăng xuất), đọc lại danh sách
     cho tổ chức mới.
   - Khóa bị gỡ hoặc thay trên web: lần gọi kế trả 404 `credential_missing` hoặc 424 → đọc
     lại danh sách, nhóm biến mất hoặc báo lỗi khóa; không tự chuyển âm thầm sang nhà cung
     cấp khác giữa lượt.
8. **Quyền riêng tư và nội dung chữ (QĐ8).** Lần đầu dùng một nhóm "Khóa trên UniWork"
   (và trong tooltip của nhãn), app nói rõ: nội dung đi **qua máy chủ UniWork của tổ chức**
   tới tài khoản nhà cung cấp của khóa đã lưu trên UniWork; UniWork chỉ ghi số liệu sử dụng,
   không lưu nội dung. Không có telemetry tới Genspark hay GA: lệnh gọi proxy chỉ tới origin
   API UniWork của hồ sơ triển khai (`isAllowedOrigin`, F `uniwork-auth/deployment.ts`).
   Không mã nội bộ (G6-05k, UNI-1637, `office.byok_desktop`) trong chữ sản phẩm.
9. **Giữ nguyên (QĐ9).** Đường khóa cục bộ / CLI của 0028 (QĐ2), đường credit UniWork và
   UniWork AI (0028 QĐ3, G6-03a/b), frame web và host web (0029), kho khóa và luật
   `PUT`/`DELETE` khóa (chỉ web ghi; desktop không ghi khóa server), ADR 0010.

## Phương án đã cân nhắc và loại

- **Khóa dùng chung do quản trị tổ chức đặt (bảng mới, route quản trị, chính sách theo
  vai trò).** Đúng nghĩa đen hơn của "khóa của tổ chức", nhưng là một tính năng mới cả web
  lẫn server (migration, UI quản trị, audit, cách ly) mà Q-M3 không mô tả (Q-M3 (b) nói
  "hiện khóa lưu trên server và gọi qua proxy BYOK của tổ chức"). Để mở: `Resolve` có thể
  sau này thử hàng cá nhân rồi hàng của tổ chức mà không đổi hợp đồng desktop. Câu hỏi mở
  Q-K1 trong báo cáo.
- **Trả khóa đã giải mã về desktop để gọi thẳng.** Phá QĐ4 của 0028 và D8 của 0029; khóa
  nằm trên mọi máy, không thu hồi được theo thiết bị.
- **Route proxy riêng cho desktop (`/desktop/ai/...`).** Lặp lại cổng, giới hạn, isoRoutes
  và lỗi đã có; ngân sách tách ra làm một người có hai lần 60/phút. Route hiện có đã nhận
  token thiết bị.
- **Dịch về một giao thức chung (UniWork AI façade).** Mất tool calling/vision/streaming
  nguyên bản như 0029 đã loại.
- **Khóa UniWork thắng khóa cục bộ khi đăng nhập.** Đổi lặng lẽ tài khoản nhà cung cấp và
  đường dữ liệu (thêm một bước qua server) của người đã cấu hình máy mình; mất ngoại tuyến.
- **Để người dùng chọn nguồn cho từng nhà cung cấp.** Thêm một cài đặt và một trạng thái
  cho chip; luật một dòng ở QĐ6 đủ cho v1.

## Hệ quả

- Lưu lượng desktop dùng khóa UniWork **có** đo đếm và chịu giới hạn/entitlement của server,
  khác đường khóa cục bộ (vẫn ngoài UniWork như 0028).
- Server thấy prompt trên đường đi (không lưu); chữ trên app phải nói điều này (QĐ8).
- Ngân sách 60/phút của `ai-byok` giờ chia giữa web, frame và desktop của cùng một người.
- Desktop mang thêm logic chọn nguồn trong main process; `packages/ai-provider` nhận hàm
  viết lại URL của web (một nguồn, hai host).
- Luật giữ: không thêm route nên `TestIsolationMatrix` (`isoRoutes`,
  `server/internal/handler/isolation_routes_test.go:382-385`) không cần dòng mới; không
  lệnh mới nên `audit_coverage_test.go` không đổi. Test mới xem hợp đồng API §7.
- Giới hạn đã biết của 0029 vẫn áp: stream openai-compatible chỉ có token khi client đặt
  `stream_options.include_usage`; khóa của thành viên bị gỡ không tự xóa (nhưng không dùng
  được vì `RequireMember`).

## Trạng thái

`proposed` (2026-10-14, G6-05k, UNI-1637). Khi chấp nhận: chuyển ra `docs/adr/`, đổi
`accepted`, thêm vào bảng trong `README.md`, và thêm một dòng vào mục Audit and Events
của `CLAUDE.md` kèm tên test giữ luật (hợp đồng API §7). Bổ sung cho 0028 và 0029; không
thay thế ADR nào.
