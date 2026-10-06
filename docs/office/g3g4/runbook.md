# Office G3-G4: deploy và rollback

> **Trạng thái:** in-progress (UNI-819). Bản dev/beta chưa ký. Nguồn rollback: plan §8.2
> (`docs/superpowers/plans/2026-09-27-office-g3-g4.md`).

Ngắn gọn. Làm theo thứ tự. Chỗ nào ghi "Chưa có" là repo chưa có thứ đó.

## Hiện còn thiếu để chạy production

Đã kiểm trong repo. Làm xong các mục này mới deploy Office lên production.

**A. `office-engine` chưa có trên Helm.**
`deploy/app/uniwork/templates/` chỉ có `deployment-be.yaml` và `deployment-fe.yaml`. Engine chỉ có ở docker compose profile `office` và `apps/office-engine/Dockerfile`. Sidecar XLSX nằm **trong** image engine, không phải dịch vụ riêng. DevOps làm:

- [ ] Build và push image từ `apps/office-engine/Dockerfile` (build từ gốc repo).
- [ ] Thêm Deployment + Service **riêng tư** (không ra edge), cổng `8090`, cùng quyền như compose: bỏ hết capability trừ `CHOWN SETUID SETGID KILL DAC_OVERRIDE FOWNER`, `no-new-privileges`, root filesystem chỉ đọc, tmpfs `/tmp` 512m, bộ nhớ 2g, 2 cpu, `pids_limit` 256.
- [ ] Tạo Secret chứa `OFFICE_ENGINE_SERVICE_TOKEN` và `OFFICE_ENGINE_GRANT_KEY` (>= 32 ký tự, khác nhau).
- [ ] Đặt `OFFICE_ENGINE_OUTPUT_ORIGINS` = origin kho file.
- [ ] Mở NetworkPolicy: chỉ BE gọi engine; engine chỉ ra kho file.
- [ ] Phía BE: thêm `OFFICE_ENGINE_URL` vào `deploy/app/env/uniwork-be.env`, thêm hai khóa trên vào Secret của BE (hiện file env này **chưa có** biến Office nào).
- [ ] Thêm `DESKTOP_AUTH_*` vào `uniwork-be.env` (hiện **chưa có**; xem mục 3.2).
- [ ] Sau deploy chạy mục 4.

**B. Origin xem trước: ĐÃ nối sẵn.** `deploy/edge/{route,certificate,apisix-tls}.yaml` có `preview.unicomhub.com`; `PREVIEW_ORIGIN` có trong `uniwork-be.env`; Secret `uniwork-preview` (khóa `PREVIEW_CAPABILITY_SECRET`) khai trong `values.yaml`. Chỉ cần tạo Secret thật.

**C. Bản cài desktop: không có CI build.** `.github/workflows/ci.yml` không build hay upload bản cài. DevOps làm tay:

- [ ] Build: `pnpm --filter @uniwork/office-desktop package` (mục 5.1; macOS cần máy Mac).
- [ ] Ghi SHA-256 từng file.
- [ ] Upload lên một host HTTPS.
- [ ] Điền link vào `OFFICE_INSTALLER_DEV_URLS` / `BETA_URLS` / `STABLE_URLS` của BE (JSON theo nền tảng, ví dụ `{"win32-x64":"https://…-setup.exe","linux-x64-deb":"https://….deb"}`). Xem `.env.example`.
- [ ] `GET /api/v1/config` trả link này. Để trống = web hiện "chưa có bản tải"; không thay kênh khác.
- [ ] Bản build **chưa ký**: có cảnh báo SmartScreen/Gatekeeper; **không** tự cập nhật.

## 1. Office gồm những phần nào

| Phần | Chạy ở đâu | Cần gì |
| --- | --- | --- |
| Trình soạn web DOCX, XLSX, PPTX, PDF, MD, HTML | Trình duyệt, trong `apps/web` (code ở `packages/views/office/`) | Cờ `office_engine` bật; file lưu qua kho file (MinIO/S3) |
| Máy xử lý Office (`office-engine`) | Container riêng, cổng `8090`, chỉ Go gọi | 2 khóa bí mật; địa chỉ kho file; `docker compose --profile office` |
| Máy tính lại XLSX (`xlsx-sidecar`) | Nằm trong cùng image `office-engine`, do engine tự chạy | Không cần cấu hình riêng (`UNIWORK_XLSX_ASSETS` đã đặt trong image) |
| Khung xem trước MD/HTML | Origin riêng `preview.<host>`, cùng tiến trình Go | `PREVIEW_ORIGIN`, `PREVIEW_CAPABILITY_SECRET`, DNS + chứng chỉ riêng |
| Server Go | Như hiện tại | Migration, env, kho file |
| App desktop (Electron) | Máy người dùng | Bản cài chưa ký; đăng nhập qua server |

