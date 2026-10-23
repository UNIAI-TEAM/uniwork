# UniWork — Kết quả công việc (Work Product): deliverable nghiệp vụ, phiên bản có nguồn gốc, xem xét và duyệt

> **Trạng thái:** in-progress — Đề xuất, chờ duyệt (chủ sở hữu sản phẩm + kiến trúc sư trưởng). Bản 2 (2026-09-16) sau review kiến trúc: đã đóng 8 vấn đề nghiêm trọng và 17 vấn đề quan trọng của bản 1. §12 còn 5 câu hỏi mở phải trả lời trước khi duyệt.

**Ngày:** 2026-09-16
**Issue:** UNI-634 · C-14 · Bounded context Work Product · P0
**Parent:** UNI-416 · Giai đoạn C — Collaboration
**Sub-issue:** UNI-639…643 (năm lát cắt §11)

**Phụ thuộc bắt buộc:** C-01 Documents (UNI-437) — **§13 của spec C-01 phải xong trước lát cắt 1**; C-11 Work Graph (UNI-460) — bảng node/edge, projector runtime và catalogue từ vựng quan hệ, **cần cho lát cắt 1b và lát 4** (§11).
**Phụ thuộc đã có:** F-08 audit + outbox, F-02 entitlement, F-10 actor, F-11 feature flag theo org, F-09 AI gateway, F-03 danh bạ, F-07 notification.

**ADR ràng buộc:** **0016** (Work Product là bounded context riêng, Document là kho duy nhất) · **0017** (hai cổng duyệt tách, Outcome không có bảng) · **0019** (đồ thị là projection, cấm suy diễn) · 0001 (không FK) · 0002 (ULID TEXT) · 0007 (`actor_kind`) · 0008 (`organization_id`) · 0009 (audit + outbox cùng transaction) · 0010 (AI đề xuất, không ghi).

**Spec liên quan:** `2026-09-08-documents-design.md` (**§13 là hợp đồng giữa hai bên, đọc cùng §4.2 và §5 ở đây**), `2026-09-04-audit-domain-events-design.md`, `2026-09-04-ai-platform-gateway-design.md` (§3.5 context builder), `2026-08-27-workspace-permissions-design.md`, `2026-09-04-notifications-design.md`, `2026-09-04-agent-actor-model-design.md`.

**Tham chiếu mã:** `server/internal/service/idempotency.go` (`BeginIdempotent`, `revision_conflict`) · `server/internal/service/search_text.go` (`foldForSearch`) · `server/internal/service/actor.go` (`service.Actor`, `service.Human`) · `server/internal/featureflags/keys.go` · `server/internal/outbox/catalogue.go` · `server/internal/audit` (`Recorder.Record`) · `server/migrations/lint_test.go` · `server/migrations/186_task_subscriber_opt_out.up.sql` (mẫu bảng người theo dõi) · `packages/core/api/endpoints/` · `packages/core/types/` · `packages/core/realtime/use-realtime-sync.ts` · `packages/views/layout/` (`CollectionPageHeader`, `BreadcrumbHeader`).

**Bản cũ (đối chiếu hành vi, không copy):** `../unidigiwork` tại commit `9f07c85a` — `src/routes/_authenticated/work-products.tsx`, `work-products_.$id.tsx`, `src/lib/api/work-products-*.functions.ts`, `src/domain/work-product-semantics/`, `.lovable/plan/work-products-kết-quả-công-việc-mvp-2026-09-09.md`.

> **Ghi chú số migration:** số `2NN_` là **giữ chỗ**. Số thật cấp khi viết plan, nối tiếp số mà C-01 đã dùng thật (C-01 giữ chỗ `159`–`179`; `develop` ngày 2026-09-16 đang ở `186`).

---

## 1. Mục tiêu

Hôm nay UniWork trả lời được "ai đang làm gì". Nó chưa trả lời được **"việc đó đẻ ra cái gì, ai duyệt, dựa trên nguồn nào"**. Task là phương tiện; thứ đội giao cho khách và cho sếp là *bản đề xuất*, *báo cáo*, *hợp đồng*.

Sáu tính chất đo được:

1. **Loại nghiệp vụ tách hoàn toàn khỏi định dạng.** "Đề xuất" là loại; DOCX là định dạng. Một Đề xuất tồn tại đồng thời ở bản soạn trong ứng dụng, bản DOCX và bản PDF — ba biểu diễn của **một** deliverable.
2. **Phiên bản là mốc nghiệp vụ, và mỗi mốc ghim đủ hai thứ: nội dung *mọi* biểu diễn tại thời điểm đó, và ảnh chụp nguồn gốc.** Nguồn đổi về sau thì bản ghi vẫn chứng minh được. Không có cái này thì "bản gửi khách hôm 12/9 là bản nào" và "AI dựa trên đâu" đều không trả lời được sau ba tháng.
3. **AI đọc gì là người chọn, người thấy được, và hệ thống ghi lại đã dùng thật những gì.**
4. **AI đề xuất, người ghi** (ADR 0010).
5. **Duyệt là duyệt giá trị nghiệp vụ**, tách hẳn khỏi cổng duyệt lượt chạy AI ở A-01 (ADR 0017).
6. **Không sở hữu byte.** Mọi tệp nằm ở Document (ADR 0016).

## 2. Phạm vi và ngoài phạm vi

**Trong phạm vi:** thực thể và vòng đời trạng thái · biểu diễn nhiều định dạng trỏ sang Document · phiên bản nghiệp vụ ghim biểu diễn + ảnh chụp nguồn gốc · bảng nguồn ngữ cảnh AI có công tắc · thanh công cụ AI khi bôi đen · yêu cầu xem xét và duyệt · người theo dõi · nối Work Graph · tìm kiếm · thẻ trên Home · liên kết ngược · bản mobile chỉ đọc và duyệt.

**Ngoài phạm vi C-14:**

| Việc | Ở đâu |
|---|---|
| Nhập DOCX, sửa có kiểm soát, vá tệp | C-15 (UNI-635) |
| Mở bằng ứng dụng máy tính | C-16 (UNI-636) |
| Bình luận trên Kết quả công việc | **Câu hỏi mở §12.1** — đề xuất hoãn chờ cơ chế bình luận dùng chung |
| Nguồn gốc "lượt thực thi nào tạo ra deliverable này" | A-01 (UNI-447), bảng nối của ADR 0017 |
| Bán công việc, định giá, cohort | A-09 (UNI-455) |
| Đồng soạn thảo thời gian thực | Thừa hưởng từ C-01 lát cắt 3 khi có |
| Xuất PDF, sinh DOCX từ bản native | Đợt sau; C-14 chỉ đính kèm tệp đã có |
| Mẫu (template) Kết quả công việc | Đợt sau |

## 3. Quyết định đã chốt

