# 0051 — Mọi AI chỉ chạy bằng UniWork AI: gỡ BYOK khỏi khung web, kho khóa trên UniWork và máy chủ

**Trạng thái:** accepted (2026-10-29, UNI-2289) — chủ sản phẩm quyết ngày 2026-10-27: Q6 và Q10 của spec Hỏi UNI × Office ("Mọi AI chạy bằng UniWork AI, không khóa ngoài"; "Q6 áp cho cả sản phẩm"), "cứ chuyển đổi thẳng thôi" (app còn đang phát triển) và Q-B1 = (a) của spec gỡ BYOK (gỡ cả khóa trên máy và CLI của app desktop). Viết thẳng ở thư mục gốc, không qua `drafts/`, vì quyết định đã có.
**Issue:** UNI-2289 · **Thay:** [0028](0028-ai-phia-client-cua-uniwork-office.md) Quyết định 2; [0029](0029-ai-cua-office-tren-web-qua-ai-gateway.md) phần kho khóa, proxy, `office.ai_byok`, header vendor, rào `custom`; [0034](0034-desktop-dung-khoa-luu-tren-uniwork-qua-proxy-byok.md) toàn bộ · **Liên quan:** [0010](0010-ai-khong-ghi-truc-tiep-de-xuat-xac-nhan-thuc-thi.md), [0044](0044-hoi-uni-ghi-qua-de-xuat-tren-server-va-ba-che-do-quyen.md), [0045](0045-agent-hop-goi-stt-truc-tiep-llm-qua-gateway.md), [0048](0048-goi-giao-viec-dua-tu-lieu-hoi-uni-vao-ai-trong-trinh-soan.md), [0050](0050-route-viet-cho-uniwork-ai-prompt-giu-o-server.md).
**Nguồn:** spec `docs/superpowers/specs/2026-10-27-remove-byok-design.md` (v2; spec gọi ADR này là "0048", nhưng 0048–0050 đã có chủ nên nhận số 0051), kế hoạch `docs/superpowers/plans/2026-10-29-remove-byok-p1-web-and-org-keys.md`.

---

## Bối cảnh

BYOK ("dùng khóa AI của riêng mình") chỉ có trong trình soạn Office, theo ba đường. Hỏi UNI và agent họp đã chạy bằng
UniWork AI từ trước.

| Đường | Quyết định cũ | Khóa nằm ở đâu | Đi qua máy chủ UniWork? |
| --- | --- | --- | --- |
| A. Office trên web (khung genoffice) | 0029 | bảng `ai_provider_credentials`, mã hóa bằng `AI_CREDENTIAL_KEY` | có: proxy pass-through `/ai/byok/*` |
| B. App desktop đã đăng nhập, "Khóa trên UniWork" | 0034 | cùng bảng; app không bao giờ nhận khóa | có: cùng route proxy, phiên thiết bị |
| C. App desktop, khóa trên máy hoặc CLI cục bộ | 0028 Quyết định 2 | `ai-settings.json` trên máy | không: app gọi thẳng nhà cung cấp |

