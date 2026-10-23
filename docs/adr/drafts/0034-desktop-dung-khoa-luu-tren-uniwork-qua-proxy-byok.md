# 0034 — Desktop đã đăng nhập dùng khóa lưu trên UniWork qua proxy BYOK của tổ chức

**Trạng thái:** proposed (bản nháp G6-05k, UNI-1637; quyết định người dùng 2026-10-14 16:15 UTC+7, câu Q-M3 = (b): "desktop đã đăng nhập dùng khóa của tổ chức lưu trên UniWork qua proxy BYOK của server"). **Chưa chấp nhận**: Advisor (2026-10-15 03:25Z, ràng buộc) giữ ADR ở `drafts/` cho tới khi người dùng trả lời Q-K1 (xem "Câu hỏi và quyết định"). Code G6-05k đã được xây theo phương án (a) của Q-K1. Số 0034 là tạm, đổi nếu ADR khác land trước.
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
  (`organization_id`, `user_id`, `provider`) — `server/migrations/9991791524388000_ai_provider_credentials.up.sql`,
  mọi query lọc cả hai cột (`server/pkg/db/queries/ai_credentials.sql`). Chưa có
  khóa dùng chung do quản trị tổ chức đặt.
- Các route proxy và route khóa đã nằm trong nhóm `authed` dùng
  `mw.RequireAuthWithDevice` (`server/internal/handler/router/router.go`), tức đã
  nhận access token phiên thiết bị desktop như route UniWork AI desktop đang dùng
  (`router/ai_uniwork.go`). Thiếu là **hợp đồng phía client** và quyết định này,
  không phải đường vào.

## Câu hỏi và quyết định

Năm câu hỏi của bản thiết kế (báo cáo s0), trạng thái tới 2026-10-15:

| Câu | Nội dung | Trạng thái |
| --- | --- | --- |
| Q-K1 | "Khóa của tổ chức" là (a) khóa **cá nhân** của người dùng đã lưu trên UniWork trong tổ chức đó (có sẵn, khuyến nghị) hay (b) khóa **dùng chung toàn tổ chức** do quản trị tổ chức đặt (bảng mới, UI/route quản trị, audit, cách ly: một card riêng, lớn hơn)? | **MỞ — của người dùng.** Advisor giữ ADR ở `proposed`. v1 xây trên (a); (b) là hướng mở rộng ở `Resolve`, ghi bên dưới. |
| Q-K2 | Thứ tự ưu tiên: (a) khóa trên máy thắng theo từng nhà cung cấp; (b) khóa UniWork thắng khi đã đăng nhập; (c) người dùng chọn theo nhà cung cấp | (a), Advisor quyết 2026-10-14 17:18Z |
| Q-K3 | Capability sử dụng riêng cho desktop: (a) `office.byok_desktop`; (b) dùng chung `office.byok` | (a), Advisor |
| Q-K4 | Công tắc tắt: (a) không có, entitlement `office.ai_byok` đã chặn; (b) feature flag riêng | (a), Advisor |
| Q-K5 | Token của stream openai-compatible: (a) không đụng body (dòng sử dụng có thể 0 token, như web); (b) desktop tự thêm `stream_options.include_usage` | (a), Advisor |

Khi người dùng trả lời Q-K1 = (a), việc chấp nhận chỉ là chuyển ADR ra `docs/adr/`, đổi
trạng thái và làm các bước ở mục "Trạng thái". Nếu trả lời (b), (b) thành một card mới
dựng trên cùng hợp đồng desktop (mục "Hướng mở rộng (b)").

## Quyết định

Các quyết định dưới đây khớp với bản đã giao của G6-05k (server D1, d-f1; fork F1–F3, fx-main,
fx-ui, fx2, fx3, fx4); chi tiết từng tuyến và tên test nằm ở hợp đồng API.