| # | Quyết định | Vì sao |
|---|---|---|
| 1 | **Loại nghiệp vụ là enum đóng có `other`**, giữ ở tầng service (không CHECK trong DB), kèm test liệt kê đủ 8 giá trị + nhãn vi | Chuỗi tự do thành rác; không CHECK thì phải có test làm hàng rào thay |
| 2 | **Mỗi biểu diễn là một tài liệu thuộc sở hữu** (C-01 §13), nối qua `work_product_representations` | ADR 0016. Bảng nối mang `role` + `format`, **không** giữ byte và **không** là sổ quyền |
| 3 | **`documents.owner_id` là nguồn sự thật của quyền sở hữu**; bảng nối là thuộc tính hiển thị. Gỡ biểu diễn = archive **cả hai** trong một transaction | Hai sổ sách không ai là nguồn sẽ lệch, và lệch ở đây đẻ ra tài liệu mồ côi vẫn tính quota |
| 4 | **Tối đa một biểu diễn `source` sống** (index giữ); **tối thiểu một** do service giữ. Chỉ `format = 'native'` được làm `source` ở C-14 | "Bản nào đang sửa" phải có một câu trả lời. Editor của C-14 chỉ soạn được `native`; cho `docx` làm `source` là hứa thứ C-15 mới làm |
| 5 | **Không có khóa ngoại tới dự án**, nhưng `primary_context_*` **có** kiểm quyền và cùng workspace | ADR 0016. Nó được chiếu thành cạnh `BELONGS_TO` (§7.3) nên **là** quan hệ, không phải nhãn hiển thị — bản 1 của spec này nói sai |
| 6 | **Mọi tham chiếu ra ngoài (ngữ cảnh chính, nguồn ngữ cảnh) bắt buộc cùng `workspace_id`** → `cross_workspace_reference` | Không có ràng buộc này thì người thuộc hai workspace kéo được nội dung của B vào deliverable ở A, và projector sinh cạnh xuyên workspace — vi phạm ADR 0019 |
| 7 | **Phiên bản nghiệp vụ ≠ phiên bản tài liệu**; mốc ghim `(document_id, document_version)` của **mọi** biểu diễn sống, không chỉ bản nguồn | "Bản gửi khách hôm 12/9" trong đời thật là cái PDF. Chỉ ghim bản nguồn thì mốc đã duyệt vẫn bị thay ruột |
| 8 | **Ảnh chụp nguồn gốc bất biến khi ghi, lọc theo quyền khi đọc** | Bất biến để làm bằng chứng; lọc để bản ghi kiểm toán không thành kênh rò tiêu đề của nguồn mà người đọc không được xem |
| 9 | **Bảng nguồn ngữ cảnh là trạng thái hiện tại; ảnh chụp là lịch sử.** Hai bảng | Gộp lại thì bật/tắt một nguồn sẽ viết lại lịch sử |
| 10 | **Ảnh chụp = nguồn đang bật ∪ nguồn đã thực sự dùng bởi các lượt AI được chấp nhận từ mốc trước** | Chỉ lấy công tắc lúc tạo mốc thì chạy AI xong tắt nguồn đi là xóa được dấu vết — đúng thứ mục tiêu §1.3 muốn chặn |
| 11 | **Trình duyệt chỉ gửi mã định danh nguồn.** Máy chủ tự phân quyền, tự nạp, tự dựng ảnh chụp | Tin tiêu đề do client gửi = cho client tự khai nguồn gốc |
| 12 | **Hai cổng duyệt tách hẳn** (ADR 0017) | Gộp lại thì hoặc AI tự nghiệm thu việc của mình, hoặc mọi bản nháp AI kẹt chờ duyệt nghiệp vụ |
| 13 | **Chỉ người được mời mới quyết duyệt.** `manage` **không** quyết được, chỉ hủy được yêu cầu | Chủ sở hữu luôn có `manage`; cho `manage` quyết duyệt nghĩa là tự duyệt việc của mình |
| 14 | **Chỉ duyệt được phiên bản hiện hành** → 409 `work_product_stale_version`; **xin duyệt khi chưa có mốc nào** → 409 | Duyệt một bản đã cũ là duyệt nhầm; duyệt khi chưa có mốc là duyệt vào hư không |
| 15 | **Tạo mốc mới khi đang `approved`/`final` đưa trạng thái về `draft`** và hủy mọi yêu cầu `pending` | Nếu không, nhãn "đã duyệt" trên màn hình nói dối về nội dung hiện tại — và nhãn mới là thứ người ta tin |
| 16 | **`archived` KHÔNG nằm trong enum `status`.** Lưu trữ là `archived_at`, trực giao với trạng thái nghiệp vụ | Giống `documents`. Gộp vào `status` thì archive từ `approved` làm mất kết quả duyệt và `/restore` phải đoán |
| 17 | **Không có bảng "kết quả cuối cùng"** (ADR 0017) | Bảng không luồng nào ghi vào sẽ rỗng vĩnh viễn |
| 18 | **`visibility` `workspace` \| `restricted`**; `restricted` bỏ **cả hai** dòng `via=member` (người **và** agent) | Nếu chỉ bỏ dòng của người thì thành viên không mở được mà agent thì mở được — và qua ủy quyền của C-01, agent đọc luôn byte |
| 19 | **Người xem xét giữ `view` sau khi đã quyết**, không chỉ khi `pending` | Duyệt xong mở lại chính thứ mình vừa ký mà 404 là lỗi thiết kế |
| 20 | **Trên `restricted`, mời người xem xét cần `manage`** | Lời mời cấp `view`; để `edit` mời được nghĩa là `edit` cấp được quyền đọc, trong khi chỉ `manage` mới đổi `visibility` |
| 21 | **Không có chia sẻ riêng và không có liên kết công khai ở C-14** | Bề mặt ẩn danh chỉ nên có một chỗ (Document, đã qua C-10 pentest) |
| 22 | **Feature flag `work_products`** theo org, mặc định tắt | FEATURE_WORKFLOW bước 4 và 7 |
| 23 | **Không port mã bản nháp.** Kế thừa ý tưởng nghiệp vụ; bỏ bảng artifact riêng, hai kho tệp song song, mọi số liệu mock | §10 |

## 4. Dữ liệu

Mọi bảng có `organization_id` (ADR 0008); bảng có `created_by` có `created_by_kind` (ADR 0007) — **dùng đúng tên `created_by` ở mọi bảng** để `TestActorKindOnEveryCreatedBy` soi được; không FK, index `CONCURRENTLY` mỗi file (ADR 0001); id ULID `TEXT` (ADR 0002).

### 4.1 `201_work_products`

```sql
CREATE TABLE work_products (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL,
  workspace_id          TEXT NOT NULL,
  type                  TEXT NOT NULL,                     -- §4.8
  title                 TEXT NOT NULL,                     -- 1..500 ký tự
  summary               TEXT NOT NULL DEFAULT '',          -- ≤ 2000 ký tự
  status                TEXT NOT NULL DEFAULT 'draft',
  visibility            TEXT NOT NULL DEFAULT 'workspace', -- 'workspace' | 'restricted'
  owner_user_id         TEXT NOT NULL,                     -- người chịu trách nhiệm nghiệp vụ
  primary_context_kind  TEXT,                              -- NULL | 'project' | 'task' | 'meeting'
  primary_context_id    TEXT,                              -- kiểm quyền + cùng workspace (§6.1)
  current_version       INTEGER NOT NULL DEFAULT 0,
  search_text           TEXT NOT NULL DEFAULT '',          -- foldForSearch(title + summary)
  revision              BIGINT NOT NULL DEFAULT 1,
  created_by            TEXT NOT NULL,
  created_by_kind       TEXT NOT NULL,
  updated_by            TEXT NOT NULL,
  updated_by_kind       TEXT NOT NULL,
  archived_at           TIMESTAMPTZ,
  archived_by           TEXT,
  purge_after           TIMESTAMPTZ,                       -- archived_at + 30 ngày, khớp Document
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_products_status_check CHECK (status IN
    ('draft','in_review','changes_requested','approved','final')),
  CONSTRAINT work_products_visibility_check CHECK (visibility IN ('workspace','restricted')),
  CONSTRAINT work_products_context_pair_check CHECK
    ((primary_context_kind IS NULL AND primary_context_id IS NULL)
     OR (primary_context_kind IS NOT NULL AND primary_context_id IS NOT NULL)),
  CONSTRAINT work_products_context_kind_check CHECK
    (primary_context_kind IS NULL OR primary_context_kind IN ('project','task','meeting'))
);
```