## 2. Trước khi deploy

- [ ] Nhánh đã qua `make check` (hoặc đúng mức cổng đã chọn).
- [ ] Có 2 khóa khác nhau, mỗi khóa >= 32 ký tự: `OFFICE_ENGINE_SERVICE_TOKEN`, `OFFICE_ENGINE_GRANT_KEY`.
- [ ] Có 1 khóa >= 32 ký tự cho `PREVIEW_CAPABILITY_SECRET` (khác `JWT_SECRET`).
- [ ] DNS + chứng chỉ cho `preview.<host>` (khác origin của app).
- [ ] Kho file (MinIO/S3) đã chạy, trình duyệt gọi tới được.
- [ ] Đã backup DB.
- [ ] Biết cách tắt cờ (mục 6) trước khi bật.

## 3. Deploy từng bước

### 3.1 Migration

1. Chạy `make migrate-up` (bên trong là `cd server && go run ./cmd/migrate up`).
2. Migration Office/desktop (đều trong `server/migrations/`):

| Tên | Để làm gì |
| --- | --- |
| `9991790521814499_office_jobs` (+ 4 index `…500` đến `…503`) | Bảng việc của engine |
| `9991790608225750_office_jobs_convert_result` | Kết quả chuyển đổi |
| `9991790722053464_desktop_auth` (+ index `…465` đến `…468`) | Đăng nhập desktop, phiên thiết bị |
| `9991790722053469_office_launch_sessions` (+ index `…471`, `…472`) | Phiên mở file từ web sang desktop |

3. Bảng file (`950` đến `977`) có từ trước. Không có migration nào xóa hay đổi dữ liệu cũ.

### 3.2 Biến môi trường

Server Go (mọi biến đã có trong `.env.example`):

| Biến | Nghĩa |
| --- | --- |
| `OFFICE_ENGINE_URL` | Địa chỉ engine. Bỏ trống = không có engine, job Office báo lỗi, phần còn lại chạy bình thường |
| `OFFICE_ENGINE_SERVICE_TOKEN`, `OFFICE_ENGINE_GRANT_KEY` | Hai khóa; **giống hệt** khóa của engine |
| `OFFICE_ENGINE_REQUEST_TIMEOUT_MS` | Chờ engine trả lời (mặc định trong ví dụ: 10000) |
| `OFFICE_JOB_MAX_DEADLINE_MS`, `OFFICE_JOB_RECONCILE_INTERVAL_MS` | Hạn tối đa một job; chu kỳ dọn job kẹt |
| `PREVIEW_ORIGIN` | Origin khung xem trước; phải khác `FRONTEND_ORIGIN` |
| `PREVIEW_CAPABILITY_SECRET`, `PREVIEW_ASSET_TTL`, `PREVIEW_ASSET_MAX_BYTES` | Khóa ký, thời hạn, trần byte |
| `DESKTOP_AUTH_CLIENT_ID`, `DESKTOP_AUTH_REDIRECT_URIS`, `DESKTOP_AUTH_DEPLOYMENT_IDS` | Cho phép app desktop đăng nhập (so khớp từng byte) |
| `DESKTOP_AUTH_CODE_TTL`, `DESKTOP_AUTH_ATTEMPT_TTL` | Hạn mã đăng nhập (120s) và lượt thử (10m) |
| `OFFICE_INSTALLER_{DEV,BETA,STABLE}_URLS` | Link tải bản cài theo nền tảng (JSON). `_URL` số ít là kiểu cũ, bỏ sau 2026-11-02 |
| `FEATURE_FLAGS_FILE` | File YAML cờ; có thể ghi đè bằng `FF_<TÊN_CỜ>` |
| `MINIO_*` hoặc `S3_*` (`STORAGE_BACKEND`) | Kho file |

