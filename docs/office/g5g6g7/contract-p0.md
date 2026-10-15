# UniWork Office G5/G6/G7 — Gói hợp đồng P0 (X-01)

> **Trạng thái:** in-progress — người dùng đã ký lô #1 ngày 2026-10-12 (U-15, "duyệt theo gợi ý": mọi khuyến nghị ở đây có hiệu lực); lô #2 (G6-D1) đã ký ngày 2026-10-13 00:35 UTC+7 ("duyệt theo gợi ý": số A1–A16, Q1–Q6; A17 chuyển G6-D2); lô #2b (G5-D1: amendment DOC-005 + threat model lease offline) đã ký ngày 2026-10-13 ("duyệt theo gợi ý": 20 hàng + 17 hàng threat model); còn chờ điền N′ (bản dev đầu tiên có G5-04g) và lệnh harness (g7-qa)

**Issue:** UNI-1338 (X-01), parent UNI-660 (`Refs: UNI-635, UNI-661`), tài liệu UNI-923.
**Nguồn ràng buộc:** [spec v1.2](../../superpowers/specs/2026-10-02-office-g5-g6-g7-design.md) (duyệt U-13),
[plan v2.6](../../superpowers/plans/2026-10-12-office-g5-g6-g7.md) thẻ X-01 (plan §5.1), plan §2, §3, §6.3, §8.
**Người soạn:** worker `worker-x01_contract_p0 (UNI-1338)` cho Advisor của Run `run_a635eef8717c`, ngày 2026-10-12.
**Cách đọc:** mọi dữ kiện code ghi `file:line` tại SHA ở mục 1 (D = `dev-uniwork`, F = fork `uniwork-office`). Ô
"Đề xuất" là khuyến nghị chờ ký; khi người dùng ký, Advisor đổi thành "Đã chốt (ngày, mã quyết định)". Tới lúc đó các lane
dùng giá trị đề xuất và ghi "theo draft contract-p0" trong packet của mình (team-rules › Open gates).

## 1. Nền (C1–C5)