`archived` **không** có trong enum (quyết định §3.16): lưu trữ là `archived_at`, và trạng thái
nghiệp vụ được giữ nguyên để `/restore` trả về đúng chỗ cũ.

Index (`202`–`204`, mỗi file một index):

```sql
-- 202: danh sách theo workspace, lọc trạng thái
CREATE INDEX CONCURRENTLY idx_work_products_ws_updated
  ON work_products (workspace_id, updated_at DESC) WHERE archived_at IS NULL;
-- 203: "của tôi"
CREATE INDEX CONCURRENTLY idx_work_products_owner
  ON work_products (owner_user_id, status) WHERE archived_at IS NULL;
-- 204: tìm kiếm tiêu đề + tóm tắt (nội dung tìm qua §6.7)
CREATE INDEX CONCURRENTLY idx_work_products_search
  ON work_products USING gin (search_text gin_trgm_ops);
```

**Vòng đời trạng thái.** Mọi chuyển ngoài sơ đồ → 409 `work_product_invalid_transition`:

```
          ┌──────────────────── reopen ─────────────────────┐
          │                                                 │
draft ──▶ in_review ──┬──▶ approved ──▶ final               │
  ▲                   │        │                            │
  │                   └──▶ changes_requested ───────────────▶┘
  │                                │
  └────────────── reopen ──────────┘

approved ──▶ in_review          (xin duyệt lại sau khi đã duyệt)
approved | final ──▶ draft      (TỰ ĐỘNG khi tạo mốc mới — §3.15)
```

Ba luật đi kèm sơ đồ, vì bản 1 vẽ nhánh mà không có lệnh nào đi được:

1. `POST /reopen` (§6.1) là lệnh duy nhất đưa `in_review` hoặc `changes_requested` về `draft`;
   nó hủy mọi yêu cầu `pending` thành `canceled`. Cần `edit`.
2. Tạo mốc mới khi `approved` hoặc `final` **tự động** đưa về `draft` và hủy yêu cầu `pending`;
   sự kiện `work_product.status_changed` phát kèm.
3. `approved → in_review` hợp lệ (vòng đời thật: duyệt → khách sửa → duyệt lại).

Lưu trữ trực giao: archive được từ mọi trạng thái, `/restore` trả về đúng `status` cũ.

### 4.2 `205_work_product_representations`

```sql
CREATE TABLE work_product_representations (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  work_product_id   TEXT NOT NULL,
  document_id       TEXT NOT NULL,          -- documents.owner_kind='work_product', owner_id=work_product_id
  role              TEXT NOT NULL,          -- 'source' | 'export'
  format            TEXT NOT NULL,          -- 'native' | 'docx' | 'pdf' | 'xlsx' | 'pptx'
  position          DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at       TIMESTAMPTZ,
  CONSTRAINT wp_representations_role_check CHECK (role IN ('source','export')),
  CONSTRAINT wp_representations_format_check CHECK (format IN ('native','docx','pdf','xlsx','pptx'))
);
-- 206: một tài liệu chỉ từng là biểu diễn của đúng một Kết quả công việc — VĨNH VIỄN.
--      Cố ý KHÔNG có "WHERE archived_at IS NULL": gỡ rồi gắn sang work product khác
--      sẽ làm documents.owner_id (sổ quyền) và bảng này (sổ hiển thị) nói hai chuyện khác nhau.
CREATE UNIQUE INDEX CONCURRENTLY uidx_wp_representations_doc
  ON work_product_representations (document_id);
-- 207: tối đa một biểu diễn nguồn sống (tối thiểu một do service giữ — §3.4)
CREATE UNIQUE INDEX CONCURRENTLY uidx_wp_representations_source
  ON work_product_representations (work_product_id) WHERE role = 'source' AND archived_at IS NULL;
-- 208: liệt kê biểu diễn
CREATE INDEX CONCURRENTLY idx_wp_representations_wp
  ON work_product_representations (work_product_id, position) WHERE archived_at IS NULL;
```

**Bảng này không giữ byte, không giữ khóa lưu trữ, và không phải sổ quyền** (quyết định §3.3).
Quyền đọc một biểu diễn đi qua `documents.owner_id` → `EffectiveLevel` của C-14. Arch test giữ
luật này (§9.1.14), và bất biến hai chiều giữa hai bảng có test riêng (C-01 §13.7 test 6).

### 4.3 `209_work_product_versions`

```sql
CREATE TABLE work_product_versions (
  id                      TEXT PRIMARY KEY,
  organization_id         TEXT NOT NULL,
  workspace_id            TEXT NOT NULL,
  work_product_id         TEXT NOT NULL,
  version                 INTEGER NOT NULL,        -- 1, 2, 3… theo work product
  label                   TEXT,                    -- ≤ 200 ký tự
  change_summary          TEXT NOT NULL DEFAULT '',-- ≤ 2000 ký tự
  reason                  TEXT NOT NULL,           -- 'manual' | 'restore'
  restored_from           INTEGER,                 -- reason = restore
  representation_snapshot JSONB NOT NULL,          -- §4.4 — MỌI biểu diễn sống, không chỉ bản nguồn
  context_snapshot        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- §4.5
  created_by              TEXT NOT NULL,
  created_by_kind         TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wp_versions_reason_check CHECK (reason IN ('manual','restore'))
);
-- 210
CREATE UNIQUE INDEX CONCURRENTLY uidx_wp_versions_wp_version
  ON work_product_versions (work_product_id, version);
```

Chỉ INSERT từ service; không có lệnh sửa hay xóa phiên bản.

### 4.4 `representation_snapshot` — ghim mọi biểu diễn

Bản 1 chỉ ghim bản nguồn, nên một mốc đã duyệt vẫn bị thay ruột khi ai đó tải đè phiên bản
tệp mới lên biểu diễn `export`. Mốc phải ghim **mọi** biểu diễn sống tại thời điểm đó:

```json
[
  { "representation_id": "01J...", "document_id": "01J...", "document_version": 12,
    "role": "source", "format": "native" },
  { "representation_id": "01J...", "document_id": "01J...", "document_version": 3,
    "role": "export",  "format": "pdf" }
]
```

Khi tạo mốc, service tạo phiên bản tài liệu `manual` cho biểu diễn `source` rồi ghim số đó;
với các biểu diễn `export` nó ghim **phiên bản hiện hành** của chúng (không tạo phiên bản mới).
Tất cả trong **một transaction**.

**Nội dung không đổi thì ghim lại, không lỗi.** C-01 trả 409 `document_version_unchanged` khi
bản làm việc không đổi. Đặt hai mốc nghiệp vụ liên tiếp (ví dụ "bản nội bộ" rồi "bản gửi khách")
là hành vi hợp lệ, nên khi gặp trường hợp đó, C-14 **ghim lại phiên bản tài liệu hiện có** thay
vì tạo mới — đúng tinh thần §3.7 "phiên bản nghiệp vụ ≠ phiên bản tài liệu". Mã lỗi đó không
bao giờ thoát ra API của C-14.