Web (đặt **lúc build**, vì Next nhúng cứng): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_APP_URL`.
Không có biến `NEXT_PUBLIC_*` riêng cho Office.

Engine (đầy đủ ở `docs/ops/RUNBOOK_OFFICE_ENGINE.md`):

| Biến | Nghĩa |
| --- | --- |
| `OFFICE_ENGINE_SERVICE_TOKEN`, `OFFICE_ENGINE_GRANT_KEY` | Bắt buộc, >= 32 ký tự, khác nhau |
| `OFFICE_ENGINE_OUTPUT_ORIGINS` | Origin kho file mà engine được ghi vào. Trống = không ghi được |
| `OFFICE_ENGINE_MAX_WORKERS` (2), `OFFICE_ENGINE_MAX_QUEUE` (16) | Số việc chạy cùng lúc, hàng chờ |
| `OFFICE_ENGINE_SANDBOX` | Image đã đặt `required`; đừng đổi ở production |
| `OFFICE_ENGINE_FAULT_OPERATIONS` | Phải là `0` ngoài lúc test |

Sidecar XLSX: không có biến riêng cần đặt.

### 3.3 Chạy engine (profile `office`)

1. `docker compose --profile office build office-engine`
2. `docker compose --profile office up -d office-engine`
3. Giá trị mặc định trong compose chỉ để dev. Nơi dùng chung phải đặt khóa thật.

### 3.4 Kho file (MinIO/S3)

- Trình duyệt phải gọi được địa chỉ kho (`MINIO_PUBLIC_ENDPOINT` nếu khác địa chỉ nội bộ).
- `OFFICE_ENGINE_OUTPUT_ORIGINS` = origin kho file mà engine nhìn thấy.
- Cấu hình CORS của bucket: Chưa có — repo không có file hay bước CORS cho bucket. Xem `docs/superpowers/specs/2026-09-22-shared-file-service-design.md` (mục lỗi browser không tới được MinIO).
- Mục đích file `document_file` do FileService quản lý. Nếu job báo `file_purpose_disabled` thì mục đích này chưa mở ở bản đang chạy.

### 3.5 Origin xem trước

1. DNS `preview.<host>` trỏ vào cùng tiến trình Go (reverse proxy).
2. Chứng chỉ phủ cả hai tên. Không redirect, không alias app.
3. Giữ nguyên header broker trả (xem `docs/office/g3g4/preview-origin.md`, mục Proxy and headers).
4. Thiếu hoặc sai biến thì server **không khởi động** (đóng an toàn).

### 3.6 Cờ tính năng

| Cờ | Mặc định | Làm gì |
| --- | --- | --- |
| `documents` | tắt | Tài liệu trong workspace |
| `office_engine` | tắt | Công tắc tổng: bật trình soạn Office cho cả web và desktop host |
| `office_docx` `office_xlsx` `office_pptx` `office_pdf` `office_markdown` `office_html` | bật | Cho phép sửa riêng từng định dạng (cần `office_engine` bật) |
| `office_html_visual_edit` | tắt | Sửa HTML trực quan (chưa có giao diện) |

1. Bật `documents` rồi `office_engine`: đặt trong file YAML (`FEATURE_FLAGS_FILE`) hoặc `FF_OFFICE_ENGINE=true`.
2. Tắt/bật **riêng từng định dạng**: mỗi định dạng có cờ riêng, mặc định **bật** — `office_docx`, `office_xlsx`, `office_pptx`, `office_pdf`, `office_markdown`, `office_html`. Một định dạng chỉ sửa được khi `office_engine` **và** cờ của nó cùng bật. Để tắt một định dạng: `FF_OFFICE_DOCX=false` (đổi tên theo cờ) hoặc override trong file/org. Tệp định dạng đó mở ở màn xem/tải như khi tắt `office_engine`, không mở trình soạn; các định dạng khác không đổi. Desktop đọc cùng các cờ này (qua `GET /api/v1/config`, lấy lúc đăng nhập): tài liệu cloud thuộc định dạng bị tắt, hoặc khi không đọc được cấu hình, mở ở chế độ chỉ xem. Tệp cục bộ không bị cờ chặn.
3. Cờ chỉ ẩn tính năng, không cấp quyền.

## 4. Kiểm tra sau deploy

1. Server: `curl <api>/healthz` rồi `curl <api>/readyz` đều 200.
2. Engine: `curl 127.0.0.1:8090/healthz` ra `{"status":"ok"}`.
3. Engine sẵn sàng: `curl -H "Authorization: Bearer $OFFICE_ENGINE_SERVICE_TOKEN" 127.0.0.1:8090/readyz` ra 200.
4. Engine hỏng **không** làm `/readyz` của API hỏng. Xem số đo `uniwork_office_engine_ready`.
5. Mỗi định dạng (DOCX, XLSX, PPTX, PDF, MD, HTML), làm lần lượt:
   1. Tải một file mẫu lên Tài liệu.
   2. Mở bằng trình soạn.
   3. Sửa một chữ (PDF chỉ xem/ghi chú theo khả năng của trình soạn).
   4. Bấm Lưu (không có tự lưu).
   5. Đóng, mở lại: nội dung mới còn.
6. XLSX: nhập một công thức, lưu, mở lại. Công thức có giá trị đúng.
7. MD/HTML: mở xem trước. Địa chỉ khung phải là `PREVIEW_ORIGIN`, không phải origin app.
8. Tải file về từ lịch sử phiên bản.

## 5. App desktop

**Chưa ký.** Ký mã (code signing), notarization và tự cập nhật: **CHƯA LÀM**. Để backlog đến khi có chứng chỉ. Tự cập nhật luôn tắt.

### 5.1 Tạo bản dev/beta (chưa ký)

1. Dùng Node 22.23.2, `pnpm install --frozen-lockfile`.
2. Đặt `UNIWORK_OFFICE_CHANNEL` (`dev` hoặc `beta`; `stable` bị từ chối khi chưa ký) và `UNIWORK_OFFICE_BUILD_NUMBER`.
3. Build: `pnpm --filter @uniwork/office-desktop package` (Windows ZIP + setup).
4. Linux `.deb` + AppImage: `pnpm --filter @uniwork/office-desktop package:linux` (hoặc `package:linux:docker`).
5. macOS `.dmg`: `pnpm --filter @uniwork/office-desktop package:macos`, phải chạy trên máy macOS. Chưa có bằng chứng build/cài trên Mac thật.
6. Kiểm: `pnpm --filter @uniwork/office-desktop smoke` và `smoke:installer`.
7. Tên file có chữ `unsigned`. Lưu SHA-256 cạnh file.

### 5.2 Phát cho người dùng

1. Đặt link tải vào `OFFICE_INSTALLER_DEV_URLS` / `OFFICE_INSTALLER_BETA_URLS` (chỉ HTTPS).
2. Người dùng đăng nhập, bấm Tải trên web. Server trả gói có kèm hồ sơ deployment.
3. Không có hồ sơ deployment thì app báo `no_deployment_profile`. Tải lại từ web.

### 5.3 Người dùng sẽ thấy gì

| Hệ | Cảnh báo | Cách qua |
| --- | --- | --- |
| Windows | SmartScreen | **More info** rồi **Run anyway**; hoặc `Unblock-File` |
| macOS | Gatekeeper | Chuột phải app, **Open**, **Open** |
| Ubuntu AppImage | Cần `libfuse2` | Cài `libfuse2` |

Chi tiết: `desktop-install-macos-ubuntu.md`.

### 5.4 Đăng nhập và thu hồi thiết bị

- Đăng nhập kiểu PKCE qua trình duyệt, quay về `uniwork-office://auth/callback` (`uniwork-office-dev://…` với bản dev).
- Người dùng tự xem thiết bị: `GET /auth/desktop/devices`; tự thu hồi: `DELETE /auth/desktop/devices/{deviceSessionID}` (đều dưới `/api/v1`).
- Đăng xuất thiết bị: `POST /auth/desktop/logout`.
- Dùng lại refresh token cũ: server trả 401 `refresh_reused` và tự thu hồi thiết bị đó.
- Thu hồi thiết bị xong, lần gọi tiếp theo bị chặn ngay (`device_revoked`).
- Thu hồi thay người dùng bằng công cụ vận hành (CLI/admin): Chưa có — chỉ chủ tài khoản thu hồi được.