1. **"Khóa của tổ chức" trên desktop (QĐ1; Q-K1 = (a) cho v1).** Là các khóa người dùng
   **đã lưu trên UniWork** cho tổ chức đang chọn của phiên desktop — đúng những hàng
   `GET /orgs/{orgID}/ai/credentials` trả về, mà Cài đặt AI trên web hiển thị. Tổ chức = tổ
   chức đang chọn của tài khoản UniWork trên app (shell, `apps/shell/src/main/uniwork-auth/`
   của fork); theo 0032 một tài khoản có một tổ chức đang hoạt động, tài khoản đa tổ chức cũ
   dùng tổ chức đang chọn. Nhà cung cấp: giao của bảng cố định phía server
   (`server/internal/ai/provider/byok.go`) với danh mục của app; không bao giờ `codex`,
   `genspark`, `uniwork` (0029 QĐ4). Ai được dùng: đúng cổng của frame web và host web,
   không thêm cổng riêng — `OrganizationService.RequireMember` (người ngoài nhận 404) rồi
   `EntitlementService.Can(ctx, orgID, FeatureOfficeAIBYOK)` (`office.ai_byok`), cả hai gọi
   trong `AIBYOKService.Proxy` (`server/internal/service/ai_byok.go`); khóa giải mã bởi
   `AICredentialService.Resolve` (`server/internal/service/ai_credentials.go`), chỉ khóa của
   chính người gọi.
2. **Khóa không bao giờ rời server (QĐ2, giữ QĐ4 của 0028).** Desktop không đọc, không
   nhận, không lưu khóa đã lưu trên UniWork. Main process của shell (`UniworkKeysHost`,
   `apps/shell/src/main/uniwork-auth/keys.ts` của fork) gửi request đúng wire format của
   nhà cung cấp tới route proxy UniWork kèm access token phiên thiết bị (gắn trong main,
   không bao giờ qua renderer, không lộ trong lỗi hay log, không theo redirect — cùng mẫu
   với `ai-chat.ts` của UniWork AI); server gắn khóa và gọi nhà cung cấp chỉ trong
   `ai.Gateway.Proxy` (`server/internal/ai/proxy.go`) qua `internal/ai/provider`
   (`TestProviderSDKOnlyInAIProvider`, `TestAIPackageOnlyCallsAiQueries`). Phản hồi chỉ có
   `key_hint`. Main chọn đường đi cho từng lệnh gọi trong một phạm vi bất đồng bộ
   (`AsyncLocalStorage`) và chỉ cài **một** bộ điều phối `setPrimaryFetch` một lần; **không**
   vá `globalThis.fetch`, nên lệnh gọi khóa cục bộ chạy song song vẫn đi thẳng.
3. **Dùng lại route proxy hiện có, không dựng route desktop mới (QĐ3).** Chat:
   `POST /orgs/{orgID}/ai/byok/{aiProvider}/chat/completions` | `/messages` | `/generate`;
   danh sách model cho chip: `GET /orgs/{orgID}/ai/byok/{aiProvider}/models`
   (`server/internal/handler/router/ai_byok.go`, handler `byokProxy`
   `server/internal/handler/ai_byok.go`). Stream giữ nguyên dạng nhà cung cấp (SSE vẫn là
   SSE), nên `packages/ai-provider` của desktop chạy không đổi; URL được viết lại bằng đúng
   bảng ánh xạ của web (`toProxyRequest`), nay nằm ở `packages/ai-provider/src/proxy-url.ts`
   của fork để web và main process dùng chung. Thay đổi phía server chỉ gồm:
   - (a) trường cộng thêm `byok` (`enabled`, `reason`) trên `GET /orgs/{orgID}/ai/credentials`,
     tính bằng `AIBYOKService.Status` (`Enabled` là phép chiếu bool của nó). `reason` đi qua
     danh sách cho phép đóng (`entitlement_required`, `subscription_inactive`,
     `ai_credentials_unavailable`); mã khác bị bỏ và ghi log, nghĩa là **fail closed**. Nếu
     việc tính trạng thái lỗi, route vẫn trả 200 với các hàng khóa và `byok` trung tính
     (`enabled: false`, `reason: ""`) — một lỗi trạng thái không làm danh sách khóa của web
     biến mất.
   - (b) dòng sử dụng của lệnh gọi đến từ phiên thiết bị ghi capability
     `office.byok_desktop` thay vì `office.byok`: handler nhận diện bằng
     `middleware.DeviceSession`, truyền `ai.ProxySurface` xuống service rồi
     `ai.ProxyRequest.Surface`; phiên web và token frame vẫn ghi `office.byok`.
   - Proxy giữ nguyên hai câu trả lời 503 của server: `ai_credentials_unavailable` khi
     chưa cấu hình `AI_CREDENTIAL_KEY` (không bị trả về thành 404 `credential_missing`) và
     `ai_byok_not_configured` khi dịch vụ BYOK chưa được nối.
   Giới hạn giữ nguyên: body ≤ 16 MiB, bucket `ai-byok` 60/phút **mỗi người chung cho web,
   frame và desktop** (khóa `user:<id>`), 15 s tới header, nghỉ 60 s giữa hai chunk, tổng 10
   phút (`server/internal/ai/provider/byok_client.go`), hạn chót ghi 60 s mỗi chunk.