### 4.5 `context_snapshot` — ảnh chụp nguồn gốc

Mảng; server dựng, client không bao giờ gửi (§3.11). Schema đóng, kiểm ở server; ngoài schema → 422.

```json
[
  { "kind": "meeting", "id": "01J...", "title": "Kickoff dự án Alpha",
    "ref": { "type": "occurred_at", "value": "2026-09-12T02:00:00Z" }, "used_by_ai": true },
  { "kind": "document", "id": "01J...", "title": "Quy trình báo giá",
    "ref": { "type": "document_version", "value": "7" }, "used_by_ai": false },
  { "kind": "project", "id": "01J...", "title": "Alpha",
    "ref": { "type": "updated_at", "value": "2026-09-10T04:00:00Z" }, "used_by_ai": false }
]
```

`ref.type` theo `kind`: `document` → `document_version` · `work_product` → `work_product_version`
· `meeting` → `occurred_at` · `project`, `task` → `updated_at`. Không có loại nào được để `ref` rỗng.

**Tập nguồn được ghim** (quyết định §3.10) = nguồn **đang bật** lúc tạo mốc **∪** nguồn mà các
lượt `ai/suggest` **được chấp nhận** kể từ mốc trước đã thực sự dùng (`used_by_ai = true`). Chỉ
lấy công tắc hiện tại thì chạy AI xong tắt nguồn đi là xóa được dấu vết.

**Đọc có lọc quyền** (quyết định §3.8). Ghi thì ghi đủ; khi trả qua API, mỗi phần tử được kiểm
lại quyền của **người đọc hiện tại** trên nguồn đó. Không có quyền → trả `{kind, ref, used_by_ai}`
và `title: null`, `id: null`, kèm cờ `redacted: true`. Id đầy đủ vẫn nằm trong audit. Nếu không
lọc, một người được mời duyệt một hợp đồng sẽ đọc được tiêu đề của "Hồ sơ lương 2026" chỉ vì nó
từng là nguồn.

### 4.6 `211_work_product_context_sources`

```sql
CREATE TABLE work_product_context_sources (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  work_product_id   TEXT NOT NULL,
  source_kind       TEXT NOT NULL,   -- 'project'|'task'|'meeting'|'document'|'work_product'
  source_id         TEXT NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wp_context_kind_check CHECK (source_kind IN
    ('project','task','meeting','document','work_product'))
);
-- 212
CREATE UNIQUE INDEX CONCURRENTLY uidx_wp_context_unique
  ON work_product_context_sources (work_product_id, source_kind, source_id);
```

Trạng thái hiện tại; tắt một nguồn không đụng ảnh chụp đã ghi. Trần 50 nguồn → 409
`work_product_context_limit`. Nguồn loại `work_product` **không mở rộng đệ quy**: context
builder đọc nội dung của chính nó, depth 0, không đi theo nguồn của nó.

### 4.7 `213_work_product_reviews` và `216_work_product_subscribers`

```sql
CREATE TABLE work_product_reviews (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  work_product_id   TEXT NOT NULL,
  version           INTEGER NOT NULL,        -- ≥ 1; xin duyệt khi current_version = 0 bị chặn
  reviewer_user_id  TEXT NOT NULL,
  due_date          DATE,
  state             TEXT NOT NULL DEFAULT 'pending',
  note              TEXT,                    -- ≤ 2000 ký tự
  decided_at        TIMESTAMPTZ,
  decided_by        TEXT,
  decided_by_kind   TEXT,
  created_by        TEXT NOT NULL,           -- người yêu cầu
  created_by_kind   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wp_reviews_state_check CHECK (state IN
    ('pending','approved','changes_requested','canceled'))
);
-- 214: một yêu cầu sống cho mỗi (work product, phiên bản, người xem xét)
CREATE UNIQUE INDEX CONCURRENTLY uidx_wp_reviews_live
  ON work_product_reviews (work_product_id, version, reviewer_user_id) WHERE state = 'pending';
-- 215: "chờ tôi duyệt", và tra quyền view của người đã từng xem xét (§5)
CREATE INDEX CONCURRENTLY idx_wp_reviews_reviewer
  ON work_product_reviews (reviewer_user_id, work_product_id);

-- 216: người theo dõi (mẫu: 186_task_subscriber_opt_out)
CREATE TABLE work_product_subscribers (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  work_product_id   TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  opted_out         BOOLEAN NOT NULL DEFAULT false,
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 217
CREATE UNIQUE INDEX CONCURRENTLY uidx_wp_subscribers
  ON work_product_subscribers (work_product_id, user_id);
```

Chủ sở hữu và người được mời xem xét **tự động** thành người theo dõi (bỏ theo dõi được bằng
`opted_out`), giống cách F-05 làm với task.

**Người xem xét là người.** Agent không bao giờ ở `reviewer_user_id` (ADR 0010, ADR 0017:
`accepted` chỉ người ghi) → 409 `work_product_reviewer_must_be_human`.

**Hợp thành trạng thái**, phát biểu cho không mâu thuẫn: Kết quả công việc chuyển sang
`approved` khi **không còn yêu cầu `pending` nào của phiên bản hiện hành và mọi yêu cầu đã
quyết của phiên bản đó đều `approved`**. Một `changes_requested` bất kỳ đưa nó về
`changes_requested` ngay và hủy các yêu cầu **còn `pending`** thành `canceled` (các yêu cầu đã
`approved` giữ nguyên).

### 4.8 Loại nghiệp vụ (`type`)

`proposal` · `report` · `analysis` · `contract` · `plan` · `deck` · `minutes` · `other`.

Enum đóng ở tầng service, không CHECK trong DB (để mở rộng không cần migration) — bù lại **bắt
buộc** có test liệt kê đủ 8 giá trị và nhãn vi/en (§9.2), vì không còn hàng rào ở tầng dữ liệu.
Nhãn trong `docs/conventions.md` §2. Mở rộng: câu hỏi mở §12.2.

## 5. Quyền

Một hàm `WorkProductService.EffectiveLevel(ctx, actor, wp) (Level, via)` là nguồn duy nhất cho
mọi handler, và là thứ mà bản cài `OwnerLevelResolver` của C-01 §13.4 gọi tới.

```
manage  nếu actor = owner_user_id (human)                          via=owner
     ∨  effective ws role ∈ {owner, admin} của wp.workspace         via=member
edit    nếu visibility = 'workspace' ∧ actor là effective member    via=member
view    nếu actor có bản ghi review trên wp ở BẤT KỲ trạng thái nào via=reviewer
     ∨  visibility = 'workspace' ∧ actor là agent member của ws     via=member (tối đa view)
none    còn lại → 404 (không lộ tồn tại)
```

Ba điểm bản 1 làm sai, nay sửa:

- **`restricted` bỏ CẢ HAI dòng `via=member`** — của người và của agent (quyết định §3.18). Bản 1
  chỉ bỏ dòng của người, nên thành viên thường không mở được hợp đồng còn agent thì mở được, và
  qua ủy quyền của C-01 §13.4 agent đọc luôn byte của tài liệu.
- **`via=reviewer` tính ở mọi trạng thái review**, không chỉ `pending` (quyết định §3.19). Bản 1
  làm người duyệt xong mất quyền xem chính thứ mình vừa ký, và người bị `canceled` mất quyền
  giữa chừng. Thu quyền chỉ khi bản ghi review bị xóa bởi lệnh hủy trước khi quyết.
- **Không có `via=share`** và không có liên kết công khai (quyết định §3.21).