Ngày 2026-10-27 chủ sản phẩm chốt một đường AI cho cả sản phẩm: UniWork chọn và chịu trách nhiệm về model, vùng dữ
liệu, thời gian giữ log (G6-D2), đo đếm và tính tiền theo gói; không còn bí mật nhà cung cấp của khách nằm trên máy chủ
UniWork. Vì app chưa có khách dùng thật, việc gỡ làm thẳng một lần, không cờ, không thông báo khách, không giai đoạn
giữ khóa. Q10 đặt việc gỡ sau dự án "Hỏi UNI soạn tệp Office", vì dự án đó đưa `write_document`, `generate_deck`,
`regenerate_slide` lên UniWork AI; dự án đó ship Phần 5 ngày 2026-10-29 (PR #516, ADR 0050).

Một bẫy kỹ thuật làm việc gỡ không chỉ là xóa: trước ADR này máy chủ chỉ cấp công cụ đám mây (tìm web, tìm ảnh, sinh
ảnh) cho khung web khi BYOK bật (`officeFrameAIGrant` đòi trường `ai`). Xóa BYOK mà không sửa cấp quyền thì mất luôn
các công cụ đó.

## Quyết định

1. **Một đường AI.** Mọi AI của UniWork — Hỏi UNI, agent họp, trình soạn Office trên web và trên desktop — chạy bằng
   UniWork AI qua `ai.Gateway`, dưới entitlement `office.ai_cloud` và credit `ai.tokens` của gói tổ chức. UniWork không
   nhận, không lưu, không giải mã, không chuyển tiếp khóa nhà cung cấp của người dùng. Không có proxy pass-through tới
   nhà cung cấp do người dùng chọn. App desktop không gọi thẳng nhà cung cấp bằng khóa trên máy hay CLI cục bộ (thời
   điểm của phần desktop: Quyết định 5).
2. **Đã gỡ ở kế hoạch 1 (UNI-2289).**
   - Máy chủ: ba route khóa `/orgs/{orgID}/ai/credentials*`, bốn route proxy `/orgs/{orgID}/ai/byok/*` và bản mount của
     chúng dưới `/office-frame/documents/{documentID}/ai/...`; service kho khóa, proxy và client vendor của proxy; hai
     nhóm rate limit `ai-credentials` và `ai-byok`.
   - Dữ liệu: migration `9991793265480000_drop_ai_provider_credentials` bỏ bảng `ai_provider_credentials` và mọi dòng
     `office.ai_byok` ở `features` và `plan_features`. Biến `AI_CREDENTIAL_KEY` rời `.env.example` và máy chủ.
   - Cấp quyền khung: `officeFrameAIGrant` không còn trường `ai`; `web_search`, `image_search`, `image_generation` đi
     theo `uniwork_ai` (thành viên, `office.ai_cloud`, UniWork AI cấu hình, cờ `office_ai_uniwork` và cờ định dạng của
     module) cộng trạng thái cloud của từng công cụ.
   - Client trong repo này: lớp client kho khóa không ai gọi, câu chữ "khóa riêng" ở landing và trang hướng dẫn, nửa
     `byok` của harness G7.
   - Fork `UNIAI-TEAM/uniwork-office` (PR #27): khung web chỉ còn nhà cung cấp `uniwork`, credit hiện ở chip model,
     giao thức khung bỏ năng lực `ai`; app desktop bỏ nguồn "Khóa trên UniWork" (đường B). Repo này pin lại bundle và
     vendor lại giao thức trong cùng PR, nên không có lúc nào khung gọi một route đã mất.
3. **Chuyển thẳng, không mã chuyển tiếp.** Không cờ bật/tắt BYOK, không route trả "đã gỡ": route chỉ không còn. App
   desktop bản cũ hỏi `GET /orgs/{orgID}/ai/credentials` bằng phiên thiết bị hợp lệ nhận 404 và coi là "không có khóa
   tổ chức" (Quyết định 7 của 0034 đã định hành vi đó); nhóm "Khóa trên UniWork" biến mất, UniWork AI và công cụ đám
   mây của desktop vẫn chạy. Down migration dựng lại đúng lược đồ của bảng (để chuỗi down cũ còn chạy về tới 004) nhưng
   không bao giờ dựng lại khóa: khóa đã lưu mất hẳn khi up chạy.
4. **Điều kiện trước khi merge và sau khi deploy** (spec §4, §5).
   - C1, đã đạt: Phần 5 của "Hỏi UNI soạn tệp Office" ship ngày 2026-10-29.
   - C2: chạy hai truy vấn chỉ đọc ở spec §8 trên production (ai có khóa trong `ai_provider_credentials`; ai dùng
     `office.byok`/`office.byok_desktop` trong 90 ngày). Chỉ ra tổ chức nội bộ hoặc thử nghiệm thì merge; ra tổ chức thật
     thì dừng và hỏi chủ sản phẩm, vì bỏ bảng không đảo được.
   - C3: ở mọi môi trường đang dùng (dev, staging, production nội bộ), cờ `office_ai_uniwork` và sáu cờ định dạng bật,
     UniWork AI đã cấu hình; kiểm bằng `GET /api/v1/config` của một thành viên. Thiếu C3 thì trình soạn ở môi trường đó
     không còn AI nào.
   - Sau deploy: xóa `AI_CREDENTIAL_KEY` khỏi secret manager mọi môi trường. Hủy khóa chủ làm ciphertext còn trong bản
     sao lưu cũ thành không giải mã được.
5. **Đường C gỡ ở kế hoạch 2.** Khóa trên máy và CLI cục bộ của app desktop (0028 Quyết định 2) đã quyết gỡ
   (Q-B1 = (a)), nhưng phần gỡ nằm ở kế hoạch 2, vì còn năm việc chờ chủ sản phẩm: bộ viết trên desktop, "My AI" và ví
   credit OpenRouter, lệnh `image`/`media`/`search` của CLI genoffice, chuỗi tìm kiếm miễn phí, và tính năng media mất
   khi chỉ còn công cụ đám mây. Cho tới khi kế hoạch 2 xong, app desktop còn giữ khóa trên máy và gọi thẳng nhà cung
   cấp; trang quyền riêng tư nói đúng điều đó (`apps/web/features/landing/privacy-content.ts`, mục UniOffice, vi và
   en). Máy chủ không phụ thuộc đường C. Câu "app desktop không gọi thẳng nhà cung cấp" chỉ vào `CLAUDE.md` khi kế
   hoạch 2 xong.
6. **`packages/office-upstream/` không đụng.** `upstream/` là bản chép giống từng byte của genoffice gốc ở commit đã
   pin, kiểm bằng `provenance.json` (`node scripts/office/vendor-upstream.mjs --check` báo lỗi ở mọi tệp bị sửa), và
   README của gói ghi "Never edited". Mã BYOK trong đó chỉ nằm ở các app desktop gốc (`upstream/apps/*/src/main`), mà
   `scripts/office/build-upstream.mjs` chỉ bundle các gói engine dưới `upstream/packages/` (ví dụ `xlsx-gateway` cho
   engine Office) và dựng engine Rust `upstream/apps/sheets/native/xlsx-engine`, không đụng `src/main` của app nào,
   nên mã đó không vào build sản phẩm nào. Sửa ở đó chỉ làm lệch bản đối chiếu mà không đổi hành vi nào.

**Phần của 0029 vẫn đúng** (nhắc lại để không mất lý do; code nay ghi "ADR 0029's cloud part, kept by ADR 0051"):

- Công cụ đám mây UniWork (tìm web và ảnh, sinh ảnh, phân tích media, phiên âm) đi qua `ai.Gateway`, thứ tự cổng
  `RequireMember` → `Can(office.ai_cloud)` (fail-closed) → kiểm đầu vào → `CheckQuota(ai.tokens)` → Gateway → dòng sử
  dụng + `RecordUsage`. Khóa nhà cung cấp phía UniWork nằm ở biến môi trường `AI_CLOUD_*` của máy chủ; công cụ chưa
  cấu hình báo `available:false` và route trả 503 `cloud_unavailable`. Client gửi byte, máy chủ không tự tải URL media.
- Bảng tính credit, một bảng Go ở `server/internal/ai/cloud.go` (đổi số là đổi giá khách trả, thuộc chủ sản phẩm):
  tìm kiếm 500 mỗi lần; sinh ảnh 4000 mỗi ảnh trả về; phiên âm 1000 mỗi phút bắt đầu (tối thiểu 1 phút, theo thời lượng
  nhà cung cấp báo, không báo thì ước lượng từ dung lượng tệp theo bitrate điển hình của định dạng); phân tích media tính
  token thật. Công cụ tính cố định ghi mức token-tương-đương vào `input_tokens` của dòng sử dụng; lệnh gọi lỗi không
  tính; dòng sử dụng và meter chốt trên context tách khỏi request (10 giây), lệnh gọi nhà cung cấp của công cụ tính cố
  định cũng tách khỏi request (4 phút), nên client ngắt giữa chừng không làm lệnh gọi đã tốn tiền thành miễn phí.
- Giới hạn đầu vào và danh sách MIME của 0029 (body tìm kiếm ≤ 1 MiB, sinh ảnh ≤ 44 MiB, phân tích media và phiên âm
  ≤ 36 MiB; 422 `media_unsupported` ngoài danh sách; chuỗi MIME của client không bao giờ vào prompt).
- Rate limit theo danh tính và theo nhóm route: `ai-cloud` 20/phút cho bốn route công cụ (`GET .../ai/cloud` chỉ chịu
  giới hạn toàn cục), chung giữa route phiên và route khung; chỉ có khi có Redis, fail-open.
- `internal/ai` chỉ gọi query `Ai*` và không ghi bảng nghiệp vụ; HTTP tới nhà cung cấp chỉ nằm trong
  `internal/ai/provider` (`TestAIPackageOnlyCallsAiQueries`, `TestProviderSDKOnlyInAIProvider`).
- Handler đám mây là mountable (`handler.NewAIMountable`, một `AIActorResolver`): route phiên dùng user của phiên +
  `{orgID}`, khung web mount dưới `/office-frame/documents/{documentID}/ai/...` với resolver đọc claim của token khung
  và kiểm lại quyền xem tài liệu mỗi request. Nửa cloud của `AIMountable` (`Cloud*`, `UniworkChatCompletions`,
  `UniworkWrite`) giữ nguyên.

**Phần của 0028 vẫn đúng** (Quyết định 1, 3, 4, 5):

- QĐ1: ADR 0010 chỉ điều chỉnh runtime agent phía server, không điều chỉnh app UniWork Office.
- QĐ3: mọi thứ tốn credit UniWork hoặc dùng công cụ đám mây của UniWork đi qua UniWork API bằng phiên UniWork của người
  dùng, máy chủ định tuyến qua `ai.Gateway` với entitlement theo gói của tổ chức. Từ ADR này đó là đường AI duy nhất.
- QĐ4: app không bao giờ giữ khóa nhà cung cấp của UniWork hay credential phía máy chủ nào.
- QĐ5: AI của khung web chỉ đi qua UniWork API + `ai.Gateway`, không bao giờ dùng khóa giữ trong trình duyệt. Từ ADR
  này, đó cũng không còn là khóa của người dùng lưu trên máy chủ.

**Không đổi:** ADR 0010; luật Hỏi UNI ghi qua đề xuất (0044); agent họp gọi STT trực tiếp, LLM qua Gateway (0045); gói
giao việc (0048); route viết (0050; các câu của nó về đường BYOK của bộ viết nay chỉ còn đúng cho app desktop, tới kế
hoạch 2). Dòng
`ai_usage_events` cũ (capability `office.byok`, `office.byok_desktop`) và dòng `audit_events` cũ giữ nguyên; nhãn
`office_byok`, `office_byok_desktop` ở client giữ để bảng sử dụng các tháng cũ vẫn đọc được.

## Phương án đã cân nhắc và loại

- **Gỡ cuốn chiếu theo tổ chức, có cờ, thông báo khách, giữ khóa 14 ngày** (bản v1 của spec). Đúng cho sản phẩm có
  khách thật; ở đây chỉ thêm mã chuyển tiếp phải gỡ lần hai. Chủ sản phẩm chọn chuyển thẳng; C2 là lưới an toàn duy nhất.
- **Giữ route khóa trả 410 "đã gỡ" cho app desktop cũ.** App cũ đã hiểu 404 là "không có khóa tổ chức" (0034 QĐ7), nên
  một route sống chỉ để nói "đã gỡ" là mã thừa.
- **Khóa dùng chung toàn tổ chức do quản trị đặt** (hướng mở rộng (b) của 0034). Vẫn là bí mật của khách nằm trên máy
  chủ UniWork; bỏ hẳn.
- **Gỡ cả đường C trong kế hoạch 1.** Năm việc của đường C mỗi việc làm mất một tính năng desktop đang chạy và chưa có
  quyết định; máy chủ không phụ thuộc chúng, nên tách thành kế hoạch 2 không chặn phần còn lại.

## Hệ quả

- Không còn bí mật nhà cung cấp của khách trên máy chủ UniWork: không bảng khóa, không khóa chủ, không proxy.
- Người dùng mất việc tự chọn model và nhà cung cấp trong trình soạn; mọi lượt AI tiêu `ai.tokens`, hết hạn mức thì
  UniWork AI trả 402 `credits_exhausted`. Tổ chức có `office.ai_byok` đã có `office.ai_cloud` (hai khóa được seed cùng
  nhau), nên không phải đổi gói.
- Không còn AI dự phòng: khi UniWork AI hỏng, trình soạn web không có AI nào (editor và Lưu vẫn chạy). Alert
  `UniworkAiModelErrors` và runbook của nó nói đúng điều đó; mức nghiêm trọng (`severity: "2"`) phải xem lại trước khi
  có người dùng thật (spec R3). G6-D2 (nhà cung cấp production của UniWork AI) không còn chặn việc gỡ BYOK, nhưng phải
  đóng trước khi có người dùng thật với dữ liệu thật.
- Ba công cụ vẫn bị chặn dưới UniWork AI sau Phần 5 (`insert_web_image`, `replace_image`, `save_style_template`) không
  có đường thay thế; chấp nhận mất (spec §4).
- Rollback: trước khi migration chạy ở một môi trường, revert PR và pin lại fork cũ là xong; sau đó code revert được
  nhưng khóa đã lưu mất hẳn, ai cần BYOK lại phải nhập lại khóa.
- Tới khi kế hoạch 2 xong, lưu lượng của đường C (app desktop, khóa trên máy) vẫn nằm ngoài đo đếm và audit của UniWork
  như 0028 đã chấp nhận; app desktop cũ còn khóa trên máy vẫn gọi thẳng nhà cung cấp cho tới khi người dùng cập nhật
  (không có cổng phiên bản tối thiểu cho app Office, spec R6).
- `docs/office/g5g6g7/contracts/g6-05k-org-keys-api.md` (hợp đồng API của 0034) và các mục BYOK trong tài liệu Office cũ
  được giữ làm lịch sử, có ghi chú "superseded by 0051".

## Cách kiểm

- `TestNoProviderKeyRoutes` (`server/internal/handler/router/provider_keys_gone_test.go`): không route nào khớp
  `/ai/credentials` hay `/ai/byok/`, cả mount phiên lẫn mount khung.
- `TestOldDesktopKeyListIsNotFound` (`server/internal/handler/office_frame_ai_test.go`): app desktop cũ với phiên thiết
  bị hợp lệ nhận 404 ở danh sách khóa và ở proxy; không gọi model, không ghi sử dụng.
- `TestOfficeFrameCloudToolsFollowUniworkAI` (`server/internal/handler/office_frame_ai_test.go`): ba công cụ đám mây
  được cấp theo `uniwork_ai` mà không có trường `ai`; tắt `office_ai_uniwork` thì không có.
- `TestNoProviderCredentialTable` (`server/migrations/provider_credentials_gone_test.go`): sau mọi migration không còn
  bảng `ai_provider_credentials` và không còn dòng `office.ai_byok`.
- `TestDropProviderCredentialsUpDownUp` (`server/migrations/provider_credentials_gone_test.go`): môi trường có dòng khóa
  chạy up sạch, down dựng lại đúng lược đồ (không có khóa), up lại được.
- Giữ nguyên: `TestProviderSDKOnlyInAIProvider`, `TestAIPackageOnlyCallsAiQueries` (`server/internal/arch_test.go`).
- Phía fork: test của khung web và app desktop ở PR #27 (`aiHostGrants`: `uniworkAi` một mình mở panel; không còn đường
  "Khóa trên UniWork").

## Trạng thái

`accepted` (2026-10-29, UNI-2289). Thay 0028 Quyết định 2, phần kho khóa và proxy của 0029, và toàn bộ 0034; ba ADR đó
đổi dòng trạng thái thành `superseded by 0051`, nội dung lịch sử giữ nguyên. Phần desktop của Quyết định 1 hoàn tất ở
kế hoạch 2.