4. **Đo đếm, không ghi nội dung (QĐ4).** Mỗi lệnh gọi (trừ `GET models`) có một dòng
   `ai_usage_events`: tổ chức, người, capability, nhà cung cấp, model, trạng thái, mã lý do,
   số token nếu nhà cung cấp báo, độ trễ, `correlation_id`; `credits = 0` (khóa không phải
   của UniWork). **Không** prompt, phản hồi, khóa, tên tệp. Không có dòng `audit_events`
   cho mỗi lệnh gọi: proxy không đổi trạng thái nghiệp vụ (0029 QĐ7), nên
   `audit_coverage_test.go` không thêm lệnh. Lưu/xóa khóa vẫn chỉ ở web, vẫn audit
   `ai.credential.saved` / `ai.credential.deleted` như cũ. Bảng sử dụng của tổ chức dịch
   được cả ba capability của Office sang vi/en (`office_uniwork_ai`, `office_byok`,
   `office_byok_desktop`) thay vì hiện chuỗi thô.
5. **Lỗi (QĐ5).** Dùng nguyên mã của proxy (`server/internal/ai/errors.go` và 0029): 403
   `entitlement_required`, 404 `credential_missing` (cũng là câu trả lời cho người không phải
   thành viên), 400 `provider_not_supported` / `base_url_refused` / `invalid_request`, 424
   `provider_auth_failed`, 429 (bucket hoặc nhà cung cấp, có `Retry-After`), 502
   `provider_unreachable`, 503 `ai_credentials_unavailable` / `ai_byok_not_configured`, 401
   `device_revoked`. Desktop hiện chúng bằng đúng các trạng thái `KEY_CODES` mà frame web đã
   có, thêm `keys_unavailable` cho các câu trả lời 503 của UniWork. Hai luật để không nhầm
   lỗi của nhà cung cấp với lỗi của UniWork:
   - 402 và 503 chỉ được coi là câu trả lời của UniWork khi body có mã của UniWork
     (`credits_exhausted`, `cloud_unavailable`, `ai_credentials_unavailable`,
     `ai_byok_not_configured`, `unavailable`) **hoặc**, riêng 503, khi body không phải JSON
     lỗi (trang cổng, body rỗng — một sự cố hạ tầng, hiện là "UniWork tạm thời chưa dùng
     được", không phải "chưa cài trên máy chủ"). 402/503 của nhà cung cấp đi nguyên cho
     `packages/ai-provider`.
   - 404 chỉ là câu trả lời của proxy khi mã là `credential_missing`; 404 không mã = server cũ.
   Đây là lưu lượng BYOK nên runbook `docs/runbooks/UniworkAiModelErrors.md` (capability
   `office_uniwork_ai`) **không** tính nó; capability mới tách được trong
   `uniwork_ai_calls_total{capability}`.
6. **Thứ tự ưu tiên trên desktop: khóa trên máy thắng (QĐ6; Q-K2 = (a)).** Một luật, theo
   từng nhà cung cấp: nếu `ai-settings.json` có khóa dùng được cho nhà cung cấp đó thì gọi
   thẳng như 0028; nếu không có mà UniWork có khóa đã lưu và `byok.enabled` thì gọi qua
   proxy. Một ô cài đặt có khóa nhưng chưa đủ (thiếu model, hoặc `custom` thiếu base URL)
   vẫn tính là của máy này; một endpoint `custom` không khóa người dùng gõ trên máy cũng được
   giữ. Main process quyết định từ trạng thái của chính nó (tệp cài đặt + danh sách khóa
   server đã đọc), không từ settings renderer gửi lên. Người dùng thấy nguồn: nhóm của nhà
   cung cấp trong chip có nhãn "Khóa trên UniWork" / "Key on UniWork" khi đi qua proxy; trong
   Cài đặt, hàng của nhà cung cấp đó chỉ đọc và có nút **"Dùng khóa trên máy này"** để nhập
   khóa cục bộ mà không phải gỡ gì trước (khóa cục bộ lưu rồi thì thắng).
7. **Cài đặt không bao giờ đợi mạng, nguồn chỉ rơi khi server nói rơi (QĐ7).** Đọc cài đặt
   (`ai:get-settings`) trả ngay từ bộ nhớ đệm trong main, đọc danh sách khóa (R1) chạy nền
   (stale-while-revalidate): timeout 5 s, lùi 30 s sau lỗi, trần `Retry-After` 5 phút. Chỉ
   hai câu trả lời làm nguồn biến mất: R1 trả 404, hoặc `byok.enabled` = false (hoặc thiếu
   `byok`); 429, 5xx, timeout, lỗi mạng giữ danh sách cuối cùng còn tốt. Lệnh gọi AI thật
   (`ai:stream`, `ai:chat`, thử kết nối) chỉ chờ R1 khi không có ô cục bộ dùng được và chưa
   có nguồn trong đệm, và chờ đó cũng bị chặn bởi timeout và lùi.
   - Server cũ (không có trường `byok`, hoặc route trả 404 không phải `credential_missing`):
     nguồn khóa UniWork **vắng mặt**, chip giữ đúng hành vi G6-05m.
   - Ngoại tuyến hoặc chưa đăng nhập: nguồn vắng mặt; khóa cục bộ chạy như cũ. Không cache
     danh sách khóa server ra đĩa.
   - Đăng xuất, đổi tổ chức, `device_revoked`: xóa nguồn khỏi bộ nhớ, hủy mọi stream proxy
     đang chạy, đọc lại cho tổ chức mới; `device_revoked` báo tài khoản đúng một lần (luồng
     đăng xuất của shell) và lùi R1 theo chủ sở hữu phiên, nên đăng nhập lại đọc ngay. Một
     401 không đến từ UniWork (cổng) chỉ làm hỏng lệnh gọi đó.
   - Khóa bị gỡ hoặc thay trên web: lần gọi kế trả 404 `credential_missing` hoặc 424 → đọc
     lại danh sách, nhóm biến mất hoặc báo lỗi khóa; không tự chuyển âm thầm sang nhà cung
     cấp khác giữa lượt.
8. **Lựa chọn model: lưu trên máy, có dấu thời gian, bản mới hơn thắng (QĐ8).** Model của
   một nhà cung cấp phục vụ bằng khóa UniWork = `model` của hàng khóa trên server so với
   lựa chọn trên máy này theo dấu thời gian (`model_updated_at` so với thời điểm chọn), cái
   nào mới hơn thắng. Lựa chọn trên máy được lưu theo tài khoản và tổ chức trong
   `app-settings.json` (`uniworkAiModelPicks`), **không bao giờ** ghi vào `ai-settings.json`,
   và chỉ được ghi khi renderer gửi một marker chọn model tường minh (`modelPick` /
   `modelPicks`) — một lần lưu Cài đặt thông thường không bao giờ tự suy ra "đã chọn". Cài
   đặt không bao giờ ghi lại model của server hay khóa giữ chỗ vào ô cục bộ; mọi nơi đọc
   "model hiện tại" (chip, My AI, agent Sheets, QC slide) đọc model mà main sẽ dùng. Giới hạn
   đã biết: một lựa chọn trùng với model của ô lưu sẵn không phân biệt được với echo, nên
   không được ghi nhận; mỗi lần Lưu mang tối đa một lựa chọn cho mỗi nhà cung cấp, tối đa 64.
9. **Quyền riêng tư và nội dung chữ (QĐ9).** Lần đầu dùng một nhóm "Khóa trên UniWork" (mỗi
   nhà cung cấp một lần, cờ đã xem được lưu), và trong mô tả truy cập của các lựa chọn, app
   nói rõ: nội dung đi **qua máy chủ UniWork của tổ chức** tới tài khoản nhà cung cấp của
   khóa đã lưu trên UniWork; UniWork chỉ ghi số liệu sử dụng, không lưu nội dung. Không có
   telemetry tới Genspark hay GA: lệnh gọi proxy chỉ tới origin API UniWork của hồ sơ triển
   khai (`isAllowedOrigin`). Không mã nội bộ (G6-05k, UNI-1637, `office.byok_desktop`) trong
   chữ sản phẩm.
10. **Giữ nguyên (QĐ10).** Đường khóa cục bộ / CLI của 0028 (QĐ2), đường credit UniWork và
    UniWork AI (0028 QĐ3, G6-03a/b), frame web và host web (0029), kho khóa và luật
    `PUT`/`DELETE` khóa (chỉ web ghi; desktop không ghi khóa server), ADR 0010.

## Hướng mở rộng (b): khóa dùng chung toàn tổ chức do quản trị đặt

Chỉ làm nếu người dùng trả lời Q-K1 = (b) (hoặc muốn thêm sau v1). Là một card riêng, không
nằm trong G6-05k: bảng mới (có `organization_id`, ADR 0008) và migration theo luật của
`CLAUDE.md`, route + UI quản trị chỉ cho chủ/quản trị tổ chức, audit `ai.credential.*` cho
khóa tổ chức, một dòng mới ở `isoRoutes` và ca cách ly, chính sách ai được dùng khóa nào.
Điểm nối đã chừa: `AICredentialService.Resolve` có thể thử hàng cá nhân rồi hàng của tổ
chức mà **không đổi hợp đồng desktop** — desktop vẫn chỉ gọi proxy, vẫn chỉ thấy `key_hint`,
vẫn một luật ưu tiên (khóa trên máy thắng). Cần quyết định riêng khi làm: khóa cá nhân hay
khóa tổ chức thắng khi cả hai cùng có, và tên nhãn trên chip khi khóa là của tổ chức.

## Phương án đã cân nhắc và loại

- **Khóa dùng chung do quản trị tổ chức đặt, làm ngay trong v1.** Đúng nghĩa đen hơn của
  "khóa của tổ chức", nhưng là một tính năng mới cả web lẫn server (migration, UI quản trị,
  audit, cách ly) mà Q-M3 không mô tả (Q-M3 (b) nói "hiện khóa lưu trên server và gọi qua
  proxy BYOK của tổ chức"). Giữ làm hướng mở rộng ở trên, chờ Q-K1.
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
  cho chip; luật một dòng ở QĐ6 cộng nút "Dùng khóa trên máy này" đủ cho v1.
- **Vá `globalThis.fetch` trong main để định tuyến.** Đã làm rồi bỏ (review shell r1): nhiều
  stream chạy chồng nhau và lệnh gọi cục bộ có thể bị chuyển nhầm sang proxy; thay bằng một
  bộ điều phối `setPrimaryFetch` đọc phạm vi của từng lệnh gọi (QĐ2).
- **Suy ra "người dùng đã chọn model" bằng cách so sánh cài đặt trước/sau.** Không phân biệt
  được lựa chọn với echo và từng ghi nhầm model của server vào ô cục bộ; thay bằng marker
  tường minh (QĐ8).

## Hệ quả

- Lưu lượng desktop dùng khóa UniWork **có** đo đếm và chịu giới hạn/entitlement của server,
  khác đường khóa cục bộ (vẫn ngoài UniWork như 0028).
- Server thấy prompt trên đường đi (không lưu); chữ trên app phải nói điều này (QĐ9).
- Ngân sách 60/phút của `ai-byok` giờ chia giữa web, frame và desktop của cùng một người.
- Desktop mang thêm logic chọn nguồn trong main process (đọc khóa nền, đệm, lùi, lựa chọn
  model có dấu thời gian); `packages/ai-provider` nhận hàm viết lại URL của web (một nguồn,
  hai host).
- Luật giữ: không thêm route nên `TestIsolationMatrix` (`isoRoutes`,
  `server/internal/handler/isolation_routes_test.go`) không cần dòng mới; không lệnh mới nên
  `audit_coverage_test.go` không đổi. Test mới xem hợp đồng API §7.
- Giới hạn đã biết của 0029 vẫn áp: stream openai-compatible chỉ có token khi client đặt
  `stream_options.include_usage` (Q-K5 = (a): không viết lại body); khóa của thành viên bị gỡ
  không tự xóa (nhưng không dùng được vì `RequireMember`).
- Còn tồn (không chặn): danh sách model Anthropic qua R5 gọi `/v1/models` không có `limit`
  nên chỉ thấy trang đầu ngắn (`vendorCall` trong `server/internal/ai/proxy.go`); chi tiết ở
  mục "Residuals" của hợp đồng API.

## Trạng thái

`proposed` (2026-10-14, G6-05k, UNI-1637); **chờ người dùng trả lời Q-K1**. Chưa có ngày
chấp nhận. Khi người dùng chọn (a), việc chấp nhận là một bước một dòng: chuyển ra
`docs/adr/`, đổi `accepted` kèm ngày, thêm vào bảng trong `README.md`, và thêm một dòng vào
mục Audit and Events của `CLAUDE.md` kèm tên test giữ luật (hợp đồng API §7). Bổ sung cho
0028 và 0029; không thay thế ADR nào.