| Hành động | view | edit | manage | Ghi chú |
|---|---|---|---|---|
| Mở, tìm, tải biểu diễn, xem phiên bản và ảnh chụp (đã lọc §4.5) | ✓ | ✓ | ✓ | |
| Sửa nội dung bản nguồn, đổi tiêu đề, tạo mốc, khôi phục | | ✓ | ✓ | tạo mốc ở `approved`/`final` → về `draft` (§3.15) |
| Thêm/bớt nguồn ngữ cảnh, bật/tắt, gọi lệnh AI | | ✓ | ✓ | |
| Thêm biểu diễn `export`, đổi biểu diễn `source` | | ✓ | ✓ | chỉ `format='native'` được làm `source` |
| `reopen` về `draft` | | ✓ | ✓ | |
| Mời người xem xét (`visibility = workspace`) | | ✓ | ✓ | |
| **Mời người xem xét (`restricted`)** | | | ✓ | lời mời cấp `view` → là chia sẻ (§3.20) |
| **Quyết duyệt / yêu cầu sửa** | **chỉ người được mời** | | | `manage` **không** quyết được (§3.13) |
| Hủy yêu cầu xem xét | | người yêu cầu | ✓ | |
| Chốt `approved → final` | | | ✓ | |
| Đổi `visibility`, đổi chủ sở hữu, archive | | | ✓ | |

Agent: `RequireAgentMember` cho đọc, tối đa `view`, và **không** trên `restricted`; agent không
bao giờ có `edit` trực tiếp và không bao giờ là người xem xét — ghi qua proposal (ADR 0010).

Platform admin `/admin/*` không đọc nội dung (luật F-11).

> **Khuyến nghị đưa vào plan:** dựng `TestEffectiveLevelTable` dạng bảng đầy đủ
> (visibility × ws role × owner × review state × actor_kind) → (level, via), giống C-01. Ba lỗi
> vừa sửa ở trên đều lộ ngay nếu viết dưới dạng bảng.

## 6. API

Tag `WorkProducts`; SDI/SDO ở `dto/{sdi,sdo}/work_product.go`; route `router/work_products.go`
sau `RequireFeatureFlag("work_products")` (404 `feature_disabled`); mọi route qua `RequireMember`.
Path param mới `{workProductID}`, `{wpVersionNo}`, `{representationID}`, `{reviewID}`,
`{contextSourceID}` → thêm `pathParamSDI`.

### 6.1 Kết quả công việc

| Method & path | Mô tả |
|---|---|
| `GET /api/v1/workspaces/{workspaceID}/work-products` | Danh sách; lọc `type`, `status`, `owner`, `q` (tiêu đề + tóm tắt), `context_kind`/`context_id`; phân trang cursor |
| `POST /api/v1/workspaces/{workspaceID}/work-products` | Tạo. Nhận `visibility` (mặc định `workspace`); `owner_user_id` = người tạo. Tạo luôn biểu diễn `source` `native` trong cùng transaction |
| `GET /api/v1/work-products/{workProductID}` | Chi tiết + biểu diễn + nguồn ngữ cảnh + yêu cầu xem xét |
| `PATCH /api/v1/work-products/{workProductID}` | Tiêu đề, tóm tắt, loại, ngữ cảnh chính, chủ sở hữu, `visibility`; `If-Match` revision → 422 `revision_conflict` |
| `POST /api/v1/work-products/{workProductID}/reopen` | `in_review`/`changes_requested` → `draft`, hủy yêu cầu `pending`. Cần `edit` |
| `POST …/archive` · `POST …/restore` | Archive kéo theo mọi tài liệu thuộc sở hữu (C-01 §13.6); `/restore` trả về đúng `status` cũ |

**Ngữ cảnh chính có kiểm quyền** (quyết định §3.5, §3.6). Ở cả POST và PATCH, server kiểm actor
có `EffectiveLevel ≥ view` trên `primary_context_id` **và** id đó cùng `workspace_id`. Không có
quyền → 404 (không lộ tồn tại). Khác workspace → 409 `cross_workspace_reference`. Bản 1 để cột
này không kiểm gì và gọi nó là "chỉ để hiển thị" — trong khi §7.3 chiếu nó thành cạnh đồ thị,
nên nó vừa rò tiêu đề vừa sinh cạnh không có nguồn chống lưng.

### 6.2 Biểu diễn

| Method & path | Mô tả |
|---|---|
| `GET …/{workProductID}/representations` | Liệt kê |
| `POST …/{workProductID}/representations` | Đính kèm định dạng: tải tệp lên → Document tạo tài liệu `kind=file` thuộc sở hữu → bảng nối ghi `role='export'` |
| `PATCH …/representations/{representationID}` | Đổi `position`; đổi `role` sang `source` — **chỉ khi `format='native'`**, và hạ biểu diễn `source` cũ xuống `export` trong cùng transaction. Định dạng khác → 409 `work_product_source_must_be_native` |
| `DELETE …/representations/{representationID}` | **Archive cả dòng biểu diễn và tài liệu trong một transaction**, đặt `purge_after` (C-01 §13.6). Gỡ biểu diễn `source` cuối cùng → 409 `work_product_source_required` |

Tải tệp về đi qua đúng endpoint của Document — C-14 không có đường tải riêng.

### 6.3 Phiên bản

| Method & path | Mô tả |
|---|---|
| `GET …/{workProductID}/versions` | Danh sách mốc; ảnh chụp đã lọc quyền (§4.5) |
| `POST …/{workProductID}/versions` | Tạo mốc. Ghim mọi biểu diễn sống (§4.4) + dựng `context_snapshot` (§4.5), cùng transaction. Ở `approved`/`final` → trạng thái về `draft`, hủy yêu cầu `pending` |
| `GET …/versions/{wpVersionNo}` | Chi tiết một mốc |
| `POST …/versions/{wpVersionNo}/restore` | Khôi phục: tạo phiên bản tài liệu mới từ nội dung mốc đó + mốc nghiệp vụ mới `reason=restore`, `restored_from` ghi số cũ. Không xóa lịch sử |

### 6.4 Nguồn ngữ cảnh và AI

| Method & path | Mô tả |
|---|---|
| `GET …/{workProductID}/context-sources` | Nguồn + công tắc + **gợi ý** từ Work Graph depth-1 (chưa thêm). Gợi ý cần C-11 → lát 4 |
| `POST …/context-sources` | Thêm nguồn. Body **chỉ** `{source_kind, source_id}`. Server kiểm quyền actor trên nguồn (không có → 404) **và** cùng `workspace_id` (khác → 409 `cross_workspace_reference`) |
| `PATCH …/context-sources/{contextSourceID}` | Bật/tắt |
| `DELETE …/context-sources/{contextSourceID}` | Bỏ nguồn |
| `POST …/{workProductID}/ai/suggest` | Lệnh AI trên đoạn được chọn: `{op, selection, instruction?}`, `op ∈ ask\|improve\|shorten\|expand\|rewrite\|translate`. Trả **đề xuất**, không ghi |
| `POST …/{workProductID}/ai/accept` | Ghi đề xuất vào bản nguồn; **ghi lại tập nguồn lượt đó đã thực sự dùng** để §4.5 hợp vào mốc kế tiếp |

Ràng buộc cùng workspace cho nguồn ngữ cảnh là bắt buộc: thiếu nó, người thuộc cả workspace A và
B gắn được tài liệu của B làm nguồn cho deliverable ở A, sau đó **mọi** người có `view` ở A đọc
được tiêu đề đó trong ảnh chụp, AI nạp nội dung của B vào deliverable của A, và §7.3 sinh cạnh
`REFERENCES` xuyên workspace.