## 6. Khi có sự cố / rollback

Nguyên tắc (plan §8.2):

1. **Tắt sửa, giữ xem.** Tắt cờ `office_engine` (`FF_OFFICE_ENGINE=false` hoặc override trong file/org). Tài liệu đã lưu vẫn xem, tải, xem lịch sử theo quyền. Tắt riêng một định dạng: đặt cờ của nó về `false` (ví dụ `FF_OFFICE_DOCX=false`), các định dạng còn lại vẫn sửa được (mục 3.6).
2. **Không xóa nháp.** Giữ nguyên nháp mã hóa, khóa, và store. Rollback không được làm mất nháp.
3. **Không down migration.** Không chạy `make migrate-down` trên production.
4. **Không xóa blob.** FileService tự giữ staged/claim/GC. Không dọn tay kho file.
5. **Engine lỗi:** chỉ rollback engine nếu bản cũ đọc được các phiên bản đã tạo. Nếu không, chặn sửa; không để mất byte, không tự chuyển định dạng.
6. **Desktop:** thu hồi thiết bị lỗi (mục 5.4). Rollback không khôi phục thiết bị đã thu hồi, không dùng lại refresh token đã xoay.
7. **Cập nhật lỗi:** giữ app và file cũ, giữ nháp, không ép khởi động lại khi lưu checkpoint lỗi. Tắt cập nhật tách riêng với tắt ghi cloud.