| Mục | Giá trị | Nguồn |
| --- | --- | --- |
| D `origin/develop` | `2e9586c25` (merge PR #246, UNI-1310) | `git log` |
| D root (tích hợp) | `feature/UNI-923-office-g5-g6-g7` tại `b6a0f4150` | nhánh này tách từ đó |
| F `origin/main` | `0d03b185`, tag `v0.11.0-dev.7` (`git describe --tags` đúng tại HEAD) | fork clone |
| Phiên bản app fork | `apps/shell/package.json` `version` = `0.11.0` | F |
| Pin web (cả sáu) | `0.1.0-0d03b18`, `gitSha` `0d03b18`: `apps/web/platform/office-frame/{docs,sheets,slides,pdf,markdown,html}.pin.json:3` | D |
| Bản cài server đang phục vụ (kênh dev) | `0.11.0-dev.7` (tên tệp `UniWork-Office_0.11.0-dev.7_unsigned_{win32_x64-setup.exe, darwin_arm64.dmg, darwin_x64.dmg, linux_x64.deb, linux_x64.AppImage}`); kênh beta/stable rỗng | `deploy/app/env/uniwork-be.env:145-147` (chỉ đọc tên tệp; URL không chép vào đây) |
| Cách server phát bản cài | Không lưu bản cài; `GET /api/v1/office/desktop/download` trả link theo kênh từ `OFFICE_INSTALLER_<CHANNEL>_URLS`; phiên bản tách từ tên tệp bằng regex | `server/internal/handler/router/config.go:31`, `server/internal/config/office_installers.go:15,83-84`, `docs/office/g3g4/uniwork-office-app-api-contract.md:253-267` |

Bản cài đang phục vụ (`0.11.0-dev.7`) trùng tag mới nhất của fork tại `0d03b185`; bằng chứng G7 vẫn ghi cả hai (spec §9.3).

| # | Điều kiện | Trạng thái | Bằng chứng |
| --- | --- | --- | --- |
| C1 | Spec v1.2 được duyệt | **Đạt** | U-13, 2026-10-12 (spec §1.2) |
| C2 | PR #219 (UNI-1001) vào `develop` | **Đạt** | squash commit `fc171d4a2` "UNI-1001: UniWork Office genoffice pivot … (#219)", tổ tiên của `2e9586c25` |
| C3 | Gỡ G3/`apps/office-desktop` (GO-B7) | **Đạt** | `apps/office-desktop` không còn ở D; commit cuối chạm `apps/office-desktop/package.json` là `fc171d4a2` (việc gỡ đi trong chính PR #219, không có merge riêng của UNI-1240) |
| C4 | Mô tả UNI-660/635/661 reconcile với U-08/U-09; sub-issue theo plan §5 | **Một nửa** | 51 sub-issue UNI-1338..1388 đã tạo (plan dòng 8–15); reconcile mô tả ba issue cha là việc UniAI của Advisor, chưa có bằng chứng trong repo |
| C5 | Handoff packet §10.3 (SHA D/F, pin, bản cài, tag) | **Đạt bằng bảng trên** | mục 1 này; bảng công cụ AI theo module do G6-01 giao |

Chỗ lưu "My AI"/model theo tài khoản (UNI-1240, đầu vào G6 theo spec §1.4): đi cùng PR #219 (`fc171d4a2`); G6-02/G6-03c
xác minh đường dẫn cụ thể khi dùng; owner việc kiểm tra đường dẫn này là G6-03c (lô #2, Q5).

## 2. Owner

Theo U-14, vai trò owner người của plan §1 do lead agent đảm nhận; mọi điểm *hitl* về người dùng qua decision packet của
Advisor. Lane hiện có trong Run: `g5-fork_main` (local), `g6-ai_server` (local), `g6-fork_tools` (VPS bro), `g7-qa`
(VPS bro). Team T1/T2/T5/T7 khác theo `execution-plan.md` §2 của Advisor; lane chưa mở thì Advisor giữ vai trò tới khi mở.

| Vai trò plan | Ai giữ | Ký *hitl* |
| --- | --- | --- |
| Coordinator | Advisor (phiên Claude trên root) | — |
| Lead D | Lead lane T1 (contract/registry) cho registry + protocol phía D; lead lane T2 (Documents server) cho feed/commit/lease; tới khi mở: Advisor | — |
| Lead F | Lead `g5-fork_main` (L9 store/sync), lead T5 (renderer + i18n), lead `g6-fork_tools`/T6 (AI fork); owner seam protocol = lead T1 | — |
| AI Platform | Lead `g6-ai_server` (L6, L7, L13) | G6-D1 → người dùng |
| G1/FileService | Lead T2 (soạn); quyết định số | **Người dùng** (G5-D2, OQ-P1) |
| Auth | Lead T2 (soạn lease) | **Người dùng** (G5-D1 amendment + threat model) |
| Product | — | **Người dùng** (U-01, G6-D4, G7-D1) |
| UX | Lead T5 (soạn, review UI) | **Người dùng** (U-01) |
| OPS | Lead `g7-qa` (soạn runbook/alert) | **Người dùng** (G6-D2, G7-D1, G7-D2, OQ-P4) |
| QA | Lead `g7-qa` | **Người dùng** ký kết luận G7-11 |

**Owner seam (plan §6.3):**

| Seam | Owner | Lane giữ |
| --- | --- | --- |
| Frame protocol + pin bundle | Lead F (protocol) | T1 (X-02 → G5-09w → G5-03w) |
| Tín hiệu lượt AI (`aiRun`, `uniwork:ai-run`) | Lead F | T1 định hình (X-02); T6 phát (G6-05) |
| D `use-docs-frame-session.ts` | Lead D | T1 (G5-03w) rồi T6 phần D (G6-05) |
| `providers.ts` + `uniwork-cloud.ts` (F) | Lead F | T6 (G6-05) |
| Registry D (`keys.go`, `error_class.go`, route capability app) | Lead D | T1 (X-03) |
| Migration | Lead D | Advisor giữ thứ tự merge (mục 5) |
| `openapi.go`, `router.go` | Lead D | nối tiếp qua root |
| `server/cmd/server/main.go` (shutdown) | Lead D | nối tiếp qua root |
| `scripts/check.sh` | Lead D | Advisor điều phối dòng thêm |
| D `server/internal/ai/provider/*`, `policy.go`, registry prompt | AI Platform | `g6-ai_server` |
| i18n fork | Lead F | T5 (U-02) |
| Lớp store bền của app | Lead F | `g5-fork_main` |
| `save-coordinator.ts` (F) | Lead F | `g5-fork_main` / T5 nối tiếp |
| `audit_coverage_test.go`, `isolation_matrix_test.go` | Lead D | mỗi lane thêm dòng, nối tiếp |
| Catalogue sự kiện (3 bản) | Lead D | T2 (chỉ G5-01b) |

## 3. Tên route

Quy ước đã kiểm (`docs/api-sdi-sdo.md:16-37, 97-116, 151-196`): tiền tố `/api/v1` (`router/router.go:120`); đăng ký qua
wrapper `api` + `apiOp{summary (EN), description (VI), tags, sdi, sdo, auth, status}`; SDI `{Verb}{Resource}SDI`, SDO
`{Resource}SDO`; tham số path mới cần case `pathParamSDI` (tên theo thứ tự URL, nối bằng dấu phẩy). Tham số đang dùng:
`{workspaceID}`, `{documentID}`, `{orgID}` (route AI/documents theo id tổ chức), `{org}` (route tổ chức nhận id hoặc slug).
Phiên app desktop là bearer thường qua `RequireAuthWithDevice` (`router/router.go:126-133`,
`internal/middleware/auth.go:23-46`), không có nhóm route riêng cho app.

| Route | Đề xuất cuối | Kiểm va chạm | Ghi chú |
| --- | --- | --- | --- |
| Feed (G5-01a) | `GET /workspaces/{workspaceID}/documents/changes?cursor=&limit=` | Không trùng; anh em tĩnh `recent` (`router/documents.go:378`), `tree` (:394); `pathParamSDI` `workspaceID` đã có | SDI `ListDocumentChangesSDI`, SDO `DocumentChangeListSDO`; cursor chỉ trong query, opaque. Cửa sổ membership (G5-01a): quyền thành viên và quyền đọc của snapshot cold start tính tại điểm MVCC của snapshot (lệnh đầu của transaction REPEATABLE READ, cùng điểm với high-water mark); thu hồi commit sau điểm đó không hủy hay cắt snapshot đang dựng (snapshot chứa đúng tài liệu caller đọc được tại điểm đó), còn mọi request sau — cursor trang kế hay cold start mới — bị gate membership từ chối (403/404), không có dữ liệu |
| Tra intent (G5-07) | `GET /documents/{documentID}/versions/commit` + header `Idempotency-Key` | Cùng path với `POST …/versions/commit` (`router/documents.go:114`), khác method; không tham số mới | Khóa idempotency không vào URL/access log; trả `{outcome: committed\|not_committed\|in_flight\|unknown, version?, revision?}`; đọc được cả khi `office_sync_write` tắt (plan G5-07). Phương án dự phòng: `POST …/versions/commit/lookup`. Số retention: G5-D2 |
| Lease offline (G5-08s) | `PUT /documents/{documentID}/office/offline-lease` (cấp/gia hạn, idempotent theo thiết bị) · `DELETE` cùng path (trả) | Không trùng; nhóm `/documents/{documentID}/office/*` đã có `sessions`, `capabilities`, `jobs` (`router/documents.go:90,210,218`) | Thiết bị lấy từ phiên bearer, không từ body; phiên web hoặc sid không có hàng `device_sessions` sống → 403 `offline_lease_device_required`. **Đã chốt: G5-D1 (lô #2b, ký 2026-10-13)**, chi tiết [DOC-005 §6.2](../g0/login-sync-contract.md) |
| Capability app (X-03) | `GET /orgs/{orgID}/office/capabilities` | Path không trùng; nhưng đã có `GET /documents/{documentID}/office/capabilities` với nghĩa khác (định dạng/thao tác, `OfficeCapabilitySDO`, `dto/sdo/office.go:43`) | Giữ path theo plan, đặt SDO `OfficeAppCapabilitiesSDO` và summary "Office features enabled for this organization (app)" để không lẫn; `pathParamSDI` `orgID` đã có (`router/openapi.go:269`) |
| UniWork AI (G6-03a, để tham chiếu) | `POST /orgs/{orgID}/ai/uniwork/chat/completions` · `POST /office-frame/documents/{documentID}/ai/uniwork/chat/completions` | Cùng họ `/orgs/{orgID}/ai/*` (`router/ai_byok.go:22`, `ai_cloud.go:23`) | Tên theo plan G6-03a; hình dạng wire: G6-D1 |
| UniWork AI, route tài liệu (G6-03a; A10/OQ-P2 = G6-D1 hàng 10) | `POST /documents/{documentID}/ai/uniwork/chat/completions` | Cùng họ `/documents/{documentID}/ai/*` đã có; `pathParamSDI` `documentID` đã có | Phiên tài liệu của app desktop (bearer thiết bị qua `RequireAuthWithDevice`); tổ chức/workspace/module suy từ tài liệu, quyền đọc kiểm lại mỗi request. Không thêm số hay hành vi mới: mọi giá trị theo A10/OQ-P2 đã ký |

## 4. Flag, mã lỗi (X-03) và `ReviewAt`

Cách khai flag: `server/internal/featureflags/keys.go:17-29` (`Key`, `Description`, `Default`, `Public`, `Owner`,
`ReviewAt: day(y, m, d)`). Flag office hiện có review 2026-12-31 (`keys.go:41-47`) và 2026-12-05 (`:48-53`); ngày xa nhất
trong file 2027-01-31 (`:54-55`).

**`ReviewAt` đề xuất: `day(2027, 3, 31)` cho mọi flag mới của phase.** Giả định: spec không đặt ngày (§13.1 "không đặt ngày
hoàn thành"); với 10 wave (plan §6.1) và nhịp lane hiện tại, P3 dự kiến trước cuối 2027-02; thêm một tháng đệm để
`TestFlagsAreReviewed` không đỏ giữa phase. Nếu P3 trễ, owner registry dời ngày trong một PR có lý do.

| Flag | Default | Public | Nghĩa |
| --- | --- | --- | --- |
| `office_sync_feed` | true | true | Đọc feed; web tắt thanh S6 khi tắt |
| `office_sync_write` | true | false | Kill switch dispatch intent mới; giữ queue/nháp/đối soát |
| `office_offline_library` | false | false | Cấp/gia hạn lease, ghim offline |
| `office_ai_uniwork` | false | true | Kill switch UniWork AI (BYOK không đổi); tắt cho org có dữ liệu thật tới khi G6-D2 đóng |
| `office_ai_uniwork_{docx,xlsx,pptx,pdf,markdown,html}` | false | true | Capability theo định dạng; G7-08 điều khiển |

Tất cả `Owner: "office"`, `ReviewAt: day(2027, 3, 31)`.

Mã lỗi: `server/internal/handler/dto/sdo/error_class.go:9-58` là bảng mã → `error_class` duy nhất; HTTP đặt ở chỗ phát.
Lớp có sẵn: `conflict`, `gone` ("dừng thử lại và rời", `:24-25`), `quota`, `permission`, `missing`, `incompatible`,
`session`. Cổng billing/entitlement và giới hạn tốc độ cố ý không có lớp (`:30-33`).

| Mã | HTTP | `error_class` đề xuất | Lý do | Ai thêm |
| --- | --- | --- | --- | --- |
| `change_cursor_expired` | 410 | không lớp | `gone` dạy client "rời đi", trái với full resync; parser feed riêng của G5-04 tự switch theo mã (plan G5-04) | X-03 |
| `change_cursor_invalid` | 400 | không lớp | Cursor giả/sai scope; không lộ phạm vi | X-03 |
| `run_limit_reached` | 409 | không lớp | Lô #2 (Q2): 429 khiến fork phân loại thành "AI bận"; dùng 409 như `conversation_expired`, client rẽ nhánh theo mã | X-03 |
| `run_expired` | 409 | không lớp | Run id không thuộc — lạ, đã hết hạn, của hội thoại khác, của tổ chức khác — là 409 `run_expired`: client bỏ id và hỏi lại như run mới, hội thoại vẫn sống (khác `conversation_expired`) | G6-03b khi giao (Advisor 20:22Z, Q1) |
| `office_capability_off` | 403, `fields.capability` | không lớp | Flag ẩn capability, không là từ chối quyền (CLAUDE.md › Platform Admin); không nhập vào `permission` để client không chạy đường mất quyền | X-03 |
| `commit_intent_unknown` | 410 | không lớp | Kết quả intent đã bị dọn: "không biết", không giả "chưa commit" (plan G5-07) | X-03 thêm khi G5-D2 chốt retention; tên chốt ngay |
| `offline_lease_revoked` | 403 | `permission` | Gia hạn hàng đã revoke, epoch cũ hoặc chữ ký hỏng (xoay `JWT_SECRET`); G5-D1 hàng 15 | G5-08s |
| `offline_lease_device_required` | 403 | không lớp | Phiên web hoặc sid không có hàng `device_sessions` sống; không dùng `office_capability_off` vì flag vẫn bật; G5-D1 hàng 5 | G5-08s |
| `offline_lease_limit_reached` | 409 | không lớp | Vượt 200 lease sống mỗi thiết bị; G5-D1 hàng 11 | G5-08s |
| `document_archived` | 403 | không lớp | Gia hạn lease của tài liệu archived; chỉ trả cho người giữ hàng lease sống của chính tài liệu đó nên không lộ tồn tại; mã chưa có trong server; G5-D1 hàng 14 | G5-08s |
| ~~`offline_lease_expired`~~ | — | — | **Server không phát** (G5-D1 hàng 15): gia hạn sau khi hết hạn được phép nếu quyền sống còn; `lease_expired` chỉ là lý do phía app (EXPERIENCE) | — |
| `conversation_expired` | 409 | không lớp | Theo plan G6-03a | G6-D1 đã chốt (lô #2 ký 2026-10-13); G6-03a đăng ký |
| `ai_tool_result_too_large` | 413 | không lớp | Tool result vượt trần 64 KiB/lần hoặc 256 KiB/request (A6; Q4) | G6-03a/G6-03b khi giao |
| `ai_uniwork_busy` | 429 (`Retry-After: 5`) | không lớp | Vượt trần đồng thời 32/pod, 64 toàn cục, 8/org (A11; Q4) | G6-03a/G6-03b khi giao |
| `ai_provider_timeout` | 504 | không lớp | Quá hạn 55 s chờ upstream (A14; Q4) | G6-03a/G6-03b khi giao |

Ghi chú lô #2: (Q1) `office_capability_off` của UniWork AI mang `fields.capability` = `ai_uniwork` hoặc
`ai_uniwork_<format>`. (Q6) nhóm giới hạn `ai-uniwork` phát `ai_rate_limited`; G6-03b thêm tham số mã lỗi cho
`RateLimitByIdentityBucket`.

Route capability của app: `{sync_feed, sync_write, offline_library, ai_uniwork, ai_uniwork_formats[], ttl_seconds}`,
`ttl_seconds` mặc định 300, đánh giá override user > org > global (plan X-03).

## 5. Thứ tự migration

Quy tắc: tên `999<unix-ms>_<name>.{up,down}.sql` (`server/migrations/lint_test.go`,
`TestMigrationPrefixesSortTheSameAsStringsAndNumbers`). **Chú ý dữ kiện:** tiền tố lớn nhất hiện có là
`9991791800000006` (`9991791800000006_data_subject_requests_one_open_uidx`), tức 2026-10-12T10:13:20Z — lớn hơn
`Date.now()` lúc soạn (`1791797880644`). File mới dùng `max(unix-ms lúc viết, tiền tố lớn nhất trên root + 1)`; nếu merge
lệch thứ tự, đổi tên khi rebase để thứ tự chuỗi = thứ tự merge. Index `CONCURRENTLY` ở file riêng, một câu.

| Thứ tự | Task | Migration dự kiến | Điều kiện |
| --- | --- | --- | --- |
| 1 | G5-01a | `999<ms>_document_change_snapshots` (+ file index riêng) | nếu cần bảng snapshot |
| 2 | G5-07 | `999<ms>_document_commit_intents`; nếu OQ-P1 chọn (a1): `999<ms>_documents_content_revision` | G5-D2 |
| 3 | G5-08s | `999<ms>_office_offline_leases` (kèm bảng epoch `office_offline_policy`: `organization_id`, `epoch`, cùng migration; index `CONCURRENTLY` ở file riêng) | G5-D1 đã ký (2026-10-13) |
| 4 | G6-03a | `999<ms>_ai_uniwork_conversations` | nếu G6-02 chọn Postgres |
| 5 | G6-03b | `999<ms>_ai_uniwork_runs` | luôn áp dụng (lô #2, Q3) |
| 6 | G6-03c | `999<ms>_<entitlement>` | chỉ khi G6-D1 chọn nhánh entitlement mới (U-13: dùng lại `office.ai_cloud`, nên mặc định không có) |
| 7 | G8-03 | `999<ms>_document_comments_collab` → `999<ms>_document_comment_revisions` → `999<ms>_document_comment_mentions`, mỗi index `CONCURRENTLY` một file riêng (`…_document_comment_revisions_comment_uidx`, `…_document_comment_revisions_document_idx`, `…_document_comment_mentions_comment_user_uidx`, `…_document_comment_mentions_document_idx`); chi tiết [contract-collab](./contract-collab.md) mục 5 | luôn áp dụng (G8-D5, plan §6.3) |

Bảng mới: không FK, id ULID `TEXT`, `organization_id TEXT NOT NULL`, `created_by` + `created_by_kind`; bảng có TTL có
worker dọn đăng ký trong chuỗi shutdown `server/cmd/server/main.go` (plan §4).

## 6. Bản rollback tối thiểu N′

N′ = bản dev **đầu tiên** của fork chứa guard "store mới hơn" của G5-04g (lane `g5-fork_main`, UNI-1343). Hiện tại guard
chưa có: `0.11.0-dev.7` (`0d03b185`) chưa có G5-04g. N′ dự kiến là `0.11.0-dev.8` nếu không có tag nào chen; giá trị thật
Advisor ghi vào đây khi bản đó phát hành. Rollback app xuống dưới N′ **không được hỗ trợ** (bản đó coi binding schema 2
là tệp cục bộ thường — plan §8). N′ phải có trên mọi kênh trước khi kênh nào phát hành store schema 2 (support matrix theo
kênh, G7-07).

## 7. Câu hỏi thiết kế mở

### 7.1 OQ-P1 — đổi chỉ metadata tăng revision

**Dữ kiện code (D `b6a0f4150`):**
- Commit thường so đúng revision: `if locked.Revision != in.BaseRevision` → `document_version_conflict`
  (`server/internal/service/document_commit.go:309`); đường job so cả revision lẫn version
  (`locked.Revision != job.BaseRevision || locked.FileVersionID.String != job.BaseVersionID`, `:301`). Lỗi 409 chỉ mang
  `current_revision` (`:78-81`). Fingerprint idempotency gồm `BaseRevision` (`:244`). Khôi phục version cũng so revision (`:434`).
- Tăng revision không có version mới (`server/pkg/db/queries/document_tree.sql`): `MoveDocument` (:39),
  `ClearDocumentArchiveBatch` (:83, chú thích :74-76 cố ý: "client giữ revision trước lưu trữ phải conflict"),
  `RestoreSingleDocument` (:99), `DetachDocumentToRoot` (:112), `RestoreDocumentsByOwner` (:161), `RestoreOwnedDocument` (:189).
  **Thêm (plan chưa ghi):** đổi tên/biểu tượng/visibility qua PATCH — `UpdateDocumentFields`
  (`server/pkg/db/queries/documents.sql:94-103`) cũng tăng revision. Lưu trữ (`ArchiveDocumentBatch`, `document_tree.sql:53-64`) không tăng.
- Commit đặt version mới cùng lúc tăng revision: `SetDocumentFileVersion` (`document_files.sql:9-13`).
- `document_versions` **không có cột revision** (`server/migrations/984_document_versions.up.sql:10-31`); server không suy được
  version từ `base_revision`.
- Phía client: host web gửi `base_revision` = `doc.revision` lúc mở (`packages/core/office/docs-frame-api.ts:123-124,240`).

**Phương án:**
- **(a1) Server so base nội dung bằng cột `content_revision`** (đề xuất). Thêm `documents.content_revision BIGINT NOT NULL`
  (backfill = `revision`), cập nhật ở mọi chỗ đổi nội dung (`SetDocumentFileVersion`, restore version,
  `UpdateDocumentContent`). Commit nhận khi `content_revision ≤ base_revision ≤ revision`; ngoài khoảng đó → 409 như nay.
  Không đổi wire, frame/app cũ hưởng ngay; di chuyển/khôi phục/bỏ lưu trữ/đổi tên không còn gây "Xung đột" với nội dung
  giống hệt. Quyền và trạng thái lưu trữ vẫn kiểm trong cùng transaction (`withDocumentMutation`). Đường job áp cùng quy tắc.
- **(a2) Wire mang `base_version_id`** tùy chọn trong SDI commit (`dto/sdi/document.go:65`, `dto/sdi/office_frame.go:21`);
  server so `locked.FileVersionID` như đường job. Đổi hai repo (frame protocol + app), client cũ không hưởng.
- **(b) Client rebase:** feed + `doc.remoteVersion` báo cả bump metadata; client thay `base_revision` khi `version_id` không đổi.
  Cần mọi client (frame web, queue app) làm đúng; vẫn còn cửa sổ race giữa event và Lưu (409 vẫn xảy ra) trừ khi 409 mang
  thêm `current_version_id`; nhiều code nhất (G5-01b, X-02, G5-06, G5-03w/03a).

**Khuyến nghị: (a1).** Một luật ở server, không đổi protocol, đóng luôn trường hợp đổi tên mà plan chưa liệt kê. Owner thực
thi: G5-07 (thêm migration ở hàng 2 mục 5). Test bắt buộc (plan §3): di chuyển rồi dispatch → committed, không conflict; bỏ
lưu trữ rồi Lưu web → saved; thêm: đổi tên rồi Lưu → saved; commit khác chen giữa → vẫn 409. Ký: người dùng (vai
G1/FileService).

### 7.2 OQ-P4 — so phiên bản app độc lập kênh

**Dữ kiện (F `0d03b185`, `.github/workflows/release-installers.yml`):** tag phát hành khớp
`^v([0-9]+\.[0-9]+\.[0-9]+)-(dev|beta)\.([0-9]+)$` (:105), base phải bằng `apps/shell/package.json` (:110-113), phiên bản
`<base>-<channel>.<n>` (:115); tag phải là tổ tiên của `origin/main` (:116); bản `workflow_dispatch` dùng
`<base>-<channel>.<run_number>` (:131) và không phát hành. Số `n` của dev và beta đếm riêng. Semver so prerelease theo ASCII
nên mọi `0.11.0-beta.*` < mọi `0.11.0-dev.*`.

**Phương án:**
- (a) Số build đơn điệu: nhúng `buildNumber` = số commit của `origin/main` tại commit build (`git rev-list --count`);
  mọi tag nằm trên main (:116) nên số này tăng đều qua mọi kênh. So `(core semver, buildNumber)`.
- (b) Base phát hành + số năng lực store riêng: binding ghi `min_store_level` (số nguyên, tăng khi store đổi theo cách bản cũ
  không đọc được) cùng `min_app_version` = core semver (`MAJOR.MINOR.PATCH`, bỏ prerelease) chỉ để hiển thị S11.

**Khuyến nghị: (b).** Quyết định "đọc được store không" là câu hỏi năng lực, không phải câu hỏi thứ tự build: số nguyên
`min_store_level` độc lập kênh tuyệt đối, không phụ thuộc lịch sử git hay số chạy CI, và khớp guard schema của G5-04g.
Quy tắc đọc: thiếu/sai dạng → S11; `min_store_level` > năng lực của bản đang chạy → S11; bằng hoặc nhỏ hơn → mở. So core
semver chỉ khi hai bên cùng `min_store_level` và chỉ để chọn thông điệp. Test bắt buộc: `0.11.0-beta.9` và `0.11.0-dev.3`
cùng năng lực store → kết quả như nhau, không phụ thuộc chuỗi kênh. Nếu người dùng muốn giữ một trường duy nhất: dùng (a).
Ký: người dùng (vai Lead F + OPS).

### 7.3 OQ-P3 — dữ kiện cho X-02 (X-02 chốt)

- Version không mang revision (`DocumentVersionDTO`, `server/internal/handler/dto/sdo/document.go:78-97`).
- Phản hồi mở của frame (`GET /office-frame/documents/{documentID}`) dựng trong một lần đọc service: `Revision` của head và
  `DownloadURL` `…/content?version=<số thứ tự của file head>` (`server/internal/handler/office_frame.go:107-118`), nên cặp
  (byte, revision) của head nhất quán.
- Route nội dung chỉ ủy quyền rồi gọi `downloadDocument` theo `?version=N` (`office_frame.go:193-199`); nó trả byte của
  version N dù N không còn là head.
- Gợi ý cho X-02 (không ràng buộc): khi `api.open` xin version không còn là head, host trả **head** kèm revision của head và
  một cờ cho biết đã đổi bản; không bao giờ trả byte cũ kèm revision mới. Bản không còn tồn tại hoặc thuộc tài liệu khác →
  từ chối, frame không mở bản đó.

**Câu trả lời OQ-P3 (X-02, 2026-10-12)** — theo gợi ý trên; `PROTOCOL_VERSION` giữ 1, không thêm mã lỗi.

- **Khóa request:** `api.open {fileId, versionId?}`. `versionId` là `version_id` của `doc.remoteVersion`, cùng giá trị host
  đặt vào `FileMeta.versionId` (D `packages/core/office/docs-frame-api.ts:122`). Không có khóa → như nay, mở head.
- **Host mới (G5-03w)** luôn trả **head** đọc trong một lần (`GET /office-frame/documents/{documentID}`): byte, `FileMeta.revision`
  (chuỗi thập phân) và `FileMeta.versionId` đều của chính head đó; không bao giờ trả byte của version đã xin.
  - `versionId` = head → reply head, không cờ.
  - `versionId` là version cũ của **chính tài liệu này** (không còn là head, ví dụ có commit chen giữa event và `api.open`)
    → reply head kèm cờ `versionChanged: true` trên reply (`ApiOpenResult`). Validator `response:api.open` từ chối
    `versionChanged: true` khi thiếu `FileMeta.revision`.
  - `versionId` không thuộc danh sách version của tài liệu (đã dọn, của tài liệu khác, sai dạng) → từ chối bằng
    `not_found` (mã có sẵn của `PROTOCOL_ERROR_CODES`); frame không mở bản nào, giữ nội dung đang có.
- **Frame** lấy số và base chỉ từ reply (`FileMeta.revision`, helper `openReplyRevision`), không từ event, không từ khóa
  đã xin. Host cũ bỏ khóa lạ, trả bản mới nhất không có `revision` → `openReplyRevision` = `null` → thanh không số
  `uwRemoteUpdatedNoRev`, không bao giờ hiện số đã xin.
- **Test:** F `web/docs/protocol/test/protocol.test.ts` và D `packages/core/office/docs-frame-host.test.ts` (host giả: commit
  chen giữa → head với revision khớp và `versionChanged`; version lạ → `not_found`; host cũ → không số). Host thật: G5-03w.

## 8. Upstream cho dev và cloud runner

Chỉ tên cấu hình (spec §8.4). Giá trị: **theo `~/.codex/config.toml` mục `[model_providers.customlocal]`** trên máy dev;
không chép host, cổng hay khóa vào repo, issue, report hay tin nhắn.

| Biến | Máy dev (G6-02, G6-08, P1) | Cloud runner / CI / unit test |
| --- | --- | --- |
| `AI_PROVIDER` | `openai` | `fake` |
| `OPENAI_BASE_URL` | = `base_url` của `customlocal` | không đặt |
| `OPENAI_API_KEY` | = giá trị biến mà `env_key` của `customlocal` trỏ tới | không đặt |
| `AI_MODEL_ALLOW` | thêm model chọn từ `/v1/models` của upstream | không đặt |
| `AI_MODEL_OFFICE_UNIWORK_AI` | model đó (override có sẵn `AI_MODEL_<CAPABILITY>`, `server/internal/ai/policy.go:72`) | không đặt |

Dữ kiện: `.env.example:354-365` đã có `AI_PROVIDER`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `AI_MODEL_ALLOW`; capability
`office_uniwork_ai` chưa có trong enum (`server/internal/ai/policy.go:14-27`) — G6-13 thêm. Không bật UniWork AI cho tổ chức
nào trên deployment `AI_PROVIDER=fake` (spec §12.3).

Số G6-D1 (`ModelPolicy` của `office_uniwork_ai`, trần instruction pack, trần vòng tool, req/phút nhóm `ai-uniwork`, số lần
chờ 429, trần body/tool-result, hội thoại phía server, đồng thời, run id, wire extension, streaming): **đã ký ở lô #2
(2026-10-13 00:35 UTC+7, "duyệt theo gợi ý")**; nguồn `decisions/batch-2.md` A1–A16, bằng chứng `g6-02-spike-report.md` §1/§8.1.
A17 (upstream production) chuyển sang G6-D2.

| # | Số đã ký |
| --- | --- |
| A1 | `ModelPolicy` `office_uniwork_ai`: cùng map flagship với `policy.go:39` (anthropic claude-opus-5, openai gpt-4o, fake); không ollama; MaxTokens 4096; Temperature 0; model dev qua `AI_MODEL_OFFICE_UNIWORK_AI` + `AI_MODEL_ALLOW` |
| A2 | Instruction pack ≤ 2000 token (chung ≤ 800 + module ≤ 1200) |
| A3 | 8 vòng tool-result, 10 lần gọi model mỗi lượt; vượt → `run_limit_reached` (409) |
| A4 | `ai-uniwork`: 60 req/phút mỗi identity, bucket riêng |
| A5 | 3 lần chờ 429 mỗi lượt; `Retry-After` kẹp 300 s |
| A6 | Body 1 MiB; tool result ≤ 64 KiB/lần, ≤ 256 KiB/request; vượt → 413 `ai_tool_result_too_large` |
| A7 | Lịch sử ≤ 48 000 token input mỗi lần gọi, bỏ cả cặp cũ nhất, ≤ 20 lượt người dùng |
| A8 | Mở rộng provider: `ToolCall{ID}`, role user/assistant/tool + `ToolCalls`/`ToolCallID`, `UsagePresent`; ollama từ chối |
| A9 | Hội thoại lưu Postgres 2 bảng, AES-256-GCM secretbox, idle 30 phút / tuyệt đối 24 h / 20 lượt; hết hạn → 409 `conversation_expired` |
| A10 | OQ-P2: desktop dùng `POST /api/v1/documents/{documentID}/ai/uniwork/chat/completions` (document session), kiểm quyền mỗi request |
| A11 | Đồng thời: LoadShed miễn trừ theo route; 32/pod, 64 toàn cục (Redis lease), 8/org; vượt → 429 `ai_uniwork_busy`, `Retry-After: 5` |
| A12 | Run id: header `X-UniWork-AI-Run`, `X-UniWork-AI-Conversation` (+ CORS) |
| A13 | Wire extension `x_uniwork` {`dropped_tool_calls`, `step`, `limit`, terminal dự trữ}; `finish_reason` chuẩn, không có `tool_not_allowed` |
| A14 | Streaming v1: SSE một chunk sau khi biết câu trả lời upstream; lỗi là HTTP status thật; hạn 55 s; không bao giờ 200 rỗng; streaming thật ở v1.1 |
| A15 | Entitlement dùng lại `office.ai_cloud` (U-13) |
| A16 | Run/usage ở bảng hạ tầng AI (`Ai*`), không audit/outbox; thiếu usage → `usage_unknown` |

## 9. Harness G7-01 và đường dự phòng

Lệnh khởi động (lane `g7-qa` điền và chạy một lần trên cloud runner; chạy thật là điều kiện xong của G7-01, không của X-01):

```sh
# <G7-01 điền> — khung dự kiến trên VM Linux của cloud runner, cổng mới mỗi lần chạy:
# 1. DB mới + migrate:            (lệnh migrate của repo D, DB riêng cho lần chạy)
# 2. Server D, AI_PROVIDER=fake:   PORT=<api_port> go run ./server/cmd/server
# 3. Web D:                        NEXT_PUBLIC_API_URL=http://127.0.0.1:<api_port> pnpm --filter web start -p <web_port>
# 4. App dev (bản cài kênh dev):   xvfb-run -a <AppImage 0.11.0-dev.N> (server lấy từ link "open" hoặc ô nhập địa chỉ)
# 5. Runner bằng chứng:            <lệnh evidence runner của G7-01> --ac <id>
```

Đường dự phòng (plan §8): e2e của fork với stub Documents + e2e web D + lần chạy tay theo kịch bản có ghi hình; mọi hàng phụ
thuộc harness ghi **BLOCKED**, không PASS. Ra P0 cần một trong hai: harness đã chạy một lần, hoặc dự phòng đã ghi (plan §6.5).

## 10. Test matrix AC → task → lệnh → artifact

Lệnh chạy trên cloud runner: `node <RUNNER> test --spec reports/<lane>/cloud-spec-<seq>.txt --lane <lane> --out
reports/<lane>/cloud-test-<seq>.md` (team-rules › Tests); mỗi dòng spec là lệnh test của task (tên test do task đặt theo
assertion của thẻ plan). Artifact: báo cáo trong `.uniwork-dev/office-g5g6g7/reports/<lane>/`, dòng bằng chứng trong
`docs/office/g5g6g7/acceptance-rows.json` (G7-01 tạo, hợp đồng như `docs/office/g3g4/capability-rows.json`), ảnh chụp
light/dark vi/en cho task UI.

| AC | Task thực thi (góp) | Lệnh (dòng spec cloud runner) | Artifact |
| --- | --- | --- | --- |
| G5-A01 | G5-01a, G5-01b, G5-02, G5-04 (X-03) | `cd server && go test ./internal/service ./internal/handler -run 'DocumentChanges\|IsolationMatrix'` · `pnpm vitest run packages/core/api/endpoints/document-changes.test.ts` · F vitest store/feed của G5-04 | `reports/<T2>/cloud-test-*.md`, `reports/g5-fork_main/…`, hàng G5-A01 |
| G5-A02 | G5-01b | `go test ./internal/service -run 'DocumentChanges.*(Revoke\|Tombstone\|Move\|WorkProduct)'` · `node --test scripts/events-catalogue.test.mjs` | `reports/<T2>/…`; Work Product BLOCKED tới C-14 |
| G5-A03 | G5-03w, G5-03a, G7-10, G7-04 (X-02) | vitest `docs-frame-host.test.ts` + test host G5-03w; F test G5-03a; harness G7-10 (`node --test scripts/office/g5g6g7/g7-10/tracer.test.mjs`, `evidence.mjs run --req G5-A03 --fixture fx-xlsx-revenue-xyz … -- node scripts/office/g5g6g7/g7-10/tracer.mjs --loop 1 --run-dir <runDir>`; exit 0 PASS, 1 FAIL, 77 BLOCKED)/G7-04 | `reports/<T1>/…`, `reports/g7-qa/…` + ghi hình harness |
| G5-A04 | G5-05, G5-05u, G7-03b | F vitest engine offline; fault spec G7-03b | `reports/g5-fork_main/…`, `reports/g7-qa/…`; BLOCKED(G5-D1) tới khi đóng |
| G5-A05 | G5-06, G5-06u, G5-10, G7-10, G7-03a | F vitest queue/crash-restart; harness G7-10 (`evidence.mjs run --req G5-A05 --fixture fx-docx-report-vi … -- node scripts/office/g5g6g7/g7-10/tracer.mjs --loop 3 --run-dir <runDir>`); fault G7-03a | `reports/g5-fork_main/…`, `reports/g7-qa/…` |
| G5-A06 | G5-06, G5-07, G7-03a | `go test ./internal/service -run 'CommitIntent\|Idempotency'` · F queue · fault G7-03a | `reports/<T2>/…`, `reports/g7-qa/…` |
| G5-A07 | G5-04, G5-08s, G5-08c, G5-11, G7-03b (G5-04g) | F vitest guard/store; `go test ./internal/service -run OfficeLease`; fault G7-03b | `reports/g5-fork_main/…`, `reports/<T2>/…`; phần lease: G5-D1 đã ký 2026-10-13, G5-08s mở |
| G5-A08 | G5-09w, G5-09, G5-10, G5-12, G7-03a | F vitest `frame-dialog.test.ts`, `webapi.test.ts`; D vitest `office-module-frame.test.tsx`; `go test -run DocumentCopy` | `reports/<T1>/…`, `reports/<T5>/…` + ảnh S5 |
| G6-A01 | G6-08, G7-12 (G7-02, G6-12, G6-14) | dev set G6-08; holdout G7-12 qua runner G7-01 (≥3 lần) | `reports/g6-ai_server/…`, `reports/g7-qa/eval-*` |
| G6-A02 | G6-08, G7-12 | như trên | như trên |
| G6-A03 | G6-05, G7-08, G7-10 | F test đếm request G6-05; tích hợp G7-08 đếm version; harness G7-10 (`evidence.mjs run --req G6-A03 --fixture fx-docx-report-vi … -- node scripts/office/g5g6g7/g7-10/tracer.mjs --loop 2 --run-dir <runDir>`) | `reports/<T6>/…`, `reports/g7-qa/…` |
| G6-A04 | G6-09, G7-03a, G7-08 | F test hiển thị + hoàn tác; fault Lưu sau AI | `reports/<T6>/…`, `reports/g7-qa/…` |
| G6-A05 | G7-08 | tích hợp DOCX → Lưu → tải → mở Word | `reports/g7-qa/…` |
| G6-A06 | G6-12, G7-08 (G6-01) | F test công cụ G6-12; ma trận G7-08 | `reports/g6-fork_tools/…`, `reports/g7-qa/…`; BLOCKED(G6-D4) |
| G6-A07 | G6-03a, G6-03b, G6-03c, G6-05, G6-05u, G7-12 (X-02) | `go test ./internal/service ./internal/handler -run 'AIUniwork\|IsolationMatrix'`; F G6-05; eval G7-12 | `reports/g6-ai_server/…`, `reports/<T6>/…` |
| G6-A08 | G6-03a, G6-03b, G6-03c, G6-05, G6-05u (G6-13) | `go test ./internal/ai/... ./internal/service -run 'AIUniwork.*(Timeout\|Credits\|RateLimit\|Cancel)'`; F G6-05 | `reports/g6-ai_server/…`, `reports/<T6>/…` |
| G6-A09 | G6-03b (G6-13) | `go test ./internal/service -run 'AIUniwork.*Usage'` | `reports/g6-ai_server/…` |
| G6-A10 | G6-14, G7-12 (G6-13) | `go test ./internal/ai -run Prompt` (golden) · `node --test scripts/office/instruction-pack-tools.test.mjs` | `reports/g6-ai_server/…` |
| G7-A01 | G7-04 | harness G7-01 kịch bản full loop | `reports/g7-qa/…` + ghi hình |
| G7-A02 | G7-03a, G7-04 | fault race G5×G6; harness | `reports/g7-qa/…` |
| G7-A03 | G5-11, G7-05 (G5-04g) | F test logout/rollback; nâng/hạ bản cài N′ ↔ N+1 | `reports/g5-fork_main/…`, `reports/g7-qa/…`; phần ký số theo U-11 |
| G7-A04 | G7-05, G7-06, G7-09 | ma trận platform (máy theo G7-D2); hồi quy upstream G7-06: `node ~/cloud-runner/.cursor/cloud/cloud-runner.mjs test --spec reports/g7-qa/specs/cloud-g7-06-6.txt --lane g7-qa --out <report> --timeout 7200` (spec chạy unit test, sync bundle, harness `OFFICE_FORK_SHA=<pin> bash scripts/office/g5g6g7/harness/start.sh`, `capture.mjs --host desktop\|web`, rồi `evidence.mjs run --req G7-A04 … -- node scripts/office/g5g6g7/g7-06/job.mjs`; exit 0 PASS, 1 FAIL, 77 BLOCKED); checklist UX G7-09 | `reports/g7-qa/…`; hàng thiếu máy BLOCKED(G7-D2) |
| G7-A05 | G7-07, G7-11 (G7-01, G6-14) | `node --test scripts/alerts-runbooks.test.mjs` · runtime manifest dựng lại | `reports/g7-qa/…`, tài liệu quyết định G7-11 |
| G8-A01 | G8-02, G8-12..15, G8-19 (góp G8-08, G8-20) | F vitest tác giả G8-02 (grep-test `userInfo(`/`USERNAME`/`LOGNAME` + đọc lại phần bình luận tệp) · F vitest adapter G8-12..15 (AI tool không gọi `comments.create` trước Gửi) · harness G8-19 bốn fixture | `reports/g8-fork_host/cloud-test-*.md`, `reports/g8-fork_editors/cloud-test-*.md`, `reports/g7-qa/g8-a01/` (dòng server + phần tệp đọc lại + log request) |
| G8-A02 | G8-04, G8-12..15, G8-19 | `go test ./internal/service ./internal/handler -run 'DocumentCommentAnchors\|IsolationMatrix'` · F vitest neo G8-12..15 (Lưu → neo mới, xóa → `lost`, reveal) · harness G8-19 | `reports/g8-server/cloud-test-*.md`, `reports/g8-fork_editors/cloud-test-*.md`, `reports/g7-qa/g8-a02/` (receipt neo + ba thân 400) |
| G8-A03 | G8-03, G8-10, G8-11 (góp G8-20) | `go test ./internal/service ./internal/handler -run 'DocumentComment(Kind\|Tombstone\|Revision\|Purge\|Copy\|ListToken)'` · `go test ./migrations` (lint migration, `TestNewTablesCarryOrganizationID`, `TestEveryQueryNamesItsTenant`, `TestActorKindOnEveryCreatedBy`) · `pnpm vitest run packages/views/documents packages/core/api/endpoints/document-comments.test.ts` (gồm ca `unchanged`, dòng `discussion` ở client cũ) · F vitest panel G8-11 | `reports/g8-server/cloud-test-*.md`, `reports/g8-web/cloud-test-*.md` + ảnh S13 light/dark vi/en, `reports/g8-fork_editors/cloud-test-*.md` |
| G8-A04 | G8-08, G8-10, G8-11, G8-19 (góp G8-04, G8-20) | `pnpm vitest run packages/core/office packages/views/office/frame packages/core/realtime/use-realtime-sync.test.tsx` · `node --test scripts/office/frame-protocol-vendor.test.mjs` · F vitest protocol G8-08 (gồm `comment_deleted` không reload + giữ nháp, thứ tự + hạn chờ `comments.reveal`, `commentsLevel` view/edit/manage, init có `comments` thiếu `commentsLevel` = lỗi host) · harness G8-19 hai host | `reports/g8-fork_host/cloud-test-*.md`, `reports/g8-web/cloud-test-*.md`, `reports/g7-qa/g8-a04/` (ghi hình web ↔ desktop) |
| G8-A05 | G8-05, G8-06, G8-10 (góp G8-20) | `go test ./internal/notification ./internal/service ./internal/mentions -run 'DocumentMention\|MentionCandidates\|Claim\|TokenIDs'` · `pnpm vitest run packages/core/api/endpoints/document-comments.test.ts packages/views/documents` | `reports/g8-server/cloud-test-*.md`, `reports/g8-web/cloud-test-*.md` |
| G8-A06 | G8-05 | `go test ./internal/notification -run 'DocumentComment\|Titles\|Kinds'` (gồm `TestDocumentCommentCommentedNotification` viết lại theo G8-D4) · `pnpm vitest run packages/core/types packages/views/notifications packages/core/i18n` | `reports/g8-server/cloud-test-*.md` (bảng người nhận UNI-1337 từng hàng) |
| G8-A07 | G8-07, G8-19 (góp G8-08) | `go test ./internal/notification ./internal/service -run 'ResourceURL\|FilterReadableDocuments\|NotificationList\|OfficeLaunch'` · `pnpm vitest run packages/views/notifications/resource-href.test.ts packages/views/documents packages/core/api/endpoints/notifications.test.ts` · harness G8-19 deep link web + desktop | `reports/g8-web/cloud-test-*.md`, `reports/g8-server/cloud-test-*.md`, `reports/g7-qa/g8-a07/` (ảnh S15 năm ngoại lệ) |
| G8-A08 | G8-03, G8-04, G8-06, G8-08 | `go test ./internal/handler -run 'IsolationMatrix\|IsolationRealtime\|EveryBodyIDFieldHasAReferenceCase'` · `go test ./internal/service -run 'EveryAuditedCommandWritesItsRow\|ReusedAuditActionCommandsWriteTheirOwnRows'` · `node --test scripts/events-catalogue.test.mjs scripts/no-pii-log.test.mjs` | `reports/g8-server/cloud-test-*.md` |
| G8-A09 | G8-16, G8-17, G8-19 | F vitest `uniwork-auth`/`uniwork-docs` G8-16/G8-17 · harness G8-19 đăng nhập nhiều tổ chức + tạo/đổi tên/lưu trữ | `reports/g8-fork_host/cloud-test-*.md`, `reports/g7-qa/g8-a09/` + ảnh S16–S18 |
| G8-A10 | G8-18 | BLOCKED(G8-D3): lệnh do G8-18 đặt khi luật ký; dự kiến `go test ./internal/service -run 'DocumentMention.*NoAccess'` + F vitest composer | `reports/g8-server/…`, `reports/g8-fork_editors/…` khi gỡ chặn |

## 11. Trạng thái gate

| Gate | Đã đóng bởi U-13 | Còn mở | Đóng bằng / ai ký |
| --- | --- | --- | --- |
| G5-D1 | Giá trị chính sách: lease ≤ 24 h, gia hạn khi online, revoke hiệu lực khi máy nhận revoke hoặc lease hết hạn, logout khóa ngay | ~~Amendment DOC-005 + threat model~~ — đã viết trong DOC-005 §6.2 (G5-08s, commit đầu) | **Đã ký** lô #2b 2026-10-13 (20 hàng + threat model 17 hàng, "duyệt theo gợi ý"); người dùng (vai Auth) |
| G5-D2 | — (giao đội chốt) | Retention feed/snapshot/idempotency, tra intent, fencing, claim refresh | Lô #2; người dùng (vai G1/FileService); dev dùng giá trị tạm của G5-01a/G5-07 |
| G5-D3 | Một intent chưa giải quyết mỗi Document; số giới hạn queue/cache/nháp (OQ-UX2) | — | Đóng bởi U-01 apply (U-15, 2026-10-12): số đã ký ở `ux/EXPERIENCE.md` › Open questions |
| G6-D1 | Entitlement dùng lại `office.ai_cloud`; façade route/wire/run id, streaming, vòng tool-result, `ModelPolicy`, trần pack/lượt/đồng thời, quota semantics (lô #2) | — | **Đã ký** lô #2 2026-10-13 (A1–A16, Q1–Q6); A17 → G6-D2 |
| G6-D2 | — (người dùng quyết khi lên production) | Upstream production, region, retention/log, secrets, transcript | Người dùng; tới đó chỉ fixture tổng hợp trên upstream dev |
| G6-D3 | Đóng (spec §13.1) | — | — |
| G6-D4 | — (giao đội chốt) | Ma trận §6.5 theo bảng G6-01, cách hiển thị thay đổi AI | Lô #3; người dùng |
| G7-D1 | ≥100 tình huống eval | Ngưỡng §9.2, fixture/load profile, cost/run, ngân sách token (≥3 lần × ≥100 ca), SLO | Lô #3; người dùng |
| G7-D2 | Danh sách platform (Win NSIS, mac arm64 + x64 dmg, Linux AppImage + deb) | Máy cụ thể, máy Mac thật cho VoiceOver/Safari, stage/channel | Lô #3; người dùng |

OQ-P1 và OQ-P4 (mục 7) nằm trong lô ký #1 cùng tài liệu này; OQ-P2 thuộc G6-02 (lô #2); OQ-P3 thuộc X-02.