`ai/suggest` đi qua `ai.Gateway` (ADR 0010): context builder chạy **bằng quyền của actor**, ngân
sách cứng, nội dung nguồn bọc `<untrusted>`, citation validator. Metering theo org/actor/model.
Nguồn đang **tắt** không bao giờ vào prompt (test §9.1.1).

### 6.5 Xem xét và duyệt

| Method & path | Mô tả |
|---|---|
| `POST …/{workProductID}/reviews` | Mời xem xét `{reviewer_user_ids[], due_date?}` trên phiên bản hiện hành; `status` → `in_review`. **`current_version = 0` → 409 `work_product_no_version`.** Trên `restricted` cần `manage` (§3.20) |
| `POST …/reviews/{reviewID}/decide` | `{decision, note?}`. **Chỉ người được mời** — `manage` không quyết được (§3.13). Phiên bản đã cũ → 409 `work_product_stale_version` |
| `DELETE …/reviews/{reviewID}` | Hủy yêu cầu (người yêu cầu hoặc `manage`) |
| `POST …/{workProductID}/finalize` | `approved` → `final`; cần `manage` |
| `GET /api/v1/me/work-product-reviews` | "Chờ tôi duyệt". Route cắt ngang nhiều org và workspace: **tự lọc** theo membership của người gọi và theo cờ `work_products` của **từng** org; không đi qua `RequireMember` của một workspace cụ thể |

### 6.6 Người theo dõi

`POST …/{workProductID}/subscribe` · `DELETE …/{workProductID}/subscribe` (đặt `opted_out`).
Chủ sở hữu và người được mời xem xét được thêm tự động.

### 6.7 Tìm kiếm nội dung

`GET /api/v1/workspaces/{workspaceID}/work-products/search?q=` — **C-14 sở hữu truy vấn này**
(C-01 §13.5): join `documents.search_text` của tài liệu thuộc sở hữu → `work_product_representations`
→ `work_products`, lọc bằng `EffectiveLevel`, trả về **Kết quả công việc**. Endpoint danh sách
tài liệu của C-01 loại hẳn tài liệu thuộc sở hữu.

### 6.8 Lỗi ổn định

`revision_conflict` (422) · `work_product_invalid_transition` (409) · `work_product_stale_version`
(409) · `work_product_no_version` (409) · `work_product_source_required` (409) ·
`work_product_source_must_be_native` (409) · `work_product_context_limit` (409) ·
`cross_workspace_reference` (409 — dùng lại mã của C-01) ·
`work_product_reviewer_not_member` (409) · `work_product_reviewer_must_be_human` (409) ·
`document_owned_by_work_product` (409 — từ C-01 §13) · `feature_disabled` (404) ·
`forbidden` / `not_found`. Thêm một lần ở `mapServiceError`.

Quota dung lượng kế thừa `storage.bytes` của Document; C-14 **không** có entitlement riêng
(câu hỏi mở §12.5), nên không khai `entitlement_required` ở đây.

## 7. Sự kiện, realtime, worker

### 7.1 Catalogue (thêm ở **ba** nơi: `docs/events/CATALOGUE.md`, `internal/outbox/catalogue.go`, `packages/core/types/events.ts`)

| Sự kiện | Client thấy | Dùng cho |
|---|---|---|
| `work_product.created` | ids | projector, danh sách |
| `work_product.updated` | ids | danh sách, chi tiết (gồm đổi ngữ cảnh chính → projector) |
| `work_product.status_changed` | ids | Home, notification, projector |
| `work_product.version_created` | ids | lịch sử |
| `work_product.representation_added` | ids | chi tiết, projector (thêm cạnh `REALIZED_AS`) |
| **`work_product.representation_removed`** | ids | chi tiết, projector (**gỡ** cạnh `REALIZED_AS`) |
| **`work_product.context_source_changed`** | ids | projector (thêm/gỡ cạnh `REFERENCES` khi thêm, bỏ, bật, tắt) |
| `work_product.review_requested` | ids | notification |
| `work_product.review_decided` | ids | notification |
| `work_product.archived` · `work_product.restored` | ids | danh sách, projector |

Hai sự kiện in đậm là thứ bản 1 thiếu. Không có chúng, projector hoặc không bao giờ dựng được
cạnh `REFERENCES` (§7.3 nói nó chiếu từ nguồn ngữ cảnh đang bật), hoặc phải đọc thẳng bảng
nghiệp vụ ngoài đường outbox — đúng điều **ADR 0019 cấm**. Và cạnh `REALIZED_AS` sẽ không bao
giờ bị gỡ.

**Payload chỉ mang id**; không dòng nào khai `Patch` (ADR 0015 chỉ mở cho `task.updated`). Mọi
sự kiện phát qua outbox trong cùng transaction với lệnh (ADR 0009). Mỗi lệnh thêm một dòng vào
`server/internal/service/audit_coverage_test.go` **cùng lúc** — thiếu là test đỏ.

### 7.2 Notification

`work_product_review_requested` (người được mời) · `work_product_review_decided` (chủ sở hữu +
người yêu cầu) · `work_product_finalized` (**người theo dõi** — bảng `216`, §4.7). Sinh từ
**outbox consumer**, không từ handler (luật F-07).

### 7.3 Work Graph (C-11)

Projector đọc các sự kiện §7.1 và chiếu (ADR 0019 — **không** ghi đồ thị trong transaction
nghiệp vụ). C-14 **thêm dòng khai báo** loại node `WORK_PRODUCT` và ba loại quan hệ dưới đây vào
catalogue từ vựng của C-11; loại không khai thì projector từ chối (ADR 0019 §"Test giữ luật").

| Cạnh | Nguồn | Gỡ khi |
|---|---|---|
| `WORK_PRODUCT --REALIZED_AS--> DOCUMENT` | `work_product_representations` sống | `representation_removed` |
| `WORK_PRODUCT --REFERENCES--> {PROJECT,TASK,MEETING,DOCUMENT,WORK_PRODUCT}` | nguồn ngữ cảnh **đang bật**, nguồn gốc = người tạo | `context_source_changed` (bỏ hoặc tắt) |
| `WORK_PRODUCT --BELONGS_TO--> {PROJECT,TASK,MEETING}` | `primary_context_*` (đã kiểm quyền và cùng workspace, §6.1) | `updated` khi đổi/bỏ ngữ cảnh chính |

Quan hệ "lượt thực thi nào tạo ra deliverable này" **không** thuộc C-14 — cần bảng nối của
ADR 0017, làm ở A-01.

### 7.4 Worker

**Một job, hai lệnh, đúng thứ tự** (C-01 §13.6): job purge của Document gọi
`WorkProductService.PurgeExpired()` **trước**, rồi `DocumentService.PurgeExpired()`. Mỗi service
chỉ xóa bảng của mình — gói Document không được xóa bảng của Work Product, vì đó là đảo chiều
phụ thuộc mà ADR 0016 dựng lên. Đưa vào chuỗi shutdown `main.go`, không goroutine trần. Trang
`docs/ops/RUNBOOK_WORK_PRODUCTS.md`.

## 8. Frontend

### 8.1 File map

Theo đúng quy ước repo: **hàm endpoint ở `packages/core/api/endpoints/`** (luật "API Compatibility":
chỉ thư mục đó được tạo hình response), **kiểu ở `packages/core/types/`**.