Nói gì với người dùng:

- "Tạm thời chưa sửa được file Office. Bạn vẫn xem và tải được."
- "Nháp của bạn vẫn còn. Đừng xóa dữ liệu app."
- "Nếu máy bị mất hay lỗi, đăng nhập web và thu hồi thiết bị."

## 7. Lỗi hay gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Engine không khởi động | Hai khóa trùng nhau hoặc < 32 ký tự | Đặt hai khóa khác nhau |
| Job lỗi `output_write_*` | Kho file từ chối hoặc không tới được | Kiểm `OFFICE_ENGINE_OUTPUT_ORIGINS` và kho file |
| `503 engine_overloaded` | Hàng chờ đầy | Đợi; nếu hay lặp thì xét `OFFICE_ENGINE_MAX_WORKERS`/`MAX_QUEUE` sau khi đo |
| `timed_out` (`deadline`/`cpu_limit`) | File nặng, vượt hạn | Đo trước khi nâng giới hạn |
| `engine_crashed` (`memory_limit`/`temp_limit`) | Hết RAM/ổ tạm | Như trên |
| `failed` `output_limit` | Kết quả lớn hơn mức cho phép | Kiểm `max_bytes` của FileService (trần 50 MiB) |
| `file_purpose_disabled` | Mục đích `document_file` chưa mở | Cập nhật bản server có mục này |
| `501 unsupported_operation` | Thao tác chưa gắn (convert luôn thế) | Bình thường |
| Office job báo chưa cấu hình | `OFFICE_ENGINE_URL` trống | Đặt địa chỉ engine |
| Có tiến trình worker khi không có job | Tiến trình kẹt | Lấy `/metrics` + log, restart container |
| Server không lên, nhắc `PREVIEW_*` | Thiếu/sai biến xem trước | Sửa theo bảng ở `preview-origin.md` |
| Xem trước lỗi sau reverse proxy | Redirect hoặc alias origin app | Bỏ redirect; dùng host riêng |
| Desktop: `no_deployment_profile` | Thiếu hồ sơ deployment | Tải lại từ web |
| Desktop: 401 `refresh_reused` / `device_revoked` | Token cũ bị dùng lại, hoặc thiết bị đã thu hồi | Đăng nhập lại |
| Cập nhật báo `checkpoint_failed` | Lưu nháp cục bộ lỗi | Không khởi động lại; xem `desktop-packaging.md` mục Update and rollback |
| Nâng từ beta lên bản ký sau này mất khóa nháp | Keychain khác danh tính | Lưu file trước khi nâng cấp |

## 8. Tài liệu liên quan

- [RUNBOOK_OFFICE_ENGINE.md](../../ops/RUNBOOK_OFFICE_ENGINE.md): engine, giới hạn, XLSX sidecar
- [preview-origin.md](preview-origin.md): origin xem trước MD/HTML
- [desktop-packaging.md](desktop-packaging.md): đóng gói, cập nhật, rollback nháp
- [desktop-install-macos-ubuntu.md](desktop-install-macos-ubuntu.md): cài macOS, Ubuntu
- [desktop-auth-contract.md](desktop-auth-contract.md): đăng nhập, thiết bị, thu hồi
- [acceptance.md](acceptance.md): ma trận nghiệm thu