| Path | Trách nhiệm |
|---|---|
| `packages/core/types/work-product.ts` | `WorkProduct`, `WorkProductType`, `WorkProductStatus`, `Representation`, `WorkProductVersion`, `ContextSource`, `Review`; schema lenient (`z.string()` cho enum) |
| `packages/core/api/endpoints/work-products.ts`, `work-products-versions.ts`, `work-products-reviews.ts` (+ `.test.ts`) | Mọi hàm §6, `parseWithFallback`, malformed test từng hàm |
| `packages/core/work-products/keys.ts` | `workProductKeys.list(wsId, filter)`, `.detail(id)`, `.versions(id)`, `.contextSources(id)`, `.reviews(id)`, `.myReviews()` — key theo workspace luôn kèm `wsId` |
| `packages/core/work-products/hooks.ts`, `hooks-versions.ts`, `hooks-reviews.ts` | Query/mutation; autosave bản nguồn dùng lại `useAutosaveDocument` của C-01; không optimistic cho create/delete/quyết duyệt |
| `packages/core/types/events.ts` | 10 topic §7.1 |
| `packages/core/realtime/use-realtime-sync.ts` | case `work_product.*` → invalidate keys (ids-only, không patch cache) |
| `packages/core/permissions/rules.ts` | `canViewWorkProduct`, `canEditWorkProduct`, `canManageWorkProduct`, `canDecideReview`; mỗi rule cite dòng Go của §5 |
| `packages/core/paths/paths.ts` | `workspace(org, ws).workProducts()`, `.workProduct(id)`; reserved slug `work-products`; `paths/consistency.test.ts` phải xanh |
| `packages/core/feature-flags` | `useFlag("work_products", false)` gate nav + route |
| `packages/views/work-products/work-products-page.tsx` | `CollectionPageHeader` + `CollectionPageState` |
| `packages/views/work-products/work-product-create-dialog.tsx` | Hai bước: loại + mẫu → ngữ cảnh |
| `packages/views/work-products/work-product-detail.tsx` | `BreadcrumbHeader`, ba vùng, chế độ tập trung |
| `packages/views/work-products/context-panel.tsx` | Bảng nguồn + công tắc + gợi ý (lát 4) |
| `packages/views/work-products/representations-panel.tsx`, `versions-panel.tsx`, `review-panel.tsx` | |
| `packages/views/work-products/ai-selection-toolbar.tsx` | Bôi đen → đề xuất → Chấp nhận/Từ chối/Tạo lại |
| `packages/views/layout/app-sidebar.tsx` | Mục nav sau flag |
| `packages/views/search/search-command.tsx` | Nhóm kết quả "Kết quả công việc" (dùng §6.7) |
| `packages/views/home/` | Thẻ "chờ bạn duyệt" và "AI đã tạo bản nháp" |

Trình soạn thảo bản `native` **dùng lại** editor của C-01 (TipTap) — không editor thứ hai. File
`.tsx` ≤ 500 dòng; mọi chuỗi qua `t()`. Ngân sách bundle: route chi tiết nằm trong trần hiện có,
kiểm bằng `size-limit` như mọi route.

### 8.2 i18n và glossary

Thêm vào `docs/conventions.md` §2: **Work Product → "Kết quả công việc"** (không dịch "sản phẩm
công việc", tránh đụng `work_units`); representation → "biểu diễn"; source → "bản nguồn"; context
source → "nguồn ngữ cảnh"; review → "xem xét"; approve → "duyệt"; changes requested → "yêu cầu
sửa"; subscriber → "người theo dõi". vi và en đủ cặp (cổng parity F-14).

### 8.3 Hành vi

- Trạng thái rỗng nói cách tạo Kết quả công việc đầu tiên; **không** hàng giả, không số giả.
- Thanh công cụ AI luôn hiện bản xem trước; không đường nào ghi thẳng.
- Bảng nguồn ngữ cảnh hiện nguồn nào đang bật **ngay cạnh** nút gọi AI, không giấu trong menu.
- Phần tử ảnh chụp bị lọc quyền hiện "Nguồn bạn không có quyền xem", không hiện tiêu đề.
- Mobile: đọc, xem phiên bản, duyệt. Không soạn thảo.
- Không lỗi tràn ngang ở 390px; đích chạm ≥ 44px.

## 9. Kiểm thử bắt buộc

### 9.1 Go (Postgres thật, `-race`)

1. **Nguồn tắt không vào prompt.** Tắt một nguồn → `ai/suggest` → nội dung nguồn đó không có
   trong payload gửi gateway.
2. **Chiều ngược lại: nguồn đã dùng thì không xóa được dấu vết.** Chạy AI với 5 nguồn → chấp
   nhận → tắt 3 nguồn → tạo mốc → `context_snapshot` vẫn có đủ 5, ba nguồn kia mang
   `used_by_ai = true`.
3. **Client không khai được nguồn gốc.** `source_id` mà actor không có quyền → 404, không rò tiêu
   đề. Gửi thêm `title` trong body → bị bỏ qua.
4. **Ảnh chụp bất biến khi ghi, lọc khi đọc.** Tạo mốc → sửa tiêu đề nguồn → ảnh chụp cũ không
   đổi. Người không có quyền trên một nguồn đọc mốc → phần tử đó `redacted: true`, `title` và
   `id` là null.
5. **Cùng workspace.** Nguồn ngữ cảnh và ngữ cảnh chính khác workspace → 409
   `cross_workspace_reference`, kể cả khi actor là thành viên của cả hai.
6. **Ngữ cảnh chính có kiểm quyền.** Đặt `primary_context_id` là dự án actor không xem được → 404.
7. **`restricted` đóng với cả agent.** Agent member của workspace → `none` trên wp `restricted`;
   và qua ủy quyền, `effectiveLevel` của tài liệu thuộc sở hữu cũng `none`.
8. **Người xem xét giữ quyền sau khi quyết.** Duyệt xong → vẫn `view`. Bị `canceled` → vẫn `view`.
9. **`manage` không quyết duyệt được.** ws admin không được mời → `decide` trả 403.
10. **Chỉ duyệt phiên bản hiện hành, và phải có phiên bản.** Mời ở v3 → tạo v4 → decide → 409
    `work_product_stale_version`. Mời khi `current_version = 0` → 409 `work_product_no_version`.
11. **Hợp thành trạng thái.** Mời 3 người. #1 duyệt → vẫn `in_review`. #2 yêu cầu sửa →
    `changes_requested`; review của **#3** (đang `pending`) thành `canceled`; review của #1 giữ
    `approved`.
12. **Cổng duyệt khóa nội dung.** Ở `approved`, tạo mốc mới → `status` về `draft`, mọi yêu cầu
    `pending` thành `canceled`, sự kiện `status_changed` phát.
13. **Máy trạng thái đi được hết sơ đồ.** `approved → in_review` hợp lệ; `reopen` từ
    `changes_requested` về `draft`; ma trận chuyển sai → 409.
14. **Arch test**: `work_product_representations` không mang cột trỏ object storage; gói Work
    Product không import storage adapter; bản cài `OwnerLevelResolver` không đọc bảng `documents`
    (khớp C-01 §13.7 test 7).
15. **Mốc ghim mọi biểu diễn.** Tạo mốc → tải đè phiên bản mới lên biểu diễn `export` → mốc cũ
    vẫn trỏ phiên bản cũ.
16. **Mốc liên tiếp không lỗi.** Tạo hai mốc mà không sửa gì → cả hai thành công, mốc thứ hai
    ghim lại phiên bản tài liệu hiện có; `document_version_unchanged` không thoát ra API.
17. **Chỉ `native` làm `source`.** Đặt biểu diễn `docx` thành `source` → 409. Đặt `native` khác
    thành `source` → biểu diễn cũ tự hạ xuống `export`. Gỡ `source` cuối → 409.
18. **Gỡ biểu diễn archive cả hai.** DELETE → cả dòng biểu diễn và tài liệu có `archived_at` +
    `purge_after`; không tài liệu mồ côi (khớp bất biến C-01 §13.7 test 6).
19. **Cách ly tổ chức và workspace** cho mọi lệnh: đọc, sửa, thêm nguồn, nối biểu diễn, tạo mốc,
    duyệt.
20. **Người xem xét phải là người** → agent id → 409.
21. **Hai cổng duyệt tách — dạng test âm.** Không code path nào của C-14 đổi `work_products.status`
    ngoài §6.1 (`reopen`, tạo mốc) và §6.5 (`decide`, `finalize`). Viết là arch test / grep test
    trên tầng service, **không** dựng lượt chạy AI giả lập: A-01 chưa tồn tại nên một test giả
    lập sẽ không bắt được chính thứ nó tuyên bố bắt. Test thật cho ADR 0017 thuộc A-01.
22. **Audit coverage**: mọi lệnh có dòng trong `audit_coverage_test.go`. **Migration lint** xanh.

### 9.2 Frontend

- `api/endpoints/*`: mỗi hàm có ca malformed-response, degrade chứ không throw.
- `rules.ts`: bảng test cho bốn rule, khớp từng dòng §5 — gồm ca `restricted` + agent và ca
  `manage` không quyết duyệt.
- `types`: test liệt kê đủ 8 giá trị `type` và nhãn vi/en (thay cho CHECK trong DB, §4.8).
- `views`: trạng thái rỗng/lỗi không render hàng giả; thanh công cụ AI không ghi khi chưa chấp
  nhận; phần tử ảnh chụp bị lọc hiện đúng chuỗi thay thế.

### 9.3 E2E (`e2e/work-products.spec.ts`)

1. Tạo từ một dự án → soạn → bật một nguồn → gọi AI → chấp nhận → tạo mốc → ảnh chụp hiện đúng
   nguồn đã dùng.
2. Mời xem xét → người khác duyệt → trạng thái đổi → thông báo tới chủ sở hữu.
3. Tìm kiếm (§6.7) thấy Kết quả công việc theo **nội dung** biểu diễn và tôn trọng quyền.
4. Người ngoài workspace mở URL trực tiếp → 404.

### 9.4 Hiệu năng

Danh sách 1.000 Kết quả công việc: p95 < 300 ms. Chi tiết kèm biểu diễn, nguồn ngữ cảnh và 50
mốc: p95 < 400 ms. Tìm kiếm §6.7 trên 10.000 tài liệu thuộc sở hữu: p95 < 500 ms. Vào k6 nightly.

## 10. Kế thừa từ bản nháp và cái gì bỏ

**Kế thừa (ý tưởng nghiệp vụ):** loại nghiệp vụ tách khỏi định dạng — bản nháp gọi đây là "bất
biến lâu dài" và đúng · ảnh chụp nguồn gốc trên phiên bản · bảng chọn nguồn ngữ cảnh tường minh ·
luật "AI luôn xem trước, chỉ ghi khi người chấp nhận" · lỗ hổng bảo mật bản nháp tự phát hiện
(client không được khai nguồn gốc) · không gắn cứng `project_id` · "chỉ duyệt được phiên bản
hiện hành".

**Bỏ:** bảng artifact riêng và kho tệp thứ hai (ADR 0016) · toàn bộ mã TypeScript và hàm PL/pgSQL
· bảng bình luận riêng (§12.1) · nhãn "Work Products" cho `/work-catalog` (A-09 đã đổi tên) ·
mọi số liệu mock.

## 11. Phân rã delivery

**Không ship lát sau khi lát trước chưa qua DoD.**

| Lát | Sub-issue | Nội dung | Điều kiện vào |
|---|---|---|---|
| 1a | UNI-639 | Migration 201–217, `WorkProductService`, `EffectiveLevel` + bảng test, `OwnerLevelResolver`, API §6.1–§6.3 và §6.5–§6.6, flag, core types/endpoints/hooks | **C-01 §13 đã xong** |
| 1b | UNI-639 | Projector Work Graph: node `WORK_PRODUCT`, ba loại quan hệ vào catalogue C-11, xử lý cả thêm và gỡ cạnh | **C-11 đã có bảng node/edge + projector runtime + catalogue** |
| 2 | UNI-640 | Danh sách + bộ lọc + tạo hai bước + chi tiết ba vùng + soạn thảo bản native + tự lưu | 1a |
| 3 | UNI-641 | Phiên bản + ảnh chụp (ghi và lọc đọc) + xem xét + duyệt + notification + người theo dõi. *(Bình luận: §12.1)* | 2 |
| 4 | UNI-642 | Bảng nguồn ngữ cảnh + gợi ý depth-1 + `ai/suggest` + `ai/accept` + thanh công cụ | 3, **C-11** |
| 5 | UNI-643 | Tìm kiếm §6.7, Home, liên kết ngược, mobile đọc-duyệt, E2E, runbook | 4 |

**Lát 1 đã tách làm 1a và 1b** vì roadmap ghi C-11 là `CHƯA` và spec C-11 còn `(cần viết)`: 1a
không cần C-11, 1b thì cần. Gộp lại thì lát 1 bị chặn bởi một tính năng chưa có spec.

Bật flag cho org UNICOM sau lát 2. Rollback mọi lát = tắt flag; migration forward-compatible.

## 12. Câu hỏi mở (chủ sở hữu sản phẩm quyết trước khi duyệt)

1. **Bình luận trên Kết quả công việc.** C-01 §12.3 đã hoãn bình luận trên tài liệu để chờ **một**
   cơ chế dùng chung cho task, tài liệu và Kết quả công việc. Làm riêng ở đây là bảng bình luận
   thứ ba. **Đề xuất:** hoãn — lát 3 ship "phiên bản + xem xét/duyệt". Cần xác nhận vì nó **thu
   hẹp lát 3** so với mô tả issue UNI-641 **và so với dòng roadmap C-14**; chốt hoãn thì phải sửa
   cả hai.
2. **Danh sách loại nghiệp vụ** (§4.8) có đủ cho pilot không, và tổ chức có được tự thêm loại
   không? **Đề xuất:** 8 loại cố định ở C-14; cho tự định nghĩa là đợt sau vì nó kéo theo cấu hình
   theo tenant và ảnh hưởng báo cáo A-11.
3. **Ai được tạo Kết quả công việc?** Hiện: mọi effective member. **Đề xuất:** giữ; hạn chế theo
   vai trò khi có yêu cầu thật.
4. **Trần phiên bản.** Document có trần 500 và job gộp. **Đề xuất:** chưa cần trần ở C-14 — mốc
   nghiệp vụ do người đặt, khối lượng nhỏ hơn hai bậc. Xem lại nếu pilot vượt 200 mốc.
5. **Entitlement riêng.** Dung lượng đã tính qua `storage.bytes`. **Đề xuất:** không ở C-14; thêm
   khi A-09 cần phân gói.
